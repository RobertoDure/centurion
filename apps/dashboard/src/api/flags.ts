import { z } from 'zod';

import { flagSchema, type FlagOutcome } from '@centurion/contracts';

import { apiRequest, type ApiRequestOptions } from './client';

export const flagListResponseSchema = z.strictObject({
  items: z.array(flagSchema),
  total: z.int().nonnegative(),
});
export type FlagListResponse = z.infer<typeof flagListResponseSchema>;

export interface FlagListQuery {
  ruleId?: string;
  sourceId?: string;
  outcome?: FlagOutcome;
  limit?: number;
  offset?: number;
}

function toQueryString(query: FlagListQuery): string {
  const params = new URLSearchParams();
  if (query.ruleId !== undefined) params.set('ruleId', query.ruleId);
  if (query.sourceId !== undefined) params.set('sourceId', query.sourceId);
  if (query.outcome !== undefined) params.set('outcome', query.outcome);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  const serialized = params.toString();
  return serialized === '' ? '' : `?${serialized}`;
}

export const flagsApi = {
  list(query: FlagListQuery = {}, options: ApiRequestOptions = {}) {
    return apiRequest(flagListResponseSchema, `/api/v1/flags${toQueryString(query)}`, options);
  },
};
