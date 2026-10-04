import { z } from 'zod';

import { actionDtoSchema } from './action';
import { ruleConditionSchema } from './condition';
import { logEnvelopeSchema } from './envelope';
import { jevAnswerSchema, jevQuestionSchema } from './jev';
import {
  ruleObjectSchema,
  uncertainPolicySchema,
  validateRuleConsistency,
} from './rule';
import { ruleVerdictSchema } from './verdict';

export const flagOutcomeSchema = z.enum(['triggered', 'uncertain']);
export type FlagOutcome = z.infer<typeof flagOutcomeSchema>;

export const actionExecutionStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed']);
export type ActionExecutionStatus = z.infer<typeof actionExecutionStatusSchema>;

export const evaluationStatusSchema = z.enum(['clean', 'flagged', 'uncertain', 'error', 'partial']);
export type EvaluationStatus = z.infer<typeof evaluationStatusSchema>;

export const validationIssueSchema = z.strictObject({
  path: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

/** RFC 9457 problem+json error body. */
export const problemDetailsSchema = z.strictObject({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(validationIssueSchema).optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const ruleDtoSchema = ruleObjectSchema
  .extend({
    invalid: z.boolean().default(false),
    invalidReason: z.string().optional(),
  })
  .superRefine(validateRuleConsistency);
export type RuleDto = z.infer<typeof ruleDtoSchema>;

export const ruleListResponseSchema = z.strictObject({
  items: z.array(ruleDtoSchema),
  total: z.int().nonnegative(),
});
export type RuleListResponse = z.infer<typeof ruleListResponseSchema>;

export const flagSchema = z.strictObject({
  id: z.uuid(),
  messageId: z.string(),
  ruleId: z.uuid(),
  ruleVersion: z.int().nonnegative(),
  outcome: flagOutcomeSchema,
  answer: jevAnswerSchema,
  sourceId: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type Flag = z.infer<typeof flagSchema>;

export const evaluationSchema = z.strictObject({
  messageId: z.string(),
  sourceId: z.string(),
  topic: z.string(),
  partition: z.int().nonnegative(),
  offset: z.string(),
  model: z.string().optional(),
  tokenEstimate: z.int().nonnegative().optional(),
  partial: z.boolean(),
  status: evaluationStatusSchema,
  excerpt: z.string().optional(),
  createdAt: z.iso.datetime({ offset: true }).optional(),
});
export type Evaluation = z.infer<typeof evaluationSchema>;

export const actionExecutionSchema = z.strictObject({
  id: z.uuid(),
  flagId: z.uuid(),
  actionId: z.uuid(),
  status: actionExecutionStatusSchema,
  attempts: z.int().nonnegative(),
  nextAttemptAt: z.iso.datetime({ offset: true }).optional(),
  lastError: z.string().optional(),
});
export type ActionExecution = z.infer<typeof actionExecutionSchema>;

export const paginationQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const ruleTestRequestSchema = z
  .strictObject({
    question: jevQuestionSchema,
    condition: ruleConditionSchema,
    uncertainPolicy: uncertainPolicySchema.default('ignore'),
    sample: logEnvelopeSchema,
  })
  .superRefine(validateRuleConsistency);
export type RuleTestRequest = z.infer<typeof ruleTestRequestSchema>;

export const ruleTestResponseSchema = z.strictObject({
  answer: jevAnswerSchema,
  verdict: ruleVerdictSchema,
  model: z.string(),
  usage: z.strictObject({
    inputTokens: z.int().nonnegative(),
    outputTokens: z.int().nonnegative(),
  }),
});
export type RuleTestResponse = z.infer<typeof ruleTestResponseSchema>;

export const healthResponseSchema = z.strictObject({ status: z.literal('ok') });

export const readinessCheckSchema = z.strictObject({
  name: z.string(),
  ok: z.boolean(),
  detail: z.string().optional(),
});
export type ReadinessCheck = z.infer<typeof readinessCheckSchema>;

export const readyResponseSchema = z.strictObject({
  status: z.enum(['ready', 'not_ready']),
  checks: z.array(readinessCheckSchema),
});
export type ReadyResponse = z.infer<typeof readyResponseSchema>;

export { actionDtoSchema };
