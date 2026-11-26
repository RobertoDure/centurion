import { z } from 'zod';

import {
  actionContentSchema,
  type ActionContent,
  type ActionDto,
  actionDtoSchema,
  actionExecutionSchema,
} from '@centurion/contracts';

import { apiRequest, apiRequestVoid, type ApiRequestOptions } from './client';

/** A stored action whose JSONB failed contract validation; surfaced as invalid. */
export const invalidActionSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  type: z.string(),
  invalid: z.literal(true),
  invalidReason: z.string(),
});

export const actionEntrySchema = z.union([actionDtoSchema, invalidActionSchema]);
export type ActionEntry = z.infer<typeof actionEntrySchema>;

/** Narrows a list entry to a contract-valid action definition. */
export function isValidAction(entry: ActionEntry): entry is ActionDto {
  return !('invalid' in entry);
}

export const actionListResponseSchema = z.strictObject({
  items: z.array(actionEntrySchema),
  total: z.int().nonnegative(),
});
export type ActionListResponse = z.infer<typeof actionListResponseSchema>;

const actionIdPath = (id: string): string => `/api/v1/actions/${encodeURIComponent(id)}`;

export const actionsApi = {
  list(options: ApiRequestOptions = {}) {
    return apiRequest(actionListResponseSchema, '/api/v1/actions', options);
  },
  get(id: string, options: ApiRequestOptions = {}) {
    return apiRequest(actionDtoSchema, actionIdPath(id), options);
  },
  create(content: ActionContent) {
    return apiRequest(actionDtoSchema, '/api/v1/actions', {
      method: 'POST',
      body: actionContentSchema.parse(content),
    });
  },
  update(id: string, content: ActionContent) {
    return apiRequest(actionDtoSchema, actionIdPath(id), {
      method: 'PUT',
      body: actionContentSchema.parse(content),
    });
  },
  remove(id: string) {
    return apiRequestVoid(actionIdPath(id));
  },
  /** Outbox executions for one action; the UI degrades gracefully if this is absent. */
  executions(id: string, options: ApiRequestOptions = {}) {
    return apiRequest(z.array(actionExecutionSchema), `${actionIdPath(id)}/executions`, options);
  },
};
