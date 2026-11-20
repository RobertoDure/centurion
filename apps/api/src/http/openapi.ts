import type { Repositories } from '../db/repositories';
import { ApiMetrics } from '../ops/metrics';
import { SseHub } from '../sse/hub';
import { buildApp } from './app';
import type { HttpAppDeps } from './deps';

function placeholderRepositories(): Repositories {
  const unsupported = (): never => {
    throw new Error('repositories are not available during OpenAPI generation');
  };
  return new Proxy<Record<string, unknown>>({}, { get: () => unsupported }) as unknown as Repositories;
}

/** Dependencies that satisfy route registration without touching real infrastructure. */
export function createPlaceholderDeps(): HttpAppDeps {
  return {
    repositories: placeholderRepositories(),
    ruleCache: { invalidate: () => {} },
    gateway: {
      evaluate: async () => {
        throw new Error('gateway is not available during OpenAPI generation');
      },
    },
    metrics: new ApiMetrics(),
    readiness: {
      database: async () => {},
      kafka: async () => {},
      jevAuth: () => ({ ok: true }),
    },
    sseHub: new SseHub({ heartbeatMs: 0 }),
    ruleTestRateLimiter: { acquire: async () => {} },
  };
}

/** Generate the OpenAPI document from the zod route schemas (T5.4). */
export async function buildOpenApiDocument(): Promise<Record<string, unknown>> {
  const app = buildApp(createPlaceholderDeps());
  await app.ready();
  try {
    return app.swagger() as unknown as Record<string, unknown>;
  } finally {
    await app.close();
  }
}
