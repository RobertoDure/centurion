import type { ConsumerStatus } from '@centurion/contracts';

export interface ConsumedMessage {
  topic: string;
  partition: number;
  offset: string;
  key: string | null;
  value: string | null;
  headers: Record<string, string>;
  timestamp: string;
}

export interface MessageContext {
  message: ConsumedMessage;
  /** Manual offset commit; at-least-once delivery (PLAN.md 5.7). */
  commit(): Promise<void>;
}

export type MessageHandler = (context: MessageContext) => Promise<void>;

/** Thin adapter over a Kafka client; the concrete one lives next to it. */
export interface KafkaConsumerAdapter {
  start(handler: MessageHandler): Promise<void>;
  pause(): void;
  resume(): void;
  /** Must not abandon an in-flight handler. */
  stop(): Promise<void>;
}

export interface ConsumerRunnerOptions {
  onStatusChange?: (status: ConsumerStatus) => void;
  logger?: { warn(message: string, fields?: Record<string, unknown>): void };
}

/**
 * Enforces sequential processing (CONSUMER_CONCURRENCY=1, assumption A9),
 * pause/resume and graceful shutdown: pause fetching, let the in-flight message
 * finish and commit, then disconnect.
 */
export class ConsumerRunner {
  private readonly adapter: KafkaConsumerAdapter;
  private readonly options: ConsumerRunnerOptions;
  private inFlight = 0;
  private status: ConsumerStatus = 'stopped';
  private idleWaiters: Array<() => void> = [];

  constructor(adapter: KafkaConsumerAdapter, options: ConsumerRunnerOptions = {}) {
    this.adapter = adapter;
    this.options = options;
  }

  get currentStatus(): ConsumerStatus {
    return this.status;
  }

  get inFlightCount(): number {
    return this.inFlight;
  }

  private setStatus(status: ConsumerStatus): void {
    this.status = status;
    this.options.onStatusChange?.(status);
  }

  private notifyIdle(): void {
    if (this.inFlight > 0) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const waiter of waiters) waiter();
  }

  private waitForIdle(): Promise<void> {
    if (this.inFlight === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  async start(handler: MessageHandler): Promise<void> {
    const wrapped: MessageHandler = async (context) => {
      this.inFlight += 1;
      try {
        await handler(context);
      } finally {
        this.inFlight -= 1;
        this.notifyIdle();
      }
    };
    this.setStatus('running');
    await this.adapter.start(wrapped);
  }

  pause(): void {
    this.adapter.pause();
    this.setStatus('paused');
  }

  resume(): void {
    this.adapter.resume();
    this.setStatus('running');
  }

  /** Graceful shutdown: stop fetching, drain in-flight work, disconnect. */
  async stop(): Promise<void> {
    this.adapter.pause();
    await this.waitForIdle();
    await this.adapter.stop();
    this.setStatus('stopped');
  }
}
