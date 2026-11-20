import { describe, expect, it, vi } from 'vitest';

import type { JevEvaluation } from '@centurion/contracts';

import { JevAuthError, JevRateLimitError } from '../src/jev/errors';
import type { JevEvaluateInput } from '../src/jev/gateway';
import { createTestApp } from './helpers/http';

const sample = {
  schemaVersion: 1,
  id: 'm1',
  source: { id: 'checkout-api' },
  timestamp: '2026-10-01T00:00:00.000Z',
  payload: 'payment declined',
};

function requestBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    question: { type: 'noul', instructions: 'Is the payment declined?' },
    condition: { type: 'noul', op: 'gte', threshold: 0.5 },
    sample,
    ...overrides,
  };
}

function noulAnswer(noul: number): JevEvaluation {
  return {
    model: 'jev-1.13.0',
    answers: { sample: { type: 'noul', noul } },
    usage: { inputTokens: 11, outputTokens: 2 },
  };
}

describe('POST /api/v1/rules/test', () => {
  it('calls the gateway once, rate-limits the call and returns the typed verdict', async () => {
    const acquire = vi.fn(async () => {});
    const evaluate = vi.fn(
      async (_input: JevEvaluateInput): Promise<JevEvaluation> => noulAnswer(0.93),
    );
    const { app } = createTestApp({ gateway: { evaluate }, ruleTestRateLimiter: { acquire } });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rules/test',
      payload: requestBody(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      verdict: string;
      model: string;
      answer: { type: string; noul: number };
      usage: { inputTokens: number };
    };
    expect(body.verdict).toBe('TRIGGERED');
    expect(body.model).toBe('jev-1.13.0');
    expect(body.answer).toEqual({ type: 'noul', noul: 0.93 });
    expect(body.usage.inputTokens).toBe(11);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledTimes(1);

    const call = evaluate.mock.calls[0]?.[0];
    expect(call?.state).toBe('payment declined');
    expect(Object.keys(call?.questions ?? {})).toEqual(['sample']);
  });

  it('evaluates a below-threshold answer as NOT_TRIGGERED', async () => {
    const gateway = {
      evaluate: async (): Promise<JevEvaluation> => noulAnswer(0.1),
    };
    const { app } = createTestApp({ gateway });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rules/test',
      payload: requestBody(),
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { verdict: string }).verdict).toBe('NOT_TRIGGERED');
  });

  it('redacts configured keys before building state', async () => {
    const evaluate = vi.fn(
      async (_input: JevEvaluateInput): Promise<JevEvaluation> => noulAnswer(0.9),
    );
    const { app } = createTestApp({ gateway: { evaluate }, redactKeys: ['password'] });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rules/test',
      payload: requestBody({
        sample: { ...sample, payload: { password: 'hunter2', detail: 'failed' } },
      }),
    });
    expect(response.statusCode).toBe(200);
    const call = evaluate.mock.calls[0]?.[0];
    expect(call?.state).toEqual({ password: '[REDACTED]', detail: 'failed' });
  });

  it('refuses mismatched question and condition types with a 422 field path', async () => {
    const { app } = createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rules/test',
      payload: requestBody({
        condition: { type: 'choice', anyOf: ['declined'] },
      }),
    });
    expect(response.statusCode).toBe(422);
    const body = response.json() as { errors: { path: string }[] };
    expect(body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'condition.type' })]),
    );
  });

  it('maps a Jev rate-limit error to 429', async () => {
    const gateway = {
      evaluate: async (): Promise<JevEvaluation> => {
        throw new JevRateLimitError('slow down');
      },
    };
    const { app } = createTestApp({ gateway });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rules/test',
      payload: requestBody(),
    });
    expect(response.statusCode).toBe(429);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('maps a Jev auth error to 503', async () => {
    const gateway = {
      evaluate: async (): Promise<JevEvaluation> => {
        throw new JevAuthError('bad key');
      },
    };
    const { app } = createTestApp({ gateway });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rules/test',
      payload: requestBody(),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 503 });
  });
});
