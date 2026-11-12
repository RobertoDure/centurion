import {
  CURRENT_SCHEMA_VERSION,
  KAFKA_CONTENT_TYPE_JSON,
  KAFKA_HEADER_CONTENT_TYPE,
  KAFKA_HEADER_SCHEMA_VERSION,
  type LogEnvelope,
  type LogLevel,
  type LogPayload,
} from '@centurion/contracts';
import { describe, expect, it } from 'vitest';

import {
  defaultIdFactory,
  LogClient,
  LogClientClosedError,
  LogValidationError,
  type LogClientOptions,
  type LogRecordInput,
} from '../src';
import { FakeProducer } from './helpers/fake-producer';

const FIXED_ID = '01J0Z9Q2M8Y7K5N4P3R2S1T0V9';
const FIXED_TIME = new Date('2026-10-01T12:00:00.000Z');

function createClient(
  options: Partial<LogClientOptions> = {},
  producer: FakeProducer = new FakeProducer(),
): { client: LogClient; producer: FakeProducer } {
  const client = new LogClient({
    brokers: ['localhost:9092'],
    topic: 'logs.raw',
    source: { id: 'checkout-api', environment: 'test' },
    producer,
    idFactory: () => FIXED_ID,
    now: () => FIXED_TIME,
    ...options,
  });
  return { client, producer };
}

function parse(message: { value: string } | undefined): LogEnvelope {
  if (!message) {
    throw new Error('expected a producer message');
  }
  return JSON.parse(message.value) as LogEnvelope;
}

describe('LogClient records', () => {
  it('generates an id and ISO-8601 timestamp when absent', async () => {
    const { client, producer } = createClient();
    const result = await client.send({ payload: { message: 'hello' } });

    expect(result).toEqual({ id: FIXED_ID, status: 'delivered' });
    const envelope = parse(producer.messages[0]);
    expect(envelope.id).toBe(FIXED_ID);
    expect(envelope.timestamp).toBe('2026-10-01T12:00:00.000Z');
    expect(envelope.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(envelope.source).toEqual({ id: 'checkout-api', environment: 'test' });
    await client.close();
  });

  it('defaultIdFactory returns a v4 UUID', () => {
    expect(defaultIdFactory()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('honours a provided id, timestamp, level and attributes', async () => {
    const { client, producer } = createClient();
    const result = await client.send({
      id: 'custom-id',
      timestamp: '2026-01-02T03:04:05.000+02:00',
      level: 'warn',
      payload: 'plain text',
      attributes: { region: 'eu-west-1' },
    });

    expect(result.id).toBe('custom-id');
    const envelope = parse(producer.messages[0]);
    expect(envelope.id).toBe('custom-id');
    expect(envelope.timestamp).toBe('2026-01-02T03:04:05.000+02:00');
    expect(envelope.level).toBe('warn');
    expect(envelope.attributes).toEqual({ region: 'eu-west-1' });
    await client.close();
  });

  it('keys by source.id and writes the schema headers', async () => {
    const { client, producer } = createClient();
    await client.send({ payload: 'hello' });

    const message = producer.messages[0];
    expect(message?.key).toBe('checkout-api');
    expect(message?.headers[KAFKA_HEADER_SCHEMA_VERSION]).toBe(String(CURRENT_SCHEMA_VERSION));
    expect(message?.headers[KAFKA_HEADER_CONTENT_TYPE]).toBe(KAFKA_CONTENT_TYPE_JSON);
    await client.close();
  });

  it('rejects payloads that violate the shared contract', async () => {
    const { client, producer } = createClient();

    await expect(client.send({ payload: 42 as unknown as LogPayload })).rejects.toBeInstanceOf(
      LogValidationError,
    );
    await expect(
      client.send({ payload: 'x', level: 'verbose' as LogLevel }),
    ).rejects.toBeInstanceOf(LogValidationError);
    await expect(client.send({} as LogRecordInput)).rejects.toBeInstanceOf(LogValidationError);
    await expect(
      client.send({ payload: 'x', extra: true } as unknown as LogRecordInput),
    ).rejects.toBeInstanceOf(LogValidationError);
    expect(producer.sendCalls).toBe(0);
    await client.close();
  });

  it('reports the failing path in the validation error', async () => {
    const { client } = createClient();
    await expect(client.send({ payload: 'x', level: 'verbose' as LogLevel })).rejects.toThrow(
      /Invalid log envelope at level/,
    );
    await client.close();
  });
});

describe('LogClient batching', () => {
  it('sendBatch delivers every record in order', async () => {
    const { client, producer } = createClient();
    const results = await client.sendBatch([
      { payload: { index: 0 } },
      { payload: { index: 1 } },
      { payload: { index: 2 } },
    ]);

    expect(results.map((result) => result.status)).toEqual(['delivered', 'delivered', 'delivered']);
    expect(producer.messages).toHaveLength(3);
    expect(JSON.parse(producer.messages[1]?.value ?? '{}')).toMatchObject({
      payload: { index: 1 },
    });
    await client.close();
  });

  it('coalesces concurrent sends into one linger batch', async () => {
    const { client, producer } = createClient({
      batch: { maxRecords: 100, lingerMs: 30, maxBufferBytes: 1024 * 1024 },
    });

    await Promise.all([
      client.send({ payload: 'a' }),
      client.send({ payload: 'b' }),
      client.send({ payload: 'c' }),
    ]);

    expect(producer.batches).toHaveLength(1);
    expect(producer.lastBatch?.messages).toHaveLength(3);
    await client.close();
  });

  it('splits batches at maxRecords', async () => {
    const { client, producer } = createClient({
      batch: { maxRecords: 2, lingerMs: 0, maxBufferBytes: 1024 * 1024 },
    });

    await client.sendBatch(Array.from({ length: 5 }, (_, index) => ({ payload: { index } })));

    expect(producer.messages).toHaveLength(5);
    expect(producer.batches.length).toBeGreaterThanOrEqual(3);
    expect(producer.attempts.every((batch) => batch.messages.length <= 2)).toBe(true);
    await client.close();
  });
});

describe('LogClient lifecycle', () => {
  it('rejects sends after close in throw mode', async () => {
    const { client } = createClient({ failureMode: 'throw' });
    await client.close();

    await expect(client.send({ payload: 'x' })).rejects.toBeInstanceOf(LogClientClosedError);
  });

  it('close is idempotent and disconnects once', async () => {
    const { client, producer } = createClient();
    await client.send({ payload: 'x' });
    await Promise.all([client.close(), client.close()]);
    await client.close();

    expect(producer.disconnectCalls).toBe(1);
    expect(client.stats.closed).toBe(true);
  });

  it('exposes immutable stats snapshots', async () => {
    const { client } = createClient();
    const before = client.stats;
    await client.send({ payload: 'x' });
    expect(before.delivered).toBe(0);
    expect(client.stats).not.toBe(before);
    expect(client.stats.delivered).toBe(1);
    await client.close();
  });

  it('validates constructor options', () => {
    expect(
      () =>
        new LogClient({
          brokers: [],
          topic: 'logs.raw',
          source: { id: 'svc' },
          producer: new FakeProducer(),
        }),
    ).toThrow(/broker/);
    expect(
      () =>
        new LogClient({
          brokers: ['localhost:9092'],
          topic: 'logs.raw',
          source: { id: 'svc' },
          batch: { maxRecords: 0 },
          producer: new FakeProducer(),
        }),
    ).toThrow(/maxRecords/);
  });
});
