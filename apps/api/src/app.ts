import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { pino, type Logger } from 'pino';

import { ActionExecutor } from './actions/executor';
import { createKafkaTopicHandler } from './actions/kafka-topic';
import { createDefaultActionRegistry } from './actions/registry';
import { createWebhookHandler } from './actions/webhook';
import { kafkaBrokers, listFromCsv, type AppConfig } from './config';
import {
  connectProducer,
  createKafka,
  KafkaJsConsumerAdapter,
  KafkaJsDlqPublisher,
  KafkaJsProducer,
  type KafkaProducerHandle,
  type KafkaSasl,
} from './consumer/kafkajs-consumer';
import { ConsumerRunner } from './consumer/runner';
import { createDb, createPool } from './db/client';
import { createRepositories } from './db/repositories';
import { buildApp as buildHttpApp } from './http/app';
import { JevAuthError } from './jev/errors';
import { DefaultJevGateway, type JevGateway } from './jev/gateway';
import { TokenBucketRateLimiter } from './jev/rate-limiter';
import { createSdkTransport } from './jev/sdk-transport';
import { TokenCalibrator } from './jev/token-estimator';
import { instrumentGateway } from './ops/instrumentation';
import { ApiMetrics } from './ops/metrics';
import { JevAuthState, type ReadinessDeps } from './ops/status';
import { Pipeline } from './pipeline/orchestrator';
import { RuleCache } from './pipeline/rule-cache';
import { createActionConfigCodec } from './security/secrets';
import { SseHub } from './sse/hub';

export interface ApplicationDeps {
  config: AppConfig;
  logger?: Logger;
}

export interface Application {
  fastify: FastifyInstance;
  start(): Promise<void>;
  /** Graceful shutdown: consumer, executor, cache, SSE, HTTP, producer, pool. */
  stop(): Promise<void>;
}

function kafkaSasl(config: AppConfig): KafkaSasl | undefined {
  const mechanism = config.KAFKA_SASL_MECHANISM;
  if (mechanism === undefined) return undefined;
  const { KAFKA_SASL_USERNAME: username, KAFKA_SASL_PASSWORD: password } = config;
  if (username === undefined || password === undefined) return undefined;
  return { mechanism, username, password };
}

/** A missing key becomes an auth error the moment Jev is called, not a crash. */
function createGateway(
  config: AppConfig,
  rateLimiter: TokenBucketRateLimiter,
  calibrator: TokenCalibrator,
): JevGateway {
  const apiKey = config.TYPESAFE_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    return {
      evaluate: async () => {
        throw new JevAuthError('TYPESAFE_API_KEY is not configured');
      },
    };
  }
  return new DefaultJevGateway({
    transport: createSdkTransport({
      apiKey,
      baseURL: config.JEV_BASE_URL,
      defaultModel: config.JEV_MODEL,
      timeoutMs: config.JEV_TIMEOUT_MS,
      maxRetries: config.JEV_MAX_RETRIES,
    }),
    model: config.JEV_MODEL,
    rateLimiter,
    calibrator,
  });
}

/**
 * Composes the whole process (T5.4 / deliverable 6): Postgres, Kafka consumer,
 * Jev gateway, SSE hub, action executor, pipeline and the Fastify HTTP app.
 * `buildApp` performs connections; `start()` begins consuming and listening.
 */
