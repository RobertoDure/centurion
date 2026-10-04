import { z } from 'zod';

import { jsonValueSchema } from './json';

export const logLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
export type LogLevel = z.infer<typeof logLevelSchema>;

export const logSourceSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  environment: z.string().min(1).optional(),
});
export type LogSource = z.infer<typeof logSourceSchema>;

export const logPayloadSchema = z.union([
  z.string(),
  z.record(z.string(), jsonValueSchema),
  z.array(jsonValueSchema),
]);
export type LogPayload = z.infer<typeof logPayloadSchema>;

/** Current major version of the log envelope. Unknown majors are rejected to the DLQ. */
export const CURRENT_SCHEMA_VERSION = 1;

/** Kafka headers carried alongside every envelope. */
export const KAFKA_HEADER_SCHEMA_VERSION = 'schema-version';
export const KAFKA_HEADER_CONTENT_TYPE = 'content-type';
export const KAFKA_CONTENT_TYPE_JSON = 'application/json';

export const logEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: z.string().min(1),
  source: logSourceSchema,
  timestamp: z.iso.datetime({ offset: true }),
  level: logLevelSchema.optional(),
  payload: logPayloadSchema,
  attributes: z.record(z.string(), z.string()).optional(),
});
export type LogEnvelope = z.infer<typeof logEnvelopeSchema>;
