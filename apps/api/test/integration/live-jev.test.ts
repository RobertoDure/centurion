import type { LogEnvelope } from '@centurion/contracts';
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
import { Pipeline, noopEventPublisher, type DlqPublisher, type Metrics } from '../../src/pipeline/orchestrator';

/**
 * LIVE Jev validation. Never runs in CI: requires JEV_LIVE_TESTS=1 and a real
 * TYPESAFE_API_KEY. Bounded to a handful of calls.
 */
const live = process.env.JEV_LIVE_TESTS === '1' && (process.env.TYPESAFE_API_KEY ?? '').length > 0;
const describeIf = live ? describe : describe.skip;
const jevBaseUrl = process.env.JEV_BASE_URL ?? 'https://api.typesafe.ai';
const model = process.env.JEV_MODEL ?? 'jev-1.13.0';

function makeGateway(): DefaultJevGateway {
  return new DefaultJevGateway({
    transport: createSdkTransport({
      apiKey: process.env.TYPESAFE_API_KEY ?? '',
      baseURL: jevBaseUrl,
      defaultModel: model,
    }),
    model,
    rateLimiter: new TokenBucketRateLimiter({ maxRps: Number(process.env.JEV_MAX_RPS ?? 5) }),
  });
}

function envelope(id: string, payload: string): LogEnvelope {
  return {
    schemaVersion: 1,
    id,
    source: { id: 'live-svc' },
    timestamp: new Date().toISOString(),
    level: 'error',
    payload,
  };
}

function contextFor(value: string, offset: number): MessageContext {
  const message: ConsumedMessage = {
    topic: 'logs.raw',
    partition: 0,
    offset: String(offset),
    key: 'live-svc',
    value,
    headers: {},
    timestamp: new Date().toISOString(),
  };
  return { message, commit: async () => {} };
}

describeIf('live Jev (real API)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let pool: Pool | undefined;
  let db: Database;
  let repos: Repositories;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.2-alpine').start();
    pool = createPool(container.getConnectionUri());
    db = createDb(pool);
    await migrate(db, { migrationsFolder: './drizzle' });
    repos = createRepositories(db);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('answers Noul, Choice and Score questions with a pinned model', async () => {
    const gateway = makeGateway();
    const result = await gateway.evaluate({
      state: 'The customer says their payment was declined by the issuer and they are angry about it.',
      questions: {
        declined: { type: 'noul', instructions: 'Does the log report that a payment was declined?' },
        department: {
          type: 'choice',
          instructions: 'Which department should handle this?',
          criteria: { billing: 'Billing', technical: 'Technical', other: 'Other' },
        },
        severity: {
          type: 'score',
          instructions: 'How severe is the customer sentiment?',
          criteria: ['calm', 'frustrated', 'very angry'],
        },
      },
    });

    expect(result.model).toContain('jev');
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.answers.declined?.type).toBe('noul');
    expect(result.answers.department?.type).toBe('choice');
    expect(result.answers.severity?.type).toBe('score');
    console.log('LIVE_GATEWAY_RESULT', JSON.stringify({ model: result.model, usage: result.usage, answers: result.answers }));
  }, 120_000);

  it('runs the pipeline against real Jev and is idempotent on redelivery', async () => {
    const rule = await repos.rules.create({
      name: `live-rule-${Date.now()}`,
      enabled: true,
      scope: { sources: ['live-svc'] },
      question: { type: 'noul', instructions: 'Does the log report that a payment was declined?' },
      condition: { type: 'noul', op: 'gte', threshold: 0.5 },
      uncertainPolicy: 'review',
      actionIds: [],
    });

    const dlq: DlqPublisher = { publish: async () => {} };
    const metrics: Metrics = { increment: () => {}, observe: () => {} };
    const pipeline = new Pipeline({
      gateway: makeGateway(),
      ruleCache: { selectFor: async () => [rule] },
      outcomes: repos.outcomes,
      dlq,
      events: noopEventPublisher,
      metrics,
      config: {
        budget: { stateQuestionTokenLimit: 32_000, requestTokenLimit: 64_000, safetyMargin: 0.1 },
        oversize: { policy: 'chunk', maxChunks: 8 },
        excerptChars: 0,
        persistAllEvaluations: true,
        redactKeys: [],
      },
    });

    const first = await pipeline.handle(contextFor(JSON.stringify(envelope('live-1', 'payment declined by issuer')), 0));
    console.log('LIVE_PIPELINE_RESULT', JSON.stringify(first));
    expect(['clean', 'flagged', 'uncertain', 'partial']).toContain(first.status);

    const evaluation = await repos.evaluations.get('live-1');
    expect(evaluation?.kind).toBe('valid');
    if (evaluation?.kind === 'valid') expect(evaluation.evaluation.model).toContain('jev');

    const before = await repos.flags.list({});
    const beforeCount = before.length;
    await pipeline.handle(contextFor(JSON.stringify(envelope('live-1', 'payment declined by issuer')), 0));
    const after = await repos.flags.list({});
    expect(after.length).toBe(beforeCount);
  }, 120_000);
});
