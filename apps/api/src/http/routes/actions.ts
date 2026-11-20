import {
  actionContentSchema,
  actionDtoSchema,
  actionExecutionSchema,
  type ActionContent,
  type ActionDefinition,
  type ActionDto,
} from '@centurion/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { parseExternal } from '../../db/parse';
import type { ActionEntry } from '../../db/repositories/types';
import type { HttpAppDeps } from '../deps';
import { sendProblem } from '../errors';
import { actionListResponseSchema, idParamsSchema, type invalidActionSchema } from '../schemas';
import { z } from 'zod';

type InvalidAction = z.infer<typeof invalidActionSchema>;

function webhookDto(action: ActionDefinition & { type: 'webhook' }, hasSecret: boolean): ActionDto {
  const { secret: _secret, ...config } = action.config;
  return actionDtoSchema.parse({
    id: action.id,
    type: 'webhook',
    name: action.name,
    enabled: action.enabled,
    config,
    hasSecret,
  });
}

function kafkaDto(action: ActionDefinition & { type: 'kafka_topic' }): ActionDto {
  return actionDtoSchema.parse({
    id: action.id,
    type: 'kafka_topic',
    name: action.name,
    enabled: action.enabled,
    config: action.config,
    hasSecret: false,
  });
}

type ValidActionEntry = Extract<ActionEntry, { kind: 'valid' }>;

function validEntryToDto(entry: ValidActionEntry): ActionDto {
  return entry.action.type === 'webhook'
    ? webhookDto(entry.action, entry.hasSecret)
    : kafkaDto(entry.action);
}

/** The write-only secret never leaves the API: it is stripped from the DTO. */
export function toActionEntry(entry: ActionEntry): ActionDto | InvalidAction {
  if (entry.kind === 'invalid') {
    return {
      id: entry.id,
      name: entry.name,
      enabled: entry.enabled,
      type: entry.type,
      invalid: true,
      invalidReason: entry.reason,
    };
  }
  return validEntryToDto(entry);
}

function toActionDto(action: ActionDefinition, hasSecret: boolean): ActionDto {
  return action.type === 'webhook' ? webhookDto(action, hasSecret) : kafkaDto(action);
}

function hasSecret(content: ActionContent): boolean {
  return content.type === 'webhook' && content.config.secret !== undefined;
}

export function registerActionRoutes(app: FastifyInstance, deps: HttpAppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/actions', {
    schema: {
      tags: ['actions'],
      summary: 'List actions',
      response: { 200: actionListResponseSchema },
    },
    handler: async () => {
      const entries = await deps.repositories.actions.list();
      const items = entries.map(toActionEntry);
      return { items, total: items.length };
    },
  });

  typed.post('/actions', {
    schema: {
      tags: ['actions'],
      summary: 'Create an action',
      body: actionContentSchema,
      response: { 201: actionDtoSchema },
    },
    handler: async (request, reply) => {
      const action = await deps.repositories.actions.create(request.body);
      return reply.code(201).send(toActionDto(action, hasSecret(request.body)));
    },
  });

  typed.get('/actions/:id', {
    schema: {
      tags: ['actions'],
      summary: 'Read an action',
      params: idParamsSchema,
      response: { 200: actionDtoSchema },
    },
    handler: async (request, reply) => {
      const entry = await deps.repositories.actions.get(request.params.id);
      if (entry === undefined) {
        sendProblem(reply, 404, 'Not Found', 'action not found');
        return;
      }
      if (entry.kind === 'invalid') {
        sendProblem(reply, 500, 'Internal Server Error', 'stored action is invalid');
        return;
      }
      return validEntryToDto(entry);
    },
  });

  // Dashboard extension beyond PLAN.md 8.3: last execution status per action.
  typed.get('/actions/:id/executions', {
    schema: {
      tags: ['actions'],
      summary: 'Recent outbox executions for an action',
      params: idParamsSchema,
      response: { 200: z.array(actionExecutionSchema) },
    },
    handler: async (request, reply) => {
      const action = await deps.repositories.actions.get(request.params.id);
      if (action === undefined) {
        sendProblem(reply, 404, 'Not Found', 'action not found');
        return;
      }
      const executions = await deps.repositories.executions.listByAction(request.params.id);
      return executions.flatMap((execution) => {
        const parsed = parseExternal(actionExecutionSchema, {
          id: execution.id,
          flagId: execution.flagId,
          actionId: execution.actionId,
          status: execution.status,
          attempts: execution.attempts,
          ...(execution.lastError === null ? {} : { lastError: execution.lastError }),
        });
        return parsed.ok ? [parsed.value] : [];
      });
    },
  });

  typed.put('/actions/:id', {
    schema: {
      tags: ['actions'],
      summary: 'Update an action',
      params: idParamsSchema,
      body: actionContentSchema,
      response: { 200: actionDtoSchema },
    },
    handler: async (request, reply) => {
      const id = request.params.id;
      let content = request.body;
      // The secret is write-only. When an update omits it, keep the stored one
      // instead of silently wiping the HMAC key.
      if (content.type === 'webhook' && content.config.secret === undefined) {
        const existing = await deps.repositories.actions.get(id);
        if (
          existing !== undefined &&
          existing.kind === 'valid' &&
          existing.action.type === 'webhook' &&
          existing.hasSecret
        ) {
          content = {
            ...content,
            config: { ...content.config, secret: existing.action.config.secret },
          };
        }
      }
      const entry = await deps.repositories.actions.update(id, content);
      if (entry === undefined) {
        sendProblem(reply, 404, 'Not Found', 'action not found');
        return;
      }
      if (entry.kind === 'invalid') {
        sendProblem(reply, 500, 'Internal Server Error', 'stored action is invalid');
        return;
      }
      return validEntryToDto(entry);
    },
  });

  typed.delete('/actions/:id', {
    schema: { tags: ['actions'], summary: 'Delete an action', params: idParamsSchema },
    handler: async (request, reply) => {
      const deleted = await deps.repositories.actions.delete(request.params.id);
      if (!deleted) {
        sendProblem(reply, 404, 'Not Found', 'action not found');
        return;
      }
      return reply.code(204).send();
    },
  });
}
