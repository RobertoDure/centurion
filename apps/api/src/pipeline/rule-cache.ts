import { selectInScope, type LogEnvelope, type Rule } from '@centurion/contracts';

import type { RuleListEntry } from '../db/repositories/types';

export interface RuleSource {
  list(): Promise<RuleListEntry[]>;
}

export interface InvalidRule {
  id: string;
  name: string;
  reason: string;
}

export interface RuleSnapshot {
  rules: Rule[];
  invalid: InvalidRule[];
  loadedAt: number;
}

export interface RuleCacheOptions {
  source: RuleSource;
  refreshSeconds: number;
  now?: () => number;
  logger?: { warn(message: string, fields?: Record<string, unknown>): void };
}

/**
 * In-memory snapshot of enabled, valid rules (PLAN.md A9 / T4.2).
 *
 * Mutations in this process call `invalidate()`, so a rule edit takes effect on
 * the next message without a restart. A background refresh every
 * RULE_CACHE_REFRESH_SECONDS also picks up out-of-band changes.
 */
export class RuleCache {
  private snapshot: RuleSnapshot = { rules: [], invalid: [], loadedAt: Number.NEGATIVE_INFINITY };
  private refreshing: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly source: RuleSource;
  private readonly refreshMs: number;
  private readonly now: () => number;
  private readonly logger: RuleCacheOptions['logger'];

  constructor(options: RuleCacheOptions) {
    this.source = options.source;
    this.refreshMs = Math.max(1, options.refreshSeconds) * 1000;
    this.now = options.now ?? (() => Date.now());
    this.logger = options.logger;
  }

  invalidate(): void {
    this.snapshot = { ...this.snapshot, loadedAt: Number.NEGATIVE_INFINITY };
  }

  async refresh(): Promise<RuleSnapshot> {
    if (this.refreshing !== undefined) {
      await this.refreshing;
      return this.snapshot;
    }
    const run = (async () => {
      const entries = await this.source.list();
      const rules: Rule[] = [];
      const invalid: InvalidRule[] = [];
      for (const entry of entries) {
        if (entry.kind === 'valid') rules.push(entry.rule);
        else invalid.push({ id: entry.id, name: entry.name, reason: entry.reason });
      }
      this.snapshot = { rules: rules.filter((rule) => rule.enabled), invalid, loadedAt: this.now() };
      if (invalid.length > 0) {
        this.logger?.warn('rule cache skipped invalid rules', { count: invalid.length });
      }
    })();
    this.refreshing = run;
    try {
      await run;
    } finally {
      this.refreshing = undefined;
    }
    return this.snapshot;
  }

  private isStale(): boolean {
    return this.now() - this.snapshot.loadedAt >= this.refreshMs;
  }

  async getSnapshot(): Promise<RuleSnapshot> {
    if (this.isStale()) await this.refresh();
    return this.snapshot;
  }

  async selectFor(envelope: Pick<LogEnvelope, 'source' | 'level'>): Promise<Rule[]> {
    const snapshot = await this.getSnapshot();
    return selectInScope(snapshot.rules, envelope);
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      void this.refresh().catch((error: unknown) => {
        this.logger?.warn('rule cache refresh failed', { error: String(error) });
      });
    }, this.refreshMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
