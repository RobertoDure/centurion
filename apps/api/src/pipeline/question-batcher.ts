import type { JevQuestion } from '@centurion/contracts';

import { effectiveBudget, type SizeBudget } from '../jev/size-guard';
import { estimateTokens } from '../jev/token-estimator';

export interface BatchableRule {
  id: string;
  question: JevQuestion;
}

export interface QuestionBatch {
  /** Question id is the rule id (PLAN.md section 7 step 5). */
  questions: Record<string, JevQuestion>;
  ruleIds: string[];
}

export interface QuestionBatcherInput {
  stateTokens: number;
  rules: readonly BatchableRule[];
  budget: SizeBudget;
}

export interface QuestionBatchResult {
  batches: QuestionBatch[];
  /** Rules whose question cannot fit alongside the state; the caller auto-disables them. */
  unbatchable: string[];
}

interface Sized {
  id: string;
  question: JevQuestion;
  tokens: number;
}

/**
 * Group rule questions into Jev requests that respect both token budgets.
 * Every rule ends up in exactly one batch or in `unbatchable`.
 */
export function batchQuestions(input: QuestionBatcherInput): QuestionBatchResult {
  const { stateTokens, rules, budget } = input;
  const { stateQuestionTokens, requestTokens } = effectiveBudget(budget);
  const batches: QuestionBatch[] = [];
  const unbatchable: string[] = [];
  let current: Sized[] = [];
  let currentTotalTokens = 0;
  let currentMaxTokens = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    batches.push({
      questions: Object.fromEntries(current.map((rule) => [rule.id, rule.question])),
      ruleIds: current.map((rule) => rule.id),
    });
    current = [];
    currentTotalTokens = 0;
    currentMaxTokens = 0;
  };

  for (const rule of rules) {
    const tokens = estimateTokens(rule.question);
    if (stateTokens + tokens > stateQuestionTokens || stateTokens + tokens > requestTokens) {
      unbatchable.push(rule.id);
      continue;
    }
    if (
      current.length > 0 &&
      (stateTokens + Math.max(currentMaxTokens, tokens) > stateQuestionTokens ||
        stateTokens + currentTotalTokens + tokens > requestTokens)
    ) {
      flush();
    }
    current.push({ id: rule.id, question: rule.question, tokens });
    currentTotalTokens += tokens;
    currentMaxTokens = Math.max(currentMaxTokens, tokens);
  }

  flush();
  return { batches, unbatchable };
}
