import { z } from 'zod';

import { descriptionSchema } from './json';

export const CHOICE_MIN_OPTIONS = 2;
export const CHOICE_MAX_OPTIONS = 255;
export const SCORE_MIN_LEVELS = 2;
export const SCORE_MAX_LEVELS = 10;

export const noulQuestionSchema = z.strictObject({
  type: z.literal('noul'),
  instructions: descriptionSchema,
  criteria: z
    .strictObject({
      true: descriptionSchema.optional(),
      false: descriptionSchema.optional(),
    })
    .optional(),
});
export type NoulQuestion = z.infer<typeof noulQuestionSchema>;

export const choiceQuestionSchema = z.strictObject({
  type: z.literal('choice'),
  instructions: descriptionSchema,
  criteria: z
    .record(z.string(), descriptionSchema.nullable())
    .refine(
      (criteria) => {
        const size = Object.keys(criteria).length;
        return size >= CHOICE_MIN_OPTIONS && size <= CHOICE_MAX_OPTIONS;
      },
      { message: `Choice requires between ${CHOICE_MIN_OPTIONS} and ${CHOICE_MAX_OPTIONS} options` },
    ),
});
export type ChoiceQuestion = z.infer<typeof choiceQuestionSchema>;

export const scoreQuestionSchema = z.strictObject({
  type: z.literal('score'),
  instructions: descriptionSchema,
  criteria: z.array(descriptionSchema).min(SCORE_MIN_LEVELS).max(SCORE_MAX_LEVELS),
});
export type ScoreQuestion = z.infer<typeof scoreQuestionSchema>;

export const jevQuestionSchema = z.discriminatedUnion('type', [
  noulQuestionSchema,
  choiceQuestionSchema,
  scoreQuestionSchema,
]);
export type JevQuestion = z.infer<typeof jevQuestionSchema>;

export const noulAnswerSchema = z.strictObject({
  type: z.literal('noul'),
  noul: z.number().min(0).max(1),
});
export type NoulAnswer = z.infer<typeof noulAnswerSchema>;

export const choiceAnswerSchema = z.strictObject({
  type: z.literal('choice'),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number().min(0).max(1),
});
export type ChoiceAnswer = z.infer<typeof choiceAnswerSchema>;

export const scoreAnswerSchema = z.strictObject({
  type: z.literal('score'),
  score: z.number(),
  legend: z.record(z.string(), descriptionSchema),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number().min(0).max(1),
});
export type ScoreAnswer = z.infer<typeof scoreAnswerSchema>;

export const jevAnswerSchema = z.discriminatedUnion('type', [
  noulAnswerSchema,
  choiceAnswerSchema,
  scoreAnswerSchema,
]);
export type JevAnswer = z.infer<typeof jevAnswerSchema>;

/** Raw response body of `POST /v1/systemone`, exactly as the API returns it. */
export const jevApiResponseSchema = z.strictObject({
  model: z.string(),
  answers: z.record(z.string(), jevAnswerSchema),
  usage: z.strictObject({
    input_tokens: z.int().nonnegative(),
    output_tokens: z.int().nonnegative(),
  }),
});
export type JevApiResponse = z.infer<typeof jevApiResponseSchema>;

/** Domain shape returned by `JevGateway` (camelCase; mapped from the API response). */
export const jevEvaluationSchema = z.strictObject({
  model: z.string(),
  answers: z.record(z.string(), jevAnswerSchema),
  usage: z.strictObject({
    inputTokens: z.int().nonnegative(),
    outputTokens: z.int().nonnegative(),
  }),
});
export type JevEvaluation = z.infer<typeof jevEvaluationSchema>;

/** Request body of `POST /v1/systemone`. */
export const jevApiRequestSchema = z.strictObject({
  state: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]),
  model: z.string().min(1),
  questions: z.record(z.string(), jevQuestionSchema),
});
export type JevApiRequest = z.infer<typeof jevApiRequestSchema>;
