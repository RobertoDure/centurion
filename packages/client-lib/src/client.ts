import { Buffer } from 'node:buffer';

import {
  CURRENT_SCHEMA_VERSION,
  KAFKA_CONTENT_TYPE_JSON,
  KAFKA_HEADER_CONTENT_TYPE,
  KAFKA_HEADER_SCHEMA_VERSION,
  logEnvelopeSchema,
  logSourceSchema,
  type LogEnvelope,
  type LogSource,
} from '@centurion/contracts';

import {
  LogBufferFullError,
  LogClientClosedError,
  LogClientError,
  LogValidationError,
} from './errors';
import { defaultIdFactory } from './id';
import { KafkaProducerAdapter } from './producer';
import type {
  BatchOptions,
  FailureMode,
  LogClientOptions,
  LogClientStats,
  LogErrorContext,
  LogRecordInput,
  PayloadSizeWarning,
  ProducerLike,
  ProducerMessage,
  RetryOptions,
  SendResult,
} from './types';

const DEFAULT_RETRY: Required<RetryOptions> = {
  maxAttempts: 3,
  initialBackoffMs: 50,
  maxBackoffMs: 2000,
  jitter: true,
};

const DEFAULT_MAX_RECORDS = 500;
const DEFAULT_LINGER_MS = 5;
const DEFAULT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const DEFAULT_WARN_PAYLOAD_BYTES = 1024 * 1024;
const DEFAULT_ENQUEUE_TIMEOUT_MS = 5000;
const DEFAULT_CLIENT_ID = '@centurion/client-lib';
const DEFAULT_FAILURE_MODE: FailureMode = 'drop';

interface QueueItem {
  id: string;
  message: ProducerMessage;
  bytes: number;
  resolve: (result: SendResult) => void;
  reject: (error: unknown) => void;
}

interface SpaceWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Counters {
  accepted: number;
  delivered: number;
  dropped: number;
  failed: number;
  retried: number;
  warnings: number;
}

/**
 * Validates log records, assigns ids/timestamps, and publishes them to Kafka
 * on a bounded, batched buffer. Failures never crash the host by default:
 * `failureMode: 'drop'` counts the record and moves on.
 */
export class LogClient {
  readonly #topic: string;
  readonly #source: LogSource;
  readonly #producer: ProducerLike;
  readonly #failureMode: FailureMode;
  readonly #onError: ((error: Error, context: LogErrorContext) => void) | undefined;
  readonly #onWarning: ((warning: PayloadSizeWarning) => void) | undefined;
  readonly #warnPayloadBytes: number;
  readonly #maxRecords: number;
  readonly #maxBufferBytes: number;
  readonly #lingerMs: number;
  readonly #enqueueTimeoutMs: number;
  readonly #retry: Required<RetryOptions>;
  readonly #idFactory: () => string;
  readonly #now: () => Date;

