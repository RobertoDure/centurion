import { evaluationSchema, type Evaluation, type EvaluationStatus } from '@centurion/contracts';
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';

import type { Database } from '../client';
import { parseExternal } from '../parse';
import { evaluations, type EvaluationRow } from '../schema';

export interface NewEvaluation {
  messageId: string;
  sourceId: string;
  topic: string;
  partition: number;
  offset: string;
  model?: string;
  tokenEstimate?: number;
  partial: boolean;
  status: EvaluationStatus;
  excerpt?: string;
}

export interface EvaluationFilter {
  sourceId?: string;
  status?: EvaluationStatus;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export type EvaluationEntry =
  | { kind: 'valid'; evaluation: Evaluation }
  | { kind: 'invalid'; messageId: string; reason: string };

function toEntry(row: EvaluationRow): EvaluationEntry {
  const parsed = parseExternal(evaluationSchema, {
    messageId: row.messageId,
    sourceId: row.sourceId,
    topic: row.topic,
    partition: row.partition,
    offset: row.offset,
    model: row.model ?? undefined,
    tokenEstimate: row.tokenEstimate ?? undefined,
    partial: row.partial,
    status: row.status,
    excerpt: row.excerpt ?? undefined,
    createdAt: row.createdAt.toISOString(),
  });
  if (parsed.ok) return { kind: 'valid', evaluation: parsed.value };
  return { kind: 'invalid', messageId: row.messageId, reason: parsed.reason };
}

export class EvaluationsRepository {
  constructor(private readonly db: Database) {}

  async get(messageId: string): Promise<EvaluationEntry | undefined> {
    const rows = await this.db
      .select()
      .from(evaluations)
      .where(eq(evaluations.messageId, messageId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toEntry(row);
  }

  async list(filter: EvaluationFilter = {}): Promise<EvaluationEntry[]> {
    const conditions: SQL[] = [];
    if (filter.sourceId !== undefined) conditions.push(eq(evaluations.sourceId, filter.sourceId));
    if (filter.status !== undefined) conditions.push(eq(evaluations.status, filter.status));
    if (filter.from !== undefined) conditions.push(gte(evaluations.createdAt, filter.from));
    if (filter.to !== undefined) conditions.push(lte(evaluations.createdAt, filter.to));
    const rows = await this.db
      .select()
      .from(evaluations)
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(desc(evaluations.createdAt))
      .limit(filter.limit ?? 50)
      .offset(filter.offset ?? 0);
    return rows.map((row) => toEntry(row));
  }
}
