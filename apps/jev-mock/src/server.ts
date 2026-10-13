import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  jevApiRequestSchema,
  jevApiResponseSchema,
  type ChoiceAnswer,
  type ChoiceQuestion,
  type Description,
  type JevAnswer,
  type JevApiRequest,
  type JevApiResponse,
  type JevQuestion,
  type ProblemDetails,
  type ScoreAnswer,
  type ScoreQuestion,
  type ValidationIssue,
} from '@centurion/contracts';
import { z } from 'zod';

/** Failure/latency modes the mock can simulate. 'ok' is the normal path. */
export const MOCK_MODES = ['429', '529', '422', 'latency', 'ok'] as const;
export type MockMode = (typeof MOCK_MODES)[number];

export const DEFAULT_LATENCY_MS = 250;
export const DEFAULT_PORT = 8080;

/** Default Noul probability when no keyword fixture matches. */
export const DEFAULT_NOUL = 0.2;

export interface NoulFixture {
  readonly keywords: readonly string[];
  readonly noul: number;
}

/**
 * Deterministic Noul fixtures, keyed by keywords found in the lower-cased
 * JSON-stringified state. First match wins, so order is significant.
 */
export const NOUL_FIXTURES: readonly NoulFixture[] = [
  { keywords: ['payment declined'], noul: 0.93 },
  { keywords: ['timeout', 'timed out'], noul: 0.9 },
];

const CHOICE_MATCHED_PROBABILITY = 0.85;
const CHOICE_DEFAULT_PROBABILITY = 0.6;
const CHOICE_MATCHED_CONFIDENCE = 0.8;
const CHOICE_DEFAULT_CONFIDENCE = 0.5;
const SCORE_LEVEL_PROBABILITY = 0.8;
const SCORE_CONFIDENCE = 0.8;

const PROBLEM_TYPE_BASE = 'https://centurion.local/problems/jev-mock';

const STATUS_TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  404: 'Not Found',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  529: 'Overloaded',
};

const mockModeRequestSchema = z.strictObject({ mode: z.enum(MOCK_MODES) });

export interface JevMockOptions {
  /** Added by the latency mode before answering normally. Defaults to 250. */
  readonly latencyMs?: number;
  /** Forces every response, as if the request asked for this mode. */
  readonly alwaysMode?: MockMode;
  /** Fails every Nth request with 429 when no explicit mode is requested. */
  readonly failEvery?: number;
}

export interface ModeResolutionInput {
  readonly requested?: MockMode | undefined;
  readonly global?: MockMode | undefined;
  readonly failEvery?: number | undefined;
  readonly requestCount: number;
}

/** Precedence: per-request mode > global mode > every-Nth 429 > ok. */
export function resolveMode(input: ModeResolutionInput): MockMode {
  if (input.requested !== undefined) {
    return input.requested;
  }
  if (input.global !== undefined) {
    return input.global;
  }
  if (
    input.failEvery !== undefined &&
    input.failEvery > 0 &&
    input.requestCount % input.failEvery === 0
  ) {
    return '429';
  }
  return 'ok';
}

