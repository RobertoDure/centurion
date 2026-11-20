import { type Flag } from '@centurion/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { z } from 'zod';

import type { FlagEntry } from '../../db/repositories';
import type { HttpAppDeps } from '../deps';
import { sendProblem } from '../errors';
import {
  flagEntrySchema,
  flagListResponseSchema,
  flagQuerySchema,
  idParamsSchema,
  type invalidFlagSchema,
} from '../schemas';

type InvalidFlag = z.infer<typeof invalidFlagSchema>;

function toFlagEntry(entry: FlagEntry): Flag | InvalidFlag {
  return entry.kind === 'valid'
    ? entry.flag
    : { id: entry.id, invalid: true, invalidReason: entry.reason };
}

export function registerFlagRoutes(app: FastifyInstance, deps: HttpAppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/flags', {
    schema: {
      tags: ['flags'],
      summary: 'List flags with filters and pagination',
      querystring: flagQuerySchema,
      response: { 200: flagListResponseSchema },
    },
    handler: async (request) => {
      const query = request.query;
      const entries = await deps.repositories.flags.list({
        ruleId: query.ruleId,
        sourceId: query.sourceId,
        outcome: query.outcome,
        from: query.from === undefined ? undefined : new Date(query.from),
        to: query.to === undefined ? undefined : new Date(query.to),
        limit: query.limit,
        offset: query.offset,
      });
      return {
        items: entries.map(toFlagEntry),
        limit: query.limit,
        offset: query.offset,
      };
    },
  });

  typed.get('/flags/:id', {
    schema: {
      tags: ['flags'],
      summary: 'Read a flag',
      params: idParamsSchema,
      response: { 200: flagEntrySchema },
    },
    handler: async (request, reply) => {
      const entry = await deps.repositories.flags.get(request.params.id);
      if (entry === undefined) {
        sendProblem(reply, 404, 'Not Found', 'flag not found');
        return;
      }
      return toFlagEntry(entry);
    },
  });
}
