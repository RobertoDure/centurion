import {
  actionContentSchema,
  actionSchema,
  type ActionContent,
  type ActionDefinition,
} from '@centurion/contracts';
import { eq } from 'drizzle-orm';

import type { Database } from '../client';
import { parseExternal } from '../parse';
import { actions, type ActionRow } from '../schema';
import {
  identityActionConfigCodec,
  type ActionConfigCodec,
  type ActionEntry,
} from './types';

function candidateFromRow(row: ActionRow, config: Record<string, unknown>): unknown {
  return { id: row.id, type: row.type, name: row.name, enabled: row.enabled, config };
}

function hasConfiguredSecret(type: string, config: Record<string, unknown>): boolean {
  if (type !== 'webhook') return false;
  const secret = config.secret;
  return typeof secret === 'string' && secret.length > 0;
}

export class ActionsRepository {
  constructor(
    private readonly db: Database,
    private readonly codec: ActionConfigCodec = identityActionConfigCodec,
  ) {}

  private toEntry(row: ActionRow): ActionEntry {
    const rawConfig = (row.config ?? {}) as Record<string, unknown>;
    let decoded: Record<string, unknown>;
    try {
      decoded = this.codec.decode(rawConfig);
    } catch (error) {
      return {
        kind: 'invalid',
        id: row.id,
        name: row.name,
        enabled: row.enabled,
        type: row.type,
        reason: `could not decrypt action config: ${String(error)}`,
      };
    }
    const parsed = parseExternal(actionSchema, candidateFromRow(row, decoded));
    if (parsed.ok) {
      return { kind: 'valid', action: parsed.value, hasSecret: hasConfiguredSecret(row.type, decoded) };
    }
    return {
      kind: 'invalid',
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      type: row.type,
      reason: parsed.reason,
    };
  }

  /** Full definition including the plaintext secret; used by the action executor. */
  async getForExecution(id: string): Promise<ActionDefinition | undefined> {
    const rows = await this.db.select().from(actions).where(eq(actions.id, id)).limit(1);
    const row = rows[0];
    if (row === undefined) return undefined;
    const entry = this.toEntry(row);
    return entry.kind === 'valid' ? entry.action : undefined;
  }

  async list(): Promise<ActionEntry[]> {
    const rows = await this.db.select().from(actions).orderBy(actions.name);
    return rows.map((row) => this.toEntry(row));
  }

  async get(id: string): Promise<ActionEntry | undefined> {
    const rows = await this.db.select().from(actions).where(eq(actions.id, id)).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : this.toEntry(row);
  }

  async create(content: ActionContent): Promise<ActionDefinition> {
    const parsed = actionContentSchema.parse(content);
    const storedConfig = this.codec.encode(parsed.config as Record<string, unknown>);
    const inserted = await this.db
      .insert(actions)
      .values({ name: parsed.name, type: parsed.type, config: storedConfig, enabled: parsed.enabled })
      .returning();
    const row = inserted[0];
    if (row === undefined) throw new Error('failed to insert action');
    const entry = this.toEntry(row);
    if (entry.kind !== 'valid') throw new Error(`stored action ${row.id} is invalid: ${entry.reason}`);
    return entry.action;
  }

  async update(id: string, content: ActionContent): Promise<ActionEntry | undefined> {
    const parsed = actionContentSchema.parse(content);
    const storedConfig = this.codec.encode(parsed.config as Record<string, unknown>);
    const updated = await this.db
      .update(actions)
      .set({
        name: parsed.name,
        type: parsed.type,
        config: storedConfig,
        enabled: parsed.enabled,
        updatedAt: new Date(),
      })
      .where(eq(actions.id, id))
      .returning();
    const row = updated[0];
    return row === undefined ? undefined : this.toEntry(row);
  }

  async setEnabled(id: string, enabled: boolean): Promise<ActionEntry | undefined> {
    const updated = await this.db
      .update(actions)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(actions.id, id))
      .returning();
    const row = updated[0];
    return row === undefined ? undefined : this.toEntry(row);
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db.delete(actions).where(eq(actions.id, id)).returning({ id: actions.id });
    return deleted.length > 0;
  }
}

export { candidateFromRow };
