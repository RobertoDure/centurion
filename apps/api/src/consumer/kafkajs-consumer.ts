import { Kafka, type Consumer, type EachMessagePayload, type Producer } from 'kafkajs';

import type { KafkaProducerLike, KafkaRecord } from '../actions/kafka-topic';
import type { ConsumedMessage, KafkaConsumerAdapter, MessageContext, MessageHandler } from './runner';

/** Structural contract for the DLQ publisher; the pipeline orchestrator (T4.3) consumes it. */
export interface DlqPublisher {
  publish(input: { reason: string; message: ConsumedMessage }): Promise<void>;
}

export type KafkaSasl =
  | { mechanism: 'plain'; username: string; password: string }
  | { mechanism: 'scram-sha-256'; username: string; password: string }
  | { mechanism: 'scram-sha-512'; username: string; password: string };

export interface KafkaConnectionOptions {
  brokers: string[];
  clientId: string;
  ssl?: boolean;
  sasl?: KafkaSasl | undefined;
}

export function createKafka(options: KafkaConnectionOptions): Kafka {
  return new Kafka({
    clientId: options.clientId,
    brokers: options.brokers,
    ...(options.ssl === undefined ? {} : { ssl: options.ssl }),
    ...(options.sasl === undefined ? {} : { sasl: options.sasl }),
  });
}

export function toConsumedMessage(payload: EachMessagePayload): ConsumedMessage {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload.message.headers ?? {})) {
    if (value === undefined || value === null) continue;
    headers[key] = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  }
  return {
    topic: payload.topic,
    partition: payload.partition,
    offset: payload.message.offset,
    key: payload.message.key === null ? null : payload.message.key.toString('utf8'),
    value: payload.message.value === null ? null : payload.message.value.toString('utf8'),
    headers,
    timestamp: payload.message.timestamp,
  };
}

export interface KafkaJsConsumerAdapterOptions {
  topic: string;
  groupId: string;
  fromBeginning?: boolean;
  logger?: { warn(message: string, fields?: Record<string, unknown>): void };
}

/**
 * KafkaJS adapter behind KafkaConsumerAdapter. autoCommit is off, so the
 * pipeline commits an offset only after the DB transaction (PLAN.md 5.7/7).
 */
export class KafkaJsConsumerAdapter implements KafkaConsumerAdapter {
  private readonly kafka: Kafka;
  private readonly options: KafkaJsConsumerAdapterOptions;
  private consumer: Consumer | undefined;
  private runPromise: Promise<void> | undefined;

  constructor(kafka: Kafka, options: KafkaJsConsumerAdapterOptions) {
    this.kafka = kafka;
    this.options = options;
  }

  private async handleMessage(payload: EachMessagePayload, handler: MessageHandler): Promise<void> {
    const consumer = this.consumer;
    if (consumer === undefined) throw new Error('consumer is not connected');
    const context: MessageContext = {
      message: toConsumedMessage(payload),
      commit: async () => {
        await consumer.commitOffsets([
          {
            topic: payload.topic,
            partition: payload.partition,
            offset: (BigInt(payload.message.offset) + 1n).toString(),
          },
        ]);
      },
    };
    await handler(context);
  }

  async start(handler: MessageHandler): Promise<void> {
    const consumer = this.kafka.consumer({ groupId: this.options.groupId });
    await consumer.connect();
    await consumer.subscribe({ topic: this.options.topic, fromBeginning: this.options.fromBeginning ?? false });
    this.consumer = consumer;
    this.runPromise = consumer.run({
      autoCommit: false,
      eachMessage: (payload) => this.handleMessage(payload, handler),
    });
    this.runPromise.catch((error: unknown) => {
      this.options.logger?.warn('kafka consumer loop stopped', { error: String(error) });
    });
  }

  pause(): void {
    void this.consumer?.pause([{ topic: this.options.topic }]);
  }

  resume(): void {
    void this.consumer?.resume([{ topic: this.options.topic }]);
  }

  async stop(): Promise<void> {
    await this.consumer?.disconnect();
    await this.runPromise?.catch(() => undefined);
    this.consumer = undefined;
  }

  /** Approximate consumer lag (sum of highs minus committed offsets). */
  async lag(): Promise<number | undefined> {
    const admin = this.kafka.admin();
    await admin.connect();
    try {
      const [topicOffsets, groupOffsets] = await Promise.all([
        admin.fetchTopicOffsets(this.options.topic),
        admin.fetchOffsets({ groupId: this.options.groupId, topics: [this.options.topic] }),
      ]);
      const high = topicOffsets.reduce((sum, entry) => sum + Number(entry.high), 0);
      const committed = groupOffsets
        .flatMap((entry) => entry.partitions)
        .reduce((sum, partition) => sum + Number(partition.offset), 0);
      return Math.max(0, high - committed);
    } catch {
      return undefined;
    } finally {
      await admin.disconnect();
    }
  }
}

export interface KafkaProducerHandle {
  producer: Producer;
  disconnect(): Promise<void>;
}

export async function connectProducer(kafka: Kafka): Promise<KafkaProducerHandle> {
  const producer = kafka.producer({ allowAutoTopicCreation: false });
  await producer.connect();
  return {
    producer,
    disconnect: async () => {
      await producer.disconnect();
    },
  };
}

/** Producer-backed kafka_topic action handler dependency. */
export class KafkaJsProducer implements KafkaProducerLike {
  constructor(private readonly producer: Producer) {}

  async send(record: KafkaRecord): Promise<void> {
    await this.producer.send({
      topic: record.topic,
      messages: [{ key: record.key, value: record.value, headers: record.headers }],
    });
  }
}

/** Rejected messages go to logs.dlq with headers reason/original-topic/original-offset (PLAN.md 8.1). */
export class KafkaJsDlqPublisher implements DlqPublisher {
  constructor(
    private readonly producer: Producer,
    private readonly topic: string,
  ) {}

  async publish({ reason, message }: { reason: string; message: ConsumedMessage }): Promise<void> {
    await this.producer.send({
      topic: this.topic,
      messages: [
        {
          key: message.key,
          value: message.value,
          headers: {
            reason,
            'original-topic': message.topic,
            'original-offset': message.offset,
          },
        },
      ],
    });
  }
}
