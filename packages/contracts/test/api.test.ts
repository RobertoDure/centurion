import { describe, expect, it } from 'vitest';

import {
  actionExecutionStatusSchema,
  paginationQuerySchema,
  problemDetailsSchema,
  ruleTestRequestSchema,
  sseEventSchema,
} from '../src';

describe('API DTOs', () => {
  it('defaults the problem type and validates the shape', () => {
    const parsed = problemDetailsSchema.parse({ title: 'Not Found', status: 404 });
    expect(parsed.type).toBe('about:blank');
    expect(problemDetailsSchema.safeParse({ title: 'x', status: 'nope' }).success).toBe(false);
  });

  it('coerces pagination query strings and enforces bounds', () => {
    const parsed = paginationQuerySchema.parse({ limit: '10', offset: '20' });
    expect(parsed).toEqual({ limit: 10, offset: 20 });
    expect(paginationQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
  });

  it('validates the action execution status enum', () => {
    for (const status of ['pending', 'running', 'succeeded', 'failed']) {
      expect(actionExecutionStatusSchema.safeParse(status).success).toBe(true);
    }
    expect(actionExecutionStatusSchema.safeParse('dropped').success).toBe(false);
  });

  it('rejects a dry-run request whose condition type mismatches the question', () => {
    const sample = {
      schemaVersion: 1,
      id: 'abc',
      source: { id: 'svc' },
      timestamp: '2026-10-01T10:00:00.000Z',
      payload: 'hello',
    };
    expect(
      ruleTestRequestSchema.safeParse({
        question: { type: 'noul', instructions: 'bad?' },
        condition: { type: 'noul', op: 'gte', threshold: 0.5 },
        sample,
      }).success,
    ).toBe(true);
    expect(
      ruleTestRequestSchema.safeParse({
        question: { type: 'noul', instructions: 'bad?' },
        condition: { type: 'choice', anyOf: ['x'] },
        sample,
      }).success,
    ).toBe(false);
  });

  it('parses each SSE event variant', () => {
    expect(
      sseEventSchema.safeParse({
        type: 'log.processed',
        data: {
          messageId: 'm1',
          sourceId: 'svc',
          status: 'clean',
          flagCount: 0,
          partial: false,
        },
      }).success,
    ).toBe(true);
    expect(
      sseEventSchema.safeParse({
        type: 'consumer.status',
        data: { status: 'running', at: '2026-10-01T10:00:00.000Z' },
      }).success,
    ).toBe(true);
    expect(sseEventSchema.safeParse({ type: 'unknown', data: {} }).success).toBe(false);
  });
});
