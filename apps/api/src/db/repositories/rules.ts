import { ruleContentSchema, ruleSchema, type Rule, type RuleContent } from '@centurion/contracts';
import { desc, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { parseExternal } from '../parse';
import { ruleActions, rules, ruleVersions, type RuleRow } from '../schema';
import type { RuleListEntry, RuleVersionEntry } from './types';

function candidateFromRow(row: RuleRow, actionIds: string[]): unknown {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    enabled: row.enabled,
    scope: row.scope,
    question: row.question,
    condition: row.condition,
    uncertainPolicy: row.uncertainPolicy,
    actionIds,
    version: row.currentVersion,
    disabledReason: row.disabledReason ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class RulesRepository {
  constructor(private readonly db: Database) {}

  private build(row: RuleRow, actionIds: string[]): Rule {
    const parsed = parseExternal(ruleSchema, candidateFromRow(row, actionIds));
    if (!parsed.ok) throw new Error(`stored rule ${row.id} is invalid: ${parsed.reason}`);
    return parsed.value;
  }

  private toEntry(row: RuleRow, actionIds: string[]): RuleListEntry {
    const parsed = parseExternal(ruleSchema, candidateFromRow(row, actionIds));
    if (parsed.ok) return { kind: 'valid', rule: parsed.value };
    return {
      kind: 'invalid',
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      version: row.currentVersion,
      reason: parsed.reason,
    };
  }

  private async actionIdsByRule(ruleIds: readonly string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (ruleIds.length === 0) return map;
    const rows = await this.db
      .select({
        ruleId: ruleActions.ruleId,
        actionId: ruleActions.actionId,
        position: ruleActions.position,
      })
      .from(ruleActions)
      .where(inArray(ruleActions.ruleId, [...ruleIds]))
      .orderBy(ruleActions.position);
    for (const row of rows) {
      const existing = map.get(row.ruleId);
      if (existing === undefined) map.set(row.ruleId, [row.actionId]);
      else existing.push(row.actionId);
    }
    return map;
  }

  async list(): Promise<RuleListEntry[]> {
    const rows = await this.db.select().from(rules).orderBy(rules.name);
    const map = await this.actionIdsByRule(rows.map((row) => row.id));
    return rows.map((row) => this.toEntry(row, map.get(row.id) ?? []));
  }

  async get(id: string): Promise<RuleListEntry | undefined> {
    const rows = await this.db.select().from(rules).where(eq(rules.id, id)).limit(1);
    const row = rows[0];
    if (row === undefined) return undefined;
    const map = await this.actionIdsByRule([id]);
    return this.toEntry(row, map.get(id) ?? []);
  }

  async create(content: RuleContent): Promise<Rule> {
    const parsed = ruleContentSchema.parse(content);
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(rules)
        .values({
          name: parsed.name,
          description: parsed.description ?? null,
          enabled: parsed.enabled,
          scope: parsed.scope,
          question: parsed.question,
          condition: parsed.condition,
          uncertainPolicy: parsed.uncertainPolicy,
          currentVersion: 1,
        })
        .returning();
      const row = inserted[0];
      if (row === undefined) throw new Error('failed to insert rule');
      if (parsed.actionIds.length > 0) {
        await tx.insert(ruleActions).values(
          parsed.actionIds.map((actionId, index) => ({ ruleId: row.id, actionId, position: index })),
        );
      }
      const rule = this.build(row, parsed.actionIds);
      await tx.insert(ruleVersions).values({
        ruleId: row.id,
        version: row.currentVersion,
        snapshot: rule,
      });
      return rule;
    });
  }

  async update(id: string, content: RuleContent): Promise<RuleListEntry | undefined> {
    const parsed = ruleContentSchema.parse(content);
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(rules)
        .set({
          name: parsed.name,
          description: parsed.description ?? null,
          enabled: parsed.enabled,
          scope: parsed.scope,
          question: parsed.question,
          condition: parsed.condition,
          uncertainPolicy: parsed.uncertainPolicy,
          currentVersion: sql`${rules.currentVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(rules.id, id))
        .returning();
      const row = updated[0];
      if (row === undefined) return undefined;
      await tx.delete(ruleActions).where(eq(ruleActions.ruleId, id));
      if (parsed.actionIds.length > 0) {
        await tx.insert(ruleActions).values(
          parsed.actionIds.map((actionId, index) => ({ ruleId: id, actionId, position: index })),
        );
      }
      const rule = this.build(row, parsed.actionIds);
      await tx.insert(ruleVersions).values({ ruleId: id, version: row.currentVersion, snapshot: rule });
      return { kind: 'valid' as const, rule };
    });
  }

  /** Operational toggle; does not consume a rule version (see docs/DECISIONS.md). */
  async setEnabled(id: string, enabled: boolean, disabledReason?: string): Promise<RuleListEntry | undefined> {
    const updated = await this.db
      .update(rules)
      .set({ enabled, disabledReason: disabledReason ?? null, updatedAt: new Date() })
      .where(eq(rules.id, id))
      .returning();
    const row = updated[0];
    if (row === undefined) return undefined;
    const map = await this.actionIdsByRule([id]);
    return this.toEntry(row, map.get(id) ?? []);
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db.delete(rules).where(eq(rules.id, id)).returning({ id: rules.id });
    return deleted.length > 0;
  }

  async listVersions(id: string): Promise<RuleVersionEntry[]> {
    const rows = await this.db
      .select()
      .from(ruleVersions)
      .where(eq(ruleVersions.ruleId, id))
      .orderBy(desc(ruleVersions.version));
    return rows.map((row) => {
      const parsed = parseExternal(ruleSchema, row.snapshot);
      if (parsed.ok) {
        return { version: row.version, createdAt: row.createdAt.toISOString(), rule: parsed.value };
      }
      return { version: row.version, createdAt: row.createdAt.toISOString(), reason: parsed.reason };
    });
  }
}
