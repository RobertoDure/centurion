import { healthResponseSchema, readyResponseSchema } from '@centurion/contracts';

import { apiRequest, apiRequestAny, apiRequestText, type ApiRequestOptions } from './client';

export const systemApi = {
  health(options: ApiRequestOptions = {}) {
    return apiRequest(healthResponseSchema, '/api/v1/health', options);
  },
  ready(options: ApiRequestOptions = {}) {
    // /ready returns 503 with a valid body when not ready, so do not throw on status.
    return apiRequestAny(readyResponseSchema, '/api/v1/ready', options);
  },
  /** Prometheus text; parsed in src/lib/metrics.ts. */
  metrics(options: ApiRequestOptions = {}) {
    return apiRequestText('/api/v1/metrics', options);
  },
};
