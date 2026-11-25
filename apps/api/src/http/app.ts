import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

import type { AuthenticateHook, HttpAppDeps } from './deps';
import { registerProblemHandlers } from './errors';
import { registerActionRoutes } from './routes/actions';
import { registerFlagRoutes } from './routes/flags';
import { registerOpsRoutes } from './routes/ops';
import { registerRuleRoutes } from './routes/rules';
import { registerRuleTestRoutes } from './routes/rules-test';
import { registerStreamRoutes } from './routes/stream';

const noopAuthenticate: AuthenticateHook = async () => {};

/**
 * Builds the Fastify app (T5.1). Persistence, the gateway, the SSE hub and the
 * readiness checks are injected so route tests can use fakes and
 * `fastify.inject` without Postgres or Kafka.
 */
export function buildApp(deps: HttpAppDeps): FastifyInstance {
  const serverOptions: FastifyServerOptions =
    deps.logger === undefined ? { logger: false } : { loggerInstance: deps.logger };
  const app = Fastify(serverOptions);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerProblemHandlers(app);

  app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Centurion API',
        version: '0.0.0',
        description: 'Rule management, actions, flags, rule dry-run and the live SSE stream.',
      },
      tags: [
        { name: 'rules', description: 'Rule CRUD, version history and dry-run' },
        { name: 'actions', description: 'Action CRUD; webhook secrets are write-only' },
        { name: 'flags', description: 'Flag history' },
        { name: 'stream', description: 'Server-Sent Events' },
        { name: 'ops', description: 'Health, readiness and metrics' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  app.register(
    async (api) => {
      // A7: the OIDC hook drops in here without touching any route.
      api.addHook('preHandler', deps.authenticate ?? noopAuthenticate);
      registerRuleRoutes(api, deps);
      registerActionRoutes(api, deps);
      registerFlagRoutes(api, deps);
      registerOpsRoutes(api, deps);
      registerRuleTestRoutes(api, deps);
      registerStreamRoutes(api, deps);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
