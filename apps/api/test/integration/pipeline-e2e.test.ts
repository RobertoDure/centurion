import { selectInScope, type LogEnvelope, type Rule, type SseEvent } from '@centurion/contracts';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ConsumedMessage, MessageContext } from '../../src/consumer/runner';
import { createDb, createPool, type Database } from '../../src/db/client';
import { createRepositories, type Repositories } from '../../src/db/repositories';
import { DefaultJevGateway } from '../../src/jev/gateway';
import { TokenBucketRateLimiter } from '../../src/jev/rate-limiter';
import { createSdkTransport } from '../../src/jev/sdk-transport';
import {
  Pipeline,
  type DlqPublisher,
  type EventPublisher,
  type Metrics,
} from '../../src/pipeline/orchestrator';

const jevBaseUrl = process.env.JEV_BASE_URL ?? 'http://localhost:8080';

async function jevMockReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${jevBaseUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

const reachable = await jevMockReachable();
const describeIf = reachable ? describe : describe.skip;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let db: Database;
let repos: Repositories;

function envelope(id: string, sourceId: string, payload: LogEnvelope['payload']): LogEnvelope {
  return {
    schemaVersion: 1,
    id,
    source: { id: sourceId, environment: 'test' },
    timestamp: '2026-10-01T00:00:00.000Z',
    level: 'error',
    payload,
  };
}

function makeContext(value: string, offset: number): { context: MessageContext; commits: string[] } {
  const commits: string[] = [];
  const message: ConsumedMessage = {
    topic: 'logs.raw',
    partition: 0,
    offset: String(offset),
    key: 'svc',
    value,
    headers: {},
    timestamp: '2026-10-01T00:00:00.000Z',
  };
  return {
    commits,
    context: {
      message,
      commit: async () => {
        commits.push(String(offset));
      },
    },
  };
}

describeIf('Pipeline end-to-end (Postgres + jev-mock)', () => {
  let pipeline: Pipeline;
  let actionRule: Rule;
  let dlqReasons: string[];
  let events: SseEvent[];

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.2-alpine').start();
    pool = createPool(container.getConnectionUri());
    db = createDb(pool);
    await migrate(db, { migrationsFolder: './drizzle' });
    repos = createRepositories(db);

    const action = await repos.actions.create({
      type: 'kafka_topic',
      name: 'flag output',
      enabled: true,
      config: { topic: 'logs.flags' },
    });

    const declinedRule = await repos.rules.create({
      name: 'Payment declined',
      enabled: true,
      scope: { sources: ['declined-svc'] },
      question: { type: 'noul', instructions: 'Does the log report a declined payment?' },
      condition: { type: 'noul', op: 'gte', threshold: 0.5 },
      uncertainPolicy: 'ignore',
      actionIds: [],
    });
    actionRule = await repos.rules.create({
      name: 'Timeout with action',
      enabled: true,
      scope: { sources: ['timeout-svc'] },
      question: { type: 'noul', instructions: 'Does the log report a timeout?' },
      condition: { type: 'noul', op: 'gte', threshold: 0.5 },
      uncertainPolicy: 'ignore',
      actionIds: [action.id],
    });
    const uncertainRule = await repos.rules.create({
      name: 'Billing question',
      enabled: true,
      scope: { sources: ['billing-svc'] },
      question: {
        type: 'choice',
        instructions: 'Which department is this about?',
        criteria: { billing: 'Billing', technical: 'Technical' },
      },
      condition: { type: 'choice', anyOf: ['billing'], minConfidence: 0.9 },
      uncertainPolicy: 'review',
      actionIds: [],
    });

    const rules = [declinedRule, actionRule, uncertainRule];
    const gateway = new DefaultJevGateway({
      transport: createSdkTransport({
        apiKey: process.env.TYPESAFE_API_KEY ?? 'test-key',
        baseURL: jevBaseUrl,
        defaultModel: 'jev-1.13.0',
      }),
      model: 'jev-1.13.0',
      rateLimiter: new TokenBucketRateLimiter({ maxRps: 100 }),
    });

    dlqReasons = [];
    events = [];
    const dlq: DlqPublisher = {
      publish: async ({ reason }) => {
        dlqReasons.push(reason);
      },
    };
    const publisher: EventPublisher = { publish: (event) => events.push(event) };
    const metrics: Metrics = { increment: () => {}, observe: () => {} };

    pipeline = new Pipeline({
      gateway,
      ruleCache: { selectFor: async (envelope) => selectInScope(rules, envelope) },
      outcomes: repos.outcomes,
      dlq,
      events: publisher,
      metrics,
      config: {
        budget: { stateQuestionTokenLimit: 200, requestTokenLimit: 400, safetyMargin: 0 },
        oversize: { policy: 'reject', maxChunks: 8 },
        excerptChars: 64,
        persistAllEvaluations: false,
        redactKeys: [],
      },
    });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('processes flagged, uncertain, clean, invalid and oversize messages', async () => {
    const inputs: Array<{ id: string; value: string }> = [
      { id: 'e2e-declined', value: JSON.stringify(envelope('e2e-declined', 'declined-svc', 'payment declined by issuer')) },
      { id: 'e2e-timeout', value: JSON.stringify(envelope('e2e-timeout', 'timeout-svc', 'request to payment service timed out')) },
      { id: 'e2e-billing', value: JSON.stringify(envelope('e2e-billing', 'billing-svc', 'customer asked about a billing invoice')) },
      { id: 'e2e-clean', value: JSON.stringify(envelope('e2e-clean', 'clean-svc', 'everything is fine')) },
      { id: 'e2e-invalid', value: '{ not json' },
      { id: 'e2e-oversize', value: JSON.stringify(envelope('e2e-oversize', 'declined-svc', 'x'.repeat(2000))) },
    ];

    const outcomes = new Map<string, string>();
    for (const [index, input] of inputs.entries()) {
      const { context: ctx, commits } = makeContext(input.value, index);
      const outcome = await pipeline.handle(ctx);
      expect(commits).toEqual([String(index)]);
      outcomes.set(input.id, outcome.status);
    }

    expect(outcomes.get('e2e-declined')).toBe('flagged');
    expect(outcomes.get('e2e-timeout')).toBe('flagged');
    expect(outcomes.get('e2e-billing')).toBe('uncertain');
    expect(outcomes.get('e2e-clean')).toBe('clean');
    expect(outcomes.get('e2e-invalid')).toBe('error');
    expect(outcomes.get('e2e-oversize')).toBe('error');

    expect(dlqReasons).toEqual(['INVALID_ENVELOPE', 'OVERSIZE']);

    const allFlags = await repos.flags.list({});
    expect(allFlags).toHaveLength(3);
    const validFlags = allFlags.flatMap((entry) => (entry.kind === 'valid' ? [entry.flag] : []));
    expect(validFlags.filter((flag) => flag.outcome === 'triggered')).toHaveLength(2);
    expect(validFlags.filter((flag) => flag.outcome === 'uncertain')).toHaveLength(1);

    const timeoutFlag = validFlags.find((flag) => flag.ruleId === actionRule.id);
    expect(timeoutFlag).toBeDefined();
    const executions = await repos.executions.listByFlag(timeoutFlag?.id ?? '');
    expect(executions).toHaveLength(1);
    expect(executions[0]?.status).toBe('pending');

    const evaluations = await repos.evaluations.list({ limit: 100 });
    expect(evaluations.filter((entry) => entry.kind === 'valid')).toHaveLength(3);

    expect(events.filter((event) => event.type === 'flag.created')).toHaveLength(3);
    expect(events.filter((event) => event.type === 'log.processed')).toHaveLength(6);
  }, 120_000);

  it('is idempotent when the same messages are redelivered', async () => {
    const redeliveries = [
      JSON.stringify(envelope('e2e-declined', 'declined-svc', 'payment declined by issuer')),
      JSON.stringify(envelope('e2e-timeout', 'timeout-svc', 'request to payment service timed out')),
      JSON.stringify(envelope('e2e-billing', 'billing-svc', 'customer asked about a billing invoice')),
    ];
    for (const [index, value] of redeliveries.entries()) {
      const { context: ctx } = makeContext(value, index);
      await pipeline.handle(ctx);
    }

    const allFlags = await repos.flags.list({});
    expect(allFlags).toHaveLength(3);
    const validFlags = allFlags.flatMap((entry) => (entry.kind === 'valid' ? [entry.flag] : []));
    const timeoutFlag = validFlags.find((flag) => flag.ruleId === actionRule.id);
    const executions = await repos.executions.listByFlag(timeoutFlag?.id ?? '');
    expect(executions).toHaveLength(1);
    expect(events.filter((event) => event.type === 'flag.created')).toHaveLength(3);
  }, 120_000);
});
