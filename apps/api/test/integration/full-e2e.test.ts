import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { LogClient } from '@centurion/client-lib';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Kafka } from 'kafkajs';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp, type Application } from '../../src/app';
import { loadConfig } from '../../src/config';
import { createDb, createPool, type Database } from '../../src/db/client';

const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',').map((value) => value.trim());
const jevBaseUrl = process.env.JEV_BASE_URL ?? 'http://localhost:8080';
const runId = Date.now();

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function kafkaReachable(): Promise<boolean> {
  const admin = new Kafka({ clientId: 'e2e-probe', brokers, connectionTimeout: 3000, retry: { retries: 1 } }).admin();
  try {
    await admin.connect();
    await admin.disconnect();
    return true;
  } catch {
    return false;
  }
}

const kafkaUp = await kafkaReachable();
const jevUp = await reachable(`${jevBaseUrl}/health`);
const describeIf = kafkaUp && jevUp ? describe : describe.skip;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      server.close(() => resolve(address.port));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 40_000): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) return undefined;
    await sleep(250);
  }
}

async function waitForSse(baseUrl: string, needle: string, timeoutMs = 40_000): Promise<string> {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/v1/stream`, {
    headers: { accept: 'text/event-stream' },
    signal: controller.signal,
  });
  if (response.body === null) throw new Error('SSE response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes(needle)) return buffer;
    }
    return buffer;
  } finally {
    controller.abort();
  }
}

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let db: Database;
let app: Application | undefined;
let webhookServer: Server | undefined;
let baseUrl = '';

interface ReceivedWebhook {
  body: string;
  signature: string | undefined;
}

const receivedWebhooks: ReceivedWebhook[] = [];
const webhookSecret = 'e2e-webhook-secret';
const rawTopic = `e2e.raw.${runId}`;
const dlqTopic = `e2e.dlq.${runId}`;
const flagsTopic = `e2e.flags.${runId}`;

describeIf('full end-to-end (Compose Kafka + jev-mock, Testcontainers Postgres)', () => {
  beforeAll(async () => {
    // 1. Postgres
    container = await new PostgreSqlContainer('postgres:17.2-alpine').start();
    pool = createPool(container.getConnectionUri());
    db = createDb(pool);
    await migrate(db, { migrationsFolder: './drizzle' });

    // 2. Topics
    const admin = new Kafka({ clientId: `e2e-admin-${runId}`, brokers }).admin();
    await admin.connect();
    await admin.createTopics({
      topics: [
        { topic: rawTopic, numPartitions: 1, replicationFactor: 1 },
        { topic: dlqTopic, numPartitions: 1, replicationFactor: 1 },
        { topic: flagsTopic, numPartitions: 1, replicationFactor: 1 },
      ],
    });
    await admin.disconnect();

    // 3. Local signed-webhook receiver
    webhookServer = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      request.on('end', () => {
        receivedWebhooks.push({
          body,
          signature:
            typeof request.headers['x-centurion-signature'] === 'string'
              ? request.headers['x-centurion-signature']
              : undefined,
        });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve, reject) => {
      webhookServer?.on('error', reject);
      webhookServer?.listen(0, '127.0.0.1', () => resolve());
    });
    const webhookPort = (webhookServer.address() as AddressInfo).port;

    // 4. API process (everything wired: consumer, pipeline, executor, HTTP, SSE)
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    const config = loadConfig({
      DATABASE_URL: container.getConnectionUri(),
      HOST: '127.0.0.1',
      PORT: String(port),
      KAFKA_BROKERS: brokers.join(','),
      KAFKA_CLIENT_ID: `e2e-api-${runId}`,
      KAFKA_GROUP_ID: `e2e-group-${runId}`,
      KAFKA_TOPIC_RAW: rawTopic,
      KAFKA_TOPIC_DLQ: dlqTopic,
      KAFKA_TOPIC_FLAGS: flagsTopic,
      JEV_BASE_URL: jevBaseUrl,
      TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY ?? 'e2e-key',
      JEV_MODEL: 'jev-1.13.0',
      JEV_MAX_RPS: '500',
      WEBHOOK_ALLOWED_HOSTS: '127.0.0.1',
      SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      ACTION_EXECUTOR_INTERVAL_MS: '200',
      SSE_RING_BUFFER_SIZE: '100',
    } as NodeJS.ProcessEnv);
    app = await buildApp({ config });
    await app.start();
    await waitFor(async () => {
      const response = await fetch(`${baseUrl}/api/v1/ready`);
      return response.ok ? true : undefined;
    });

    // 5. Create the webhook action and one rule per primitive through the API
    const actionResponse = await fetch(`${baseUrl}/api/v1/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'webhook',
        name: 'e2e receiver',
        enabled: true,
        config: {
          url: `http://127.0.0.1:${webhookPort}/hook`,
          secret: webhookSecret,
          timeoutMs: 5000,
        },
      }),
    });
    expect(actionResponse.status).toBe(201);
    const action = (await actionResponse.json()) as { id: string };
    expect(action.id).toMatch(/^[0-9a-f-]{36}$/);

    const ruleBody = (question: unknown, condition: unknown, actionIds: string[]) => ({
      name: `e2e-${runId}`,
      enabled: true,
      scope: { sources: ['e2e-svc'] },
      question,
      condition,
      uncertainPolicy: 'ignore',
      actionIds,
    });

    const createRule = async (body: unknown): Promise<string> => {
      const response = await fetch(`${baseUrl}/api/v1/rules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(201);
      const rule = (await response.json()) as { id: string };
      return rule.id;
    };

    noulRuleId = await createRule(
      ruleBody(
        { type: 'noul', instructions: 'Does the log report a declined payment?' },
        { type: 'noul', op: 'gte', threshold: 0.5 },
        [action.id],
      ),
    );
    choiceRuleId = await createRule(
      ruleBody(
        {
          type: 'choice',
          instructions: 'What kind of failure is this?',
          criteria: { declined: 'Card declined', timeout: 'Timeout' },
        },
        { type: 'choice', anyOf: ['declined'] },
        [],
      ),
    );
    scoreRuleId = await createRule(
      ruleBody(
        { type: 'score', instructions: 'How severe is this?', criteria: ['none', 'low', 'high'] },
        { type: 'score', op: 'gte', threshold: 2 },
        [],
      ),
    );
  }, 240_000);

  let noulRuleId = '';
  let choiceRuleId = '';
  let scoreRuleId = '';

  afterAll(async () => {
    await app?.stop();
    await new Promise<void>((resolve) => {
      if (webhookServer === undefined) return resolve();
      webhookServer.close(() => resolve());
    });
    await pool?.end();
    await container?.stop();
  });

  it('creates rules, produces logs with the client lib, flags them and delivers a signed webhook', async () => {
    const ssePromise = waitForSse(baseUrl, 'flag.created');

    const client = new LogClient({
      brokers,
      topic: rawTopic,
      source: { id: 'e2e-svc', environment: 'test' },
      failureMode: 'throw',
      batch: { maxRecords: 10, lingerMs: 5 },
    });
    await client.send({ level: 'error', payload: 'payment declined by issuer' });
    await client.send({ level: 'error', payload: 'everything is fine' });
    await client.flush();
    await client.close();

    // Flags appear through the API for each primitive.
    const flagIds = await waitFor(async () => {
      const response = await fetch(`${baseUrl}/api/v1/flags?limit=100`);
      if (!response.ok) return undefined;
      const body = (await response.json()) as { items: Array<{ id: string; ruleId: string }> };
      const ruleIds = new Set(body.items.map((flag) => flag.ruleId));
      return ruleIds.has(noulRuleId) && ruleIds.has(choiceRuleId) && ruleIds.has(scoreRuleId)
        ? body.items
        : undefined;
    });
    expect(flagIds).toBeDefined();
    const items = flagIds ?? [];
    expect(items.filter((flag) => flag.ruleId === noulRuleId)).toHaveLength(1);

    // The signed webhook arrived and the HMAC matches.
    const webhook = await waitFor(async () => (receivedWebhooks.length > 0 ? receivedWebhooks[0] : undefined));
    expect(webhook).toBeDefined();
    const expectedSignature = `sha256=${createHmac('sha256', webhookSecret).update(webhook?.body ?? '').digest('hex')}`;
    expect(webhook?.signature).toBe(expectedSignature);
    const payload = JSON.parse(webhook?.body ?? '{}') as { flagId?: string; rule?: { id?: string } };
    expect(payload.rule?.id).toBe(noulRuleId);

    // The SSE stream carried the live flag event.
    const sse = await ssePromise;
    expect(sse).toContain('flag.created');

    // Ops endpoints.
    const ready = await fetch(`${baseUrl}/api/v1/ready`);
    expect(ready.status).toBe(200);
    const metrics = await fetch(`${baseUrl}/api/v1/metrics`);
    expect(metrics.status).toBe(200);
    const metricsText = await metrics.text();
    expect(metricsText).toContain('centurion_');
  }, 120_000);
});
