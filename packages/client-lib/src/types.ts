import type { LogLevel, LogPayload, LogSource } from '@centurion/contracts';
import type { SASLOptions } from 'kafkajs';

/** How the client reacts when a record cannot be enqueued or delivered. */
export type FailureMode = 'drop' | 'throw' | 'callback';

/** Compression codec passed through to the Kafka producer. */
export type CompressionType = 'none' | 'gzip' | 'snappy' | 'lz4' | 'zstd';

/** TLS / SASL settings for brokers that require authentication. */
export interface AuthOptions {
  ssl?: boolean;
  sasl?: SASLOptions;
}

/** Bounded-buffer limits applied by the client. */
export interface BatchOptions {
  /** Maximum records held in the queue plus in-flight batch. Default 500. */
  maxRecords?: number;
  /** How long a partial batch waits for more records before it is sent. Default 5ms. */
  lingerMs?: number;
  /** Maximum bytes held in the queue plus in-flight batch. Default 8 MiB. */
  maxBufferBytes?: number;
}

/** Retry policy for a failed producer.sendBatch call. */
export interface RetryOptions {
  /** Total attempts, including the first. Default 3. */
  maxAttempts?: number;
  /** Delay before the first retry in milliseconds. Default 50. */
  initialBackoffMs?: number;
  /** Upper bound for the exponential backoff in milliseconds. Default 2000. */
  maxBackoffMs?: number;
  /** Add equal jitter to each backoff. Default true. */
  jitter?: boolean;
}

/** A record accepted by {@link LogClient.send}. */
export interface LogRecordInput {
  level?: LogLevel;
  payload: LogPayload;
  attributes?: Record<string, string>;
  /** ISO-8601 timestamp. Generated when omitted. */
  timestamp?: string;
  /** Record id. Generated when omitted. */
  id?: string;
}

/** A serialized Kafka message handed to a {@link ProducerLike}. */
export interface ProducerMessage {
  key: string;
  value: string;
  headers: Record<string, string>;
}

/**
 * The narrow producer surface the client depends on. Tests inject a fake; the
 * real implementation is {@link KafkaProducerAdapter} over kafkajs.
 */
export interface ProducerLike {
  sendBatch(topic: string, messages: ProducerMessage[]): Promise<void>;
  disconnect(): Promise<void>;
}

/** Phase in which a failure happened. */
export type LogErrorPhase = 'enqueue' | 'delivery';

/** Context passed to the optional onError hook. */
export interface LogErrorContext {
  id?: string;
  phase: LogErrorPhase;
  /** Attempt number (1-based) for delivery failures. */
  attempt?: number;
}

/** Emitted when a payload exceeds warnPayloadBytes. */
export interface PayloadSizeWarning {
  id: string;
  bytes: number;
  thresholdBytes: number;
}

/** How a completed send settled. */
export type SendStatus = 'delivered' | 'dropped' | 'failed';

/** Result of an individual send. */
export interface SendResult {
  id: string;
  status: SendStatus;
  /** Present for `failed` results; also set on dropped results. */
  error?: Error;
}

/** Snapshot of the client's counters and buffer occupancy. */
export interface LogClientStats {
  /** Records that were validated and accepted into the buffer. */
  accepted: number;
  /** Records acknowledged by the producer. */
  delivered: number;
  /** Records discarded because of the `drop` failure mode. */
  dropped: number;
  /** Records that failed because of the `callback` failure mode. */
  failed: number;
  /** sendBatch attempts that were retried. */
  retried: number;
  /** Payloads larger than warnPayloadBytes. */
  warnings: number;
  queuedRecords: number;
  queuedBytes: number;
  inFlightRecords: number;
  inFlightBytes: number;
  bufferedRecords: number;
  bufferedBytes: number;
  closed: boolean;
}

/** Constructor options for {@link LogClient}. */
export interface LogClientOptions {
  /** Kafka bootstrap brokers, e.g. `['localhost:9092']`. */
  brokers: string[];
  /** Destination topic, e.g. `logs.raw`. */
  topic: string;
  /** Static source stamped on every envelope and used as the Kafka key. */
  source: LogSource;
  auth?: AuthOptions;
  compression?: CompressionType;
  batch?: BatchOptions;
  /** Defaults to `drop` so a broker outage never crashes the host app. */
  failureMode?: FailureMode;
  onError?: (error: Error, context: LogErrorContext) => void;
  /** Optional sink for oversize warnings; defaults to console.warn. */
  onWarning?: (warning: PayloadSizeWarning) => void;
  clientId?: string;
  /** Warn when a serialized record exceeds this many bytes. Default 1 MiB. */
  warnPayloadBytes?: number;
  retry?: RetryOptions;
  /** How long send() waits for buffer space before dropping/rejecting. Default 5000ms. */
  enqueueTimeoutMs?: number;
  /** Inject a producer (used by tests). */
  producer?: ProducerLike;
  /** Inject an id generator (used by tests). */
  idFactory?: () => string;
  /** Inject a clock (used by tests). */
  now?: () => Date;
}
