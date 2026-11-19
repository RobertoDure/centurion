import { logEnvelopeSchema, type LogEnvelope } from '@centurion/contracts';

import { listFromCsv, loadConfig } from './config';
import { createDb, createPool } from './db/client';
import { createRepositories } from './db/repositories';
import { DefaultJevGateway } from './jev/gateway';
import { TokenBucketRateLimiter } from './jev/rate-limiter';
import { createSdkTransport } from './jev/sdk-transport';
import { TokenCalibrator } from './jev/token-estimator';
import { Pipeline, noopEventPublisher, type DlqPublisher, type Metrics } from './pipeline/orchestrator';
import { RuleCache } from './pipeline/rule-cache';

/**
 * T8.2 load/soak harness. Drives the pipeline directly with injected latency and
 * periodic 429/529 windows, asserting zero loss, no duplicate flags and bounded
 * memory. Run against the local Compose Postgres + jev-mock:
 *
 *   SOAK_MESSAGES=10000 pnpm --filter @centurion/api soak
 */
const MESSAGES = Number(process.env.SOAK_MESSAGES ?? 10_000);
const LATENCY_WINDOW = Number(process.env.SOAK_LATENCY_WINDOW ?? 50);
const RATE_LIMIT_WINDOW = Number(process.env.SOAK_RATE_LIMIT_WINDOW ?? 10);

function envelope(id: string, payload: string): LogEnvelope {
  return logEnvelopeSchema.parse({
    schemaVersion: 1,
    id,
    source: { id: 'soak-svc' },
    timestamp: new Date().toISOString(),
    level: 'error',
    payload,
  });
}

