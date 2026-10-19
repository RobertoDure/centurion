import type { FlagOutcome, JevAnswer } from '@centurion/contracts';
import { and, eq } from 'drizzle-orm';

import type { Database } from '../client';
import { actionExecutions, evaluations, flags } from '../schema';
import type { NewEvaluation } from './evaluations';

export interface FlagToRecord {
  ruleId: string;
  ruleVersion: number;
  outcome: FlagOutcome;
  answer: JevAnswer;
  actionIds: readonly string[];
}

export interface RecordOutcomeInput {
  messageId: string;
  /** Written when the message produced a flag or an error. */
  evaluation?: NewEvaluation;
  flags: readonly FlagToRecord[];
}

export interface RecordedFlag {
  ruleId: string;
  flagId: string;
  /** false when the flag already existed (redelivery). */
  created: boolean;
}

/**
 * Persists the outcome of one Kafka message in a single transaction: the
 * evaluation, the flags, and one pending action execution per (flag, action).
 * This is the transactional outbox from PLAN.md section 7 step 8.
 */
export class OutcomeRepository {
  constructor(private readonly db: Database) {}

  async record(input: RecordOutcomeInput): Promise<RecordedFlag[]> {
    return this.db.transaction(async (tx) => {
      if (input.evaluation !== undefined) {
        const evaluation = input.evaluation;
        await tx
          .insert(evaluations)
          .values({
            messageId: evaluation.messageId,
            sourceId: evaluation.sourceId,
            topic: evaluation.topic,
            partition: evaluation.partition,
            offset: evaluation.offset,
            model: evaluation.model ?? null,
            tokenEstimate: evaluation.tokenEstimate ?? null,
            partial: evaluation.partial,
            status: evaluation.status,
            excerpt: evaluation.excerpt ?? null,
          })
          .onConflictDoNothing({ target: evaluations.messageId });
      }

      const recorded: RecordedFlag[] = [];
      for (const flag of input.flags) {
        const inserted = await tx
          .insert(flags)
          .values({
            messageId: input.messageId,
            ruleId: flag.ruleId,
            ruleVersion: flag.ruleVersion,
            outcome: flag.outcome,
            answer: flag.answer,
          })
          .onConflictDoNothing({ target: [flags.messageId, flags.ruleId] })
          .returning({ id: flags.id });
        const insertedRow = inserted[0];
        if (insertedRow === undefined) {
          const existing = await tx
            .select({ id: flags.id })
            .from(flags)
            .where(and(eq(flags.messageId, input.messageId), eq(flags.ruleId, flag.ruleId)))
            .limit(1);
          recorded.push({ ruleId: flag.ruleId, flagId: existing[0]?.id ?? '', created: false });
          continue;
        }
        if (flag.actionIds.length > 0) {
          await tx
            .insert(actionExecutions)
            .values(
              flag.actionIds.map((actionId) => ({
                flagId: insertedRow.id,
                actionId,
                status: 'pending' as const,
              })),
            )
            .onConflictDoNothing({ target: [actionExecutions.flagId, actionExecutions.actionId] });
        }
        recorded.push({ ruleId: flag.ruleId, flagId: insertedRow.id, created: true });
      }
      return recorded;
    });
  }
}
