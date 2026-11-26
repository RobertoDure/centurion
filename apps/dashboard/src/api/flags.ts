import { z } from 'zod';

import { flagSchema, type FlagOutcome } from '@centurion/contracts';

import { apiRequest, type ApiRequestOptions } from './client';

/** A flag row whose stored answer failed contract validation. */
export const invalidFlagSchema = z.strictObject({
  id: z.string(),
  invalid: z.literal(true),
  invalidReason: z.string(),
});

export const flagEntrySchema = z.union([flagSchema, invalidFlagSchema]);
export type FlagEntry = z.infer<typeof flagEntrySchema>;

export const flagListResponseSchema = z.strictObject({
  items: z.array(flagEntrySchema),
  limit: z.int(),
  offset: z.int(),
  total: z.int().nonnegative().optional(),
});
export type FlagListResponse = z.infer<typeof flagListResponseSchema>;

export interface FlagListQuery {
  ruleId?: string;
  sourceId?: string;
  outcome?: FlagOutcome;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

function toQueryString(query: FlagListQuery): string {
  const params = new URLSearchParams();
  if (query.ruleId !== undefined) params.set('ruleId', query.ruleId);
  if (query.sourceId !== undefined) params.set('sourceId', query.sourceId);
  if (query.outcome !== undefined) params.set('outcome', query.outcome);
  if (query.from !== undefined) params.set('from', query.from);
  if (query.to !== undefined) params.set('to', query.to);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  const serialized = params.toString();
  return serialized === '' ? '' : `?${serialized}`;
}

export const flagsApi = {
  list(query: FlagListQuery = {}, options: ApiRequestOptions = {}) {
    return apiRequest(flagListResponseSchema, `/api/v1/flags${toQueryString(query)}`, options);
  },
  get(id: string, options: ApiRequestOptions = {}) {
    return apiRequest(flagEntrySchema, `/api/v1/flags/${encodeURIComponent(id)}`, options);
  },
};