async function setMockMode(baseUrl: string, mode: string): Promise<void> {
  await fetch(`${baseUrl}/__mock/mode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);
  const repos = createRepositories(db);
  const calibrator = new TokenCalibrator();
  const gateway = new DefaultJevGateway({
    transport: createSdkTransport({
      apiKey: config.TYPESAFE_API_KEY ?? 'test-key',
      baseURL: config.JEV_BASE_URL,
      defaultModel: config.JEV_MODEL,
    }),
    model: config.JEV_MODEL,
    rateLimiter: new TokenBucketRateLimiter({ maxRps: config.JEV_MAX_RPS }),
    calibrator,
  });

  const existing = await repos.rules.list();
  const rule = await repos.rules.create({
    name: `soak-${Date.now()}`,
    enabled: true,
    scope: { sources: ['soak-svc'] },
    question: { type: 'noul', instructions: 'Does the log report a declined payment?' },
    condition: { type: 'noul', op: 'gte', threshold: 0.5 },
    uncertainPolicy: 'ignore',
    actionIds: [],
  });

  const ruleCache = new RuleCache({
    source: { list: async () => [{ kind: 'valid', rule }] },
    refreshSeconds: 60,
  });
  await ruleCache.refresh();

  const metricsCounters = new Map<string, number>();
  const metrics: Metrics = {
    increment: (name) => metricsCounters.set(name, (metricsCounters.get(name) ?? 0) + 1),
    observe: () => {},
  };
  const dlq: DlqPublisher = { publish: async () => {} };
  const pipeline = new Pipeline({
    gateway,
    ruleCache,
    outcomes: repos.outcomes,
    dlq,
    events: noopEventPublisher,
    metrics,
    config: {
      budget: {
        stateQuestionTokenLimit: config.JEV_STATE_QUESTION_TOKEN_LIMIT,
        requestTokenLimit: config.JEV_REQUEST_TOKEN_LIMIT,
        safetyMargin: config.TOKEN_SAFETY_MARGIN,
      },
      oversize: { policy: config.OVERSIZE_POLICY, maxChunks: config.MAX_CHUNKS },
      excerptChars: config.EXCERPT_CHARS,
      persistAllEvaluations: false,
      redactKeys: listFromCsv(config.REDACT_KEYS),
    },
  });

  const heapBefore = process.memoryUsage().heapUsed;
  let processed = 0;
  let flagged = 0;
  let clean = 0;
  let retries = 0;
  let peakHeap = heapBefore;

  const flaggedPayload = 'payment declined by issuer';
  const cleanPayload = 'everything is fine';

  let latencyRemaining = 0;
  let rateLimitActive = false;
  let rateLimitFails = 0;

  for (let index = 0; index < MESSAGES; index += 1) {
    if (index === Math.floor(MESSAGES * 0.25)) {
      await setMockMode(config.JEV_BASE_URL, 'latency');
      latencyRemaining = LATENCY_WINDOW;
    }
    if (index === Math.floor(MESSAGES * 0.5) && !rateLimitActive) {
      await setMockMode(config.JEV_BASE_URL, '429');
      rateLimitActive = true;
      rateLimitFails = 0;
    }

    const payload = index % 2 === 0 ? flaggedPayload : cleanPayload;
    const value = JSON.stringify(envelope(`soak-${index}`, payload));

    // Simulates at-least-once redelivery: never commit on failure, retry the message.
    for (;;) {
      try {
        const outcome = await pipeline.handle({
          message: {
            topic: config.KAFKA_TOPIC_RAW,
            partition: 0,
            offset: String(index),
            key: 'soak-svc',
            value,
            headers: {},
            timestamp: new Date().toISOString(),
          },
          commit: async () => {},
        });
        if (outcome.status === 'flagged') flagged += 1;
        else clean += 1;
        processed += 1;
        if (latencyRemaining > 0) {
          latencyRemaining -= 1;
          if (latencyRemaining === 0 && !rateLimitActive) {
            await setMockMode(config.JEV_BASE_URL, 'ok');
          }
        }
        break;
      } catch {
        retries += 1;
        if (rateLimitActive) {
          rateLimitFails += 1;
          if (rateLimitFails >= RATE_LIMIT_WINDOW) {
            await setMockMode(config.JEV_BASE_URL, 'ok');
            rateLimitActive = false;
          }
        }
        await sleep(250);
      }
    }

    if (index % 100 === 0) {
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    }
  }

  await setMockMode(config.JEV_BASE_URL, 'ok');

  const flags = await repos.flags.list({ limit: 100_000 });
  const validFlags = flags.flatMap((entry) => (entry.kind === 'valid' ? [entry.flag] : []));
  const uniqueKeys = new Set(validFlags.map((flag) => `${flag.messageId}:${flag.ruleId}`));
  const expectedFlagged = Math.ceil(MESSAGES / 2);

  // Clean up the rule created by this run and any previous runs.
  await repos.rules.delete(rule.id);
  for (const entry of existing) {
    if (entry.kind === 'valid' && entry.rule.name.startsWith('soak-')) {
      await repos.rules.delete(entry.rule.id);
    }
  }

  const report = {
    messages: MESSAGES,
    processed,
    flagged,
    clean,
    retries,
    expectedFlagged,
    flagsStored: validFlags.length,
    uniqueFlagKeys: uniqueKeys.size,
    heapBeforeMb: Math.round(heapBefore / 1024 / 1024),
    peakHeapMb: Math.round(peakHeap / 1024 / 1024),
    tokenCalibration: calibrator.snapshot(),
  };
  console.log(JSON.stringify(report, null, 2));

  await pool.end();

  const failures: string[] = [];
  if (processed !== MESSAGES) failures.push(`processed ${processed} != ${MESSAGES}`);
  if (uniqueKeys.size !== validFlags.length) failures.push('duplicate flags detected');
  if (flagged !== expectedFlagged) failures.push(`flagged ${flagged} != ${expectedFlagged}`);
  if (peakHeap > 512 * 1024 * 1024) failures.push(`heap grew to ${report.peakHeapMb}MB`);
  if (failures.length > 0) {
    console.error('SOAK FAILED:', failures.join('; '));
    process.exitCode = 1;
  } else {
    console.log('SOAK OK');
  }
}

await main();
