import { HttpResponse, http } from 'msw';
import type { z } from 'zod';

import {
  actionContentSchema,
  actionDtoSchema,
  actionExecutionSchema,
  evaluateRule,
  healthResponseSchema,
  problemDetailsSchema,
  readyResponseSchema,
  ruleContentSchema,
  ruleDtoSchema,
  ruleListResponseSchema,
  ruleTestRequestSchema,
  sseEventSchema,
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
  SseEvent,
  ValidationIssue,
} from '@centurion/contracts';

import { db, toRuleSnapshot, type StoredFlag } from './db';

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

function isInvalidFlag(flag: StoredFlag): flag is Extract<StoredFlag, { invalid: true }> {
  return 'invalid' in flag;
}

function problemResponse(status: number, title: string, detail?: string): Response {
  const problem: ProblemDetails = {
    type: 'about:blank',
    title,
    status,
    ...(detail === undefined ? {} : { detail }),
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
  const problem: ProblemDetails = {
    type: 'about:blank',
    title: 'Validation failed',
    status: 422,
    errors,
  };
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
    config: { url, ...(headers === undefined ? {} : { headers }), timeoutMs },
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
    const hasSecret = content.config.secret === undefined ? existingHasSecret : true;
    return webhookDto(content, id, hasSecret);
  }
  return kafkaDto(content, id);
}

let streamStep = 0;

const STREAM_RULE_ID = '11111111-1111-4111-8111-111111111111';

function mockStreamFlag(step: number): Flag {
  return {
    id: newId(),
    messageId: `mock-msg-${step}`,
    ruleId: STREAM_RULE_ID,
    ruleVersion: 3,
    outcome: 'triggered',
    answer: { type: 'noul', noul: 0.9 },
    sourceId: 'checkout-service',
    createdAt: new Date().toISOString(),
  };
}

/** A repeating, schema-valid event sequence for the dev/live feed. */
export function nextStreamEvent(step: number): SseEvent {
  const phase = step % 5;
  if (phase === 4) {
    return {
      type: 'consumer.status',
      data: { status: 'running', lag: 7 - (step % 4), at: new Date().toISOString() },
    };
  }
  if (phase === 2) {
    return { type: 'flag.created', data: mockStreamFlag(step) };
  }
  const status = phase === 0 ? 'clean' : phase === 1 ? 'flagged' : 'partial';
  return {
    type: 'log.processed',
    data: {
      messageId: `mock-${step}`,
      sourceId: phase === 1 ? 'checkout-service' : 'support-bot',
      level: phase === 3 ? 'warn' : 'info',
      status,
      flagCount: status === 'flagged' ? 1 : 0,
      partial: status === 'partial',
      model: 'jev-mock-1.0',
    },
  };
}

export const handlers = [
  http.get('/api/v1/health', () => HttpResponse.json(healthResponseSchema.parse({ status: 'ok' }))),

  http.get('/api/v1/ready', () => {
    const body = readyResponseSchema.parse(db.readiness);
    return HttpResponse.json(body, { status: body.status === 'ready' ? 200 : 503 });
  }),

  http.get('/api/v1/metrics', () => {
    return new HttpResponse(db.metricsText, {
      headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' },
    });
  }),

  http.get('/api/v1/stream', () => {
    const encoder = new TextEncoder();
    let interval: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': connected\n\n'));
        interval = setInterval(() => {
          streamStep += 1;
          const parsed = sseEventSchema.safeParse(nextStreamEvent(streamStep));
          if (!parsed.success) return;
          try {
            controller.enqueue(
              encoder.encode(
                `id: ${streamStep}\nevent: ${parsed.data.type}\ndata: ${JSON.stringify(parsed.data.data)}\n\n`,
              ),
            );
          } catch {
            if (interval !== undefined) clearInterval(interval);
          }
        }, 1500);
      },
      cancel() {
        if (interval !== undefined) clearInterval(interval);
      },
    });
    return new HttpResponse(stream, {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    });
  }),

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
    const items = db.ruleVersions
      .filter((version) => version.ruleId === id)
      .sort((a, b) => b.version - a.version);
    return HttpResponse.json({ items, total: items.length });
  }),

  http.get('/api/v1/actions', () => {
    const items = db.actions.map((action) => actionDtoSchema.parse(action));
    return HttpResponse.json({ items, total: items.length });
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
    const sourceId = url.searchParams.get('sourceId');
    const outcome = url.searchParams.get('outcome');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const hasTimeFilter = from !== null || to !== null;

    const items = db.flags.filter((flag) => {
      if (isInvalidFlag(flag)) return !hasTimeFilter;
      if (ruleId !== null && flag.ruleId !== ruleId) return false;
      if (sourceId !== null && flag.sourceId !== sourceId) return false;
      if (outcome !== null && flag.outcome !== outcome) return false;
      if (from !== null && flag.createdAt < from) return false;
      if (to !== null && flag.createdAt > to) return false;
      return true;
    });

    const sorted = [...items].sort((a, b) => {
      const aTime = isInvalidFlag(a) ? '' : a.createdAt;
      const bTime = isInvalidFlag(b) ? '' : b.createdAt;
      return bTime.localeCompare(aTime);
    });
    return HttpResponse.json({ items: sorted.slice(offset, offset + limit), limit, offset });
  }),

  http.get('/api/v1/flags/:id', ({ params }) => {
    const flag = db.flags.find((entry) => entry.id === String(params.id));
    if (flag === undefined) return problemResponse(404, 'Flag not found');
    return HttpResponse.json(flag);
  }),
];
