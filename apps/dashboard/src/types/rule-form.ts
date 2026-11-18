import type { RuleCondition, RuleScope, UncertainPolicy } from '@centurion/contracts';

export type NoulCondition = Extract<RuleCondition, { type: 'noul' }>;
export type ChoiceCondition = Extract<RuleCondition, { type: 'choice' }>;
export type ScoreCondition = Extract<RuleCondition, { type: 'score' }>;

/**
 * The form carries a slightly wider Noul condition than the contract so a stale
 * `minConfidence` (for example after switching question type) can be represented
 * and rejected by the shared schema on submit.
 */
export type NoulConditionDraft = NoulCondition & { minConfidence?: number };
export type ConditionDraft = NoulConditionDraft | ChoiceCondition | ScoreCondition;

/**
 * Form-side question types keep every Description as a plain string. The UI only
 * edits text, and the non-recursive shape keeps react-hook-form's path types sane.
 * They are structurally assignable to the contract JevQuestion.
 */
export interface NoulQuestionForm {
  type: 'noul';
  instructions: string;
  criteria?: { true?: string; false?: string };
}

export interface ChoiceQuestionForm {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string | null>;
}

export interface ScoreQuestionForm {
  type: 'score';
  instructions: string;
  criteria: string[];
}

export type QuestionForm = NoulQuestionForm | ChoiceQuestionForm | ScoreQuestionForm;

export interface RuleFormValues {
  name: string;
  description?: string;
  enabled: boolean;
  scope: RuleScope;
  question: QuestionForm;
  condition: ConditionDraft;
  uncertainPolicy: UncertainPolicy;
  actionIds: string[];
}
