import type { JevAnswer, JevQuestion } from '@centurion/contracts';
import { describe, expect, it, vi } from 'vitest';

import { JevNetworkError, JevValidationError } from '../src/jev/errors';
import type { JevGateway } from '../src/jev/gateway';
import { evaluateWithIsolation, type RuleQuestion } from '../src/jev/isolate';

function question(id: string): JevQuestion {
  return { type: 'noul', instructions: `question ${id}` };
}

function rule(id: string): RuleQuestion {
  return { ruleId: id, question: question(id) };
}

/** Gateway that rejects the whole group with 422 if any "bad" id is present. */
function fakeGateway(badIds: readonly string[]): JevGateway & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async evaluate(input) {
      const ids = Object.keys(input.questions);
      calls.push(ids);
      const offending = ids.filter((id) => badIds.includes(id));
      if (offending.length > 0) {
        throw new JevValidationError('Jev rejected the request', {
          issues: offending.map((id) => `questions.${id}: invalid`),
        });
      }
      const answers: Record<string, JevAnswer> = {};
      for (const id of ids) answers[id] = { type: 'noul', noul: 0.9 };
      return {
        model: 'jev-1.13.0',
        answers,
        usage: { inputTokens: 10, outputTokens: 2 },
      };
    },
  };
}

describe('evaluateWithIsolation', () => {
  it('evaluates everything in one request when no rule is invalid', async () => {
    const gateway = fakeGateway([]);
    const result = await evaluateWithIsolation({
      gateway,
      state: 'hello',
      rules: ['a', 'b', 'c'].map(rule),
    });
    expect(gateway.calls).toEqual([['a', 'b', 'c']]);
    expect(Object.keys(result.answers).sort()).toEqual(['a', 'b', 'c']);
    expect(result.disabledRuleIds).toEqual([]);
  });

  it('isolates one bad rule among five and evaluates the rest', async () => {
    const gateway = fakeGateway(['c']);
    const onInvalidRule = vi.fn(async (_ruleId: string, _reason: string) => {});
    const result = await evaluateWithIsolation({
      gateway,
      state: 'hello',
      rules: ['a', 'b', 'c', 'd', 'e'].map(rule),
      onInvalidRule,
    });
    expect(Object.keys(result.answers).sort()).toEqual(['a', 'b', 'd', 'e']);
    expect(result.disabledRuleIds).toEqual(['c']);
    expect(onInvalidRule).toHaveBeenCalledTimes(1);
    expect(onInvalidRule.mock.calls[0]?.[0]).toBe('c');
    expect(String(onInvalidRule.mock.calls[0]?.[1])).toContain('c');
  });

  it('isolates several bad rules', async () => {
    const gateway = fakeGateway(['b', 'e']);
    const result = await evaluateWithIsolation({
      gateway,
      state: 'hello',
      rules: ['a', 'b', 'c', 'd', 'e'].map(rule),
    });
    expect(Object.keys(result.answers).sort()).toEqual(['a', 'c', 'd']);
    expect(result.disabledRuleIds.sort()).toEqual(['b', 'e']);
  });

  it('treats a single rejected rule as invalid', async () => {
    const gateway = fakeGateway(['only']);
    const onInvalidRule = vi.fn(async (_ruleId: string, _reason: string) => {});
    const result = await evaluateWithIsolation({
      gateway,
      state: 'hello',
      rules: [rule('only')],
      onInvalidRule,
    });
    expect(result.answers).toEqual({});
    expect(result.disabledRuleIds).toEqual(['only']);
    expect(onInvalidRule).toHaveBeenCalledTimes(1);
  });

  it('propagates non-422 failures', async () => {
    const gateway: JevGateway = {
      evaluate: async () => {
        throw new JevNetworkError('down');
      },
    };
    await expect(
      evaluateWithIsolation({ gateway, state: 'x', rules: [rule('a'), rule('b')] }),
    ).rejects.toBeInstanceOf(JevNetworkError);
  });

  it('returns an empty result for no rules without calling Jev', async () => {
    const gateway = fakeGateway([]);
    const result = await evaluateWithIsolation({ gateway, state: 'x', rules: [] });
    expect(gateway.calls).toEqual([]);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});
