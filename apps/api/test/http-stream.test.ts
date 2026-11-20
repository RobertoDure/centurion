import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp, testHub } from './helpers/http';

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needle: string,
  timeoutMs = 3000,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;
  while (!text.includes(needle)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`timed out waiting for "${needle}"; received: ${text}`);
    const chunk = await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('stream read timed out')), remaining);
      }),
    ]);
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text;
}

describe('GET /api/v1/stream', () => {
  let app: FastifyInstance | undefined;
  let abort: AbortController | undefined;

  afterEach(async () => {
    abort?.abort();
    if (app !== undefined) {
      app.server.closeAllConnections();
      await app.close();
      app = undefined;
    }
  });

  it('sets SSE headers and streams a published event', async () => {
    const hub = testHub();
    const created = createTestApp({ sseHub: hub });
    app = created.app;
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('server is not listening');

    abort = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/stream`, {
      signal: abort.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-cache');

    hub.publish({
      type: 'log.processed',
      data: { messageId: 'm1', sourceId: 'svc', status: 'clean', flagCount: 0, partial: false },
    });

    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('response has no body');
    const text = await readUntil(reader, 'event: log.processed');
    expect(text).toContain('"messageId":"m1"');
    expect(text).toMatch(/id: \d+/);
  });

  it('returns 503 when no hub is configured', async () => {
    const created = createTestApp({ sseHub: undefined });
    app = created.app;
    const response = await app.inject({ method: 'GET', url: '/api/v1/stream' });
    expect(response.statusCode).toBe(503);
  });
});
