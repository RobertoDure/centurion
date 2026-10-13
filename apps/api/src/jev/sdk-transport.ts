import { TypeSafeClient, type Questions } from '@typesafe-ai/sdk';
import {
  jevApiResponseSchema,
  type JevApiRequest,
  type JevApiResponse,
} from '@centurion/contracts';

import { JevValidationError } from './errors';
import type { JevTransport } from './gateway';

export interface SdkTransportOptions {
  apiKey: string;
  /** JEV_BASE_URL; the SDK does not read this env var, so it is passed explicitly. */
  baseURL?: string;
  defaultModel: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof globalThis.fetch;
}

/**
 * The only module that imports @typesafe-ai/sdk. The SDK retries 429/529 with
 * exponential backoff on its own; everything else is mapped by the gateway.
 */
export function createSdkTransport(options: SdkTransportOptions): JevTransport {
  const client = new TypeSafeClient({
    apiKey: options.apiKey,
    defaultModel: options.defaultModel,
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    ...(options.maxRetries === undefined ? {} : { retry: { maxRetries: options.maxRetries } }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  return {
    async evaluate(request: JevApiRequest): Promise<JevApiResponse> {
      // The request was validated by JevGateway against the contracts schema.
      // The SDK's generic inference is narrower (branded criteria keys), so the
      // questions are forwarded as JSON; PLAN.md section 4 allows this.
      const result = await client.systemOne({
        state: request.state,
        questions: request.questions as Questions,
        model: request.model,
      });
      const parsed = jevApiResponseSchema.safeParse(result);
      if (!parsed.success) {
        throw new JevValidationError('Invalid Jev response', {
          issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
        });
      }
      return parsed.data;
    },
  };
}
