import { describe, expect, it } from 'vitest';

import { jevApiResponseSchema } from '@centurion/contracts';

import { buildServer, createOptionsFromEnv, resolveMode, type JevMockOptions } from '../src/server';

const validRequest = {
  state: { message: 'the customer says hello' },
  model: 'jev-1.13.0',
  questions: {
    is_urgent: { type: 'noul', instructions: 'Is this urgent?' },
    department: {
      type: 'choice',
      instructions: 'Which department?',
      criteria: { billing: 'Billing', technical: 'Technical', sales: 'Sales' },
    },
    frustration: {
      type: 'score',
      instructions: 'How frustrated is the customer?',
      criteria: ['calm', 'frustrated', 'angry'],
    },
  },
} as const;

type App = ReturnType<typeof buildServer>;

interface AnswerShape {
  type: string;
  noul?: number;
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
  legend?: Record<string, unknown>;
}

interface ResponseBody {
  model: string;
  answers: Record<string, AnswerShape>;
  usage: { input_tokens: number; output_tokens: number };
}

interface ProblemShape {
  type: string;
  title: string;
  status: number;
  detail: string;
  errors?: { path: string; message: string }[];
}

async function withServer<T>(options: JevMockOptions, fn: (app: App) => Promise<T>): Promise<T> {
  const app = buildServer(options);
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}

