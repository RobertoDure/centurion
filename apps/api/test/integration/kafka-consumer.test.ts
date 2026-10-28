import { Kafka } from 'kafkajs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { KafkaJsConsumerAdapter } from '../../src/consumer/kafkajs-consumer';
import type { ConsumedMessage } from '../../src/consumer/runner';
import { ConsumerRunner } from '../../src/consumer/runner';

const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',').map((value) => value.trim());
const topic = `logs.raw.it.${Date.now()}`;
const groupId = `centurion-it-${Date.now()}`;

async function kafkaReachable(): Promise<boolean> {
  const admin = new Kafka({ clientId: 'it-probe', brokers, connectionTimeout: 3000, retry: { retries: 1 } }).admin();
  try {
    await admin.connect();
    await admin.disconnect();
    return true;
  } catch {
    return false;
  }
}

const reachable = await kafkaReachable();
const describeIf = reachable ? describe : describe.skip;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await sleep(100);
  }
}

describeIf('KafkaJsConsumerAdapter (real broker)', () => {
  beforeAll(async () => {
    const admin = new Kafka({ clientId: 'it-admin', brokers }).admin();
    await admin.connect();
    await admin.createTopics({ topics: [{ topic, numPartitions: 1, replicationFactor: 1 }] });
    const producer = new Kafka({ clientId: 'it-producer', brokers }).producer();
    await producer.connect();
    await producer.send({
      topic,
      messages: [
        { key: 'svc', value: JSON.stringify({ n: 1 }) },
        { key: 'svc', value: JSON.stringify({ n: 2 }) },
        { key: 'svc', value: JSON.stringify({ n: 3 }) },
      ],
    });
    await producer.disconnect();
    await admin.disconnect();
  }, 60_000);

  afterAll(() => {
    // Topics are uniquely named per run; nothing to clean up.
  });

  it('consumes sequentially, commits manually and does not redeliver', async () => {
    const kafka = new Kafka({ clientId: `it-consumer-${Date.now()}`, brokers });
    const adapter = new KafkaJsConsumerAdapter(kafka, { topic, groupId, fromBeginning: true });
    const runner = new ConsumerRunner(adapter);
    const received: ConsumedMessage[] = [];
    const commits: string[] = [];

    await runner.start(async (context) => {
      received.push(context.message);
      commits.push(context.message.offset);
      await context.commit();
    });

    await waitFor(() => received.length >= 3);
    await runner.stop();

    expect(received.map((message) => JSON.parse(message.value ?? '{}'))).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(commits.length).toBe(3);
    expect(runner.currentStatus).toBe('stopped');

    // Restarting the same group must resume after the committed offsets.
    const secondKafka = new Kafka({ clientId: `it-consumer-2-${Date.now()}`, brokers });
    const secondAdapter = new KafkaJsConsumerAdapter(secondKafka, { topic, groupId, fromBeginning: false });
    const secondRunner = new ConsumerRunner(secondAdapter);
    const redelivered: string[] = [];
    await secondRunner.start(async (context) => {
      redelivered.push(context.message.offset);
      await context.commit();
    });
    await sleep(5_000);
    await secondRunner.stop();
    expect(redelivered).toEqual([]);
  }, 120_000);
});
