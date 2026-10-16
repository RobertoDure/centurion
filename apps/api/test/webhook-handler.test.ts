import type { ActionPayload } from '@centurion/contracts';
import { describe, expect, it, vi } from 'vitest';

import { SsrfError } from '../src/actions/ssrf';
import { createWebhookHandler, SIGNATURE_HEADER, signWebhookPayload } from '../src/actions/webhook';

const payload: ActionPayload = {
  flagId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  rule: { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3302', name: 'Payment failures', version: 2 },
  source: { id: 'checkout-api' },
  messageRef: { topic: 'logs.raw', partition: 0, offset: '42' },
  answer: { type: 'noul', noul: 0.91 },
  triggeredAt: '2026-10-01T12:00:00.000Z',
};

const config = { url: 'https://hooks.example.com/x', secret: 'topsecret', timeoutMs: 5000 };

function fetchMock(status = 200, body: string | null = '') {
  return vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(body, { status }));
}

type FetchMock = ReturnType<typeof fetchMock>;

function handlerWith(fetchMockImpl: FetchMock) {
  return createWebhookHandler({
    fetch: fetchMockImpl as unknown as typeof globalThis.fetch,
    guard: async (url) => new URL(url),
  });
}

describe('signWebhookPayload', () => {
  it('produces a stable HMAC-SHA256 signature', () => {
    const first = signWebhookPayload('secret', 'body');
    const second = signWebhookPayload('secret', 'body');
    expect(first).toBe(second);
    expect(first).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signWebhookPayload('other', 'body')).not.toBe(first);
  });
});

describe('createWebhookHandler', () => {
  it('POSTs the JSON payload with a signature header', async () => {
    const mock = fetchMock(200);
    const handler = handlerWith(mock);

    const result = await handler.execute(payload, config, { flagId: payload.flagId, attempt: 1 });

    expect(result.detail).toContain('200');
    expect(mock).toHaveBeenCalledTimes(1);
    const call = mock.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call ?? [];
    expect(String(url)).toBe('https://hooks.example.com/x');
    expect(init?.method).toBe('POST');
    const body = init?.body as string;
    expect(JSON.parse(body)).toEqual(payload);
    const headers = init?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers[SIGNATURE_HEADER]).toBe(signWebhookPayload('topsecret', body));
  });

  it('omits the signature when no secret is configured', async () => {
    const mock = fetchMock(204, null);
    const handler = handlerWith(mock);
    await handler.execute(payload, { ...config, secret: undefined }, { flagId: payload.flagId, attempt: 1 });
    const [, init] = mock.mock.calls[0] ?? [];
    const headers = init?.headers as Record<string, string>;
    expect(headers).not.toHaveProperty(SIGNATURE_HEADER);
  });

  it('merges custom headers', async () => {
    const mock = fetchMock(200);
    const handler = handlerWith(mock);
    await handler.execute(
      payload,
      { ...config, headers: { 'x-custom': 'yes' } },
      { flagId: payload.flagId, attempt: 1 },
    );
    const [, init] = mock.mock.calls[0] ?? [];
    expect(init?.headers).toMatchObject({ 'x-custom': 'yes' });
  });

  it('throws on a non-2xx response', async () => {
    const handler = handlerWith(fetchMock(500, 'nope'));
    await expect(
      handler.execute(payload, config, { flagId: payload.flagId, attempt: 1 }),
    ).rejects.toThrow('500');
  });

  it('never calls fetch when the SSRF guard rejects the URL', async () => {
    const mock = fetchMock(200);
    const handler = createWebhookHandler({
      fetch: mock as unknown as typeof globalThis.fetch,
      guard: async () => {
        throw new SsrfError('blocked');
      },
    });
    await expect(
      handler.execute(payload, config, { flagId: payload.flagId, attempt: 1 }),
    ).rejects.toBeInstanceOf(SsrfError);
    expect(mock).not.toHaveBeenCalled();
  });
});
