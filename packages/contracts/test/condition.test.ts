import { describe, expect, it } from 'vitest';

import { ruleConditionSchema } from '../src';

describe('rule conditions', () => {
  it('accepts the documented valid shapes', () => {
    expect(ruleConditionSchema.safeParse({ type: 'noul', op: 'gte', threshold: 0.7 }).success).toBe(true);
    expect(
      ruleConditionSchema.safeParse({
        type: 'choice',
        anyOf: ['card_declined'],
        minProbability: 0.6,
        minConfidence: 0.5,
      }).success,
    ).toBe(true);
    expect(
      ruleConditionSchema.safeParse({ type: 'score', op: 'gte', threshold: 3, minConfidence: 0.4 }).success,
    ).toBe(true);
  });

  it('rejects a Noul threshold outside 0..1 or an unknown operator', () => {
    expect(ruleConditionSchema.safeParse({ type: 'noul', op: 'gte', threshold: 1.5 }).success).toBe(false);
    expect(ruleConditionSchema.safeParse({ type: 'noul', op: 'lt', threshold: 0.5 }).success).toBe(false);
  });

  it('rejects an empty anyOf list and out-of-range probabilities', () => {
    expect(ruleConditionSchema.safeParse({ type: 'choice', anyOf: [] }).success).toBe(false);
    expect(
      ruleConditionSchema.safeParse({ type: 'choice', anyOf: ['a'], minProbability: -1 }).success,
    ).toBe(false);
    expect(ruleConditionSchema.safeParse({ type: 'choice', anyOf: ['a'], minConfidence: 2 }).success).toBe(false);
  });

  it('rejects a negative Score threshold', () => {
    expect(ruleConditionSchema.safeParse({ type: 'score', op: 'lte', threshold: -1 }).success).toBe(false);
  });

  it('rejects minConfidence on a Noul condition (Noul has no confidence)', () => {
    expect(
      ruleConditionSchema.safeParse({ type: 'noul', op: 'gte', threshold: 0.5, minConfidence: 0.9 }).success,
    ).toBe(false);
  });
});
