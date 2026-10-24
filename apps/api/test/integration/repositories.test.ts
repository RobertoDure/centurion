import type { JevQuestion } from '@centurion/contracts';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ActionExecutor } from '../../src/actions/executor';
import { ActionRegistry } from '../../src/actions/registry';
import { createDb, createPool, type Database } from '../../src/db/client';
import { createRepositories, type Repositories } from '../../src/db/repositories';
import { rules } from '../../src/db/schema';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let db: Database;
let repos: Repositories;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.2-alpine').start();
  pool = createPool(container.getConnectionUri());
  db = createDb(pool);
  await migrate(db, { migrationsFolder: './drizzle' });
  repos = createRepositories(db);
}, 180_000);

beforeEach(async () => {
  // Tests share one database; the outbox queue must not leak between them.
  await db.execute(sql`DELETE FROM action_executions`);
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

const validRule = {
  name: 'Payment failures',
  enabled: true,
  scope: { sources: ['checkout-api'], levels: ['error' as const] },
  question: {
    type: 'choice' as const,
    instructions: 'What kind of failure is this?',
    criteria: { card_declined: 'Card declined', timeout: 'Dependency timeout' },
  },
  condition: { type: 'choice' as const, anyOf: ['card_declined'] },
  uncertainPolicy: 'review' as const,
  actionIds: [] as string[],
};

describe('RulesRepository', () => {
  it('creates version 1 and writes a snapshot', async () => {
    const rule = await repos.rules.create(validRule);
    expect(rule.version).toBe(1);
    const versions = await repos.rules.listVersions(rule.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.version).toBe(1);
  });

  it('update writes version N+1 in the same transaction', async () => {
    const created = await repos.rules.create({ ...validRule, name: 'versioned' });
    const updated = await repos.rules.update(created.id, { ...validRule, name: 'versioned v2' });
    expect(updated?.kind).toBe('valid');
    if (updated?.kind !== 'valid') return;
    expect(updated.rule.version).toBe(2);
    expect(updated.rule.name).toBe('versioned v2');
    const versions = await repos.rules.listVersions(created.id);
    expect(versions.map((entry) => entry.version).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('returns undefined when updating or deleting a missing rule', async () => {
    const missing = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(await repos.rules.update(missing, validRule)).toBeUndefined();
    expect(await repos.rules.delete(missing)).toBe(false);
  });

  it('surfaces an invalid stored rule as a marker instead of throwing', async () => {
    const inserted = await db
      .insert(rules)
      .values({
        name: 'broken rule',
        question: { type: 'bogus' } as unknown as JevQuestion,
        condition: { type: 'noul', op: 'gte', threshold: 0.5 },
        scope: {},
        uncertainPolicy: 'ignore',
        currentVersion: 1,
      })
      .returning({ id: rules.id });
    const id = inserted[0]?.id;
    expect(id).toBeDefined();

    const list = await repos.rules.list();
    const broken = list.find((entry) => entry.kind === 'invalid' && entry.id === id);
    expect(broken).toBeDefined();
    if (broken?.kind !== 'invalid') return;
    expect(broken.reason.length).toBeGreaterThan(0);
    expect(broken.name).toBe('broken rule');

    const fetched = await repos.rules.get(id ?? '');
    expect(fetched?.kind).toBe('invalid');
  });

  it('toggles enabled without bumping the version', async () => {
    const created = await repos.rules.create({ ...validRule, name: 'toggle' });
    const disabled = await repos.rules.setEnabled(created.id, false, 'auto-disabled: 422');
    expect(disabled?.kind).toBe('valid');
    if (disabled?.kind !== 'valid') return;
    expect(disabled.rule.enabled).toBe(false);
    expect(disabled.rule.version).toBe(1);
    expect(disabled.rule.disabledReason).toBe('auto-disabled: 422');
  });
});

describe('ActionsRepository', () => {
  it('stores a webhook secret and reports hasSecret', async () => {
    const action = await repos.actions.create({
      type: 'webhook',
      name: 'Notify',
      enabled: true,
      config: { url: 'https://hooks.example.com/x', secret: 's3cr3t', timeoutMs: 5000 },
    });
    const entry = await repos.actions.get(action.id);
    expect(entry?.kind).toBe('valid');
    if (entry?.kind !== 'valid') return;
    expect(entry.hasSecret).toBe(true);
    const forExecution = await repos.actions.getForExecution(action.id);
    expect(forExecution?.type).toBe('webhook');
    if (forExecution?.type !== 'webhook') return;
    expect(forExecution.config.secret).toBe('s3cr3t');
  });

  it('updates and deletes actions', async () => {
    const action = await repos.actions.create({
      type: 'kafka_topic',
      name: 'Publish',
      enabled: true,
      config: { topic: 'logs.flags' },
    });
    const updated = await repos.actions.update(action.id, {
      type: 'kafka_topic',
      name: 'Publish v2',
      enabled: false,
      config: { topic: 'logs.flags.v2' },
    });
    expect(updated?.kind).toBe('valid');
    if (updated?.kind !== 'valid') return;
    expect(updated.action.enabled).toBe(false);
    expect(await repos.actions.delete(action.id)).toBe(true);
    expect(await repos.actions.delete(action.id)).toBe(false);
  });
});

describe('OutcomeRepository and flags', () => {
  it('records flags with an evaluation and is idempotent on redelivery', async () => {
    const action = await repos.actions.create({
      type: 'kafka_topic',
      name: 'outbox',
      enabled: true,
      config: { topic: 'logs.flags' },
    });
    const rule = await repos.rules.create({ ...validRule, name: 'outbox rule', actionIds: [action.id] });
    const messageId = 'msg-idempotent-1';

    const first = await repos.outcomes.record({
      messageId,
      evaluation: {
        messageId,
        sourceId: 'checkout-api',
        topic: 'logs.raw',
        partition: 0,
        offset: '1',
        model: 'jev-1.13.0',
        tokenEstimate: 12,
        partial: false,
        status: 'flagged',
      },
      flags: [
        {
          ruleId: rule.id,
          ruleVersion: rule.version,
          outcome: 'triggered',
          answer: { type: 'choice', choice: 'card_declined', probabilities: { card_declined: 0.9 }, confidence: 0.8 },
          actionIds: [action.id],
        },
      ],
    });
    expect(first[0]?.created).toBe(true);
    expect(first[0]?.flagId).not.toBe('');

    const second = await repos.outcomes.record({
      messageId,
      evaluation: {
        messageId,
        sourceId: 'checkout-api',
        topic: 'logs.raw',
        partition: 0,
        offset: '1',
        partial: false,
        status: 'flagged',
      },
      flags: [
        {
          ruleId: rule.id,
          ruleVersion: rule.version,
          outcome: 'triggered',
          answer: { type: 'choice', choice: 'card_declined', probabilities: { card_declined: 0.9 }, confidence: 0.8 },
          actionIds: [action.id],
        },
      ],
    });
    expect(second[0]?.created).toBe(false);
    expect(second[0]?.flagId).toBe(first[0]?.flagId);

    const allFlags = await repos.flags.list({});
    expect(allFlags).toHaveLength(1);
    const valid = allFlags[0];
    expect(valid?.kind).toBe('valid');
    if (valid?.kind !== 'valid') return;
    expect(valid.flag.sourceId).toBe('checkout-api');

    const executions = await repos.executions.listByFlag(first[0]?.flagId ?? '');
    expect(executions).toHaveLength(1);
    expect(executions[0]?.status).toBe('pending');
  });

  it('filters flags by source and outcome', async () => {
    const sourceFlags = await repos.flags.list({ sourceId: 'checkout-api', outcome: 'triggered' });
    expect(sourceFlags.length).toBeGreaterThan(0);
    const none = await repos.flags.list({ sourceId: 'does-not-exist' });
    expect(none).toHaveLength(0);
  });
});

describe('ActionExecutionsRepository outbox', () => {
  it('claims, completes and recovers executions', async () => {
    const action = await repos.actions.create({
      type: 'kafka_topic',
      name: 'claim',
      enabled: true,
      config: { topic: 'logs.flags' },
    });
    const rule = await repos.rules.create({ ...validRule, name: 'claim rule', actionIds: [action.id] });
    const messageId = 'msg-exec-1';
    const recorded = await repos.outcomes.record({
      messageId,
      evaluation: {
        messageId,
        sourceId: 'svc',
        topic: 'logs.raw',
        partition: 0,
        offset: '7',
        partial: false,
        status: 'flagged',
      },
      flags: [
        {
          ruleId: rule.id,
          ruleVersion: rule.version,
          outcome: 'triggered',
          answer: { type: 'noul', noul: 0.95 },
          actionIds: [action.id],
        },
      ],
    });
    const flagId = recorded[0]?.flagId ?? '';

    const claimed = await repos.executions.claimDue(10);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.attempts).toBe(1);

    const context = await repos.executions.loadContext(claimed[0]!);
    expect(context?.action.id).toBe(action.id);
    expect(context?.payload.flagId).toBe(flagId);
    expect(context?.payload.messageRef.offset).toBe('7');

    await repos.executions.markSucceeded(claimed[0]!.id);
    const afterSuccess = await repos.executions.listByFlag(flagId);
    expect(afterSuccess[0]?.status).toBe('succeeded');

    // A failed attempt is queued again unless it is final.
    const action2 = await repos.actions.create({
      type: 'kafka_topic',
      name: 'claim2',
      enabled: true,
      config: { topic: 'logs.flags' },
    });
    const rule2 = await repos.rules.create({ ...validRule, name: 'claim rule 2', actionIds: [action2.id] });
    const msg2 = 'msg-exec-2';
    const recorded2 = await repos.outcomes.record({
      messageId: msg2,
      evaluation: {
        messageId: msg2,
        sourceId: 'svc',
        topic: 'logs.raw',
        partition: 0,
        offset: '8',
        partial: false,
        status: 'flagged',
      },
      flags: [
        {
          ruleId: rule2.id,
          ruleVersion: rule2.version,
          outcome: 'triggered',
          answer: { type: 'noul', noul: 0.95 },
          actionIds: [action2.id],
        },
      ],
    });
    const flag2 = recorded2[0]?.flagId ?? '';
    const claimed2 = await repos.executions.claimDue(10);
    await repos.executions.markFailed(claimed2[0]!.id, 'boom', { final: false });
    const queuedAgain = await repos.executions.listByFlag(flag2);
    expect(queuedAgain[0]?.status).toBe('pending');
    expect(queuedAgain[0]?.lastError).toBe('boom');

    // A row stuck in "running" is recovered.
    await db.execute(sql`UPDATE action_executions SET updated_at = now() - interval '10 minutes' WHERE id = ${claimed2[0]!.id}`);
    await db.execute(sql`UPDATE action_executions SET status = 'running' WHERE id = ${claimed2[0]!.id}`);
    expect(await repos.executions.recoverStuck(60_000)).toBe(1);
    const recovered = await repos.executions.listByFlag(flag2);
    expect(recovered[0]?.status).toBe('pending');
  });
});

describe('EvaluationsRepository', () => {
  it('reads an evaluation back', async () => {
    const entry = await repos.evaluations.get('msg-idempotent-1');
    expect(entry?.kind).toBe('valid');
    if (entry?.kind !== 'valid') return;
    expect(entry.evaluation.sourceId).toBe('checkout-api');
    expect(entry.evaluation.model).toBe('jev-1.13.0');
  });

  it('reports an invalid evaluation row', async () => {
    await db.execute(
      sql`INSERT INTO evaluations (message_id, source_id, topic, "partition", "offset", partial, status) VALUES ('bad-eval', 'svc', 'logs.raw', 0, '1', false, 'not-a-status')`,
    );
    const entry = await repos.evaluations.get('bad-eval');
    expect(entry?.kind).toBe('invalid');
  });
});

describe('ActionExecutor against the real outbox', () => {
  async function seedExecution(messageId: string, offset: string): Promise<{ flagId: string; actionId: string }> {
    const action = await repos.actions.create({
      type: 'kafka_topic',
      name: `action-${messageId}`,
      enabled: true,
      config: { topic: 'logs.flags' },
    });
    const rule = await repos.rules.create({ ...validRule, name: `rule-${messageId}`, actionIds: [action.id] });
    const recorded = await repos.outcomes.record({
      messageId,
      evaluation: {
        messageId,
        sourceId: 'svc',
        topic: 'logs.raw',
        partition: 0,
        offset,
        partial: false,
        status: 'flagged',
      },
      flags: [
        {
          ruleId: rule.id,
          ruleVersion: rule.version,
          outcome: 'triggered',
          answer: { type: 'noul', noul: 0.95 },
          actionIds: [action.id],
        },
      ],
    });
    return { flagId: recorded[0]?.flagId ?? '', actionId: action.id };
  }

  it('retries a flaky handler and finishes succeeded on the third attempt', async () => {
    const { flagId } = await seedExecution('msg-flaky', '31');
    let calls = 0;
    const registry = new ActionRegistry().register({
      type: 'kafka_topic',
      execute: async () => {
        calls += 1;
        if (calls <= 2) throw new Error(`flaky ${calls}`);
        return { detail: 'ok' };
      },
    });
    const executor = new ActionExecutor({
      store: repos.executions,
      registry,
      maxAttempts: 5,
      backoffBaseMs: 0,
      random: () => 0,
    });

    await executor.runOnce();
    await executor.runOnce();
    const mid = await repos.executions.listByFlag(flagId);
    expect(mid[0]?.status).toBe('pending');
    expect(mid[0]?.lastError).toBe('flaky 2');

    const result = await executor.runOnce();
    expect(result.succeeded).toBe(1);
    const rows = await repos.executions.listByFlag(flagId);
    expect(rows[0]?.status).toBe('succeeded');
    expect(rows[0]?.attempts).toBe(3);
    expect(calls).toBe(3);
  });

  it('ends failed after ACTION_MAX_ATTEMPTS', async () => {
    const { flagId } = await seedExecution('msg-permanent', '32');
    const registry = new ActionRegistry().register({
      type: 'kafka_topic',
      execute: async () => {
        throw new Error('always fails');
      },
    });
    const executor = new ActionExecutor({
      store: repos.executions,
      registry,
      maxAttempts: 2,
      backoffBaseMs: 0,
      random: () => 0,
    });

    await executor.runOnce();
    await executor.runOnce();
    const rows = await repos.executions.listByFlag(flagId);
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.attempts).toBe(2);
    expect(rows[0]?.lastError).toBe('always fails');

    // A finished execution is never claimed again.
    expect((await executor.runOnce()).claimed).toBe(0);
  });
});