describe('POST /v1/systemone', () => {
  it('returns a schema-valid response, echoes the model, and answers only requested ids', async () => {
    await withServer({ latencyMs: 1 }, async (app) => {
      const res = await app.inject({ method: 'POST', url: '/v1/systemone', payload: validRequest });
      expect(res.statusCode).toBe(200);
      const body = res.json() as ResponseBody;
      expect(jevApiResponseSchema.safeParse(body).success).toBe(true);
      expect(body.model).toBe('jev-1.13.0');
      expect(Object.keys(body.answers).sort()).toEqual(['department', 'frustration', 'is_urgent']);
      expect(body.usage.input_tokens).toBeGreaterThanOrEqual(1);
      expect(body.usage.output_tokens).toBe(4);
    });
  });

  it('does not invent answers for unknown or absent ids', async () => {
    await withServer({ latencyMs: 1 }, async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/systemone',
        payload: {
          state: 'hello',
          model: 'jev-1.13.0',
          questions: { only: { type: 'noul', instructions: 'Is it bad?' } },
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as ResponseBody;
      expect(Object.keys(body.answers)).toEqual(['only']);
      expect(body.usage.output_tokens).toBe(2);
    });
  });

  it('rejects a malformed body with 422 problem+json and zod issue paths', async () => {
    await withServer({ latencyMs: 1 }, async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/systemone',
        payload: { state: { message: 'x' }, model: '', questions: { bad: { type: 'ranking' } } },
      });
      expect(res.statusCode).toBe(422);
      expect(res.headers['content-type']).toContain('application/problem+json');
      const body = res.json() as ProblemShape;
      expect(body.status).toBe(422);
      expect(body.title).toBe('Unprocessable Entity');
      const errors = body.errors ?? [];
      expect(errors.length).toBeGreaterThan(0);
      const paths = errors.map((issue) => issue.path);
      expect(paths).toContain('model');
      expect(paths.some((path) => path.startsWith('questions.bad'))).toBe(true);
    });
  });

  it('rejects malformed JSON with 422 problem+json', async () => {
    await withServer({ latencyMs: 1 }, async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/systemone',
        payload: '{not-json',
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(422);
      expect(res.headers['content-type']).toContain('application/problem+json');
    });
  });

  it('derives Noul answers from keyword fixtures and never adds confidence', async () => {
    const cases: { state: unknown; expected: number }[] = [
      { state: { message: 'Payment Declined by the issuer' }, expected: 0.93 },
      { state: { message: 'the request timed out after 30s' }, expected: 0.9 },
      { state: { error: 'connection timeout' }, expected: 0.9 },
      { state: { message: 'everything is fine' }, expected: 0.2 },
    ];
    for (const testCase of cases) {
      await withServer({ latencyMs: 1 }, async (app) => {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/systemone',
          payload: { ...validRequest, state: testCase.state },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json() as ResponseBody;
        expect(body.answers.is_urgent).toEqual({ type: 'noul', noul: testCase.expected });
        expect(body.answers.is_urgent).not.toHaveProperty('confidence');
      });
    }
  });

  it('answers choice questions with a real option, probabilities and confidence', async () => {
    await withServer({ latencyMs: 1 }, async (app) => {
      const defaultRes = await app.inject({
        method: 'POST',
        url: '/v1/systemone',
        payload: validRequest,
      });
      const defaultBody = defaultRes.json() as ResponseBody;
      const defaultChoice = defaultBody.answers.department;
      expect(defaultChoice?.type).toBe('choice');
      expect(Object.keys(validRequest.questions.department.criteria)).toContain(
        defaultChoice?.choice,
      );
      expect(defaultChoice?.choice).toBe('billing');
      expect(defaultChoice?.confidence).toBeGreaterThan(0);
      const defaultSum = Object.values(defaultChoice?.probabilities ?? {}).reduce(
        (sum, p) => sum + p,
        0,
      );
      expect(defaultSum).toBeCloseTo(1, 6);

      const matchedRes = await app.inject({
        method: 'POST',
        url: '/v1/systemone',
        payload: { ...validRequest, state: { message: 'a technical question' } },
      });
      const matchedBody = matchedRes.json() as ResponseBody;
      expect(matchedBody.answers.department?.choice).toBe('technical');
    });
  });

  it('answers score questions within range with legend, probabilities and confidence', async () => {
    await withServer({ latencyMs: 1 }, async (app) => {
      const res = await app.inject({ method: 'POST', url: '/v1/systemone', payload: validRequest });
      const body = res.json() as ResponseBody;
      const answer = body.answers.frustration;
      expect(answer?.type).toBe('score');
      expect(answer?.score).toBeGreaterThanOrEqual(0);
      expect(answer?.score).toBeLessThanOrEqual(2);
      expect(Object.keys(answer?.legend ?? {}).sort()).toEqual(['0', '1', '2']);
      expect(answer?.legend?.['0']).toBe('calm');
      expect(answer?.confidence).toBeGreaterThan(0);
      const sum = Object.values(answer?.probabilities ?? {}).reduce((total, p) => total + p, 0);
      expect(sum).toBeCloseTo(1, 6);
    });
  });

  it('simulates 429 and 529 with the right status and problem+json', async () => {
    for (const pair of [
      ['429', 429],
      ['529', 529],
    ] as const) {
      const [mode, status] = pair;
      await withServer({ latencyMs: 1 }, async (app) => {
        const viaHeader = await app.inject({
          method: 'POST',
          url: '/v1/systemone',
          payload: validRequest,
          headers: { 'x-jev-mock-mode': mode },
        });
        expect(viaHeader.statusCode).toBe(status);
        expect(viaHeader.headers['content-type']).toContain('application/problem+json');
        expect((viaHeader.json() as ProblemShape).status).toBe(status);

        const viaQuery = await app.inject({
          method: 'POST',
          url: '/v1/systemone?mode=' + mode,
          payload: validRequest,
        });
        expect(viaQuery.statusCode).toBe(status);
      });
    }
  });

  it('simulates a 422 mode', async () => {
    await withServer({ latencyMs: 1 }, async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/systemone?mode=422',
        payload: validRequest,
      });
      expect(res.statusCode).toBe(422);
      expect(res.headers['content-type']).toContain('application/problem+json');
    });
  });

  it('forces every response with alwaysMode', async () => {
    await withServer({ alwaysMode: '529', latencyMs: 1 }, async (app) => {
      const res = await app.inject({ method: 'POST', url: '/v1/systemone', payload: validRequest });
      expect(res.statusCode).toBe(529);
    });
  });

  it('fails every Nth request with 429', async () => {
    await withServer({ failEvery: 2, latencyMs: 1 }, async (app) => {
      const first = await app.inject({
        method: 'POST',
        url: '/v1/systemone',
        payload: validRequest,
      });
      const second = await app.inject({
        method: 'POST',
        url: '/v1/systemone',
        payload: validRequest,
      });
      const third = await app.inject({
        method: 'POST',
        url: '/v1/systemone',
        payload: validRequest,
      });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(429);
      expect(third.statusCode).toBe(200);
    });
  });

  it('answers normally after the latency delay', async () => {
    await withServer({ latencyMs: 20 }, async (app) => {
      const started = Date.now();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/systemone?mode=latency',
        payload: validRequest,
      });
      const elapsed = Date.now() - started;
      expect(res.statusCode).toBe(200);
      expect(jevApiResponseSchema.safeParse(res.json()).success).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(15);
    });
  });

  it('serves /health, /__mock/mode and /__mock/stats', async () => {
    await withServer({ latencyMs: 1 }, async (app) => {
      const health = await app.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ status: 'ok' });

      const forced = await app.inject({
        method: 'POST',
        url: '/__mock/mode',
        payload: { mode: '429' },
      });
      expect(forced.statusCode).toBe(200);
      expect((forced.json() as { mode: string }).mode).toBe('429');

      const failed = await app.inject({
        method: 'POST',
        url: '/v1/systemone',
        payload: validRequest,
      });
      expect(failed.statusCode).toBe(429);

      const reset = await app.inject({
        method: 'POST',
        url: '/__mock/mode',
        payload: { mode: 'ok' },
      });
      expect(reset.statusCode).toBe(200);

      const ok = await app.inject({ method: 'POST', url: '/v1/systemone', payload: validRequest });
      expect(ok.statusCode).toBe(200);

      const stats = await app.inject({ method: 'GET', url: '/__mock/stats' });
      const statsBody = stats.json() as { counts: Record<string, number>; total: number };
      expect(statsBody.counts['429']).toBe(1);
      expect(statsBody.counts['200']).toBe(1);
      expect(statsBody.total).toBe(2);

      const invalid = await app.inject({
        method: 'POST',
        url: '/__mock/mode',
        payload: { mode: 'nope' },
      });
      expect(invalid.statusCode).toBe(400);
    });
  });
});

