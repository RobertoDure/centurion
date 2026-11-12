import { describe, expect, it, vi } from 'vitest';

import { LogClient, type LogClientOptions, type PayloadSizeWarning } from '../src';
import { FakeProducer } from './helpers/fake-producer';

function createClient(
  options: Partial<LogClientOptions> = {},
  producer: FakeProducer = new FakeProducer(),
): { client: LogClient; producer: FakeProducer } {
  const client = new LogClient({
    brokers: ['localhost:9092'],
    topic: 'logs.raw',
    source: { id: 'svc' },
    producer,
    idFactory: () => 'id',
    now: () => new Date('2026-10-01T00:00:00.000Z'),
    ...options,
  });
  return { client, producer };
}

function tick(ms = 5): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('failure modes', () => {
  it('drop mode resolves dropped, counts it, and does not throw', async () => {
    const producer = new FakeProducer({ failWith: () => new Error('broker down') });
    const onError = vi.fn();
    const { client } = createClient(
      { failureMode: 'drop', retry: { maxAttempts: 1 }, onError },
      producer,
    );

    const result = await client.send({ payload: 'x' });

    expect(result.status).toBe('dropped');
    expect(result.error?.message).toBe('broker down');
    expect(client.stats.dropped).toBe(1);
    expect(client.stats.delivered).toBe(0);
    expect(client.stats.failed).toBe(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(producer.sendCalls).toBe(1);
    await client.close();
  });

  it('throw mode rejects the send with the producer error', async () => {
    const producer = new FakeProducer({ failWith: () => new Error('nope') });
    const { client } = createClient({ failureMode: 'throw', retry: { maxAttempts: 1 } }, producer);

    await expect(client.send({ payload: 'x' })).rejects.toThrow('nope');
    expect(client.stats.dropped).toBe(0);
    expect(client.stats.delivered).toBe(0);
    await client.close();
  });

  it('callback mode resolves failed and invokes onError', async () => {
    const producer = new FakeProducer({ failWith: () => new Error('cb') });
    const onError = vi.fn();
    const { client } = createClient(
      { failureMode: 'callback', retry: { maxAttempts: 1 }, onError },
      producer,
    );

    const result = await client.send({ payload: 'x' });

    expect(result.status).toBe('failed');
    expect(client.stats.failed).toBe(1);
    expect(client.stats.dropped).toBe(0);
    expect(onError).toHaveBeenCalledTimes(1);
    await client.close();
  });

  it('an onError callback that throws cannot crash the client', async () => {
    const producer = new FakeProducer({ failWith: () => new Error('x') });
    const { client } = createClient(
      {
        failureMode: 'drop',
        retry: { maxAttempts: 1 },
        onError: () => {
          throw new Error('observer boom');
        },
      },
      producer,
    );

    const result = await client.send({ payload: 'x' });
    expect(result.status).toBe('dropped');
    await client.close();
  });
});

describe('retry and backpressure', () => {
  it('retries with backoff until the batch is delivered', async () => {
    const producer = new FakeProducer({
      failWith: (call) => (call < 3 ? new Error('transient') : undefined),
    });
    const { client } = createClient(
      { retry: { maxAttempts: 3, initialBackoffMs: 1, maxBackoffMs: 1, jitter: false } },
      producer,
    );

    const result = await client.send({ payload: 'x' });

    expect(result.status).toBe('delivered');
    expect(client.stats.retried).toBe(2);
    expect(producer.sendCalls).toBe(3);
    expect(client.stats.delivered).toBe(1);
    await client.close();
  });

  it('applies backpressure while the buffer is full', async () => {
    const producer = new FakeProducer({ gateCalls: 1 });
    const { client } = createClient(
      {
        batch: { maxRecords: 2, lingerMs: 0, maxBufferBytes: 1024 * 1024 },
        retry: { maxAttempts: 1 },
      },
      producer,
    );

    const first = client.send({ payload: 'a' });
    const second = client.send({ payload: 'b' });
    await tick();

    let thirdSettled = false;
    const third = client.send({ payload: 'c' }).then((result) => {
      thirdSettled = true;
      return result;
    });
    await tick();

    expect(client.stats.bufferedRecords).toBe(2);
    expect(thirdSettled).toBe(false);

    producer.release();
    const results = await Promise.all([first, second, third]);

    expect(results.map((result) => result.status)).toEqual(['delivered', 'delivered', 'delivered']);
    expect(client.stats.bufferedRecords).toBe(0);
    await client.close();
  });
});

describe('broker-down behaviour', () => {
  it('drop mode settles every send without growing the buffer without bound', async () => {
    const producer = new FakeProducer({ failWith: () => new Error('broker down') });
    const { client } = createClient(
      {
        failureMode: 'drop',
        batch: { maxRecords: 4, lingerMs: 0, maxBufferBytes: 4096 },
        enqueueTimeoutMs: 20,
        retry: { maxAttempts: 2, initialBackoffMs: 1, maxBackoffMs: 1, jitter: false },
      },
      producer,
    );

    const sends = Array.from({ length: 40 }, (_, index) => client.send({ payload: { index } }));
    const results = await Promise.all(sends);
    await client.flush();

    expect(results).toHaveLength(40);
    expect(results.every((result) => result.status === 'dropped')).toBe(true);
    expect(client.stats.delivered).toBe(0);
    expect(client.stats.dropped).toBe(40);
    expect(client.stats.bufferedRecords).toBe(0);
    expect(client.stats.bufferedBytes).toBe(0);
    // The buffer is bounded: no attempt ever carried more than maxRecords.
    expect(producer.attempts.every((batch) => batch.messages.length <= 4)).toBe(true);
    await client.close();
  });

  it('flush settles even when the producer always rejects', async () => {
    const producer = new FakeProducer({ failWith: () => new Error('always down') });
    const { client } = createClient(
      {
        failureMode: 'drop',
        batch: { maxRecords: 3, lingerMs: 0, maxBufferBytes: 1024 },
        retry: { maxAttempts: 2, initialBackoffMs: 1, maxBackoffMs: 1, jitter: false },
      },
      producer,
    );

    const sends = [client.send({ payload: 'one' }), client.send({ payload: 'two' })];
    await Promise.all(sends);
    await expect(client.flush()).resolves.toBeUndefined();
    expect(client.stats.bufferedRecords).toBe(0);
    await client.close();
  });
});

describe('payload size handling', () => {
  it('warns above warnPayloadBytes and still delivers', async () => {
    const warnings: PayloadSizeWarning[] = [];
    const { client, producer } = createClient({
      warnPayloadBytes: 64,
      onWarning: (warning) => warnings.push(warning),
    });

    const result = await client.send({ payload: 'x'.repeat(200) });

    expect(result.status).toBe('delivered');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.thresholdBytes).toBe(64);
    expect(warnings[0]?.bytes).toBeGreaterThan(64);
    expect(client.stats.warnings).toBe(1);
    expect(producer.messages).toHaveLength(1);
    await client.close();
  });

  it('admits a single record larger than maxBufferBytes (no client-side size cap)', async () => {
    const { client, producer } = createClient({
      batch: { maxRecords: 10, lingerMs: 0, maxBufferBytes: 32 },
      warnPayloadBytes: 10 * 1024 * 1024,
    });

    const result = await client.send({ payload: 'y'.repeat(500) });

    expect(result.status).toBe('delivered');
    expect(producer.messages).toHaveLength(1);
    await client.close();
  });
});