export async function buildApp(deps: ApplicationDeps): Promise<Application> {
  const { config } = deps;
  const logger = deps.logger ?? pino({ level: 'info' });

  const pool: Pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);
  const codec = createActionConfigCodec(config.SECRETS_ENCRYPTION_KEY, { logger });
  const repositories = createRepositories(db, codec);
  const redactKeys = listFromCsv(config.REDACT_KEYS);

  const ruleCache = new RuleCache({
    source: repositories.rules,
    refreshSeconds: config.RULE_CACHE_REFRESH_SECONDS,
    logger,
  });
  ruleCache.start();

  const kafka = createKafka({
    brokers: kafkaBrokers(config),
    clientId: config.KAFKA_CLIENT_ID,
    ssl: config.KAFKA_SSL,
    sasl: kafkaSasl(config),
  });
  const producer: KafkaProducerHandle = await connectProducer(kafka);

  const gatewayLimiter = new TokenBucketRateLimiter({ maxRps: config.JEV_MAX_RPS });
  const testLimiter = new TokenBucketRateLimiter({ maxRps: config.JEV_MAX_RPS });
  const calibrator = new TokenCalibrator();
  const authState = new JevAuthState();
  const metrics = new ApiMetrics({ calibrator });
  const gateway = instrumentGateway({
    gateway: createGateway(config, gatewayLimiter, calibrator),
    metrics,
    authState,
  });

  const hub = new SseHub({ ringBufferSize: config.SSE_RING_BUFFER_SIZE, logger });

  const registry = createDefaultActionRegistry({
    webhook: createWebhookHandler(),
    kafkaTopic: createKafkaTopicHandler({
      producer: new KafkaJsProducer(producer.producer),
      defaultTopic: config.KAFKA_TOPIC_FLAGS,
    }),
  });
  const executor = new ActionExecutor({
    store: repositories.executions,
    registry,
    maxAttempts: config.ACTION_MAX_ATTEMPTS,
    logger,
  });

  const pipeline = new Pipeline({
    gateway,
    ruleCache,
    outcomes: repositories.outcomes,
    dlq: new KafkaJsDlqPublisher(producer.producer, config.KAFKA_TOPIC_DLQ),
    events: hub,
    metrics,
    config: {
      budget: {
        stateQuestionTokenLimit: config.JEV_STATE_QUESTION_TOKEN_LIMIT,
        requestTokenLimit: config.JEV_REQUEST_TOKEN_LIMIT,
        safetyMargin: config.TOKEN_SAFETY_MARGIN,
      },
      oversize: { policy: config.OVERSIZE_POLICY, maxChunks: config.MAX_CHUNKS },
      excerptChars: config.EXCERPT_CHARS,
      persistAllEvaluations: config.PERSIST_ALL_EVALUATIONS,
      redactKeys,
    },
    onInvalidRule: async (ruleId, reason) => {
      await repositories.rules.setEnabled(ruleId, false, reason);
      ruleCache.invalidate();
    },
  });

  const consumerAdapter = new KafkaJsConsumerAdapter(kafka, {
    topic: config.KAFKA_TOPIC_RAW,
    groupId: config.KAFKA_GROUP_ID,
    fromBeginning: false,
    logger,
  });
  const consumerRunner = new ConsumerRunner(consumerAdapter, {
    onStatusChange: (status) => {
      hub.publishConsumerStatus(status);
    },
    logger,
  });

  const readiness: ReadinessDeps = {
    database: async () => {
      await pool.query('SELECT 1');
    },
    kafka: async () => {
      const admin = kafka.admin();
      await admin.connect();
      try {
        await admin.listTopics();
      } finally {
        await admin.disconnect();
      }
    },
    jevAuth: () => authState.readiness(),
  };

  const fastify = buildHttpApp({
    repositories,
    ruleCache,
    gateway,
    metrics,
    readiness,
    sseHub: hub,
    ruleTestRateLimiter: testLimiter,
    consumerLag: () => consumerAdapter.lag(),
    redactKeys,
    logger,
  });

  return {
    fastify,
    async start() {
      await executor.start(config.ACTION_EXECUTOR_INTERVAL_MS);
      hub.start();
      await consumerRunner.start((context) => pipeline.handle(context).then(() => undefined));
      await fastify.listen({ host: config.HOST, port: config.PORT });
    },
    async stop() {
      await consumerRunner.stop();
      executor.stop();
      ruleCache.stop();
      hub.stop();
      await fastify.close();
      await producer.disconnect();
      await pool.end();
    },
  };
}
