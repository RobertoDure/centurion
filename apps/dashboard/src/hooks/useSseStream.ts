import type { SseEvent } from '@centurion/contracts';
import { useEffect, useRef, useState } from 'react';

import { readSseStream, sseUrl, toSseEvent } from '../api/sse';

export interface UseSseStreamOptions {
  url?: string;
  enabled?: boolean;
  fetchImpl?: typeof fetch;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  maxEvents?: number;
}

export interface UseSseStreamResult {
  events: SseEvent[];
  connected: boolean;
  lastEventId: string | undefined;
  error: string | undefined;
  reconnectAttempts: number;
}

/**
 * Subscribes to the server-sent event stream with exponential-backoff reconnect.
 * Tracks the last event id and replays it as `Last-Event-ID` on every reconnect
 * so the server can resend anything missed while disconnected.
 */
export function useSseStream(options: UseSseStreamOptions = {}): UseSseStreamResult {
  const {
    url = sseUrl(),
    enabled = true,
    fetchImpl,
    reconnectDelayMs = 1000,
    maxReconnectDelayMs = 15_000,
    maxEvents = 1000,
  } = options;

  const [events, setEvents] = useState<SseEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastEventId, setLastEventId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const lastEventIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let cancelled = false;
    let attempt = 0;

    const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        if (controller.signal.aborted) {
          onAbort();
          return;
        }
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });

    const run = async (): Promise<void> => {
      while (!cancelled && !controller.signal.aborted) {
        try {
          const resume = lastEventIdRef.current;
          for await (const frame of readSseStream({
            url,
            signal: controller.signal,
            ...(resume === undefined ? {} : { lastEventId: resume }),
            ...(fetchImpl === undefined ? {} : { fetchImpl }),
          })) {
            if (cancelled || controller.signal.aborted) return;
            setConnected(true);
            setError(undefined);
            if (attempt !== 0) {
              attempt = 0;
              setReconnectAttempts(0);
            }
            if (frame.id !== undefined) {
              lastEventIdRef.current = frame.id;
              setLastEventId(frame.id);
            }
            const event = toSseEvent(frame);
            if (event !== undefined) {
              setEvents((current) => [...current, event].slice(-maxEvents));
            }
          }
          if (cancelled || controller.signal.aborted) return;
          setConnected(false);
        } catch (caught) {
          if (cancelled || controller.signal.aborted) return;
          setConnected(false);
          setError(caught instanceof Error ? caught.message : 'SSE connection failed');
        }
        if (cancelled || controller.signal.aborted) return;
        const delay = Math.min(reconnectDelayMs * 2 ** attempt, maxReconnectDelayMs);
        attempt += 1;
        setReconnectAttempts(attempt);
        await sleep(delay);
      }
    };

    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url, enabled, fetchImpl, reconnectDelayMs, maxReconnectDelayMs, maxEvents]);

  return { events, connected, lastEventId, error, reconnectAttempts };
}
