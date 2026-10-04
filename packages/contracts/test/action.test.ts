import { describe, expect, it } from 'vitest';

import { actionContentSchema, actionPayloadSchema, actionDtoSchema } from '../src';

describe('action definitions', () => {
  it('accepts a webhook action and applies the timeout default', () => {
    const parsed = actionContentSchema.parse({
      type: 'webhook',
      name: 'Notify Slack',
      config: { url: 'https://example.com/hook', secret: 's3cr3t' },
    });
    expect(parsed.enabled).toBe(true);
    if (parsed.type !== 'webhook') throw new Error('expected webhook');
    expect(parsed.config.timeoutMs).toBe(10_000);
  });

  it('accepts a kafka_topic action', () => {
    expect(
      actionContentSchema.safeParse({ type: 'kafka_topic', name: 'publish', config: { topic: 'logs.flags' } })
        .success,
    ).toBe(true);
  });

  it('rejects an invalid webhook URL', () => {
    expect(
      actionContentSchema.safeParse({ type: 'webhook', name: 'x', config: { url: 'not-a-url' } }).success,
    ).toBe(false);
  });

  it('rejects a config that does not match the action type', () => {
    expect(
      actionContentSchema.safeParse({ type: 'kafka_topic', name: 'x', config: { url: 'https://a.example' } })
        .success,
    ).toBe(false);
    expect(
      actionContentSchema.safeParse({ type: 'webhook', name: 'x', config: { topic: 't' } }).success,
    ).toBe(false);
  });

  it('rejects a DTO that still carries a secret (defence in depth)', () => {
    const base = {
      id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      type: 'webhook' as const,
      name: 'hook',
      hasSecret: true,
    };
    expect(
      actionDtoSchema.safeParse({
        ...base,
        config: { url: 'https://example.com/hook', timeoutMs: 5000, secret: 'leak' },
      }).success,
    ).toBe(false);
    const parsed = actionDtoSchema.parse({
      ...base,
      config: { url: 'https://example.com/hook', timeoutMs: 5000 },
    });
    expect(parsed.type).toBe('webhook');
    expect('secret' in parsed.config).toBe(false);
  });
});

describe('action payload', () => {
  it('accepts a complete payload', () => {
    const payload = {
      flagId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      rule: { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3302', name: 'Payment failures', version: 3 },
      source: { id: 'checkout-api', environment: 'prod' },
      messageRef: { topic: 'logs.raw', partition: 0, offset: '1042' },
      answer: { type: 'noul', noul: 0.91 },
      triggeredAt: '2026-10-01T12:00:01.000Z',
      excerpt: 'payment declined',
    };
    expect(actionPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('rejects a missing message reference', () => {
    expect(
      actionPayloadSchema.safeParse({
        flagId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        rule: { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3302', name: 'r', version: 1 },
        source: { id: 's' },
        answer: { type: 'noul', noul: 0.5 },
        triggeredAt: '2026-10-01T12:00:01.000Z',
      }).success,
    ).toBe(false);
  });
});
