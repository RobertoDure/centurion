import {
  actionDtoSchema,
  flagSchema,
  paginationQuerySchema,
  ruleVersionSchema,
} from '@centurion/contracts';
import { z } from 'zod';

export const idParamsSchema = z.strictObject({ id: z.uuid() });

export const invalidActionSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  type: z.string(),
  invalid: z.literal(true),
  invalidReason: z.string(),
});

export const actionListResponseSchema = z.strictObject({
  items: z.array(z.union([actionDtoSchema, invalidActionSchema])),
  total: z.int().nonnegative(),
});

export const flagQuerySchema = paginationQuerySchema.extend({
  ruleId: z.uuid().optional(),
  sourceId: z.string().min(1).optional(),
  outcome: z.enum(['triggered', 'uncertain']).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export const invalidFlagSchema = z.strictObject({
  id: z.string(),
  invalid: z.literal(true),
  invalidReason: z.string(),
});

export const flagEntrySchema = z.union([flagSchema, invalidFlagSchema]);

export const flagListResponseSchema = z.strictObject({
  items: z.array(flagEntrySchema),
  limit: z.int(),
  offset: z.int(),
});

/** Valid and unreadable (corrupt JSONB) versions, mirroring RuleListEntry. */
export const ruleVersionEntrySchema = z.union([
  ruleVersionSchema,
  z.strictObject({
    ruleId: z.uuid(),
    version: z.int().nonnegative(),
    reason: z.string(),
    createdAt: z.iso.datetime({ offset: true }),
  }),
]);

export const ruleVersionListResponseSchema = z.strictObject({
  items: z.array(ruleVersionEntrySchema),
  total: z.int().nonnegative(),
});
