import { actionPayloadSchema, type ActionDefinition, type ActionPayload } from '@centurion/contracts';
import { eq, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { parseExternal } from '../parse';
import { actionExecutions, evaluations, flags, rules } from '../schema';
import type { ActionsRepository } from './actions';

export interface ClaimedExecution {
  id: string;
  flagId: string;
  actionId: string;
  attempts: number;
}

export interface ExecutionContext {
  execution: ClaimedExecution;
  action: ActionDefinition;
  payload: ActionPayload;
}

export interface ExecutionSummary {
  id: string;
  flagId: string;
  actionId: string;
  status: string;
  attempts: number;
  lastError: string | null;
}

export class ActionExecutionsRepository {
  constructor(
    private readonly db: Database,
    private readonly actionsRepository: ActionsRepository,
  ) {}

  async enqueue(flagId: string, actionIds: readonly string[]): Promise<number> {
    if (actionIds.length === 0) return 0;
    const rows = await this.db
      .insert(actionExecutions)
      .values(actionIds.map((actionId) => ({ flagId, actionId, status: 'pending' as const })))
      .onConflictDoNothing({ target: [actionExecutions.flagId, actionExecutions.actionId] })
      .returning({ id: actionExecutions.id });
    return rows.length;
  }

  /**
   * Atomically claim due outbox rows. FOR UPDATE SKIP LOCKED lets several
   * workers run without processing the same row twice (PLAN.md 5.8, 7 step 10).
   */
  async claimDue(limit = 10): Promise<ClaimedExecution[]> {
    const result = await this.db.execute(sql`
      UPDATE action_executions
      SET status = 'running', attempts = attempts + 1, updated_at = now()
      WHERE id IN (
        SELECT id FROM action_executions
        WHERE status = 'pending' AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, flag_id, action_id, attempts
    `);
    const rows = result.rows as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      flagId: String(row.flag_id),
      actionId: String(row.action_id),
      attempts: Number(row.attempts),
    }));
  }

  async loadContext(execution: ClaimedExecution): Promise<ExecutionContext | undefined> {
    const action = await this.actionsRepository.getForExecution(execution.actionId);
    if (action === undefined) return undefined;
    const rows = await this.db
      .select({
        flagId: flags.id,
        ruleId: flags.ruleId,
        ruleVersion: flags.ruleVersion,
        answer: flags.answer,
        triggeredAt: flags.createdAt,
        ruleName: rules.name,
        sourceId: evaluations.sourceId,
        topic: evaluations.topic,
        partition: evaluations.partition,
        offset: evaluations.offset,
        excerpt: evaluations.excerpt,
      })
      .from(flags)
      .innerJoin(rules, eq(rules.id, flags.ruleId))
      .innerJoin(evaluations, eq(evaluations.messageId, flags.messageId))
      .where(eq(flags.id, execution.flagId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return undefined;
    const parsed = parseExternal(actionPayloadSchema, {
      flagId: row.flagId,
      rule: { id: row.ruleId, name: row.ruleName, version: row.ruleVersion },
      source: { id: row.sourceId },
      messageRef: { topic: row.topic, partition: row.partition, offset: row.offset },
      answer: row.answer,
      triggeredAt: row.triggeredAt.toISOString(),
      excerpt: row.excerpt ?? undefined,
    });
    if (!parsed.ok) return undefined;
    return { execution, action, payload: parsed.value };
  }

  async markSucceeded(id: string): Promise<void> {
    await this.db
      .update(actionExecutions)
      .set({ status: 'succeeded', lastError: null, updatedAt: new Date() })
      .where(eq(actionExecutions.id, id));
  }

  async markFailed(
    id: string,
    error: string,
    options: { final: boolean; nextAttemptAt?: Date },
  ): Promise<void> {
    await this.db
      .update(actionExecutions)
      .set({
        status: options.final ? 'failed' : 'pending',
        lastError: error,
        nextAttemptAt: options.nextAttemptAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(actionExecutions.id, id));
  }

  /** Return rows abandoned mid-run (for example after a crash) to the queue. */
  async recoverStuck(olderThanMs = 60_000): Promise<number> {
    const result = await this.db.execute(sql`
      UPDATE action_executions
      SET status = 'pending', updated_at = now()
      WHERE status = 'running' AND updated_at < now() - interval '1 millisecond' * ${olderThanMs}
      RETURNING id
    `);
    return result.rows.length;
  }

  async listByFlag(flagId: string): Promise<ExecutionSummary[]> {
    const rows = await this.db
      .select({
        id: actionExecutions.id,
        flagId: actionExecutions.flagId,
        actionId: actionExecutions.actionId,
        status: actionExecutions.status,
        attempts: actionExecutions.attempts,
        lastError: actionExecutions.lastError,
      })
      .from(actionExecutions)
      .where(eq(actionExecutions.flagId, flagId));
    return rows;
  }
}
