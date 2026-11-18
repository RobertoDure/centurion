import { HttpResponse, http } from 'msw';
import type { z } from 'zod';

import {
  actionContentSchema,
  actionDtoSchema,
  evaluateRule,
  problemDetailsSchema,
  ruleContentSchema,
  ruleDtoSchema,
  ruleListResponseSchema,
  ruleTestRequestSchema,
  actionExecutionSchema,
} from '@centurion/contracts';
import type {
  ActionContent,
  ActionDto,
  Flag,
  JevAnswer,
  LogEnvelope,
  ProblemDetails,
  RuleDto,
  RuleTestRequest,
  RuleTestResponse,
  ValidationIssue,
} from '@centurion/contracts';

import { db, toRuleSnapshot } from './db';

let idCounter = 0;

function newId(): string {
  const globalCrypto: Crypto | undefined = globalThis.crypto;
  if (globalCrypto !== undefined && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID();
  }
  idCounter += 1;
  const suffix = idCounter.toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4000-8000-${suffix}`;
}

function problemResponse(status: number, title: string, detail?: string): Response {
  const problem: ProblemDetails = {
    type: 'about:blank',
    title,
    status,
    ...(detail !== undefined ? { detail } : {}),
  };
  return HttpResponse.json(problemDetailsSchema.parse(problem), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

function validationProblem(error: z.ZodError): Response {
  const errors: ValidationIssue[] = error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.'),
    message: issue.message,
  }));
  const problem: ProblemDetails = { type: 'about:blank', title: 'Validation failed', status: 422, errors };
  return HttpResponse.json(problemDetailsSchema.parse(problem), {
    status: 422,
    headers: { 'content-type': 'application/problem+json' },
  });
}

function payloadText(envelope: LogEnvelope): string {
  if (typeof envelope.payload === 'string') return envelope.payload;
  return JSON.stringify(envelope.payload);
}

/** Deterministic stand-in for Jev so tests stay offline and reproducible. */
function buildTestResponse(request: RuleTestRequest): RuleTestResponse {
  const text = payloadText(request.sample).toLowerCase();
  const negative = /(success|succeeded|resolved|healthy|nominal|\bok\b)/.test(text);
  const question = request.question;
  let answer: JevAnswer;

  switch (question.type) {
    case 'noul':
      answer = { type: 'noul', noul: negative ? 0.08 : 0.86 };
      break;
    case 'choice': {
      const options = Object.keys(question.criteria);
      const fallback = options[0] ?? 'none';
      const chosen = negative ? (options[options.length - 1] ?? fallback) : fallback;
      const shared = options.length > 1 ? 0.2 / (options.length - 1) : 0;
      const probabilities: Record<string, number> = {};
      for (const option of options) {
        probabilities[option] = option === chosen ? (options.length > 1 ? 0.8 : 1) : shared;
      }
      answer = { type: 'choice', choice: chosen, probabilities, confidence: negative ? 0.55 : 0.82 };
      break;
    }
    case 'score': {
      const top = question.criteria.length - 1;
      const score = negative ? 0 : top;
      const rounded = Math.round(score);
      const shared = question.criteria.length > 1 ? 0.2 / (question.criteria.length - 1) : 0;
      const probabilities: Record<string, number> = {};
      const legend: Record<string, string> = {};
      question.criteria.forEach((level, index) => {
        const key = String(index);
        probabilities[key] = index === rounded ? (question.criteria.length > 1 ? 0.8 : 1) : shared;
        legend[key] = typeof level === 'string' ? level : JSON.stringify(level);
      });
      answer = { type: 'score', score, legend, probabilities, confidence: negative ? 0.6 : 0.88 };
      break;
    }
  }

  return {
    answer,
    verdict: evaluateRule({ condition: request.condition }, answer),
    model: 'jev-mock-1.0',
    usage: { inputTokens: 128, outputTokens: 16 },
  };
}

function webhookDto(
  content: Extract<ActionContent, { type: 'webhook' }>,
  id: string,
  hasSecret: boolean,
): ActionDto {
  const { url, headers, timeoutMs } = content.config;
  return {
    id,
    type: 'webhook',
    name: content.name,
    enabled: content.enabled,
    config: { url, ...(headers !== undefined ? { headers } : {}), timeoutMs },
    hasSecret,
  };
}

function kafkaDto(content: Extract<ActionContent, { type: 'kafka_topic' }>, id: string): ActionDto {
  return {
    id,
    type: 'kafka_topic',
    name: content.name,
    enabled: content.enabled,
    config: content.config,
    hasSecret: false,
  };
}

function actionDtoFromContent(
  content: ActionContent,
  id: string,
  existingHasSecret: boolean,
): ActionDto {
  if (content.type === 'webhook') {
    const hasSecret = content.config.secret !== undefined ? true : existingHasSecret;
    return webhookDto(content, id, hasSecret);
  }
  return kafkaDto(content, id);
}

export const handlers = [
  http.get('/api/v1/health', () => HttpResponse.json({ status: 'ok' })),

  http.get('/api/v1/rules', () => {
    const response = ruleListResponseSchema.parse({ items: db.rules, total: db.rules.length });
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/rules', async ({ request }) => {
    const parsed = ruleContentSchema.safeParse(await request.json());
    if (!parsed.success) return validationProblem(parsed.error);
    const now = new Date().toISOString();
    const rule = ruleDtoSchema.parse({
      ...parsed.data,
      id: newId(),
      version: 1,
      createdAt: now,
      updatedAt: now,
      invalid: false,
    });
    db.rules = [...db.rules, rule];
    db.ruleVersions = [
      ...db.ruleVersions,
      { ruleId: rule.id, version: rule.version, snapshot: toRuleSnapshot(rule), createdAt: now },
    ];
    return HttpResponse.json(rule, { status: 201 });
  }),

  http.post('/api/v1/rules/test', async ({ request }) => {
    const parsed = ruleTestRequestSchema.safeParse(await request.json());
    if (!parsed.success) return validationProblem(parsed.error);
    return HttpResponse.json(buildTestResponse(parsed.data));
  }),

  http.get('/api/v1/rules/:id', ({ params }) => {
    const rule = db.rules.find((entry) => entry.id === String(params.id));
    if (rule === undefined) return problemResponse(404, 'Rule not found');
    return HttpResponse.json(ruleDtoSchema.parse(rule));
  }),

  http.put('/api/v1/rules/:id', async ({ params, request }) => {
    const parsed = ruleContentSchema.safeParse(await request.json());
    if (!parsed.success) return validationProblem(parsed.error);
    const id = String(params.id);
    const existing = db.rules.find((entry) => entry.id === id);
    if (existing === undefined) return problemResponse(404, 'Rule not found');
    const now = new Date().toISOString();
    const rule = ruleDtoSchema.parse({
      ...parsed.data,
      id: existing.id,
      version: existing.version + 1,
      createdAt: existing.createdAt ?? now,
      updatedAt: now,
      invalid: false,
    });
    db.rules = db.rules.map((entry) => (entry.id === id ? rule : entry));
    db.ruleVersions = [
      ...db.ruleVersions,
      { ruleId: rule.id, version: rule.version, snapshot: toRuleSnapshot(rule), createdAt: now },
    ];
    return HttpResponse.json(rule);
  }),

  http.delete('/api/v1/rules/:id', ({ params }) => {
    const id = String(params.id);
    if (!db.rules.some((entry) => entry.id === id)) return problemResponse(404, 'Rule not found');
    db.rules = db.rules.filter((entry) => entry.id !== id);
    db.ruleVersions = db.ruleVersions.filter((version) => version.ruleId !== id);
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/v1/rules/:id/enable', ({ params }) => {
    const id = String(params.id);
    const rule = db.rules.find((entry) => entry.id === id);
    if (rule === undefined) return problemResponse(404, 'Rule not found');
    const updated: RuleDto = {
      ...rule,
      enabled: true,
      disabledReason: undefined,
      updatedAt: new Date().toISOString(),
    };
    db.rules = db.rules.map((entry) => (entry.id === id ? updated : entry));
    return HttpResponse.json(ruleDtoSchema.parse(updated));
  }),

  http.post('/api/v1/rules/:id/disable', ({ params }) => {
    const id = String(params.id);
    const rule = db.rules.find((entry) => entry.id === id);
    if (rule === undefined) return problemResponse(404, 'Rule not found');
    const updated: RuleDto = { ...rule, enabled: false, updatedAt: new Date().toISOString() };
    db.rules = db.rules.map((entry) => (entry.id === id ? updated : entry));
    return HttpResponse.json(ruleDtoSchema.parse(updated));
  }),

  http.get('/api/v1/rules/:id/versions', ({ params }) => {
    const id = String(params.id);
    const versions = db.ruleVersions
      .filter((version) => version.ruleId === id)
      .sort((a, b) => b.version - a.version);
    return HttpResponse.json(versions);
  }),

  http.get('/api/v1/actions', () => {
    return HttpResponse.json(db.actions.map((action) => actionDtoSchema.parse(action)));
  }),

  http.post('/api/v1/actions', async ({ request }) => {
    const parsed = actionContentSchema.safeParse(await request.json());
    if (!parsed.success) return validationProblem(parsed.error);
    const dto = actionDtoFromContent(parsed.data, newId(), false);
    db.actions = [...db.actions, dto];
    return HttpResponse.json(actionDtoSchema.parse(dto), { status: 201 });
  }),

  http.get('/api/v1/actions/:id/executions', ({ params }) => {
    const id = String(params.id);
    const executions = db.actionExecutions.filter((execution) => execution.actionId === id);
    return HttpResponse.json(executions.map((execution) => actionExecutionSchema.parse(execution)));
  }),

  http.get('/api/v1/actions/:id', ({ params }) => {
    const action = db.actions.find((entry) => entry.id === String(params.id));
    if (action === undefined) return problemResponse(404, 'Action not found');
    return HttpResponse.json(actionDtoSchema.parse(action));
  }),

  http.put('/api/v1/actions/:id', async ({ params, request }) => {
    const parsed = actionContentSchema.safeParse(await request.json());
    if (!parsed.success) return validationProblem(parsed.error);
    const id = String(params.id);
    const existing = db.actions.find((entry) => entry.id === id);
    if (existing === undefined) return problemResponse(404, 'Action not found');
    const dto = actionDtoFromContent(parsed.data, id, existing.hasSecret);
    db.actions = db.actions.map((entry) => (entry.id === id ? dto : entry));
    return HttpResponse.json(actionDtoSchema.parse(dto));
  }),

  http.delete('/api/v1/actions/:id', ({ params }) => {
    const id = String(params.id);
    if (!db.actions.some((entry) => entry.id === id)) return problemResponse(404, 'Action not found');
    db.actions = db.actions.filter((entry) => entry.id !== id);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/v1/flags', ({ request }) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? '50');
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const ruleId = url.searchParams.get('ruleId');
    const outcome = url.searchParams.get('outcome');
    let items: Flag[] = db.flags;
    if (ruleId !== null) items = items.filter((flag) => flag.ruleId === ruleId);
    if (outcome !== null) items = items.filter((flag) => flag.outcome === outcome);
    return HttpResponse.json({
      items: items.slice(offset, offset + limit),
      total: items.length,
    });
  }),
];
