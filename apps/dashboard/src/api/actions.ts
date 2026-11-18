import { z } from 'zod';

import {
  actionContentSchema,
  type ActionContent,
  actionDtoSchema,
  actionExecutionSchema,
} from '@centurion/contracts';

import { apiRequest, apiRequestVoid, type ApiRequestOptions } from './client';

const actionIdPath = (id: string): string => `/api/v1/actions/${encodeURIComponent(id)}`;

export const actionsApi = {
  list(options: ApiRequestOptions = {}) {
    return apiRequest(z.array(actionDtoSchema), '/api/v1/actions', options);
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
  /** Recent executions for one action; the UI degrades gracefully if this is absent. */
  executions(id: string, options: ApiRequestOptions = {}) {
    return apiRequest(z.array(actionExecutionSchema), `${actionIdPath(id)}/executions`, options);
  },
};
