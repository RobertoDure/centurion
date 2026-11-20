import type { ConsumerStatus, SseEvent } from '@centurion/contracts';

import type { EventPublisher } from '../pipeline/orchestrator';

/** Minimal transport the hub writes server-sent events to. */
export interface SseClient {
  /** Write one chunk; returns false when the transport is backpressured. */
  write(chunk: string): boolean;
  /** Close the underlying transport after the client is dropped or the stream ends. */
  close(): void;
}

export interface SseHubOptions {
  /** Number of events kept for Last-Event-ID replay (SSE_RING_BUFFER_SIZE). */
  ringBufferSize?: number;
  /** Heartbeat comment interval; 0 disables heartbeats. */
  heartbeatMs?: number;
  /** Events queued for one client before it is disconnected as too slow. */
  maxClientBacklog?: number;
  now?: () => Date;
  logger?: { warn(message: string, fields?: Record<string, unknown>): void };
}

export interface SubscribeOptions {
  /** Value of the client's Last-Event-ID header, replayed from the ring buffer. */
  lastEventId?: string | number;
}

interface BufferedEvent {
  id: number;
  event: SseEvent;
}

interface Subscriber {
  client: SseClient;
  queue: string[];
  backpressured: boolean;
}

function formatEvent(id: number, event: SseEvent): string {
  return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

function parseEventId(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : undefined;
  return /^\d+$/.test(value) ? Number(value) : undefined;
}

/**
 * Fan-out hub for the dashboard SSE stream (PLAN.md 8.3 / T5.3).
 *
 * A bounded ring buffer supports Last-Event-ID replay, a periodic comment keeps
 * proxies from closing idle connections, and each subscriber has its own bounded
 * queue: a slow client is dropped instead of blocking `publish`, so the Kafka
 * consumer never stalls behind a dashboard.
 */
export class SseHub implements EventPublisher {
  private readonly ringBufferSize: number;
  private readonly heartbeatMs: number;
  private readonly maxClientBacklog: number;
  private readonly now: () => Date;
  private readonly logger: SseHubOptions['logger'];
  private readonly buffer: BufferedEvent[] = [];
  private readonly subscribers = new Map<SseClient, Subscriber>();
  private nextId = 1;
  private timer: NodeJS.Timeout | undefined;
  private currentStatus: ConsumerStatus | undefined;

  constructor(options: SseHubOptions = {}) {
    this.ringBufferSize = Math.max(1, options.ringBufferSize ?? 500);
    this.heartbeatMs = Math.max(0, options.heartbeatMs ?? 15_000);
    this.maxClientBacklog = Math.max(1, options.maxClientBacklog ?? 1000);
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger;
    this.start();
  }

  get size(): number {
    return this.buffer.length;
  }

  get clientCount(): number {
    return this.subscribers.size;
  }

  get status(): ConsumerStatus | undefined {
    return this.currentStatus;
  }

  publish(event: SseEvent): void {
    const id = this.nextId;
    this.nextId += 1;
    this.buffer.push({ id, event });
    if (this.buffer.length > this.ringBufferSize) this.buffer.shift();
    const chunk = formatEvent(id, event);
    for (const subscriber of [...this.subscribers.values()]) {
      this.enqueue(subscriber, chunk);
    }
  }

  publishConsumerStatus(
    status: ConsumerStatus,
    extra: { detail?: string; lag?: number } = {},
  ): void {
    this.currentStatus = status;
    this.publish({
      type: 'consumer.status',
      data: {
        status,
        at: this.now().toISOString(),
        ...(extra.detail === undefined ? {} : { detail: extra.detail }),
        ...(extra.lag === undefined ? {} : { lag: extra.lag }),
      },
    });
  }

  subscribe(client: SseClient, options: SubscribeOptions = {}): () => void {
    const existing = this.subscribers.get(client);
    if (existing !== undefined) this.unsubscribe(client);
    const subscriber: Subscriber = { client, queue: [], backpressured: false };
    this.subscribers.set(client, subscriber);

    const lastId = parseEventId(options.lastEventId);
    if (lastId !== undefined) {
      for (const entry of this.buffer) {
        if (entry.id > lastId) this.enqueue(subscriber, formatEvent(entry.id, entry.event));
      }
    }
    return () => {
      this.unsubscribe(client);
    };
  }

  /** Retry a client whose transport signalled backpressure (e.g. after 'drain'). */
  flush(client: SseClient): void {
    const subscriber = this.subscribers.get(client);
    if (subscriber === undefined) return;
    subscriber.backpressured = false;
    this.drain(subscriber);
  }

  start(): void {
    if (this.heartbeatMs <= 0 || this.timer !== undefined) return;
    this.timer = setInterval(() => {
      if (this.subscribers.size === 0) return;
      for (const subscriber of [...this.subscribers.values()]) {
        this.enqueue(subscriber, ': heartbeat\n\n');
      }
    }, this.heartbeatMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private enqueue(subscriber: Subscriber, chunk: string): void {
    if (!this.subscribers.has(subscriber.client)) return;
    if (subscriber.queue.length >= this.maxClientBacklog) {
      this.drop(subscriber, 'client backlog exceeded');
      return;
    }
    subscriber.queue.push(chunk);
    this.drain(subscriber);
  }

  private drain(subscriber: Subscriber): void {
    if (subscriber.backpressured || !this.subscribers.has(subscriber.client)) return;
    while (subscriber.queue.length > 0) {
      const chunk = subscriber.queue.shift();
      if (chunk === undefined) return;
      let writable: boolean;
      try {
        writable = subscriber.client.write(chunk);
      } catch (error) {
        this.drop(subscriber, `client write failed: ${String(error)}`);
        return;
      }
      if (!writable) {
        subscriber.backpressured = true;
        return;
      }
    }
  }

  private unsubscribe(client: SseClient): void {
    this.subscribers.delete(client);
  }

  private drop(subscriber: Subscriber, reason: string): void {
    this.subscribers.delete(subscriber.client);
    subscriber.queue = [];
    this.logger?.warn('dropping slow SSE client', { reason });
    try {
      subscriber.client.close();
    } catch {
      // The transport is already gone; nothing to do.
    }
  }
}
