import { describe, expect, it } from 'vitest';

import { logEnvelopeSchema } from '../src';

const validEnvelope = {
  schemaVersion: 1 as const,
  id: '01J0Z9Q2M8Y7K5N4P3R2S1T0V9',
  source: { id: 'checkout-api', name: 'Checkout API', environment: 'prod' },
  timestamp: '2026-10-01T12:00:00.000Z',
  level: 'error' as const,
  payload: { message: 'payment declined', code: 402, retryable: false, meta: null },
  attributes: { region: 'eu-west-1' },
};

describe('logEnvelopeSchema', () => {
  it('accepts a complete envelope', () => {
    expect(logEnvelopeSchema.parse(validEnvelope)).toEqual(validEnvelope);
  });

  it('accepts the minimal envelope and drops optional fields', () => {
    const parsed = logEnvelopeSchema.parse({
      schemaVersion: 1,
      id: 'abc',
      source: { id: 'svc' },
      timestamp: '2026-10-01T10:00:00+02:00',
      payload: 'plain text log',
    });
    expect(parsed.level).toBeUndefined();
    expect(parsed.attributes).toBeUndefined();
  });

  it.each([
    ['missing id', { ...validEnvelope, id: undefined }],
    ['empty id', { ...validEnvelope, id: '' }],
    ['unknown schemaVersion', { ...validEnvelope, schemaVersion: 2 }],
    ['non-numeric schemaVersion', { ...validEnvelope, schemaVersion: '1' }],
    ['missing source', { ...validEnvelope, source: undefined }],
    ['source without id', { ...validEnvelope, source: { name: 'x' } }],
    ['bad timestamp', { ...validEnvelope, timestamp: 'yesterday' }],
    ['bad level', { ...validEnvelope, level: 'verbose' }],
    ['numeric payload', { ...validEnvelope, payload: 42 }],
    ['null payload', { ...validEnvelope, payload: null }],
    ['non-string attribute', { ...validEnvelope, attributes: { attempts: 3 } }],
    ['unknown top-level key', { ...validEnvelope, extra: true }],
  ])('rejects %s', (_name, input) => {
    expect(logEnvelopeSchema.safeParse(input).success).toBe(false);
  });

  it('accepts every log level', () => {
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      expect(logEnvelopeSchema.safeParse({ ...validEnvelope, level }).success).toBe(true);
    }
  });
});
