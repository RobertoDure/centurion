import { describe, expect, it } from 'vitest';

import { ruleContentSchema, ruleSchema } from '../src';

const choiceQuestion = {
  type: 'choice' as const,
  instructions: 'What kind of failure is this?',
  criteria: { card_declined: 'The card was declined', timeout: 'A dependency timed out' },
};

function rule(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Payment failures',
    enabled: true,
    scope: { sources: ['checkout-api'], levels: ['error'] },
    question: choiceQuestion,
    condition: { type: 'choice', anyOf: ['card_declined'] },
    uncertainPolicy: 'review',
    actionIds: [],
    ...overrides,
  };
}

describe('ruleContentSchema cross-field validation', () => {
  it('accepts a consistent rule', () => {
    expect(ruleContentSchema.safeParse(rule()).success).toBe(true);
  });

  it('applies defaults', () => {
    const parsed = ruleContentSchema.parse({
      name: 'minimal',
      question: { type: 'noul', instructions: 'Is it bad?' },
      condition: { type: 'noul', op: 'gte', threshold: 0.5 },
    });
    expect(parsed.enabled).toBe(true);
    expect(parsed.uncertainPolicy).toBe('ignore');
    expect(parsed.actionIds).toEqual([]);
    expect(parsed.scope).toEqual({});
  });

  it('rejects a condition whose type does not match the question type', () => {
    const result = ruleContentSchema.safeParse(
      rule({ condition: { type: 'noul', op: 'gte', threshold: 0.5 } }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'condition.type')).toBe(true);
    }
  });

  it('rejects a Choice condition referencing an option that does not exist', () => {
    const result = ruleContentSchema.safeParse(rule({ condition: { type: 'choice', anyOf: ['nope'] } }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'condition.anyOf.0')).toBe(true);
    }
  });

  it('rejects a Score threshold above the top level', () => {
    const question = { type: 'score' as const, instructions: 'Severity?', criteria: ['low', 'medium', 'high'] };
    const ok = ruleContentSchema.safeParse(
      rule({ question, condition: { type: 'score', op: 'gte', threshold: 2 } }),
    );
    expect(ok.success).toBe(true);
    const bad = ruleContentSchema.safeParse(
      rule({ question, condition: { type: 'score', op: 'gte', threshold: 3 } }),
    );
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues.some((issue) => issue.path.join('.') === 'condition.threshold')).toBe(true);
    }
  });

  it('accepts a Noul rule and rejects one carrying minConfidence', () => {
    const question = { type: 'noul' as const, instructions: 'Is it bad?' };
    expect(
      ruleContentSchema.safeParse(rule({ question, condition: { type: 'noul', op: 'lte', threshold: 0.2 } }))
        .success,
    ).toBe(true);
    expect(
      ruleContentSchema.safeParse(
        rule({ question, condition: { type: 'noul', op: 'lte', threshold: 0.2, minConfidence: 0.5 } }),
      ).success,
    ).toBe(false);
  });
});

describe('ruleSchema (stored rule)', () => {
  it('requires a uuid id and a non-negative version', () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(ruleSchema.safeParse(rule({ id, version: 1 })).success).toBe(true);
    expect(ruleSchema.safeParse(rule({ id: 'not-a-uuid', version: 1 })).success).toBe(false);
    expect(ruleSchema.safeParse(rule({ id, version: -1 })).success).toBe(false);
    expect(ruleSchema.safeParse(rule()).success).toBe(false);
  });

  it('re-applies the cross-field rules to stored rules', () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(ruleSchema.safeParse(rule({ id, version: 1, condition: { type: 'choice', anyOf: ['ghost'] } })).success).toBe(
      false,
    );
  });
});
