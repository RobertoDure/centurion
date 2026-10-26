import type { ConsumerStatus } from '@centurion/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  ConsumerRunner,
  type ConsumedMessage,
  type KafkaConsumerAdapter,
  type MessageContext,
  type MessageHandler,
} from '../src/consumer/runner';

const message: ConsumedMessage = {
  topic: 'logs.raw',
  partition: 0,
  offset: '1',
  key: 'svc',
  value: '{}',
  headers: {},
  timestamp: '2026-10-01T00:00:00.000Z',
};

function fakeAdapter(): KafkaConsumerAdapter & {
  handler: MessageHandler | undefined;
  paused: number;
  resumed: number;
  stopped: number;
} {
  const adapter = {
    handler: undefined as MessageHandler | undefined,
    paused: 0,
    resumed: 0,
    stopped: 0,
    async start(handler: MessageHandler) {
      adapter.handler = handler;
    },
    pause() {
      adapter.paused += 1;
    },
    resume() {
      adapter.resumed += 1;
    },
    async stop() {
      adapter.stopped += 1;
    },
  };
  return adapter;
}

function context(): MessageContext {
  return { message, commit: vi.fn(async () => {}) };
}

describe('ConsumerRunner', () => {
  it('tracks status transitions', async () => {
    const statuses: ConsumerStatus[] = [];
    const adapter = fakeAdapter();
    const runner = new ConsumerRunner(adapter, { onStatusChange: (status) => statuses.push(status) });
    await runner.start(async () => {});
    runner.pause();
    runner.resume();
    await runner.stop();
    expect(statuses).toEqual(['running', 'paused', 'running', 'stopped']);
    expect(adapter.paused).toBe(2);
    expect(adapter.resumed).toBe(1);
    expect(adapter.stopped).toBe(1);
  });

  it('processes messages sequentially', async () => {
    const adapter = fakeAdapter();
    const runner = new ConsumerRunner(adapter);
    const order: string[] = [];
    await runner.start(async (ctx) => {
      order.push(`start-${ctx.message.offset}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end-${ctx.message.offset}`);
    });
    const handler = adapter.handler;
    if (handler === undefined) throw new Error('handler not registered');
    await handler(context());
    await handler(context());
    expect(order).toEqual(['start-1', 'end-1', 'start-1', 'end-1']);
    expect(runner.inFlightCount).toBe(0);
  });

  it('waits for an in-flight message before stopping', async () => {
    const adapter = fakeAdapter();
    const runner = new ConsumerRunner(adapter);
    let release: (() => void) | undefined;
    await runner.start(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const handler = adapter.handler;
    if (handler === undefined) throw new Error('handler not registered');
    const processing = handler(context());
    expect(runner.inFlightCount).toBe(1);
    const stopping = runner.stop();
    expect(adapter.stopped).toBe(0);
    release?.();
    await processing;
    await stopping;
    expect(adapter.stopped).toBe(1);
    expect(runner.currentStatus).toBe('stopped');
  });
});
