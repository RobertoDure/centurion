import { z } from 'zod';

import { logEnvelopeSchema } from './envelope';

/**
 * JSON Schema (2020-12) for the log envelope, so producers in other languages
 * can validate what they publish to `logs.raw`.
 */
export const logEnvelopeJsonSchema = z.toJSONSchema(logEnvelopeSchema, {
  target: 'draft-2020-12',
});

export function toJsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, { target: 'draft-2020-12' });
}
