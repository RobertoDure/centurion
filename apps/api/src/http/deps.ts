import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';

import type { Repositories } from '../db/repositories';
import type { JevGateway } from '../jev/gateway';
import type { RateLimiter } from '../jev/rate-limiter';
import type { ApiMetrics } from '../ops/metrics';
import type { ReadinessDeps } from '../ops/status';
import type { SseHub } from '../sse/hub';

/** A7: every /api/v1 route passes through this hook; it is a no-op until OIDC. */
export type AuthenticateHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface HttpAppDeps {
  repositories: Repositories;
  /** Invalidated after every rule mutation so edits take effect without a restart. */
  ruleCache: { invalidate(): void };
  gateway: JevGateway;
  metrics: ApiMetrics;
  readiness: ReadinessDeps;
  /** Absent in some unit tests; /stream answers 503 without it. */
  sseHub?: SseHub;
  /** Dedicated bucket for POST /rules/test, driven by JEV_MAX_RPS. */
  ruleTestRateLimiter?: RateLimiter;
  /** Optional approximate Kafka lag poll, refreshed when /metrics is scraped. */
  consumerLag?: () => Promise<number | undefined>;
  redactKeys?: readonly string[];
  now?: () => Date;
  authenticate?: AuthenticateHook;
  logger?: FastifyBaseLogger;
}
