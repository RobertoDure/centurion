import { describe, expect, it } from 'vitest';

import {
  estimateTokens,
  serializedLength,
  TokenCalibrator,
  TOKENS_PER_CHAR_DIVISOR,
} from '../src/jev/token-estimator';

describe('token estimation', () => {
  it('uses the string length directly and JSON length for other values', () => {
    expect(serializedLength('abcd')).toBe(4);
    expect(serializedLength({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length);
    expect(serializedLength(undefined)).toBe(0);
  });

  it('rounds up chars/3', () => {
    expect(TOKENS_PER_CHAR_DIVISOR).toBe(3);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(2);
    expect(estimateTokens('a'.repeat(810))).toBe(270);
  });

  it('supports a custom divisor and rejects invalid ones', () => {
    expect(estimateTokens('a'.repeat(10), 5)).toBe(2);
    expect(() => estimateTokens('x', 0)).toThrow();
    expect(() => estimateTokens('x', Number.NaN)).toThrow();
  });
});

describe('TokenCalibrator', () => {
  it('reports no ratio before the first sample', () => {
    expect(new TokenCalibrator().snapshot()).toEqual({
      samples: 0,
      estimatedTokens: 0,
      actualTokens: 0,
      ratio: null,
    });
  });

  it('accumulates the estimate/actual ratio', () => {
    const calibrator = new TokenCalibrator();
    calibrator.record(100, 120);
    calibrator.record(100, 80);
    const snapshot = calibrator.snapshot();
    expect(snapshot.samples).toBe(2);
    expect(snapshot.estimatedTokens).toBe(200);
    expect(snapshot.actualTokens).toBe(200);
    expect(snapshot.ratio).toBe(1);
  });

  it('ignores negative samples', () => {
    const calibrator = new TokenCalibrator();
    calibrator.record(-1, 5);
    expect(calibrator.snapshot().samples).toBe(0);
  });
});
