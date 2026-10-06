import { describe, expect, it } from 'vitest';

import {
  evaluateRule,
  isInScope,
  selectInScope,
  type ChoiceAnswer,
  type NoulAnswer,
  type RuleScope,
  type ScoreAnswer,
} from '../src';

const noul = (value: number): NoulAnswer => ({ type: 'noul', noul: value });
const choice = (
  picked: string,
  probabilities: Record<string, number> = {},
  confidence = 1,
): ChoiceAnswer => ({ type: 'choice', choice: picked, probabilities, confidence });
const score = (value: number, confidence = 1): ScoreAnswer => ({
  type: 'score',
  score: value,
  legend: {},
  probabilities: {},
  confidence,
});

describe('evaluateRule / Noul', () => {
  it.each([
    ['gte above', { type: 'noul', op: 'gte', threshold: 0.5 } as const, noul(0.9), 'TRIGGERED'],
    ['gte equal', { type: 'noul', op: 'gte', threshold: 0.5 } as const, noul(0.5), 'TRIGGERED'],
    ['gte below', { type: 'noul', op: 'gte', threshold: 0.5 } as const, noul(0.49), 'NOT_TRIGGERED'],
    ['lte equal', { type: 'noul', op: 'lte', threshold: 0.3 } as const, noul(0.3), 'TRIGGERED'],
    ['lte above', { type: 'noul', op: 'lte', threshold: 0.3 } as const, noul(0.31), 'NOT_TRIGGERED'],
    ['extreme 0', { type: 'noul', op: 'lte', threshold: 0 } as const, noul(0), 'TRIGGERED'],
    ['extreme 1', { type: 'noul', op: 'gte', threshold: 1 } as const, noul(1), 'TRIGGERED'],
  ])('%s', (_name, condition, answer, expected) => {
    expect(evaluateRule({ condition }, answer)).toBe(expected);
  });

  it('never returns UNCERTAIN for Noul even when a threshold passes', () => {
    expect(evaluateRule({ condition: { type: 'noul', op: 'gte', threshold: 0.5 } }, noul(0.6))).toBe(
      'TRIGGERED',
    );
  });
});

describe('evaluateRule / Choice', () => {
  it('triggers when the choice is listed', () => {
    expect(evaluateRule({ condition: { type: 'choice', anyOf: ['a', 'b'] } }, choice('a'))).toBe('TRIGGERED');
  });

  it('does not trigger when the choice is not listed', () => {
    expect(evaluateRule({ condition: { type: 'choice', anyOf: ['a'] } }, choice('c'))).toBe('NOT_TRIGGERED');
  });

  it.each([
    ['equal', 0.6, 'TRIGGERED'],
    ['above', 0.61, 'TRIGGERED'],
    ['below', 0.59, 'NOT_TRIGGERED'],
  ] as const)('minProbability %s', (_name, probability, expected) => {
    expect(
      evaluateRule(
        { condition: { type: 'choice', anyOf: ['a'], minProbability: 0.6 } },
        choice('a', { a: probability }),
      ),
    ).toBe(expected);
  });

  it('treats a missing probability as zero', () => {
    expect(
      evaluateRule({ condition: { type: 'choice', anyOf: ['a'], minProbability: 0.1 } }, choice('a', {})),
    ).toBe('NOT_TRIGGERED');
  });

  it.each([
    ['equal', 0.5, 'TRIGGERED'],
    ['above', 0.8, 'TRIGGERED'],
    ['below', 0.49, 'UNCERTAIN'],
  ] as const)('minConfidence %s', (_name, confidence, expected) => {
    expect(
      evaluateRule(
        { condition: { type: 'choice', anyOf: ['a'], minConfidence: 0.5 } },
        choice('a', { a: 1 }, confidence),
      ),
    ).toBe(expected);
  });

  it('does not reach confidence when the choice or probability fails', () => {
    expect(
      evaluateRule(
        { condition: { type: 'choice', anyOf: ['a'], minProbability: 0.9, minConfidence: 0.9 } },
        choice('a', { a: 0.1 }, 0.1),
      ),
    ).toBe('NOT_TRIGGERED');
  });
});