export function isMockMode(value: unknown): value is MockMode {
  return typeof value === 'string' && (MOCK_MODES as readonly string[]).includes(value);
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseOptionalPositiveInteger(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Reads the mock configuration from the environment (all optional). */
export function createOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): JevMockOptions {
  const always = env.JEV_MOCK_ALWAYS;
  return {
    latencyMs: parsePositiveInteger(env.JEV_MOCK_LATENCY_MS, DEFAULT_LATENCY_MS),
    alwaysMode: isMockMode(always) ? always : undefined,
    failEvery: parseOptionalPositiveInteger(env.JEV_MOCK_429_EVERY),
  };
}

function stateText(state: JevApiRequest['state']): string {
  return JSON.stringify(state).toLowerCase();
}

/** Resolves a Noul probability from the keyword fixtures. */
export function noulFor(text: string): number {
  for (const fixture of NOUL_FIXTURES) {
    if (fixture.keywords.some((keyword) => text.includes(keyword))) {
      return fixture.noul;
    }
  }
  return DEFAULT_NOUL;
}

function distribution(
  keys: readonly string[],
  winner: string,
  winnerProbability: number,
): Record<string, number> {
  const probabilities: Record<string, number> = {};
  const others = keys.length - 1;
  const otherProbability = others > 0 ? (1 - winnerProbability) / others : 0;
  for (const key of keys) {
    probabilities[key] = key === winner ? winnerProbability : otherProbability;
  }
  return probabilities;
}

function answerChoice(question: ChoiceQuestion, text: string): ChoiceAnswer {
  const keys = Object.keys(question.criteria);
  const matched = keys.find((key) => text.includes(key.toLowerCase()));
  const winner = matched ?? keys[0];
  if (winner === undefined) {
    throw new Error('choice question has no criteria options');
  }
  const winnerProbability =
    matched === undefined ? CHOICE_DEFAULT_PROBABILITY : CHOICE_MATCHED_PROBABILITY;
  const confidence = matched === undefined ? CHOICE_DEFAULT_CONFIDENCE : CHOICE_MATCHED_CONFIDENCE;
  return {
    type: 'choice',
    choice: winner,
    probabilities: distribution(keys, winner, winnerProbability),
    confidence,
  };
}

function scoreIndex(text: string, maxIndex: number): number {
  if (text.includes('payment declined')) {
    return maxIndex;
  }
  if (text.includes('timeout') || text.includes('timed out')) {
    return Math.max(0, maxIndex - 1);
  }
  return Math.floor(maxIndex / 2);
}

function answerScore(question: ScoreQuestion, text: string): ScoreAnswer {
  const levels = question.criteria;
  const maxIndex = levels.length - 1;
  const index = scoreIndex(text, maxIndex);
  const probabilities: Record<string, number> = {};
  const otherProbability = maxIndex > 0 ? (1 - SCORE_LEVEL_PROBABILITY) / maxIndex : 0;
  const legend: Record<string, Description> = {};
  for (let level = 0; level <= maxIndex; level += 1) {
    const key = String(level);
    probabilities[key] = level === index ? SCORE_LEVEL_PROBABILITY : otherProbability;
    const description = levels[level];
    if (description !== undefined) {
      legend[key] = description;
    }
  }
  return { type: 'score', score: index, legend, probabilities, confidence: SCORE_CONFIDENCE };
}

/** Deterministically answers one question from the lower-cased state text. */
export function answerQuestion(question: JevQuestion, text: string): JevAnswer {
  switch (question.type) {
    case 'noul':
      return { type: 'noul', noul: noulFor(text) };
    case 'choice':
      return answerChoice(question, text);
    case 'score':
      return answerScore(question, text);
  }
}

/**
 * Builds a response that always satisfies jevApiResponseSchema: one answer per
 * requested id, the requested model echoed back, and the token usage that feeds
 * the gateway calibration metric.
 */
export function buildResponse(body: JevApiRequest): JevApiResponse {
  const text = stateText(body.state);
  const answers: Record<string, JevAnswer> = {};
  for (const [id, question] of Object.entries(body.questions)) {
    answers[id] = answerQuestion(question, text);
  }
  const inputTokens = Math.max(1, Math.ceil(JSON.stringify(body).length / 3));
  const outputTokens = 1 + Object.keys(answers).length;
  return {
    model: body.model,
    answers,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

function problemBody(
  status: number,
  detail: string,
  errors?: readonly ValidationIssue[],
): ProblemDetails {
  const body: ProblemDetails = {
    type: PROBLEM_TYPE_BASE + '/' + status,
    title: STATUS_TITLES[status] ?? 'Error',
    status,
    detail,
  };
  if (errors !== undefined && errors.length > 0) {
    body.errors = [...errors];
  }
  return body;
}

function sendProblem(
  reply: FastifyReply,
  status: number,
  detail: string,
  errors?: readonly ValidationIssue[],
): FastifyReply {
  return reply
    .status(status)
    .type('application/problem+json')
    .send(problemBody(status, detail, errors));
}

function readRequestedMode(request: FastifyRequest): MockMode | undefined {
  const header = request.headers['x-jev-mock-mode'];
  const headerValue = Array.isArray(header) ? header[0] : header;
  if (isMockMode(headerValue)) {
    return headerValue;
  }

  const query: unknown = request.query;
  if (typeof query === 'object' && query !== null && 'mode' in query) {
    const queryValue = (query as Record<string, unknown>).mode;
    if (isMockMode(queryValue)) {
      return queryValue;
    }
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface ErrorDetails {
  readonly status: number;
  readonly message: string;
}

function errorDetails(error: unknown): ErrorDetails {
  const rawStatus =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? (error as { statusCode?: unknown }).statusCode
      : undefined;
  return {
    status: typeof rawStatus === 'number' ? rawStatus : 500,
    message: error instanceof Error ? error.message : 'Unexpected error',
  };
}

/** Creates the Fastify app. Exported so tests can drive it with inject. */
export function buildServer(options: JevMockOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const latencyMs = options.latencyMs ?? DEFAULT_LATENCY_MS;
  const alwaysMode = options.alwaysMode;
  const failEvery = options.failEvery;

  let runtimeMode: MockMode | undefined;
  let requestCount = 0;
  const statusCounts: Record<string, number> = {};

  function recordStatus(status: number): void {
    const key = String(status);
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }

  app.get('/health', () => ({ status: 'ok' }));

  app.post('/__mock/mode', async (request, reply) => {
    const parsed = mockModeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      recordStatus(400);
      return sendProblem(reply, 400, 'Body must be { "mode": ' + MOCK_MODES.join(' | ') + ' }');
    }
    runtimeMode = parsed.data.mode;
    return reply.status(200).send({ mode: runtimeMode });
  });

  app.get('/__mock/stats', () => ({
    counts: { ...statusCounts },
    total: Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
  }));

  app.post('/v1/systemone', async (request, reply) => {
    requestCount += 1;
    const mode = resolveMode({
      requested: readRequestedMode(request),
      global: runtimeMode ?? alwaysMode,
      failEvery,
      requestCount,
    });

    if (mode === 'latency') {
      await delay(latencyMs);
    } else if (mode === '429' || mode === '529') {
      const status = Number(mode);
      recordStatus(status);
      return sendProblem(reply, status, 'Simulated Jev ' + mode + ' response from jev-mock');
    } else if (mode === '422') {
      recordStatus(422);
      return sendProblem(reply, 422, 'Simulated Jev 422 response from jev-mock');
    }

    const parsed = jevApiRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      recordStatus(422);
      const issues: ValidationIssue[] = parsed.error.issues.map((issue) => ({
        path: issue.path.map((segment) => String(segment)).join('.'),
        message: issue.message,
      }));
      return sendProblem(reply, 422, 'Request body failed Jev validation', issues);
    }

    const response = jevApiResponseSchema.parse(buildResponse(parsed.data));
    recordStatus(200);
    return reply.status(200).send(response);
  });

  // Fastify rejects malformed JSON before the handler runs; keep the Jev
  // contract of "bad request body -> 422 problem+json" for those too.
  app.setErrorHandler((error: unknown, _request, reply) => {
    const { status, message } = errorDetails(error);
    if (status === 400) {
      recordStatus(422);
      return sendProblem(reply, 422, 'Malformed request body: ' + message);
    }
    recordStatus(status);
    return sendProblem(reply, status, message);
  });

  return app;
}
