import { z } from 'zod';

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

export const configSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),

  KAFKA_BROKERS: z.string().default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().default('centurion-api'),
  KAFKA_GROUP_ID: z.string().default('centurion-api'),
  KAFKA_TOPIC_RAW: z.string().default('logs.raw'),
  KAFKA_TOPIC_DLQ: z.string().default('logs.dlq'),
  KAFKA_TOPIC_FLAGS: z.string().default('logs.flags'),
  KAFKA_SASL_MECHANISM: z.enum(['plain', 'scram-sha-256', 'scram-sha-512']).optional(),
  KAFKA_SASL_USERNAME: z.string().optional(),
  KAFKA_SASL_PASSWORD: z.string().optional(),
  KAFKA_SSL: booleanish.default(false),

  TYPESAFE_API_KEY: z.string().optional(),
  JEV_MODEL: z.string().default('jev-1.13.0'),
  JEV_BASE_URL: z.url().default('https://api.typesafe.ai'),
  JEV_MAX_RPS: z.coerce.number().positive().default(10),
  JEV_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  JEV_MAX_RETRIES: z.coerce.number().int().nonnegative().default(2),

  JEV_STATE_QUESTION_TOKEN_LIMIT: z.coerce.number().int().positive().default(32_000),
  JEV_REQUEST_TOKEN_LIMIT: z.coerce.number().int().positive().default(64_000),
  TOKEN_SAFETY_MARGIN: z.coerce.number().min(0).max(1).default(0.1),
  OVERSIZE_POLICY: z.enum(['chunk', 'truncate', 'reject']).default('chunk'),
  MAX_CHUNKS: z.coerce.number().int().positive().default(8),
  REDACT_KEYS: z.string().default(''),

  CONSUMER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  PERSIST_ALL_EVALUATIONS: booleanish.default(false),
  EXCERPT_CHARS: z.coerce.number().int().nonnegative().default(0),
  RULE_CACHE_REFRESH_SECONDS: z.coerce.number().int().positive().default(15),

  ACTION_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  ACTION_EXECUTOR_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  WEBHOOK_ALLOWED_HOSTS: z.string().default(''),
  SECRETS_ENCRYPTION_KEY: z.string().optional(),

  SSE_RING_BUFFER_SIZE: z.coerce.number().int().positive().default(500),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(env);
}

export function kafkaBrokers(config: Pick<AppConfig, 'KAFKA_BROKERS'>): string[] {
  return config.KAFKA_BROKERS.split(',')
    .map((broker) => broker.trim())
    .filter((broker) => broker.length > 0);
}

export function listFromCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
