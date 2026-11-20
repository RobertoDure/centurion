import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createTestApp, webhookActionContent } from './helpers/http';

interface ActionDtoShape {
  id: string;
  type: string;
  name: string;
  hasSecret: boolean;
  config: Record<string, unknown>;
}

describe('actions routes', () => {
  it('never returns the webhook secret and reports hasSecret', async () => {
    const { app } = createTestApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/actions',
      payload: webhookActionContent(),
    });
    expect(created.statusCode).toBe(201);
    const dto = created.json() as ActionDtoShape;
    expect(dto.hasSecret).toBe(true);
    expect(dto.config['secret']).toBeUndefined();
    expect(created.body).not.toContain('s3cr3t');

    const list = await app.inject({ method: 'GET', url: '/api/v1/actions' });
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain('s3cr3t');
    const listBody = list.json() as { items: ActionDtoShape[]; total: number };
    expect(listBody.total).toBe(1);
    expect(listBody.items[0]?.hasSecret).toBe(true);

    const read = await app.inject({ method: 'GET', url: `/api/v1/actions/${dto.id}` });
    expect(read.statusCode).toBe(200);
    expect(read.body).not.toContain('s3cr3t');
  });

  it('keeps the stored secret when an update omits it', async () => {
    const { app } = createTestApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/actions',
      payload: webhookActionContent(),
    });
    const dto = created.json() as ActionDtoShape;

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/v1/actions/${dto.id}`,
      payload: {
        type: 'webhook',
        name: 'Renamed hook',
        enabled: true,
        config: { url: 'https://example.com/hook', timeoutMs: 5000 },
      },
    });
    expect(updated.statusCode).toBe(200);
    const updatedDto = updated.json() as ActionDtoShape;
    expect(updatedDto.name).toBe('Renamed hook');
    expect(updatedDto.hasSecret).toBe(true);
    expect(updated.body).not.toContain('s3cr3t');
  });

  it('creates a kafka_topic action with hasSecret false', async () => {
    const { app } = createTestApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/actions',
      payload: { type: 'kafka_topic', name: 'publish flags', enabled: true, config: { topic: 'logs.flags' } },
    });
    expect(created.statusCode).toBe(201);
    const dto = created.json() as ActionDtoShape;
    expect(dto.hasSecret).toBe(false);
    expect(dto.type).toBe('kafka_topic');
  });

  it('lists the recent executions for one action', async () => {
    const { app, backend } = createTestApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/actions',
      payload: webhookActionContent(),
    });
    const dto = created.json() as ActionDtoShape;
    backend.executions.set(dto.id, [
      {
        id: randomUUID(),
        flagId: randomUUID(),
        actionId: dto.id,
        status: 'succeeded',
        attempts: 1,
        lastError: null,
      },
    ]);

    const executions = await app.inject({
      method: 'GET',
      url: `/api/v1/actions/${dto.id}/executions`,
    });
    expect(executions.statusCode).toBe(200);
    const rows = executions.json() as { status: string; attempts: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('succeeded');
    expect(rows[0]?.attempts).toBe(1);

    const missing = await app.inject({
      method: 'GET',
      url: `/api/v1/actions/${randomUUID()}/executions`,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('returns 422 for an invalid action body', async () => {
    const { app } = createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/actions',
      payload: { type: 'webhook', name: 'bad', config: { url: 'not-a-url' } },
    });
    expect(response.statusCode).toBe(422);
    const body = response.json() as { errors: { path: string }[] };
    expect(body.errors.some((issue) => issue.path.startsWith('config.url'))).toBe(true);
  });
});
