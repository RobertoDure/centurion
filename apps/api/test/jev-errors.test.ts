import { describe, expect, it } from 'vitest';

import {
  JevAuthError,
  JevError,
  JevNetworkError,
  JevOverloadedError,
  JevRateLimitError,
  JevValidationError,
  mapJevError,
} from '../src/jev/errors';

describe('mapJevError', () => {
  it('passes through an existing JevError', () => {
    const original = new JevAuthError();
    expect(mapJevError(original)).toBe(original);
  });

  it.each([
    [401, JevAuthError],
    [403, JevAuthError],
    [422, JevValidationError],
    [429, JevRateLimitError],
    [529, JevOverloadedError],
    [500, JevNetworkError],
    [undefined, JevNetworkError],
  ])('maps status %s to the right class', (status, expected) => {
    const mapped = mapJevError(status === undefined ? new Error('boom') : { status });
    expect(mapped).toBeInstanceOf(expected);
    expect(mapped).toBeInstanceOf(JevError);
  });

  it('reads a nested response status', () => {
    expect(mapJevError({ response: { status: 429 } })).toBeInstanceOf(JevRateLimitError);
  });

  it('carries validation issues', () => {
    const mapped = mapJevError({ status: 422, issues: ['questions.r1: bad'] });
    expect(mapped).toBeInstanceOf(JevValidationError);
    expect((mapped as JevValidationError).issues).toEqual(['questions.r1: bad']);
  });

  it('converts retry-after seconds to milliseconds', () => {
    const mapped = mapJevError({ status: 429, retryAfterSeconds: 3 });
    expect((mapped as JevRateLimitError).retryAfterMs).toBe(3000);
  });

  it('keeps retry-after milliseconds as-is', () => {
    const mapped = mapJevError({ status: 429, retryAfterMs: 2500 });
    expect((mapped as JevRateLimitError).retryAfterMs).toBe(2500);
  });

  it('exposes stable error codes and names', () => {
    expect(new JevAuthError().code).toBe('JEV_AUTH');
    expect(new JevRateLimitError().code).toBe('JEV_RATE_LIMIT');
    expect(new JevOverloadedError().code).toBe('JEV_OVERLOADED');
    expect(new JevValidationError().code).toBe('JEV_VALIDATION');
    expect(new JevNetworkError().code).toBe('JEV_NETWORK');
    expect(new JevAuthError().name).toBe('JevAuthError');
  });
});
