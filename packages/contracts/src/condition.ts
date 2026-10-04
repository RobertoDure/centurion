import { z } from 'zod';

export const noulConditionSchema = z.strictObject({
  type: z.literal('noul'),
  op: z.enum(['gte', 'lte']),
  threshold: z.number().min(0).max(1),
});
export type NoulCondition = z.infer<typeof noulConditionSchema>;

export const choiceConditionSchema = z.strictObject({
  type: z.literal('choice'),
  anyOf: z.array(z.string().min(1)).min(1),
  minProbability: z.number().min(0).max(1).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
});
export type ChoiceCondition = z.infer<typeof choiceConditionSchema>;

export const scoreConditionSchema = z.strictObject({
  type: z.literal('score'),
  op: z.enum(['gte', 'lte']),
  threshold: z.number().min(0),
  minConfidence: z.number().min(0).max(1).optional(),
});
export type ScoreCondition = z.infer<typeof scoreConditionSchema>;

export const ruleConditionSchema = z.discriminatedUnion('type', [
  noulConditionSchema,
  choiceConditionSchema,
  scoreConditionSchema,
]);
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

export const ruleOpSchema = z.enum(['gte', 'lte']);
export type RuleOp = z.infer<typeof ruleOpSchema>;
