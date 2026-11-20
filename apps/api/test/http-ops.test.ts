import { describe, expect, it } from 'vitest';

import { createTestApp } from './helpers/http';

describe('ops routes', () => {
  it('reports healthy, ready checks and Prometheus metrics', async () => {
    const { app } = createTestApp();

    const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });

    const ready = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(ready.statusCode).toBe(200);
    const readyBody = ready.json() as { status: string; checks: { name: string; ok: boolean }[] };
    expect(readyBody.status).toBe('ready');
    expect(readyBody.checks.map((check) => check.name)).toEqual(['database', 'kafka', 'jev_auth']);

    const metrics = await app.inject({ method: 'GET', url: '/api/v1/metrics' });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.headers['content-type']).toContain('text/plain');
    expect(metrics.body).toContain('centurion_messages_processed_total');
    expect(metrics.body).toContain('centurion_rule_verdicts_total');
  });

  it('returns 503 and a failing check when a dependency is down', async () => {
    const { app } = createTestApp({
      readiness: {
        database: async () => {
          throw new Error('postgres is down');
        },
        kafka: async () => {},
        jevAuth: () => ({ ok: false, detail: 'Jev authentication failed' }),
      },
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(response.statusCode).toBe(503);
    const body = response.json() as { status: string; checks: { name: string; ok: boolean; detail?: string }[] };
    expect(body.status).toBe('not_ready');
    expect(body.checks.find((check) => check.name === 'database')).toMatchObject({
      ok: false,
      detail: 'postgres is down',
    });
    expect(body.checks.find((check) => check.name === 'jev_auth')).toMatchObject({ ok: false });
  });
});
