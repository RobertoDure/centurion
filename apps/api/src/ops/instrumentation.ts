import { JevAuthError, JevOverloadedError, JevRateLimitError } from '../jev/errors';
import type { JevEvaluateInput, JevGateway } from '../jev/gateway';
import type { ApiMetrics } from './metrics';
import type { JevAuthState } from './status';

export interface InstrumentGatewayOptions {
  gateway: JevGateway;
  metrics: ApiMetrics;
  authState: JevAuthState;
  now?: () => number;
}

/**
 * Wraps the single Jev gateway with metrics and the shared auth state: latency
 * and 429/529 counts go to Prometheus, and a 401/403 flips `/ready` to
 * not-ready (PLAN.md section 7.2). The error is always re-thrown unchanged.
 */
export function instrumentGateway(options: InstrumentGatewayOptions): JevGateway {
  const now = options.now ?? (() => Date.now());
  return {
    async evaluate(input: JevEvaluateInput) {
      const start = now();
      try {
        const result = await options.gateway.evaluate(input);
        options.metrics.recordJevRequest(result.model, (now() - start) / 1000);
        options.authState.markOk();
        return result;
      } catch (error) {
        if (error instanceof JevRateLimitError) options.metrics.recordJevError('429');
        else if (error instanceof JevOverloadedError) options.metrics.recordJevError('529');
        else if (error instanceof JevAuthError) options.authState.markAuthError(error.message);
        throw error;
      }
    },
  };
}
