import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createTestApp, makeFlag } from './helpers/http';

describe('flags routes', () => {
  it('filters by rule, source and outcome and paginates', async () => {
    const { app, backend } = createTestApp();
    const ruleId = randomUUID();
    backend.flags.push({
      kind: 'valid',
      flag: makeFlag({ ruleId, outcome: 'triggered', sourceId: 'checkout-api' }),
    });
    backend.flags.push({
      kind: 'valid',
      flag: makeFlag({ ruleId, outcome: 'uncertain', sourceId: 'search-api' }),
    });

    const all = await app.inject({ method: 'GET', url: '/api/v1/flags' });
    expect(all.statusCode).toBe(200);
    expect((all.json() as { items: unknown[] }).items).toHaveLength(2);

    const triggered = await app.inject({
      method: 'GET',
      url: `/api/v1/flags?outcome=triggered&ruleId=${ruleId}`,
    });
    expect((triggered.json() as { items: unknown[] }).items).toHaveLength(1);

    const bySource = await app.inject({ method: 'GET', url: '/api/v1/flags?sourceId=search-api' });
    expect((bySource.json() as { items: unknown[] }).items).toHaveLength(1);

    const paged = await app.inject({ method: 'GET', url: '/api/v1/flags?limit=1&offset=1' });
    const page = paged.json() as { items: unknown[]; limit: number; offset: number };
    expect(page.items).toHaveLength(1);
    expect(page.limit).toBe(1);
    expect(page.offset).toBe(1);
  });

  it('reads one flag and returns 404 for an unknown id', async () => {
    const { app, backend } = createTestApp();
    const flag = makeFlag();
    backend.flags.push({ kind: 'valid', flag });

    const read = await app.inject({ method: 'GET', url: `/api/v1/flags/${flag.id}` });
    expect(read.statusCode).toBe(200);
    expect((read.json() as { id: string }).id).toBe(flag.id);

    const missing = await app.inject({ method: 'GET', url: `/api/v1/flags/${randomUUID()}` });
    expect(missing.statusCode).toBe(404);
  });

  it('returns 422 with the query field path for invalid pagination', async () => {
    const { app } = createTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/flags?limit=0' });
    expect(response.statusCode).toBe(422);
    const body = response.json() as { errors: { path: string }[] };
    expect(body.errors.some((issue) => issue.path === 'limit')).toBe(true);
  });
});
