import type { ClaimedExecution, ExecutionContext } from '../db/repositories/action-executions';

import type { ActionRegistry } from './registry';

/** Structural subset of ActionExecutionsRepository; a fake is used in unit tests. */
export interface ExecutionStore {
  claimDue(limit: number): Promise<ClaimedExecution[]>;
  loadContext(execution: ClaimedExecution): Promise<ExecutionContext | undefined>;
  markSucceeded(id: string): Promise<void>;
  markFailed(id: string, error: string, options: { final: boolean; nextAttemptAt?: Date }): Promise<void>;
  recoverStuck?(olderThanMs: number): Promise<number>;
}

export interface ActionExecutorOptions {
  store: ExecutionStore;
  registry: ActionRegistry;
  maxAttempts: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Injectable jitter for deterministic tests; returns a value in [0, 1). */
  random?: () => number;
  now?: () => number;
  logger?: { warn(message: string, fields?: Record<string, unknown>): void };
}

export interface RunOnceResult {
  claimed: number;
  succeeded: number;
  retried: number;
  failed: number;
}

/**
 * Outbox worker (PLAN.md section 7 step 10). Claims pending rows with
 * FOR UPDATE SKIP LOCKED (in the repository), runs the handler and retries with
 * exponential backoff up to ACTION_MAX_ATTEMPTS.
 */
export class ActionExecutor {
  private readonly store: ExecutionStore;
  private readonly registry: ActionRegistry;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly logger: ActionExecutorOptions['logger'];
  private timer: NodeJS.Timeout | undefined;

  constructor(options: ActionExecutorOptions) {
    this.store = options.store;
    this.registry = options.registry;
    this.maxAttempts = Math.max(1, options.maxAttempts);
    this.backoffBaseMs = options.backoffBaseMs ?? 500;
    this.backoffMaxMs = options.backoffMaxMs ?? 30_000;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => Date.now());
    this.logger = options.logger;
  }

  private backoffFor(attempts: number): number {
    const exponential = this.backoffBaseMs * 2 ** Math.max(0, attempts - 1);
    const capped = Math.min(this.backoffMaxMs, exponential);
    const jitter = capped * 0.25 * this.random();
    return Math.round(capped + jitter);
  }

  async runOnce(limit = 10): Promise<RunOnceResult> {
    const claimed = await this.store.claimDue(limit);
    const result: RunOnceResult = { claimed: claimed.length, succeeded: 0, retried: 0, failed: 0 };

    for (const execution of claimed) {
      const context = await this.store.loadContext(execution);
      if (context === undefined) {
        // Flag/action gone: nothing to run, and retrying cannot help.
        await this.store.markFailed(execution.id, 'execution context not found', { final: true });
        result.failed += 1;
        continue;
      }
      try {
        await this.registry.execute(context.action, context.payload, {
          flagId: execution.flagId,
          attempt: execution.attempts,
        });
        await this.store.markSucceeded(execution.id);
        result.succeeded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const final = execution.attempts >= this.maxAttempts;
        const nextAttemptAt = final ? undefined : new Date(this.now() + this.backoffFor(execution.attempts));
        await this.store.markFailed(execution.id, message, { final, nextAttemptAt });
        if (final) {
          result.failed += 1;
          this.logger?.warn('action execution failed permanently', {
            executionId: execution.id,
            attempts: execution.attempts,
          });
        } else {
          result.retried += 1;
        }
      }
    }
    return result;
  }

  /** Requeue rows abandoned by a previous process, then poll every intervalMs. */
  async start(intervalMs = 1000): Promise<void> {
    await this.store.recoverStuck?.(60_000);
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      void this.runOnce().catch((error: unknown) => {
        this.logger?.warn('action executor tick failed', { error: String(error) });
      });
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
