import { describe, expect, it } from 'vitest';

import { RULE_VERDICT_RANK, strongestVerdict } from '../src';

describe('strongestVerdict', () => {
  it('picks the strongest verdict regardless of order', () => {
    expect(strongestVerdict(['NOT_TRIGGERED', 'UNCERTAIN', 'TRIGGERED'])).toBe('TRIGGERED');
    expect(strongestVerdict(['TRIGGERED', 'NOT_TRIGGERED'])).toBe('TRIGGERED');
    expect(strongestVerdict(['NOT_TRIGGERED', 'UNCERTAIN'])).toBe('UNCERTAIN');
  });

  it('returns NOT_TRIGGERED for an empty list', () => {
    expect(strongestVerdict([])).toBe('NOT_TRIGGERED');
  });

  it('ranks TRIGGERED > UNCERTAIN > NOT_TRIGGERED', () => {
    expect(RULE_VERDICT_RANK.TRIGGERED).toBeGreaterThan(RULE_VERDICT_RANK.UNCERTAIN);
    expect(RULE_VERDICT_RANK.UNCERTAIN).toBeGreaterThan(RULE_VERDICT_RANK.NOT_TRIGGERED);
  });
});
