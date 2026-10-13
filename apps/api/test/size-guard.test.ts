import type { JsonValue } from '@centurion/contracts';
import { describe, expect, it } from 'vitest';

import {
  applyOversizePolicy,
  effectiveBudget,
  requestFitsBudget,
  stateFitsBudget,
  textWindows,
  type SizeBudget,
} from '../src/jev/size-guard';
import { estimateTokens } from '../src/jev/token-estimator';

// Effective budget: 270 tokens for state + longest question, 540 for the request.
const budget: SizeBudget = { stateQuestionTokenLimit: 300, requestTokenLimit: 600, safetyMargin: 0.1 };
const limit = effectiveBudget(budget).stateQuestionTokens;

describe('budgets', () => {
  it('applies the safety margin with floor', () => {
    expect(effectiveBudget({ stateQuestionTokenLimit: 101, requestTokenLimit: 55, safetyMargin: 0.1 })).toEqual({
      stateQuestionTokens: 90,
      requestTokens: 49,
    });
  });

  it('checks state and request budgets inclusively', () => {
    expect(stateFitsBudget(270, 0, budget)).toBe(true);
    expect(stateFitsBudget(271, 0, budget)).toBe(false);
    expect(stateFitsBudget(260, 10, budget)).toBe(true);
    expect(stateFitsBudget(260, 11, budget)).toBe(false);
    expect(requestFitsBudget(540, 0, budget)).toBe(true);
    expect(requestFitsBudget(541, 0, budget)).toBe(false);
  });
});

describe('textWindows', () => {
  it('returns the text unchanged when it fits', () => {
    expect(textWindows('abc', 10)).toEqual({ chunks: ['abc'], partial: false });
  });

  it('overlaps adjacent windows', () => {
    const { chunks } = textWindows('a'.repeat(1000), 100, 30);
    expect(chunks.length).toBeGreaterThan(1);
    const first = chunks[0] ?? '';
    const second = chunks[1] ?? '';
    expect(second.slice(0, 30)).toBe(first.slice(first.length - 30));
  });
});

describe('applyOversizePolicy / fits boundary', () => {
  it('fits at and below the effective limit', () => {
    const atLimit = 'a'.repeat(limit * 3);
    expect(estimateTokens(atLimit)).toBe(limit);
    expect(applyOversizePolicy(atLimit, budget, { policy: 'chunk', maxChunks: 8 })).toEqual({
      kind: 'fits',
      state: atLimit,
      stateTokens: limit,
    });

    const justUnder = 'a'.repeat(limit * 3 - 1);
    expect(applyOversizePolicy(justUnder, budget, { policy: 'chunk', maxChunks: 8 }).kind).toBe('fits');
  });

  it('applies the policy just over the effective limit', () => {
    const justOver = 'a'.repeat(limit * 3 + 1);
    expect(applyOversizePolicy(justOver, budget, { policy: 'chunk', maxChunks: 8 }).kind).toBe('chunked');
  });
});

describe('applyOversizePolicy / chunk', () => {
  it('splits a long string into windows that each fit', () => {
    const state = 'a'.repeat(limit * 3 + 1);
    const result = applyOversizePolicy(state, budget, { policy: 'chunk', maxChunks: 8 });
    expect(result.kind).toBe('chunked');
    if (result.kind !== 'chunked') return;
    expect(result.chunks.length).toBe(2);
    expect(result.partial).toBe(false);
    for (const chunk of result.chunks) {
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(limit);
    }
  });

  it('marks partial=true when MAX_CHUNKS truncates the window set', () => {
    const state = 'a'.repeat(limit * 3 * 5);
    const result = applyOversizePolicy(state, budget, { policy: 'chunk', maxChunks: 1 });
    expect(result.kind).toBe('chunked');
    if (result.kind !== 'chunked') return;
    expect(result.chunks).toHaveLength(1);
    expect(result.partial).toBe(true);
  });

  it('packs array elements, overlapping adjacent chunks and preserving the ends', () => {
    const items: JsonValue[] = Array.from({ length: 40 }, (_v, i) => `item-${i}-${'x'.repeat(40)}`);
    const result = applyOversizePolicy(items, budget, { policy: 'chunk', maxChunks: 100 });
    expect(result.kind).toBe('chunked');
    if (result.kind !== 'chunked') return;
    expect(result.chunks.length).toBeGreaterThan(1);
    for (const chunk of result.chunks) {
      expect(Array.isArray(chunk)).toBe(true);
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(limit);
    }
    const firstChunk = result.chunks[0];
    expect(Array.isArray(firstChunk) ? firstChunk[0] : undefined).toBe(items[0]);
    for (let i = 0; i < result.chunks.length - 1; i += 1) {
      const current = result.chunks[i] as JsonValue[];
      const next = result.chunks[i + 1] as JsonValue[];
      expect(next[0]).toBe(current[current.length - 1]);
    }
    const last = result.chunks[result.chunks.length - 1] as JsonValue[];
    expect(last[last.length - 1]).toBe(items[items.length - 1]);
  });

  it('packs object entries, overlapping keys and preserving the ends', () => {
    const entries: Array<[string, JsonValue]> = Array.from({ length: 40 }, (_v, i) => [
      `key-${i}`,
      `value-${i}-${'y'.repeat(40)}`,
    ]);
    const result = applyOversizePolicy(Object.fromEntries(entries), budget, {
      policy: 'chunk',
      maxChunks: 100,
    });
    expect(result.kind).toBe('chunked');
    if (result.kind !== 'chunked') return;
    for (const chunk of result.chunks) {
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(limit);
    }
    const firstKeys = Object.keys(result.chunks[0] as Record<string, JsonValue>);
    expect(firstKeys[0]).toBe('key-0');
    const lastChunk = result.chunks[result.chunks.length - 1] as Record<string, JsonValue>;
    expect(Object.keys(lastChunk).at(-1)).toBe('key-39');
  });

  it('emits text windows for a single element too large to fit', () => {
    const huge = `huge-${'z'.repeat(limit * 3)}`;
    const result = applyOversizePolicy([huge], budget, { policy: 'chunk', maxChunks: 8 });
    expect(result.kind).toBe('chunked');
    if (result.kind !== 'chunked') return;
    expect(result.chunks.length).toBeGreaterThan(1);
    for (const chunk of result.chunks) {
      expect(typeof chunk).toBe('string');
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(limit);
    }
  });
});

describe('applyOversizePolicy / truncate and reject', () => {
  it('keeps head and tail and marks partial', () => {
    const state = { message: 'a'.repeat(limit * 3) };
    const result = applyOversizePolicy(state, budget, { policy: 'truncate', maxChunks: 8 });
    expect(result.kind).toBe('truncated');
    if (result.kind !== 'truncated') return;
    expect(result.partial).toBe(true);
    expect(typeof result.state).toBe('string');
    expect(result.stateTokens).toBeLessThanOrEqual(limit);
    expect(result.state as string).toContain('...');
  });

  it('rejects with an OVERSIZE reason', () => {
    const state = 'a'.repeat(limit * 3 + 1);
    expect(applyOversizePolicy(state, budget, { policy: 'reject', maxChunks: 8 })).toEqual({
      kind: 'rejected',
      reason: 'OVERSIZE',
      stateTokens: estimateTokens(state),
    });
  });
});
