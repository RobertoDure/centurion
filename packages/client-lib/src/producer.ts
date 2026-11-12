import type { CompressionTypes, Producer } from 'kafkajs';

import type { AuthOptions, CompressionType, ProducerLike, ProducerMessage } from './types';

/** Options for the kafkajs-backed producer adapter. */
export interface KafkaProducerAdapterOptions {
  brokers: string[];
  clientId: string;
  auth?: AuthOptions;
  compression?: CompressionType;
}

/** Maps compression names onto kafkajs enum member names. */
const COMPRESSION_MEMBER = {
  none: 'None',
  gzip: 'GZIP',
  snappy: 'Snappy',
  lz4: 'LZ4',
  zstd: 'ZSTD',
} as const;

/**
 * Wraps a kafkajs producer behind the narrow {@link ProducerLike} surface.
 * kafkajs is imported lazily on first use so unit tests and typechecking never
 * open a socket.
 */
export class KafkaProducerAdapter implements ProducerLike {
  readonly #options: KafkaProducerAdapterOptions;
  #producer: Producer | undefined;
  #connecting: Promise<Producer> | undefined;
  #compression: CompressionTypes | undefined;

  constructor(options: KafkaProducerAdapterOptions) {
    this.#options = options;
  }

  async #ensureProducer(): Promise<Producer> {
    if (this.#producer) {
      return this.#producer;
    }
    this.#connecting ??= this.#connect();
    try {
      const producer = await this.#connecting;
      this.#producer = producer;
      return producer;
    } finally {
      this.#connecting = undefined;
    }
  }

  async #connect(): Promise<Producer> {
    const { CompressionTypes: CT, Kafka: KafkaClient } = await import('kafkajs');
    const kafka = new KafkaClient({
      clientId: this.#options.clientId,
      brokers: [...this.#options.brokers],
      connectionTimeout: 1000,
      retry: { retries: 0 },
      ...(this.#options.auth?.ssl !== undefined ? { ssl: this.#options.auth.ssl } : {}),
      ...(this.#options.auth?.sasl !== undefined ? { sasl: this.#options.auth.sasl } : {}),
    });
    const producer = kafka.producer({ allowAutoTopicCreation: false });
    await producer.connect();
    this.#compression = CT[COMPRESSION_MEMBER[this.#options.compression ?? 'none']];
    return producer;
  }

  async sendBatch(topic: string, messages: ProducerMessage[]): Promise<void> {
    const producer = await this.#ensureProducer();
    await producer.send({
      topic,
      messages: messages.map((message) => ({
        key: message.key,
        value: message.value,
        headers: message.headers,
      })),
      ...(this.#compression !== undefined ? { compression: this.#compression } : {}),
    });
  }

  async disconnect(): Promise<void> {
    if (this.#connecting) {
      try {
        await this.#connecting;
      } catch {
        // A failed connect leaves nothing to disconnect.
      }
    }
    const producer = this.#producer;
    this.#producer = undefined;
    this.#compression = undefined;
    if (producer) {
      await producer.disconnect();
    }
  }
}
