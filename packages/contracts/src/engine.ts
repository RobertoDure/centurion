import type { RuleCondition } from './condition';
import type { LogEnvelope } from './envelope';
import type { JevAnswer } from './jev';
import type { RuleScope } from './rule';
import type { RuleVerdict } from './verdict';

/** The subset of a rule the engine needs. Keeps `evaluateRule` free of I/O and storage types. */
export interface RuleEvaluationInput {
  condition: RuleCondition;
}

/**
 * Evaluate one rule against one Jev answer.
 *
 * Per PLAN.md section 5.6:
 * 1. compute `wouldTrigger` from the answer alone;
 * 2. `!wouldTrigger` -> NOT_TRIGGERED;
 * 3. `wouldTrigger` with `minConfidence` set and confidence below it -> UNCERTAIN;
 * 4. otherwise -> TRIGGERED.
 *
 * An answer whose primitive does not match the condition is NOT_TRIGGERED
 * rather than an error: a malformed rule must never crash the consumer.
 */
export function evaluateRule(rule: RuleEvaluationInput, answer: JevAnswer): RuleVerdict {
  const { condition } = rule;
  switch (condition.type) {
    case 'noul': {
      if (answer.type !== 'noul') return 'NOT_TRIGGERED';
      const wouldTrigger =
        condition.op === 'gte'
          ? answer.noul >= condition.threshold
          : answer.noul <= condition.threshold;
      return wouldTrigger ? 'TRIGGERED' : 'NOT_TRIGGERED';
    }
    case 'choice': {
      if (answer.type !== 'choice') return 'NOT_TRIGGERED';
      if (!condition.anyOf.includes(answer.choice)) return 'NOT_TRIGGERED';
      if (
        condition.minProbability !== undefined &&
        (answer.probabilities[answer.choice] ?? 0) < condition.minProbability
      ) {
        return 'NOT_TRIGGERED';
      }
      if (condition.minConfidence !== undefined && answer.confidence < condition.minConfidence) {
        return 'UNCERTAIN';
      }
      return 'TRIGGERED';
    }
    case 'score': {
      if (answer.type !== 'score') return 'NOT_TRIGGERED';
      const wouldTrigger =
        condition.op === 'gte'
          ? answer.score >= condition.threshold
          : answer.score <= condition.threshold;
      if (!wouldTrigger) return 'NOT_TRIGGERED';
      if (condition.minConfidence !== undefined && answer.confidence < condition.minConfidence) {
        return 'UNCERTAIN';
      }
      return 'TRIGGERED';
    }
  }
}

export type ScopeEnvelope = Pick<LogEnvelope, 'source' | 'level'>;

/**
 * Deterministic pre-filter applied in code before any Jev call. An absent or
 * empty list means "no restriction"; a level filter excludes logs with no level.
 */
export function isInScope(scope: RuleScope | undefined, envelope: ScopeEnvelope): boolean {
  if (scope === undefined) return true;
  const sources = scope.sources;
  if (sources !== undefined && sources.length > 0 && !sources.includes(envelope.source.id)) {
    return false;
  }
  const levels = scope.levels;
  if (levels !== undefined && levels.length > 0) {
    if (envelope.level === undefined || !levels.includes(envelope.level)) return false;
  }
  return true;
}

export function selectInScope<T extends { scope: RuleScope }>(
  rules: readonly T[],
  envelope: ScopeEnvelope,
): T[] {
  return rules.filter((rule) => isInScope(rule.scope, envelope));
}