describe('configuration helpers', () => {
  it('reads latency, always mode and failure interval from the environment', () => {
    expect(
      createOptionsFromEnv({
        JEV_MOCK_LATENCY_MS: '10',
        JEV_MOCK_ALWAYS: '529',
        JEV_MOCK_429_EVERY: '5',
      }),
    ).toEqual({ latencyMs: 10, alwaysMode: '529', failEvery: 5 });
    expect(createOptionsFromEnv({})).toMatchObject({
      latencyMs: 250,
      alwaysMode: undefined,
      failEvery: undefined,
    });
    expect(
      createOptionsFromEnv({
        JEV_MOCK_ALWAYS: 'nonsense',
        JEV_MOCK_429_EVERY: '0',
        JEV_MOCK_LATENCY_MS: '-5',
      }),
    ).toMatchObject({ latencyMs: 250, alwaysMode: undefined, failEvery: undefined });
  });

  it('resolves modes with per-request > global > every-Nth precedence', () => {
    expect(resolveMode({ requested: '529', global: '429', requestCount: 1 })).toBe('529');
    expect(resolveMode({ global: '422', requestCount: 1 })).toBe('422');
    expect(resolveMode({ failEvery: 3, requestCount: 3 })).toBe('429');
    expect(resolveMode({ failEvery: 3, requestCount: 4 })).toBe('ok');
    expect(resolveMode({ requestCount: 1 })).toBe('ok');
  });
});
