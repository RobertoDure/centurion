import type { ActionPayload, WebhookConfig } from '@centurion/contracts';
import { describe, expect, it, vi } from 'vitest';

import { ActionConfigError, ActionRegistry, createDefaultActionRegistry } from '../src/actions/registry';
import type { ActionHandler } from '../src/actions/types';

const payload: ActionPayload = {
  flagId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  rule: { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3302', name: 'r', version: 1 },
  source: { id: 'svc' },
  messageRef: { topic: 'logs.raw', partition: 0, offset: '1' },
  answer: { type: 'noul', noul: 0.9 },
  triggeredAt: '2026-10-01T12:00:00.000Z',
};
const context = { flagId: payload.flagId, attempt: 1 };

function webhookHandler(): ActionHandler<WebhookConfig> {
  return { type: 'webhook', execute: vi.fn(async () => ({ detail: 'ok' })) };
}

describe('ActionRegistry', () => {
  it('registers and dispatches by type', async () => {
    const webhook = webhookHandler();
    const kafkaExecute = vi.fn(async () => ({ detail: 'kafka' }));
    const registry = new ActionRegistry()
      .register(webhook)
      .register({ type: 'kafka_topic', execute: kafkaExecute });

    expect(registry.types().sort()).toEqual(['kafka_topic', 'webhook']);
    expect(registry.has('webhook')).toBe(true);

    await registry.execute(
      { type: 'webhook', name: 'h', enabled: true, config: { url: 'https://x.example', timeoutMs: 1000 } },
      payload,
      context,
    );
    await registry.execute(
      { type: 'kafka_topic', name: 'k', enabled: true, config: { topic: 't' } },
      payload,
      context,
    );

    expect(webhook.execute).toHaveBeenCalledTimes(1);
    expect(kafkaExecute).toHaveBeenCalledTimes(1);
  });

  it('rejects a config that does not match the action type', async () => {
    const registry = createDefaultActionRegistry({
      webhook: webhookHandler(),
      kafkaTopic: { type: 'kafka_topic', execute: vi.fn(async () => ({})) },
    });
    await expect(
      registry.execute(
        { type: 'webhook', name: 'h', enabled: true, config: { topic: 't' } } as never,
        payload,
        context,
      ),
    ).rejects.toBeInstanceOf(ActionConfigError);
  });

  it('rejects an unregistered type', async () => {
    const registry = new ActionRegistry();
    await expect(
      registry.execute(
        { type: 'webhook', name: 'h', enabled: true, config: { url: 'https://x.example', timeoutMs: 1000 } },
        payload,
        context,
      ),
    ).rejects.toThrow('no handler registered');
  });
});
