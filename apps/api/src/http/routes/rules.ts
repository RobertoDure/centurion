import {
  ruleContentSchema,
  ruleDtoSchema,
  ruleListResponseSchema,
  type RuleDto,
} from '@centurion/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { RuleListEntry } from '../../db/repositories/types';
import type { HttpAppDeps } from '../deps';
import { sendProblem } from '../errors';
import { idParamsSchema, ruleVersionListResponseSchema } from '../schemas';

const INVALID_INSTRUCTIONS = 'Stored rule is invalid and cannot be evaluated.';

/**
 * A stored rule that fails the shared schema still has to travel to the UI so it
 * can be shown as invalid and auto-disabled. The DTO contract requires a
 * question/condition, so a consistent Noul placeholder is sent alongside
 * `invalid: true` + `invalidReason`; the engine never reads it (RuleCache
 * skips invalid entries).
 */
export function toRuleDto(entry: RuleListEntry): RuleDto {
  if (entry.kind === 'valid') return { ...entry.rule, invalid: false };
  return {
    id: entry.id,
    name: entry.name,
    enabled: entry.enabled,
    version: entry.version,
    scope: {},
    question: { type: 'noul', instructions: INVALID_INSTRUCTIONS },
    condition: { type: 'noul', op: 'gte', threshold: 0 },
    uncertainPolicy: 'ignore',
    actionIds: [],
    invalid: true,
    invalidReason: entry.reason,
  };
}

export function registerRuleRoutes(app: FastifyInstance, deps: HttpAppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/rules', {
    schema: { tags: ['rules'], summary: 'List rules', response: { 200: ruleListResponseSchema } },
    handler: async () => {
      const entries = await deps.repositories.rules.list();
      const items = entries.map(toRuleDto);
      return { items, total: items.length };
    },
  });

  typed.post('/rules', {
    schema: {
      tags: ['rules'],
      summary: 'Create a rule',
      body: ruleContentSchema,
      response: { 201: ruleDtoSchema },
    },
    handler: async (request, reply) => {
      const rule = await deps.repositories.rules.create(request.body);
      deps.ruleCache.invalidate();
      return reply.code(201).send(toRuleDto({ kind: 'valid', rule }));
    },
  });

  typed.get('/rules/:id', {
    schema: {
      tags: ['rules'],
      summary: 'Read a rule',
      params: idParamsSchema,
      response: { 200: ruleDtoSchema },
    },
    handler: async (request, reply) => {
      const entry = await deps.repositories.rules.get(request.params.id);
      if (entry === undefined) {
        sendProblem(reply, 404, 'Not Found', 'rule not found');
        return;
      }
      return toRuleDto(entry);
    },
  });

  typed.put('/rules/:id', {
    schema: {
      tags: ['rules'],
      summary: 'Update a rule (writes a new version)',
      params: idParamsSchema,
      body: ruleContentSchema,
      response: { 200: ruleDtoSchema },
    },
    handler: async (request, reply) => {
      const entry = await deps.repositories.rules.update(request.params.id, request.body);
      if (entry === undefined) {
        sendProblem(reply, 404, 'Not Found', 'rule not found');
        return;
      }
      deps.ruleCache.invalidate();
      return toRuleDto(entry);
    },
  });

  typed.delete('/rules/:id', {
    schema: { tags: ['rules'], summary: 'Delete a rule', params: idParamsSchema },
    handler: async (request, reply) => {
      const deleted = await deps.repositories.rules.delete(request.params.id);
      if (!deleted) {
        sendProblem(reply, 404, 'Not Found', 'rule not found');
        return;
      }
      deps.ruleCache.invalidate();
      return reply.code(204).send();
    },
  });

  typed.post('/rules/:id/enable', {
    schema: {
      tags: ['rules'],
      summary: 'Enable a rule',
      params: idParamsSchema,
      response: { 200: ruleDtoSchema },
    },
    handler: async (request, reply) => {
      const entry = await deps.repositories.rules.setEnabled(request.params.id, true);
      if (entry === undefined) {
        sendProblem(reply, 404, 'Not Found', 'rule not found');
        return;
      }
      deps.ruleCache.invalidate();
      return toRuleDto(entry);
    },
  });

  typed.post('/rules/:id/disable', {
    schema: {
      tags: ['rules'],
      summary: 'Disable a rule',
      params: idParamsSchema,
      response: { 200: ruleDtoSchema },
    },
    handler: async (request, reply) => {
      const entry = await deps.repositories.rules.setEnabled(request.params.id, false);
      if (entry === undefined) {
        sendProblem(reply, 404, 'Not Found', 'rule not found');
        return;
      }
      deps.ruleCache.invalidate();
      return toRuleDto(entry);
    },
  });

  typed.get('/rules/:id/versions', {
    schema: {
      tags: ['rules'],
      summary: 'Rule version history',
      params: idParamsSchema,
      response: { 200: ruleVersionListResponseSchema },
    },
    handler: async (request, reply) => {
      const existing = await deps.repositories.rules.get(request.params.id);
      if (existing === undefined) {
        sendProblem(reply, 404, 'Not Found', 'rule not found');
        return;
      }
      const ruleId = request.params.id;
      const versions = await deps.repositories.rules.listVersions(ruleId);
      const items = versions.map((entry) =>
        'rule' in entry
          ? {
              ruleId,
              version: entry.version,
              snapshot: entry.rule,
              createdAt: entry.createdAt,
            }
          : { ruleId, version: entry.version, reason: entry.reason, createdAt: entry.createdAt },
      );
      return { items, total: items.length };
    },
  });
}
