import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SseEvent } from '@centurion/contracts';

import { SseHub, type SseClient } from '../src/sse/hub';

interface FakeClient extends SseClient {
  chunks: string[];
  closed: boolean;
}

function makeClient(writable = true): FakeClient {
  const client: FakeClient = {
    chunks: [],
    closed: false,
    write(chunk) {
      client.chunks.push(chunk);
      return writable;
    },
    close() {
      client.closed = true;
    },
  };
  return client;
}

function logEvent(messageId: string): SseEvent {
  return {
    type: 'log.processed',
    data: { messageId, sourceId: 'svc', status: 'clean', flagCount: 0, partial: false },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SseHub', () => {
  it('formats events with an id, type and JSON data', () => {
    const hub = new SseHub({ heartbeatMs: 0 });
    const client = makeClient();
    hub.subscribe(client);
    hub.publish(logEvent('m1'));
    expect(client.chunks).toHaveLength(1);
    expect(client.chunks[0]).toContain('id: 1\n');
    expect(client.chunks[0]).toContain('event: log.processed\n');
    expect(client.chunks[0]).toContain('"messageId":"m1"');
  });

  it('replays only events after Last-Event-ID', () => {
    const hub = new SseHub({ heartbeatMs: 0, ringBufferSize: 10 });
    hub.publish(logEvent('m1'));
    hub.publish(logEvent('m2'));
    hub.publish(logEvent('m3'));

    const client = makeClient();
    hub.subscribe(client, { lastEventId: '1' });
    const stream = client.chunks.join('');
    expect(stream).toContain('id: 2\n');
    expect(stream).toContain('id: 3\n');
    expect(stream).not.toContain('"messageId":"m1"');
  });

  it('replays from the ring buffer even after old events are evicted', () => {
    const hub = new SseHub({ heartbeatMs: 0, ringBufferSize: 2 });
    hub.publish(logEvent('m1'));
    hub.publish(logEvent('m2'));
    hub.publish(logEvent('m3'));

    const client = makeClient();
    hub.subscribe(client, { lastEventId: '0' });
    const stream = client.chunks.join('');
    expect(stream).toContain('"messageId":"m2"');
    expect(stream).toContain('"messageId":"m3"');
    expect(stream).not.toContain('"messageId":"m1"');
  });

  it('drops a slow client instead of blocking publish', () => {
    const logger = { warn: vi.fn() };
    const hub = new SseHub({ heartbeatMs: 0, maxClientBacklog: 1, logger });
    const slow = makeClient(false);
    const healthy = makeClient();
    hub.subscribe(slow);
    hub.subscribe(healthy);

    expect(() => {
      hub.publish(logEvent('m1'));
      hub.publish(logEvent('m2'));
      hub.publish(logEvent('m3'));
    }).not.toThrow();

    expect(hub.clientCount).toBe(1);
    expect(slow.closed).toBe(true);
    expect(healthy.chunks.length).toBe(3);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('sends a heartbeat comment on the interval', () => {
    vi.useFakeTimers();
    const hub = new SseHub({ heartbeatMs: 1000 });
    const client = makeClient();
    hub.subscribe(client);
    vi.advanceTimersByTime(1000);
    expect(client.chunks.some((chunk) => chunk.includes('heartbeat'))).toBe(true);
    hub.stop();
  });

  it('publishes consumer status with lag', () => {
    const hub = new SseHub({ heartbeatMs: 0, now: () => new Date('2026-10-01T12:00:00.000Z') });
    const client = makeClient();
    hub.subscribe(client);
    hub.publishConsumerStatus('paused', { lag: 7 });
    expect(hub.status).toBe('paused');
    const stream = client.chunks.join('');
    expect(stream).toContain('event: consumer.status');
    expect(stream).toContain('"status":"paused"');
    expect(stream).toContain('"lag":7');
    expect(stream).toContain('2026-10-01T12:00:00.000Z');
  });

  it('resumes writing after the transport drains', () => {
    const hub = new SseHub({ heartbeatMs: 0, maxClientBacklog: 5 });
    let writable = false;
    const client: FakeClient = {
      chunks: [],
      closed: false,
      write(chunk) {
        client.chunks.push(chunk);
        return writable;
      },
      close() {
        client.closed = true;
      },
    };
    hub.subscribe(client);
    hub.publish(logEvent('m1'));
    expect(client.chunks).toHaveLength(1);
    hub.publish(logEvent('m2'));
    expect(client.chunks).toHaveLength(1);
    writable = true;
    hub.flush(client);
    expect(client.chunks).toHaveLength(2);
    expect(client.closed).toBe(false);
  });
});
