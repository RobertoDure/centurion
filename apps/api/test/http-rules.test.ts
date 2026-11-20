import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createTestApp, noulRuleContent } from './helpers/http';

interface RuleDtoShape {
  id: string;
  name: string;
  version: number;
  enabled: boolean;
  invalid: boolean;
  invalidReason?: string;
}

describe('rules routes', () => {
  it('lists an empty store and then a created rule', async () => {
    const { app, backend } = createTestApp();
    const empty = await app.inject({ method: 'GET', url: '/api/v1/rules' });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ items: [], total: 0 });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/rules',
      payload: noulRuleContent(),
    });
    expect(created.statusCode).toBe(201);
    const rule = created.json() as RuleDtoShape;
    expect(rule.invalid).toBe(false);
    expect(rule.version).toBe(1);
    expect(rule.enabled).toBe(true);
    expect(backend.invalidations).toBe(1);

    const listed = await app.inject({ method: 'GET', url: '/api/v1/rules' });
    expect(listed.json()).toMatchObject({ total: 1 });
    const items = (listed.json() as { items: RuleDtoShape[] }).items;
    expect(items[0]?.id).toBe(rule.id);
  });

  it('reads, updates (new version), toggles and deletes a rule', async () => {
    const { app, backend } = createTestApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/rules',
      payload: noulRuleContent(),
    });
    const rule = created.json() as RuleDtoShape;

    const read = await app.inject({ method: 'GET', url: `/api/v1/rules/${rule.id}` });
    expect(read.statusCode).toBe(200);

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/v1/rules/${rule.id}`,
      payload: noulRuleContent({ name: 'Renamed rule' }),
    });
    expect(updated.statusCode).toBe(200);
    const updatedRule = updated.json() as RuleDtoShape;
    expect(updatedRule.name).toBe('Renamed rule');
    expect(updatedRule.version).toBe(2);

    const versions = await app.inject({ method: 'GET', url: `/api/v1/rules/${rule.id}/versions` });
    expect(versions.statusCode).toBe(200);
    const versionBody = versions.json() as { items: { version: number }[]; total: number };
    expect(versionBody.total).toBe(2);
    expect(versionBody.items.map((item) => item.version)).toEqual([2, 1]);

    const disabled = await app.inject({ method: 'POST', url: `/api/v1/rules/${rule.id}/disable` });
    expect(disabled.statusCode).toBe(200);
    expect((disabled.json() as RuleDtoShape).enabled).toBe(false);

    const enabled = await app.inject({ method: 'POST', url: `/api/v1/rules/${rule.id}/enable` });
    expect(enabled.statusCode).toBe(200);
    expect((enabled.json() as RuleDtoShape).enabled).toBe(true);

    expect(backend.invalidations).toBeGreaterThanOrEqual(4);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/v1/rules/${rule.id}` });
    expect(deleted.statusCode).toBe(204);
    const missing = await app.inject({ method: 'GET', url: `/api/v1/rules/${rule.id}` });
    expect(missing.statusCode).toBe(404);
  });

  it('answers 404 as problem+json', async () => {
    const { app } = createTestApp();
    const response = await app.inject({ method: 'GET', url: `/api/v1/rules/${randomUUID()}` });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ status: 404, title: 'Not Found' });
  });

  it('returns 422 with field paths for a mismatched condition type', async () => {
    const { app } = createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rules',
      payload: {
        name: 'mismatch',
        question: { type: 'noul', instructions: 'Is it bad?' },
        condition: { type: 'choice', anyOf: ['yes'] },
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toContain('application/problem+json');
    const body = response.json() as { status: number; errors: { path: string; message: string }[] };
    expect(body.status).toBe(422);
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'condition.type', message: expect.stringContaining('must match') }),
      ]),
    );
  });

  it('returns 422 with the missing field path', async () => {
    const { app } = createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rules',
      payload: {
        question: { type: 'noul', instructions: 'Is it bad?' },
        condition: { type: 'noul', op: 'gte', threshold: 0.5 },
      },
    });
    expect(response.statusCode).toBe(422);
    const body = response.json() as { errors: { path: string }[] };
    expect(body.errors.some((issue) => issue.path === 'name')).toBe(true);
  });
});
