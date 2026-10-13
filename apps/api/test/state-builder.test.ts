import type { LogEnvelope } from '@centurion/contracts';
import { describe, expect, it } from 'vitest';

import { buildState, REDACTED } from '../src/jev/state-builder';

function envelope(payload: LogEnvelope['payload']): LogEnvelope {
  return {
    schemaVersion: 1,
    id: 'msg-1',
    source: { id: 'svc' },
    timestamp: '2026-10-01T00:00:00.000Z',
    payload,
  };
}

describe('buildState', () => {
  it('uses the payload as state and keeps metadata out', () => {
    const state = buildState(envelope({ message: 'payment declined', code: 402 }));
    expect(state).toEqual({ message: 'payment declined', code: 402 });
    expect(state).not.toHaveProperty('source');
    expect(state).not.toHaveProperty('timestamp');
  });

  it('passes strings and arrays through untouched without redaction', () => {
    expect(buildState(envelope('hello'))).toBe('hello');
    expect(buildState(envelope([1, 'two', null]))).toEqual([1, 'two', null]);
  });

  it('redacts configured keys recursively', () => {
    const state = buildState(
      envelope({
        user: { email: 'a@b.c', card: '4111' },
        events: [{ token: 'abc', note: 'ok' }],
      }),
      { redactKeys: ['email', 'token'] },
    );
    expect(state).toEqual({
      user: { email: REDACTED, card: '4111' },
      events: [{ token: REDACTED, note: 'ok' }],
    });
  });

  it('truncates long string state when maxStateChars is set', () => {
    expect(buildState(envelope('a'.repeat(50)), { maxStateChars: 10 })).toBe('a'.repeat(10));
    expect(buildState(envelope('short'), { maxStateChars: 10 })).toBe('short');
  });
});