describe('evaluateRule / Score', () => {
  it.each([
    ['gte equal', { type: 'score', op: 'gte', threshold: 3 } as const, score(3), 'TRIGGERED'],
    ['gte above', { type: 'score', op: 'gte', threshold: 3 } as const, score(4.2), 'TRIGGERED'],
    ['gte below', { type: 'score', op: 'gte', threshold: 3 } as const, score(2.9), 'NOT_TRIGGERED'],
    ['lte equal', { type: 'score', op: 'lte', threshold: 1 } as const, score(1), 'TRIGGERED'],
    ['lte above', { type: 'score', op: 'lte', threshold: 1 } as const, score(1.1), 'NOT_TRIGGERED'],
  ])('%s', (_name, condition, answer, expected) => {
    expect(evaluateRule({ condition }, answer)).toBe(expected);
  });

  it.each([
    ['equal', 0.5, 'TRIGGERED'],
    ['below', 0.4, 'UNCERTAIN'],
  ] as const)('minConfidence %s', (_name, confidence, expected) => {
    expect(
      evaluateRule({ condition: { type: 'score', op: 'gte', threshold: 2, minConfidence: 0.5 } }, score(3, confidence)),
    ).toBe(expected);
  });

  it('does not reach confidence when the score fails', () => {
    expect(
      evaluateRule({ condition: { type: 'score', op: 'gte', threshold: 2, minConfidence: 0.5 } }, score(1, 0.1)),
    ).toBe('NOT_TRIGGERED');
  });
});

describe('evaluateRule / primitive mismatch', () => {
  it.each([
    [{ type: 'noul', op: 'gte', threshold: 0.5 } as const, choice('a')],
    [{ type: 'noul', op: 'gte', threshold: 0.5 } as const, score(5)],
    [{ type: 'choice', anyOf: ['a'] } as const, noul(0.9)],
    [{ type: 'choice', anyOf: ['a'] } as const, score(5)],
    [{ type: 'score', op: 'gte', threshold: 2 } as const, noul(0.9)],
    [{ type: 'score', op: 'gte', threshold: 2 } as const, choice('a')],
  ])('returns NOT_TRIGGERED instead of throwing', (condition, answer) => {
    expect(evaluateRule({ condition }, answer)).toBe('NOT_TRIGGERED');
  });
});

describe('scope filtering', () => {
  const envelope = { source: { id: 'checkout-api' }, level: 'error' as const };

  it('includes everything when scope is absent or empty', () => {
    expect(isInScope(undefined, envelope)).toBe(true);
    expect(isInScope({}, envelope)).toBe(true);
    expect(isInScope({ sources: [], levels: [] }, envelope)).toBe(true);
  });

  it('filters by source id', () => {
    expect(isInScope({ sources: ['checkout-api'] }, envelope)).toBe(true);
    expect(isInScope({ sources: ['search-api'] }, envelope)).toBe(false);
  });

  it('filters by level', () => {
    expect(isInScope({ levels: ['error', 'fatal'] }, envelope)).toBe(true);
    expect(isInScope({ levels: ['info'] }, envelope)).toBe(false);
  });

  it('excludes logs with no level when a level filter is set', () => {
    expect(isInScope({ levels: ['info'] }, { source: { id: 's' } })).toBe(false);
  });

  it('selectInScope keeps only matching rules and preserves order', () => {
    const rules: Array<{ id: string; scope: RuleScope }> = [
      { id: 'a', scope: {} },
      { id: 'b', scope: { sources: ['search-api'] } },
      { id: 'c', scope: { levels: ['error'] } },
      { id: 'd', scope: { sources: ['checkout-api'], levels: ['error'] } },
    ];
    expect(selectInScope(rules, envelope).map((rule) => rule.id)).toEqual(['a', 'c', 'd']);
  });
});
