import { z } from 'zod';

export const ruleVerdictSchema = z.enum(['TRIGGERED', 'UNCERTAIN', 'NOT_TRIGGERED']);
export type RuleVerdict = z.infer<typeof ruleVerdictSchema>;

/** Strongest-first ordering used when combining verdicts across state chunks. */
export const RULE_VERDICT_RANK: Record<RuleVerdict, number> = {
  TRIGGERED: 2,
  UNCERTAIN: 1,
  NOT_TRIGGERED: 0,
};

export function strongestVerdict(verdicts: readonly RuleVerdict[]): RuleVerdict {
  let strongest: RuleVerdict = 'NOT_TRIGGERED';
  for (const verdict of verdicts) {
    if (RULE_VERDICT_RANK[verdict] > RULE_VERDICT_RANK[strongest]) {
      strongest = verdict;
    }
  }
  return strongest;
}
