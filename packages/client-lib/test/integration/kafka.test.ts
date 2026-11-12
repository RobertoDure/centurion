import { randomUUID } from 'node:crypto';
import net from 'node:net';

import {
  CURRENT_SCHEMA_VERSION,
  KAFKA_CONTENT_TYPE_JSON,
  KAFKA_HEADER_CONTENT_TYPE,
  KAFKA_HEADER_SCHEMA_VERSION,
  type LogEnvelope,
} from '@centurion/contracts';
import { Kafka, logLevel, type IHeaders } from 'kafkajs';
import { afterAll, describe, expect, it } from 'vitest';

import { LogClient, type LogRecordInput } from '../../src';

const BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9092')
  .split(',')
  .map((broker) => broker.trim())
  .filter((broker) => broker.length > 0);
const TOPIC = process.env.KAFKA_TOPIC_RAW ?? 'logs.raw';
const RUN_ID = randomUUID();
const SOURCE_ID = `client-lib-itest-${RUN_ID}`;
const RECORD_COUNT = 25;

function isReachable(hostPort: string, timeoutMs = 2000): Promise<boolean> {
  const [host, portText] = hostPort.split(':');
  const port = Number(portText);
  if (!host || !Number.isInteger(port) || port <= 0) {
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (reachable: boolean): void => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

function headersToRecord(headers: IHeaders | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) {
    return result;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    result[key] = Array.isArray(value)
      ? value.map((entry) => entry.toString()).join(',')
      : value.toString();
  }
  return result;
}

const firstBroker = BROKERS[0] ?? '';
const reachable = firstBroker.length > 0 ? await isReachable(firstBroker) : false;

describe.skipIf(!reachable)(`Kafka integration (${BROKERS.join(',')} -> ${TOPIC})`, () => {
  const client = new LogClient({
    brokers: BROKERS,
    topic: TOPIC,
    source: { id: SOURCE_ID, environment: 'test' },
    clientId: `client-lib-itest-${RUN_ID}`,
    batch: { maxRecords: 10, lingerMs: 5, maxBufferBytes: 1024 * 1024 },
    failureMode: 'throw',
  });
  const kafka = new Kafka({
    clientId: `client-lib-itest-consumer-${RUN_ID}`,
    brokers: BROKERS,
    logLevel: logLevel.NOTHING,
  });
  const consumer = kafka.consumer({
    groupId: `client-lib-itest-${RUN_ID}`,
    sessionTimeout: 10_000,
  });
  const received: Array<{ key: string | null; value: string; headers: Record<string, string> }> =
    [];

  afterAll(async () => {
    await consumer.disconnect().catch(() => undefined);
    await client.close().catch(() => undefined);
  });

  it('publishes a batch that can be read back from the topic', async () => {
    const records: LogRecordInput[] = Array.from({ length: RECORD_COUNT }, (_, index) => ({
      level: 'info',
      payload: { message: `integration record ${index}`, index, runId: RUN_ID },
      attributes: { run: RUN_ID, index: String(index) },
    }));

    const results = await client.sendBatch(records);
    expect(results.map((result) => result.status)).toEqual(
      Array.from({ length: RECORD_COUNT }, () => 'delivered'),
    );
    await client.flush();

    await consumer.connect();
    await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timed out after receiving ${received.length}/${RECORD_COUNT} records`));
      }, 30_000);
      const finish = (error?: Error): void => {
        clearTimeout(timer);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      void consumer
        .run({
          eachMessage: async ({ message }) => {
            const value = message.value?.toString();
            if (!value) {
              return;
            }
            let envelope: LogEnvelope;
            try {
              envelope = JSON.parse(value) as LogEnvelope;
            } catch {
              return;
            }
            if (envelope.attributes?.run !== RUN_ID) {
              return;
            }
            received.push({
              key: message.key ? message.key.toString() : null,
              value,
              headers: headersToRecord(message.headers),
            });
            if (received.length >= RECORD_COUNT) {
              finish();
            }
          },
        })
        .catch((error: unknown) => {
          finish(error instanceof Error ? error : new Error(String(error)));
        });
    });

    expect(received).toHaveLength(RECORD_COUNT);
    for (const record of received) {
      const envelope = JSON.parse(record.value) as LogEnvelope;
      expect(envelope.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(envelope.source.id).toBe(SOURCE_ID);
      expect(envelope.id.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(envelope.timestamp))).toBe(false);
      expect(record.key).toBe(SOURCE_ID);
      expect(record.headers[KAFKA_HEADER_SCHEMA_VERSION]).toBe(String(CURRENT_SCHEMA_VERSION));
      expect(record.headers[KAFKA_HEADER_CONTENT_TYPE]).toBe(KAFKA_CONTENT_TYPE_JSON);
    }
  });
});
