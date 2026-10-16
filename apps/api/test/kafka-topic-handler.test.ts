import type { ActionPayload } from '@centurion/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createKafkaTopicHandler, type KafkaRecord } from '../src/actions/kafka-topic';

const payload: ActionPayload = {
  flagId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  rule: { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3302', name: 'r', version: 1 },
  source: { id: 'svc' },
  messageRef: { topic: 'logs.raw', partition: 0, offset: '1' },
  answer: { type: 'noul', noul: 0.9 },
  triggeredAt: '2026-10-01T12:00:00.000Z',
};

describe('createKafkaTopicHandler', () => {
  it('publishes keyed by rule id', async () => {
    const send = vi.fn(async (_record: KafkaRecord) => {});
    const handler = createKafkaTopicHandler({ producer: { send } });
    const result = await handler.execute(payload, { topic: 'logs.flags' }, { flagId: payload.flagId, attempt: 1 });

    expect(result.detail).toContain('logs.flags');
    expect(send).toHaveBeenCalledTimes(1);
    const record = send.mock.calls[0]?.[0];
    expect(record?.topic).toBe('logs.flags');
    expect(record?.key).toBe(payload.rule.id);
    expect(JSON.parse(record?.value ?? '')).toEqual(payload);
  });

  it('falls back to the configured default topic', async () => {
    const send = vi.fn(async (_record: KafkaRecord) => {});
    const handler = createKafkaTopicHandler({ producer: { send }, defaultTopic: 'fallback.flags' });
    await handler.execute(payload, { topic: '' }, { flagId: payload.flagId, attempt: 1 });
    expect(send.mock.calls[0]?.[0].topic).toBe('fallback.flags');
  });

  it('errors when no topic is available', async () => {
    const send = vi.fn(async (_record: KafkaRecord) => {});
    const handler = createKafkaTopicHandler({ producer: { send } });
    await expect(
      handler.execute(payload, { topic: '' }, { flagId: payload.flagId, attempt: 1 }),
    ).rejects.toThrow('no topic');
  });
});
