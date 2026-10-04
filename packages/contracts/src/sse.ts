import { z } from 'zod';

import { flagSchema, type Flag } from './api';
import { logLevelSchema } from './envelope';

export const consumerStatusSchema = z.enum(['running', 'paused', 'stopped', 'degraded', 'error']);
export type ConsumerStatus = z.infer<typeof consumerStatusSchema>;

export const logProcessedStatusSchema = z.enum([
  'clean',
  'flagged',
  'uncertain',
  'error',
  'partial',
]);
export type LogProcessedStatus = z.infer<typeof logProcessedStatusSchema>;

export const logProcessedDataSchema = z.strictObject({
  messageId: z.string(),
  sourceId: z.string(),
  level: logLevelSchema.optional(),
  status: logProcessedStatusSchema,
  flagCount: z.int().nonnegative(),
  partial: z.boolean(),
  model: z.string().optional(),
});
export type LogProcessedData = z.infer<typeof logProcessedDataSchema>;

export const flagCreatedDataSchema = flagSchema;
export type FlagCreatedData = Flag;

export const consumerStatusDataSchema = z.strictObject({
  status: consumerStatusSchema,
  detail: z.string().optional(),
  lag: z.number().nonnegative().optional(),
  at: z.iso.datetime({ offset: true }),
});
export type ConsumerStatusData = z.infer<typeof consumerStatusDataSchema>;

export const logProcessedEventSchema = z.strictObject({
  type: z.literal('log.processed'),
  data: logProcessedDataSchema,
});
export const flagCreatedEventSchema = z.strictObject({
  type: z.literal('flag.created'),
  data: flagCreatedDataSchema,
});
export const consumerStatusEventSchema = z.strictObject({
  type: z.literal('consumer.status'),
  data: consumerStatusDataSchema,
});

export const sseEventSchema = z.discriminatedUnion('type', [
  logProcessedEventSchema,
  flagCreatedEventSchema,
  consumerStatusEventSchema,
]);
export type SseEvent = z.infer<typeof sseEventSchema>;
export type SseEventName = SseEvent['type'];
