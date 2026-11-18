import { describe, expect, it } from 'vitest';

import { ApiError } from './client';
import { rulesApi } from './rules';

describe('api client', () => {
  it('parses a valid rule list response with the contracts schema', async () => {
    const response = await rulesApi.list();
    expect(response.total).toBe(3);
    expect(response.items).toHaveLength(3);
    expect(response.items.map((rule) => rule.question.type).sort()).toEqual([
      'choice',
      'noul',
      'score',
    ]);
  });

  it('surfaces problem+json errors as ApiError', async () => {
    const error = await rulesApi.get('missing').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    if (error instanceof ApiError) {
      expect(error.status).toBe(404);
      expect(error.problem.title).toBe('Rule not found');
    }
  });
});
