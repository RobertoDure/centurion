import type { JevAnswer, JevQuestion, JsonValue } from '@centurion/contracts';

import { JevValidationError } from './errors';
import type { JevGateway } from './gateway';

export interface RuleQuestion {
  ruleId: string;
  question: JevQuestion;
}

export interface IsolationResult {
  answers: Record<string, JevAnswer>;
  model: string | undefined;
  usage: { inputTokens: number; outputTokens: number };
  /** Rules Jev rejected; the caller auto-disables them with disabled_reason. */
  disabledRuleIds: string[];
}

export interface IsolationOptions {
  gateway: JevGateway;
  state: JsonValue;
  rules: readonly RuleQuestion[];
  /** Called once per irrecoverably rejected rule. */
  onInvalidRule?: (ruleId: string, reason: string) => Promise<void>;
}

interface GroupResult {
  answers: Record<string, JevAnswer>;
  model: string | undefined;
  inputTokens: number;
  outputTokens: number;
  disabled: string[];
}

function combine(left: GroupResult, right: GroupResult): GroupResult {
  return {
    answers: { ...left.answers, ...right.answers },
    model: left.model ?? right.model,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    disabled: [...left.disabled, ...right.disabled],
  };
}

/**
 * Evaluate a set of rule questions, isolating rules that Jev rejects with 422.
 *
 * PLAN.md section 7.2: bisect the question set to find the offending rule(s),
 * auto-disable them, and continue with the rest. Only JevValidationError is
 * isolated; 401/429/529 and network failures propagate to the caller.
 */
export async function evaluateWithIsolation(options: IsolationOptions): Promise<IsolationResult> {
  const { gateway, state, rules, onInvalidRule } = options;

  async function evaluateGroup(group: readonly RuleQuestion[]): Promise<GroupResult> {
    if (group.length === 0) {
      return { answers: {}, model: undefined, inputTokens: 0, outputTokens: 0, disabled: [] };
    }
    try {
      const result = await gateway.evaluate({
        state,
        questions: Object.fromEntries(group.map((rule) => [rule.ruleId, rule.question])),
      });
      return {
        answers: result.answers,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        disabled: [],
      };
    } catch (error) {
      if (!(error instanceof JevValidationError)) throw error;
      if (group.length === 1) {
        const rule = group[0];
        if (rule === undefined) {
          return { answers: {}, model: undefined, inputTokens: 0, outputTokens: 0, disabled: [] };
        }
        const reason =
          error.issues.length > 0 ? error.issues.join('; ') : 'Jev rejected the question (422)';
        await onInvalidRule?.(rule.ruleId, reason);
        return { answers: {}, model: undefined, inputTokens: 0, outputTokens: 0, disabled: [rule.ruleId] };
      }
      const mid = Math.ceil(group.length / 2);
      const left = await evaluateGroup(group.slice(0, mid));
      const right = await evaluateGroup(group.slice(mid));
      return combine(left, right);
    }
  }

  const result = await evaluateGroup(rules);
  return {
    answers: result.answers,
    model: result.model,
    usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    disabledRuleIds: result.disabled,
  };
}
