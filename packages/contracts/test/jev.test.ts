import { describe, expect, it } from 'vitest';

import {
  CHOICE_MAX_OPTIONS,
  jevAnswerSchema,
  jevApiResponseSchema,
  jevQuestionSchema,
} from '../src';

function choiceCriteria(count: number): Record<string, string> {
  return Object.fromEntries(Array.from({ length: count }, (_v, i) => [`option-${i}`, `Option ${i}`]));
}

describe('jev questions', () => {
  it('accepts a Noul question with and without criteria', () => {
    expect(
      jevQuestionSchema.safeParse({
        type: 'noul',
        instructions: 'Does the log report a failed payment?',
        criteria: { true: 'Yes', false: 'No' },
      }).success,
    ).toBe(true);
    expect(jevQuestionSchema.safeParse({ type: 'noul', instructions: 'Is it bad?' }).success).toBe(true);
  });

  it('accepts a Choice question at the option boundaries', () => {
    for (const count of [2, 3, CHOICE_MAX_OPTIONS]) {
      expect(
        jevQuestionSchema.safeParse({
          type: 'choice',
          instructions: 'Pick a failure kind',
          criteria: choiceCriteria(count),
        }).success,
      ).toBe(true);
    }
  });

  it('rejects a Choice question outside the option boundaries', () => {
    for (const count of [0, 1, CHOICE_MAX_OPTIONS + 1]) {
      expect(
        jevQuestionSchema.safeParse({
          type: 'choice',
          instructions: 'Pick a failure kind',
          criteria: choiceCriteria(count),
        }).success,
      ).toBe(false);
    }
  });

  it('accepts a Score question between 2 and 10 levels', () => {
    for (const count of [2, 5, 10]) {
      expect(
        jevQuestionSchema.safeParse({
          type: 'score',
          instructions: 'How severe is this?',
          criteria: Array.from({ length: count }, (_v, i) => `level ${i}`),
        }).success,
      ).toBe(true);
    }
  });

  it('rejects a Score question outside 2..10 levels', () => {
    for (const count of [0, 1, 11]) {
      expect(
        jevQuestionSchema.safeParse({
          type: 'score',
          instructions: 'How severe is this?',
          criteria: Array.from({ length: count }, (_v, i) => `level ${i}`),
        }).success,
      ).toBe(false);
    }
  });

  it('rejects unknown question types and stray fields', () => {
    expect(jevQuestionSchema.safeParse({ type: 'ranking', instructions: 'x', criteria: [] }).success).toBe(false);
    expect(jevQuestionSchema.safeParse({ type: 'noul', instructions: 'x', nope: 1 }).success).toBe(false);
  });
});

describe('jev answers', () => {
  it('accepts each primitive answer shape', () => {
    expect(jevAnswerSchema.safeParse({ type: 'noul', noul: 0.87 }).success).toBe(true);
    expect(
      jevAnswerSchema.safeParse({
        type: 'choice',
        choice: 'card_declined',
        probabilities: { card_declined: 0.9, other: 0.1 },
        confidence: 0.8,
      }).success,
    ).toBe(true);
    expect(
      jevAnswerSchema.safeParse({
        type: 'score',
        score: 4.2,
        legend: { '0': 'none', '5': { label: 'severe' } },
        probabilities: { '4': 0.5 },
        confidence: 0.7,
      }).success,
    ).toBe(true);
  });

  it('rejects out-of-range noul and confidence values', () => {
    expect(jevAnswerSchema.safeParse({ type: 'noul', noul: 1.2 }).success).toBe(false);
    expect(jevAnswerSchema.safeParse({ type: 'noul', noul: -0.1 }).success).toBe(false);
    expect(
      jevAnswerSchema.safeParse({ type: 'choice', choice: 'a', probabilities: {}, confidence: 2 }).success,
    ).toBe(false);
  });

  it('rejects a Noul answer carrying confidence (Noul has none)', () => {
    expect(jevAnswerSchema.safeParse({ type: 'noul', noul: 0.5, confidence: 0.9 }).success).toBe(false);
  });

  it('parses the raw API response shape with snake_case usage', () => {
    const parsed = jevApiResponseSchema.parse({
      model: 'jev-1.13.0',
      answers: { r1: { type: 'noul', noul: 0.4 } },
      usage: { input_tokens: 120, output_tokens: 5 },
    });
    expect(parsed.usage.input_tokens).toBe(120);
    expect(parsed.model).toBe('jev-1.13.0');
  });
});
