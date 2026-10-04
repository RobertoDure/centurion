import { z } from 'zod';

import { ruleConditionSchema, type RuleCondition } from './condition';
import { logLevelSchema } from './envelope';
import { type JevQuestion, jevQuestionSchema } from './jev';

export const scopeSchema = z.strictObject({
  sources: z.array(z.string().min(1)).optional(),
  levels: z.array(logLevelSchema).optional(),
});
export type RuleScope = z.infer<typeof scopeSchema>;

export const uncertainPolicySchema = z.enum(['ignore', 'review']);
export type UncertainPolicy = z.infer<typeof uncertainPolicySchema>;

export interface RuleConsistencyInput {
  question: JevQuestion;
  condition: RuleCondition;
}

/**
 * Cross-field validation shared by the UI, the REST API and every JSONB read.
 * Rules for §5.5: matching primitive type, Choice options that exist, and a
 * Score threshold within the level range.
 */
export function validateRuleConsistency(
  value: RuleConsistencyInput,
  ctx: z.RefinementCtx,
): void {
  const { question, condition } = value;
  if (question.type !== condition.type) {
    ctx.addIssue({
      code: 'custom',
      message: `condition.type "${condition.type}" must match question.type "${question.type}"`,
      path: ['condition', 'type'],
    });
    return;
  }
  if (condition.type === 'choice' && question.type === 'choice') {
    condition.anyOf.forEach((option, index) => {
      if (!Object.prototype.hasOwnProperty.call(question.criteria, option)) {
        ctx.addIssue({
          code: 'custom',
          message: `anyOf[${index}] "${option}" is not an option of the Choice question`,
          path: ['condition', 'anyOf', index],
        });
      }
    });
  }
  if (condition.type === 'score' && question.type === 'score') {
    const topLevel = question.criteria.length - 1;
    if (condition.threshold > topLevel) {
      ctx.addIssue({
        code: 'custom',
        message: `threshold ${condition.threshold} is above the top score level ${topLevel}`,
        path: ['condition', 'threshold'],
      });
    }
  }
}

/** A rule as sent by clients (no server-assigned id/version). */
export const ruleContentObjectSchema = z.strictObject({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  enabled: z.boolean().default(true),
  scope: scopeSchema.default({}),
  question: jevQuestionSchema,
  condition: ruleConditionSchema,
  uncertainPolicy: uncertainPolicySchema.default('ignore'),
  actionIds: z.array(z.uuid()).default([]),
});
export type RuleContent = z.infer<typeof ruleContentObjectSchema>;

export const ruleContentSchema = ruleContentObjectSchema.superRefine(validateRuleConsistency);

/** A rule as stored and returned by the API. */
export const ruleObjectSchema = ruleContentObjectSchema.extend({
  id: z.uuid(),
  version: z.int().nonnegative(),
  disabledReason: z.string().optional(),
  createdAt: z.iso.datetime({ offset: true }).optional(),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
});
export type Rule = z.infer<typeof ruleObjectSchema>;

export const ruleSchema = ruleObjectSchema.superRefine(validateRuleConsistency);

export const ruleVersionSchema = z.strictObject({
  ruleId: z.uuid(),
  version: z.int().nonnegative(),
  snapshot: ruleObjectSchema,
  createdAt: z.iso.datetime({ offset: true }),
});
export type RuleVersion = z.infer<typeof ruleVersionSchema>;
