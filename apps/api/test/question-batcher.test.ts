import type { JevQuestion } from '@centurion/contracts';
import { describe, expect, it } from 'vitest';

import { effectiveBudget, type SizeBudget } from '../src/jev/size-guard';
import { estimateTokens } from '../src/jev/token-estimator';
import { batchQuestions, type BatchableRule } from '../src/pipeline/question-batcher';

const budget: SizeBudget = { stateQuestionTokenLimit: 3000, requestTokenLimit: 6000, safetyMargin: 0.1 };
const effective = effectiveBudget(budget);

function noulRule(id: string, chars: number): BatchableRule {
  const question: JevQuestion = { type: 'noul', instructions: 'x'.repeat(chars) };
  return { id, question };
}

function assertBatchesRespectBudgets(batches: ReturnType<typeof batchQuestions>['batches'], stateTokens: number) {
  for (const batch of batches) {
    const tokens = Object.values(batch.questions).map((question) => estimateTokens(question));
    const total = tokens.reduce((sum, value) => sum + value, 0);
    const max = tokens.length === 0 ? 0 : Math.max(...tokens);
    expect(stateTokens + max).toBeLessThanOrEqual(effective.stateQuestionTokens);
    expect(stateTokens + total).toBeLessThanOrEqual(effective.requestTokens);
  }
}

describe('batchQuestions', () => {
  it('keeps small question sets in a single batch', () => {
    const rules = [noulRule('a', 30), noulRule('b', 30), noulRule('c', 30)];
    const result = batchQuestions({ stateTokens: 0, rules, budget });
    expect(result.unbatchable).toEqual([]);
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0]?.ruleIds).toEqual(['a', 'b', 'c']);
    expect(Object.keys(result.batches[0]?.questions ?? {})).toEqual(['a', 'b', 'c']);
  });

  it('splits when the request budget would be exceeded', () => {
    const rules = Array.from({ length: 8 }, (_v, i) => noulRule(`r${i}`, 2000));
    const result = batchQuestions({ stateTokens: 0, rules, budget });
    expect(result.batches.length).toBeGreaterThan(1);
    assertBatchesRespectBudgets(result.batches, 0);
  });

  it('splits when the state + longest question budget would be exceeded', () => {
    const rules = [noulRule('big', 3000), noulRule('small', 30)];
    const result = batchQuestions({ stateTokens: 1000, rules, budget });
    assertBatchesRespectBudgets(result.batches, 1000);
    const seen = result.batches.flatMap((batch) => batch.ruleIds).concat(result.unbatchable);
    expect(seen.sort()).toEqual(['big', 'small']);
  });

  it('reports a question that cannot fit with the state as unbatchable', () => {
    const result = batchQuestions({ stateTokens: effective.stateQuestionTokens, rules: [noulRule('x', 30)], budget });
    expect(result.unbatchable).toEqual(['x']);
    expect(result.batches).toEqual([]);
  });

  it('places every rule in exactly one batch or in unbatchable', () => {
    const rules = Array.from({ length: 60 }, (_v, i) => noulRule(`r${i}`, 10 + ((i * 37) % 400)));
    const stateTokens = 500;
    const result = batchQuestions({ stateTokens, rules, budget });
    assertBatchesRespectBudgets(result.batches, stateTokens);
    const placed = result.batches.flatMap((batch) => batch.ruleIds).concat(result.unbatchable);
    expect(placed).toHaveLength(rules.length);
    expect(new Set(placed).size).toBe(rules.length);
  });

  it('returns no batches for an empty rule list', () => {
    expect(batchQuestions({ stateTokens: 0, rules: [], budget })).toEqual({ batches: [], unbatchable: [] });
  });
});
