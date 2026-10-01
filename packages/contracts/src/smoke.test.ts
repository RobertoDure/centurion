import { describe, expect, it } from 'vitest';

import { CONTRACTS_PACKAGE } from './index';

describe('contracts package', () => {
  it('is importable', () => {
    expect(CONTRACTS_PACKAGE).toBe('@centurion/contracts');
  });
});
