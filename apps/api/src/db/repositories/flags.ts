import { flagSchema, type Flag, type FlagOutcome } from '@centurion/contracts';
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';

import type { Database } from '../client';
import { parseExternal } from '../parse';
import { evaluations, flags, type FlagRow } from '../schema';

export interface FlagFilter {
  ruleId?: string;
  sourceId?: string;
  outcome?: FlagOutcome;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export type FlagEntry =
  | { kind: 'valid'; flag: Flag }
  | { kind: 'invalid'; id: string; reason: string };

type FlagJoinRow = FlagRow & { sourceId: string };

const selection = {
  id: flags.id,
  messageId: flags.messageId,
  ruleId: flags.ruleId,
  ruleVersion: flags.ruleVersion,
  outcome: flags.outcome,
  answer: flags.answer,
  createdAt: flags.createdAt,
  sourceId: evaluations.sourceId,
};

/** Flags are always joined to their evaluation for the source id (PLAN.md 8.2). */
export class FlagsRepository {
  constructor(private readonly db: Database) {}

  private toEntry(row: FlagJoinRow): FlagEntry {
    const parsed = parseExternal(flagSchema, {
      id: row.id,
      messageId: row.messageId,
      ruleId: row.ruleId,
      ruleVersion: row.ruleVersion,
      outcome: row.outcome,
      answer: row.answer,
      sourceId: row.sourceId,
      createdAt: row.createdAt.toISOString(),
    });
    if (parsed.ok) return { kind: 'valid', flag: parsed.value };
    return { kind: 'invalid', id: row.id, reason: parsed.reason };
  }

  async list(filter: FlagFilter = {}): Promise<FlagEntry[]> {
    const conditions: SQL[] = [];
    if (filter.ruleId !== undefined) conditions.push(eq(flags.ruleId, filter.ruleId));
    if (filter.outcome !== undefined) conditions.push(eq(flags.outcome, filter.outcome));
    if (filter.sourceId !== undefined) conditions.push(eq(evaluations.sourceId, filter.sourceId));
    if (filter.from !== undefined) conditions.push(gte(flags.createdAt, filter.from));
    if (filter.to !== undefined) conditions.push(lte(flags.createdAt, filter.to));
    const rows = await this.db
      .select(selection)
      .from(flags)
      .innerJoin(evaluations, eq(evaluations.messageId, flags.messageId))
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(desc(flags.createdAt))
      .limit(filter.limit ?? 50)
      .offset(filter.offset ?? 0);
    return rows.map((row) => this.toEntry(row));
  }

  async get(id: string): Promise<FlagEntry | undefined> {
    const rows = await this.db
      .select(selection)
      .from(flags)
      .innerJoin(evaluations, eq(evaluations.messageId, flags.messageId))
      .where(eq(flags.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : this.toEntry(row);
  }
}
