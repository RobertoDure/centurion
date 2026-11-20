import {
  healthResponseSchema,
  readyResponseSchema,
  type ReadinessCheck,
} from '@centurion/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { HttpAppDeps } from '../deps';
import type { ReadinessDeps } from '../../ops/status';

async function runCheck(name: string, run: () => Promise<void>): Promise<ReadinessCheck> {
  try {
    await run();
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function runChecks(readiness: ReadinessDeps): Promise<ReadinessCheck[]> {
  const database = await runCheck('database', readiness.database);
  const kafka = await runCheck('kafka', readiness.kafka);
  const jev = readiness.jevAuth();
  const jevAuth: ReadinessCheck =
    jev.detail === undefined ? { name: 'jev_auth', ok: jev.ok } : { name: 'jev_auth', ok: jev.ok, detail: jev.detail };
  return [database, kafka, jevAuth];
}

export function registerOpsRoutes(app: FastifyInstance, deps: HttpAppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/health', {
    schema: {
      tags: ['ops'],
      summary: 'Liveness probe',
      response: { 200: healthResponseSchema },
    },
    handler: async () => ({ status: 'ok' as const }),
  });

  typed.get('/ready', {
    schema: {
      tags: ['ops'],
      summary: 'Readiness probe (Postgres, Kafka, Jev auth)',
      response: { 200: readyResponseSchema, 503: readyResponseSchema },
    },
    handler: async (_request, reply) => {
      const checks = await runChecks(deps.readiness);
      const ready = checks.every((check) => check.ok);
      const body = { status: ready ? ('ready' as const) : ('not_ready' as const), checks };
      return reply.code(ready ? 200 : 503).send(body);
    },
  });

  typed.get('/metrics', {
    schema: { tags: ['ops'], summary: 'Prometheus metrics' },
    handler: async (_request, reply) => {
      if (deps.consumerLag !== undefined) {
        const lag = await deps.consumerLag();
        if (lag !== undefined) deps.metrics.setConsumerLag(lag);
      }
      deps.metrics.refreshTokenCalibration();
      const text = await deps.metrics.registry.metrics();
      return reply.type(deps.metrics.registry.contentType).send(text);
    },
  });
}
