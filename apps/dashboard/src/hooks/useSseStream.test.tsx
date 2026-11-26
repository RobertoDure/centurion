import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSseStream } from './useSseStream';

interface StreamPlan {
  chunks?: string[];
  close?: boolean;
  error?: boolean;
}

function makeStreamFetch(plans: readonly StreamPlan[]): {
  fetchImpl: typeof fetch;
  seenHeaders: Array<string | null>;
} {
  const seenHeaders: Array<string | null> = [];
  let call = 0;
  const impl = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    seenHeaders.push(headers.get('last-event-id'));
    const plan = plans[Math.min(call, plans.length - 1)];
    call += 1;
    if (plan === undefined || plan.error === true) throw new Error('network down');
    const encoder = new TextEncoder();
    const signal = init?.signal ?? null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of plan.chunks ?? []) controller.enqueue(encoder.encode(chunk));
        if (plan.close === true) {
          controller.close();
        } else {
          signal?.addEventListener('abort', () => {
            try {
              controller.close();
            } catch {
              // already closed
            }
          });
        }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  return { fetchImpl: impl as typeof fetch, seenHeaders };
}

function logFrame(id: number, messageId: string, status: string): string {
  return `id: ${id}\nevent: log.processed\ndata: ${JSON.stringify({
    messageId,
    sourceId: 'svc',
    status,
    flagCount: 0,
    partial: false,
  })}\n\n`;
}

function Probe({
  fetchImpl,
  reconnectDelayMs,
}: {
  fetchImpl: typeof fetch;
  reconnectDelayMs: number;
}) {
  const { events, connected, lastEventId, error } = useSseStream({
    url: 'http://localhost:3000/api/v1/stream',
    fetchImpl,
    reconnectDelayMs,
    maxReconnectDelayMs: 25,
    maxEvents: 50,
  });
  const statuses = events
    .filter((event) => event.type === 'log.processed')
    .map((event) => event.data.status)
    .join(',');
  return (
    <div>
      <span data-testid="count">{events.length}</span>
      <span data-testid="connected">{connected ? 'yes' : 'no'}</span>
      <span data-testid="last-id">{lastEventId ?? 'none'}</span>
      <span data-testid="statuses">{statuses}</span>
      <span data-testid="error">{error ?? 'none'}</span>
    </div>
  );
}

describe('useSseStream', () => {
  it('reconnects and replays Last-Event-ID', async () => {
    const { fetchImpl, seenHeaders } = makeStreamFetch([
      { chunks: [logFrame(1, 'm1', 'clean')], close: true },
      { chunks: [logFrame(2, 'm2', 'flagged')] },
    ]);
    const { unmount } = render(<Probe fetchImpl={fetchImpl} reconnectDelayMs={5} />);

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    expect(screen.getByTestId('last-id').textContent).toBe('2');
    expect(screen.getByTestId('statuses').textContent).toBe('clean,flagged');
    expect(screen.getByTestId('connected').textContent).toBe('yes');
    expect(seenHeaders[0]).toBeNull();
    expect(seenHeaders[1]).toBe('1');
    unmount();
  });

  it('recovers after a connection error and ignores malformed frames', async () => {
    const { fetchImpl } = makeStreamFetch([
      { error: true },
      {
        chunks: [
          ': heartbeat\n\n',
          'event: log.processed\ndata: not-json\n\n',
          logFrame(5, 'm5', 'uncertain'),
        ],
      },
    ]);
    const { unmount } = render(<Probe fetchImpl={fetchImpl} reconnectDelayMs={5} />);

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    expect(screen.getByTestId('statuses').textContent).toBe('uncertain');
    expect(screen.getByTestId('error').textContent).toBe('none');
    expect(screen.getByTestId('last-id').textContent).toBe('5');
    unmount();
  });
});