  #queue: QueueItem[] = [];
  #queueBytes = 0;
  #inFlightRecords = 0;
  #inFlightBytes = 0;
  #spaceWaiters: SpaceWaiter[] = [];
  #idleWaiters: Array<() => void> = [];
  #draining = false;
  #closed = false;
  #closePromise: Promise<void> | undefined;
  #counters: Counters = {
    accepted: 0,
    delivered: 0,
    dropped: 0,
    failed: 0,
    retried: 0,
    warnings: 0,
  };

  constructor(options: LogClientOptions) {
    if (options === null || typeof options !== 'object') {
      throw new LogClientError('LogClient options are required');
    }
    if (!Array.isArray(options.brokers) || options.brokers.length === 0) {
      throw new LogClientError('LogClient requires at least one broker in options.brokers');
    }
    if (typeof options.topic !== 'string' || options.topic.length === 0) {
      throw new LogClientError('LogClient requires a non-empty options.topic');
    }

    const source = logSourceSchema.safeParse(options.source);
    if (!source.success) {
      throw new LogValidationError(describeIssues(source.error.issues));
    }
    this.#source = source.data;
    this.#topic = options.topic;

    const batch: BatchOptions = options.batch ?? {};
    this.#maxRecords = positiveInteger(batch.maxRecords ?? DEFAULT_MAX_RECORDS, 'batch.maxRecords');
    this.#maxBufferBytes = positiveInteger(
      batch.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
      'batch.maxBufferBytes',
    );
    this.#lingerMs = nonNegativeInteger(batch.lingerMs ?? DEFAULT_LINGER_MS, 'batch.lingerMs');
    this.#warnPayloadBytes = positiveInteger(
      options.warnPayloadBytes ?? DEFAULT_WARN_PAYLOAD_BYTES,
      'warnPayloadBytes',
    );
    this.#enqueueTimeoutMs = nonNegativeInteger(
      options.enqueueTimeoutMs ?? DEFAULT_ENQUEUE_TIMEOUT_MS,
      'enqueueTimeoutMs',
    );
    this.#failureMode = options.failureMode ?? DEFAULT_FAILURE_MODE;
    this.#onError = options.onError;
    this.#onWarning = options.onWarning;
    this.#idFactory = options.idFactory ?? defaultIdFactory;
    this.#now = options.now ?? (() => new Date());

    const retry = { ...DEFAULT_RETRY, ...(options.retry ?? {}) };
    this.#retry = {
      maxAttempts: positiveInteger(retry.maxAttempts, 'retry.maxAttempts'),
      initialBackoffMs: nonNegativeInteger(retry.initialBackoffMs, 'retry.initialBackoffMs'),
      maxBackoffMs: nonNegativeInteger(retry.maxBackoffMs, 'retry.maxBackoffMs'),
      jitter: retry.jitter,
    };

    this.#producer =
      options.producer ??
      new KafkaProducerAdapter({
        brokers: [...options.brokers],
        clientId: options.clientId ?? DEFAULT_CLIENT_ID,
        auth: options.auth,
        compression: options.compression,
      });
  }

  /** Destination topic. */
  get topic(): string {
    return this.#topic;
  }

  /** Static source stamped on every envelope. */
  get source(): LogSource {
    return this.#source;
  }

  /** Current counters and buffer occupancy. */
  get stats(): Readonly<LogClientStats> {
    return {
      ...this.#counters,
      queuedRecords: this.#queue.length,
      queuedBytes: this.#queueBytes,
      inFlightRecords: this.#inFlightRecords,
      inFlightBytes: this.#inFlightBytes,
      bufferedRecords: this.#bufferedRecords,
      bufferedBytes: this.#bufferedBytes,
      closed: this.#closed,
    };
  }

  /**
   * Validates, stamps, buffers and publishes one record. Resolves once the
   * record is delivered, dropped, or (in `callback` mode) failed. In
   * `throw` mode it rejects on delivery failure. Invalid records always
   * reject with {@link LogValidationError}.
   */
  async send(record: LogRecordInput): Promise<SendResult> {
    const envelope = this.#buildEnvelope(record);
    const value = JSON.stringify(envelope);
    const bytes = Buffer.byteLength(value, 'utf8');
    const id = envelope.id;

    if (bytes > this.#warnPayloadBytes) {
      this.#counters.warnings++;
      this.#emitWarning({ id, bytes, thresholdBytes: this.#warnPayloadBytes });
    }

    const message: ProducerMessage = {
      key: envelope.source.id,
      value,
      headers: {
        [KAFKA_HEADER_SCHEMA_VERSION]: String(CURRENT_SCHEMA_VERSION),
        [KAFKA_HEADER_CONTENT_TYPE]: KAFKA_CONTENT_TYPE_JSON,
      },
    };

    if (this.#closed) {
      return this.#applyFailureMode(new LogClientClosedError(), { id, phase: 'enqueue' });
    }

    try {
      await this.#reserve(bytes);
    } catch (error) {
      return this.#applyFailureMode(toError(error), { id, phase: 'enqueue' });
    }

    if (this.#closed) {
      return this.#applyFailureMode(new LogClientClosedError(), { id, phase: 'enqueue' });
    }

    this.#counters.accepted++;
    return new Promise<SendResult>((resolve, reject) => {
      this.#queue.push({ id, message, bytes, resolve, reject });
      this.#queueBytes += bytes;
      void this.#drain();
    });
  }

  /** Sends several records; resolves with one result per record in order. */
  async sendBatch(records: LogRecordInput[]): Promise<SendResult[]> {
    if (!Array.isArray(records)) {
      throw new LogClientError('sendBatch expects an array of records');
    }
    return Promise.all(records.map((record) => this.send(record)));
  }

  /** Resolves once every buffered and in-flight record has settled. */
  async flush(): Promise<void> {
    while (this.#bufferedRecords > 0 || this.#draining) {
      await this.#waitForIdle();
    }
  }

  /** Flushes pending records and disconnects the producer. Idempotent. */
  close(): Promise<void> {
    this.#closePromise ??= this.#doClose();
    return this.#closePromise;
  }

  async #doClose(): Promise<void> {
    this.#closed = true;
    this.#rejectSpaceWaiters(new LogClientClosedError());
    try {
      await this.flush();
    } finally {
      await this.#producer.disconnect();
    }
  }

  #buildEnvelope(record: LogRecordInput): LogEnvelope {
    if (record === null || typeof record !== 'object') {
      throw new LogValidationError('log record must be an object');
    }
    // Spread the input first so unknown keys are rejected by the strict
    // envelope schema instead of being silently dropped.
    const candidate = {
      ...record,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: record.id ?? this.#idFactory(),
      source: this.#source,
      timestamp: record.timestamp ?? this.#now().toISOString(),
    };
    const result = logEnvelopeSchema.safeParse(candidate);
    if (!result.success) {
      throw new LogValidationError(describeIssues(result.error.issues));
    }
    return result.data;
  }

  async #reserve(bytes: number): Promise<void> {
    for (;;) {
      if (this.#closed) {
        throw new LogClientClosedError();
      }
      const recordsFit = this.#bufferedRecords + 1 <= this.#maxRecords;
      // A lone record is always admitted, even if it exceeds maxBufferBytes:
      // the client does not impose a size cap (PLAN.md section 7.1 assigns
      // that decision to the server).
      const bytesFit =
        this.#bufferedRecords === 0 || this.#bufferedBytes + bytes <= this.#maxBufferBytes;
      if (recordsFit && bytesFit) {
        return;
      }
      await this.#waitForSpace();
    }
  }

  #waitForSpace(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter: SpaceWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.#spaceWaiters.indexOf(waiter);
          if (index >= 0) {
            this.#spaceWaiters.splice(index, 1);
          }
          reject(
            new LogBufferFullError(
              `Buffer full after ${this.#enqueueTimeoutMs}ms (maxRecords=${this.#maxRecords}, maxBufferBytes=${this.#maxBufferBytes})`,
            ),
          );
        }, this.#enqueueTimeoutMs),
      };
      this.#spaceWaiters.push(waiter);
    });
  }

  #notifySpace(): void {
    if (this.#spaceWaiters.length === 0) {
      return;
    }
    const waiters = this.#spaceWaiters;
    this.#spaceWaiters = [];
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  #rejectSpaceWaiters(error: Error): void {
    const waiters = this.#spaceWaiters;
    this.#spaceWaiters = [];
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  #waitForIdle(): Promise<void> {
    if (this.#bufferedRecords === 0 && !this.#draining) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.#idleWaiters.push(resolve);
    });
  }

  #notifyIdle(): void {
    if (this.#bufferedRecords > 0 || this.#draining || this.#idleWaiters.length === 0) {
      return;
    }
    const waiters = this.#idleWaiters;
    this.#idleWaiters = [];
    for (const waiter of waiters) {
      waiter();
    }
  }

  async #drain(): Promise<void> {
    if (this.#draining) {
      return;
    }
    this.#draining = true;
    try {
      while (this.#queue.length > 0) {
        await this.#waitLinger();
        const batch = this.#takeBatch();
        if (batch.length === 0) {
          continue;
        }
        await this.#deliver(batch);
      }
    } finally {
      this.#draining = false;
      if (this.#queue.length > 0) {
        void this.#drain();
      } else {
        this.#notifyIdle();
      }
    }
  }

  async #waitLinger(): Promise<void> {
    if (this.#lingerMs <= 0 || this.#queue.length >= this.#maxRecords) {
      return;
    }
    await sleep(this.#lingerMs);
  }

  #takeBatch(): QueueItem[] {
    const batch: QueueItem[] = [];
    let bytes = 0;
    while (this.#queue.length > 0 && batch.length < this.#maxRecords) {
      const next = this.#queue[0];
      if (!next) {
        break;
      }
      if (batch.length > 0 && bytes + next.bytes > this.#maxBufferBytes) {
        break;
      }
      this.#queue.shift();
      this.#queueBytes -= next.bytes;
      this.#inFlightRecords++;
      this.#inFlightBytes += next.bytes;
      batch.push(next);
      bytes += next.bytes;
    }
    return batch;
  }

  async #deliver(batch: QueueItem[]): Promise<void> {
    const messages = batch.map((item) => item.message);
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        await this.#producer.sendBatch(this.#topic, messages);
        for (const item of batch) {
          this.#settle(item);
          this.#counters.delivered++;
          item.resolve({ id: item.id, status: 'delivered' });
        }
        this.#notifySpace();
        return;
      } catch (error) {
        const normalized = toError(error);
        if (attempt >= this.#retry.maxAttempts) {
          for (const item of batch) {
            this.#settle(item);
            try {
              item.resolve(
                this.#applyFailureMode(normalized, { id: item.id, phase: 'delivery', attempt }),
              );
            } catch (failure) {
              item.reject(failure);
            }
          }
          this.#notifySpace();
          return;
        }
        this.#counters.retried++;
        await sleep(this.#backoff(attempt));
      }
    }
  }

  #settle(item: QueueItem): void {
    this.#inFlightRecords--;
    this.#inFlightBytes -= item.bytes;
  }

  #backoff(attempt: number): number {
    const exponential = Math.min(
      this.#retry.maxBackoffMs,
      this.#retry.initialBackoffMs * 2 ** (attempt - 1),
    );
    if (!this.#retry.jitter || exponential === 0) {
      return exponential;
    }
    // Equal jitter keeps the delay within [base/2, base].
    return Math.floor(exponential / 2 + Math.random() * (exponential / 2));
  }

  #applyFailureMode(error: Error, context: LogErrorContext): SendResult {
    this.#emitError(error, context);
    if (this.#failureMode === 'throw') {
      throw error;
    }
    if (this.#failureMode === 'callback') {
      this.#counters.failed++;
      return { id: context.id ?? '', status: 'failed', error };
    }
    this.#counters.dropped++;
    return { id: context.id ?? '', status: 'dropped', error };
  }

  #emitError(error: Error, context: LogErrorContext): void {
    if (!this.#onError) {
      return;
    }
    try {
      this.#onError(error, context);
    } catch {
      // An observer hook must never crash the host application.
    }
  }

  #emitWarning(warning: PayloadSizeWarning): void {
    if (this.#onWarning) {
      try {
        this.#onWarning(warning);
      } catch {
        // An observer hook must never crash the host application.
      }
      return;
    }
    console.warn(
      `[client-lib] record ${warning.id} is ${warning.bytes} bytes, above warnPayloadBytes=${warning.thresholdBytes}`,
    );
  }

  get #bufferedRecords(): number {
    return this.#queue.length + this.#inFlightRecords;
  }

  get #bufferedBytes(): number {
    return this.#queueBytes + this.#inFlightBytes;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(typeof value === 'string' ? value : 'Unknown producer error');
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new LogClientError(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new LogClientError(`${name} must be a non-negative integer`);
  }
  return value;
}

function describeIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): string {
  const first = issues[0];
  if (!first) {
    return 'log envelope failed validation';
  }
  const path = first.path.length > 0 ? first.path.map(String).join('.') : '<root>';
  return `Invalid log envelope at ${path}: ${first.message}`;
}
