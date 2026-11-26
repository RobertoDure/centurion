import { z } from 'zod';

import {
  type RuleContent,
  ruleDtoSchema,
  ruleListResponseSchema,
  ruleTestRequestSchema,
  type RuleTestRequest,
  ruleTestResponseSchema,
  ruleVersionSchema,
} from '@centurion/contracts';

import { apiRequest, apiRequestVoid, type ApiRequestOptions } from './client';

const ruleIdPath = (id: string): string => `/api/v1/rules/${encodeURIComponent(id)}`;

/** A version row whose stored snapshot failed contract validation. */
export const invalidRuleVersionSchema = z.strictObject({
  ruleId: z.uuid(),
  version: z.int().nonnegative(),
  reason: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const ruleVersionEntrySchema = z.union([ruleVersionSchema, invalidRuleVersionSchema]);
export type RuleVersionEntry = z.infer<typeof ruleVersionEntrySchema>;

export const ruleVersionListResponseSchema = z.strictObject({
  items: z.array(ruleVersionEntrySchema),
  total: z.int().nonnegative(),
});
export type RuleVersionListResponse = z.infer<typeof ruleVersionListResponseSchema>;

export const rulesApi = {
  list(options: ApiRequestOptions = {}) {
    return apiRequest(ruleListResponseSchema, '/api/v1/rules', options);
  },
  get(id: string, options: ApiRequestOptions = {}) {
    return apiRequest(ruleDtoSchema, ruleIdPath(id), options);
  },
  create(content: RuleContent) {
    return apiRequest(ruleDtoSchema, '/api/v1/rules', { method: 'POST', body: content });
  },
  update(id: string, content: RuleContent) {
    return apiRequest(ruleDtoSchema, ruleIdPath(id), { method: 'PUT', body: content });
  },
  remove(id: string) {
    return apiRequestVoid(ruleIdPath(id));
  },
  enable(id: string) {
    return apiRequest(ruleDtoSchema, `${ruleIdPath(id)}/enable`, { method: 'POST' });
  },
  disable(id: string) {
    return apiRequest(ruleDtoSchema, `${ruleIdPath(id)}/disable`, { method: 'POST' });
  },
  versions(id: string, options: ApiRequestOptions = {}) {
    return apiRequest(ruleVersionListResponseSchema, `${ruleIdPath(id)}/versions`, options);
  },
  test(request: RuleTestRequest) {
    return apiRequest(ruleTestResponseSchema, '/api/v1/rules/test', {
      method: 'POST',
      body: ruleTestRequestSchema.parse(request),
    });
  },
};
