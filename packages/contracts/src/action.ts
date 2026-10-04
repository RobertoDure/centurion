import { z } from 'zod';

import { logSourceSchema } from './envelope';
import { jevAnswerSchema } from './jev';

export const actionTypeSchema = z.enum(['webhook', 'kafka_topic']);
export type ActionType = z.infer<typeof actionTypeSchema>;

export const webhookConfigSchema = z.strictObject({
  url: z.url(),
  /** Write-only over the API: accepted on writes, never returned on reads. */
  secret: z.string().min(1).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.int().positive().max(60_000).default(10_000),
});
export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

export const kafkaTopicConfigSchema = z.strictObject({
  topic: z.string().min(1),
  brokers: z.array(z.string().min(1)).optional(),
});
export type KafkaTopicConfig = z.infer<typeof kafkaTopicConfigSchema>;

const actionCommon = {
  name: z.string().min(1).max(200),
  enabled: z.boolean().default(true),
};

/** An action as sent by clients. `config` is discriminated by `type`. */
export const actionContentSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('webhook'), ...actionCommon, config: webhookConfigSchema }),
  z.strictObject({ type: z.literal('kafka_topic'), ...actionCommon, config: kafkaTopicConfigSchema }),
]);
export type ActionContent = z.infer<typeof actionContentSchema>;

/** An action as stored and returned by the API (secrets stripped before sending). */
export const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({ id: z.uuid(), type: z.literal('webhook'), ...actionCommon, config: webhookConfigSchema }),
  z.strictObject({ id: z.uuid(), type: z.literal('kafka_topic'), ...actionCommon, config: kafkaTopicConfigSchema }),
]);
export type ActionDefinition = z.infer<typeof actionSchema>;

/** A `webhook` action as the API returns it, with the secret omitted. */
export const actionDtoSchema = z.discriminatedUnion('type', [
  z.strictObject({
    id: z.uuid(),
    type: z.literal('webhook'),
    ...actionCommon,
    config: webhookConfigSchema.omit({ secret: true }),
    hasSecret: z.boolean(),
  }),
  z.strictObject({
    id: z.uuid(),
    type: z.literal('kafka_topic'),
    ...actionCommon,
    config: kafkaTopicConfigSchema,
    hasSecret: z.literal(false).default(false),
  }),
]);
export type ActionDto = z.infer<typeof actionDtoSchema>;

export const messageRefSchema = z.strictObject({
  topic: z.string().min(1),
  partition: z.int().nonnegative(),
  offset: z.string().min(1),
});
export type MessageRef = z.infer<typeof messageRefSchema>;

/** Body delivered to every action handler. */
export const actionPayloadSchema = z.strictObject({
  flagId: z.uuid(),
  rule: z.strictObject({
    id: z.uuid(),
    name: z.string(),
    version: z.int().nonnegative(),
  }),
  source: logSourceSchema,
  messageRef: messageRefSchema,
  answer: jevAnswerSchema,
  triggeredAt: z.iso.datetime({ offset: true }),
  excerpt: z.string().optional(),
});
export type ActionPayload = z.infer<typeof actionPayloadSchema>;
