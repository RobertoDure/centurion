import type { JevApiResponse, JevApiRequest, JevQuestion } from '@centurion/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  JevAuthError,
  JevNetworkError,
  JevOverloadedError,
  JevRateLimitError,
  JevValidationError,
} from '../src/jev/errors';
import { DefaultJevGateway, type JevTransport } from '../src/jev/gateway';
import { TokenCalibrator } from '../src/jev/token-estimator';

const question: JevQuestion = { type: 'noul', instructions: 'Is the payment declined?' };

function response(): JevApiResponse {
  return {
    model: 'jev-1.13.0',
    answers: { r1: { type: 'noul', noul: 0.93 } },
    usage: { input_tokens: 42, output_tokens: 3 },
  };
}

function transportReturning(payload: JevApiResponse): { transport: JevTransport; calls: JevApiRequest[] } {
  const calls: JevApiRequest[] = [];
  return {
    calls,
    transport: {
      evaluate: async (request) => {
        calls.push(request);
        return payload;
      },
    },
  };
}

describe('DefaultJevGateway', () => {
  it('validates, sends and maps the response', async () => {
    const { transport, calls } = transportReturning(response());
    const gateway = new DefaultJevGateway({ transport, model: 'jev-1.13.0' });

    const result = await gateway.evaluate({ state: 'payment declined', questions: { r1: question } });

    expect(result.model).toBe('jev-1.13.0');
    expect(result.answers.r1).toEqual({ type: 'noul', noul: 0.93 });
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe('jev-1.13.0');
    expect(calls[0]?.state).toBe('payment declined');
  });

  it('records the estimate/actual ratio on the calibrator', async () => {
    const { transport } = transportReturning(response());
    const calibrator = new TokenCalibrator();
    const gateway = new DefaultJevGateway({ transport, model: 'jev-1.13.0', calibrator });

    await gateway.evaluate({ state: 'x'.repeat(300), questions: { r1: question } });

    const snapshot = calibrator.snapshot();
    expect(snapshot.samples).toBe(1);
    expect(snapshot.actualTokens).toBe(42);
    expect(snapshot.estimatedTokens).toBeGreaterThan(0);
    expect(snapshot.ratio).toBeCloseTo(42 / snapshot.estimatedTokens, 6);
  });

  it('waits on the rate limiter before calling the transport', async () => {
    const { transport } = transportReturning(response());
    const acquire = vi.fn(async () => {});
    const gateway = new DefaultJevGateway({ transport, model: 'jev-1.13.0', rateLimiter: { acquire } });

    await gateway.evaluate({ state: 'hello', questions: { r1: question } });

    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid request without calling the transport', async () => {
    const { transport, calls } = transportReturning(response());
    const gateway = new DefaultJevGateway({ transport, model: 'jev-1.13.0' });

    await expect(
      gateway.evaluate({
        state: 'hello',
        questions: { r1: { type: 'noul', instructions: 'x', criteria: { true: 5 as never } } },
      }),
    ).rejects.toBeInstanceOf(JevValidationError);
    expect(calls).toHaveLength(0);
  });

  it('rejects an unparseable response', async () => {
    const { transport } = transportReturning({ model: 'x', answers: {} } as JevApiResponse);
    const gateway = new DefaultJevGateway({ transport, model: 'jev-1.13.0' });
    await expect(gateway.evaluate({ state: 'hello', questions: { r1: question } })).rejects.toBeInstanceOf(
      JevValidationError,
    );
  });

  it.each([
    [{ status: 401 }, JevAuthError],
    [{ status: 429, retryAfterSeconds: 2 }, JevRateLimitError],
    [{ status: 529 }, JevOverloadedError],
    [{ status: 422, issues: ['bad rule'] }, JevValidationError],
    [new Error('socket closed'), JevNetworkError],
  ])('maps transport failures to domain errors', async (failure, expected) => {
    const transport: JevTransport = {
      evaluate: async () => {
        throw failure;
      },
    };
    const gateway = new DefaultJevGateway({ transport, model: 'jev-1.13.0' });
    await expect(gateway.evaluate({ state: 'hello', questions: { r1: question } })).rejects.toBeInstanceOf(
      expected,
    );
  });

  it('passes through a domain error thrown by the transport', async () => {
    const original = new JevOverloadedError('too busy');
    const transport: JevTransport = {
      evaluate: async () => {
        throw original;
      },
    };
    const gateway = new DefaultJevGateway({ transport, model: 'jev-1.13.0' });
    await expect(gateway.evaluate({ state: 'hello', questions: { r1: question } })).rejects.toBe(original);
  });
});
