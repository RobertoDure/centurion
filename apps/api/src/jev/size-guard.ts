import type { JsonValue } from '@centurion/contracts';

import { estimateTokens, TOKENS_PER_CHAR_DIVISOR } from './token-estimator';

export type OversizePolicy = 'chunk' | 'truncate' | 'reject';

export interface SizeBudget {
  /** JEV_STATE_QUESTION_TOKEN_LIMIT: state + the longest single question. */
  stateQuestionTokenLimit: number;
  /** JEV_REQUEST_TOKEN_LIMIT: state + every question in one request. */
  requestTokenLimit: number;
  /** TOKEN_SAFETY_MARGIN, 0..1. */
  safetyMargin: number;
}

export const DEFAULT_SIZE_BUDGET: SizeBudget = {
  stateQuestionTokenLimit: 32_000,
  requestTokenLimit: 64_000,
  safetyMargin: 0.1,
};

export interface EffectiveBudget {
  stateQuestionTokens: number;
  requestTokens: number;
}

export function effectiveBudget(budget: SizeBudget): EffectiveBudget {
  return {
    stateQuestionTokens: Math.floor(budget.stateQuestionTokenLimit * (1 - budget.safetyMargin)),
    requestTokens: Math.floor(budget.requestTokenLimit * (1 - budget.safetyMargin)),
  };
}

export function stateFitsBudget(
  stateTokens: number,
  maxQuestionTokens: number,
  budget: SizeBudget,
): boolean {
  return stateTokens + maxQuestionTokens <= effectiveBudget(budget).stateQuestionTokens;
}

export function requestFitsBudget(
  stateTokens: number,
  totalQuestionTokens: number,
  budget: SizeBudget,
): boolean {
  return stateTokens + totalQuestionTokens <= effectiveBudget(budget).requestTokens;
}

export interface OversizeOptions {
  policy: OversizePolicy;
  maxChunks: number;
  /** Characters repeated between adjacent text chunks. Default 64. */
  overlapChars?: number;
}

export type OversizeResult =
  | { kind: 'fits'; state: JsonValue; stateTokens: number }
  | { kind: 'chunked'; chunks: JsonValue[]; stateTokens: number; partial: boolean }
  | { kind: 'truncated'; state: JsonValue; stateTokens: number; partial: true }
  | { kind: 'rejected'; reason: 'OVERSIZE'; stateTokens: number };

/** Split a long string into windows that each fit the token limit. */
export function textWindows(
  text: string,
  tokenLimit: number,
  overlapChars = 0,
): { chunks: string[]; partial: boolean } {
  const maxChars = Math.max(1, tokenLimit * TOKENS_PER_CHAR_DIVISOR);
  const overlap = Math.max(0, Math.min(overlapChars, maxChars - 1));
  const step = Math.max(1, maxChars - overlap);
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += step) {
    chunks.push(text.slice(start, start + maxChars));
  }
  if (chunks.length === 0) return { chunks: [''], partial: false };
  return { chunks, partial: false };
}

function serialize(value: JsonValue): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? '';
}

function truncateText(text: string, tokenLimit: number): string {
  const maxChars = Math.max(1, tokenLimit * TOKENS_PER_CHAR_DIVISOR - 8);
  const head = Math.floor(maxChars / 2);
  const tail = maxChars - head;
  return `${text.slice(0, head)}\n...\n${text.slice(text.length - tail)}`;
}

/**
 * Greedily pack units into chunks whose estimate fits the token limit.
 * A single unit that cannot fit is emitted as text windows of its serialised
 * form, so no content is silently dropped here.
 */
function pack<T>(
  units: readonly T[],
  build: (subset: readonly T[]) => JsonValue,
  tokenLimit: number,
  overlapUnits: number,
): JsonValue[] {
  const chunks: JsonValue[] = [];
  let current: T[] = [];

  for (const unit of units) {
    if (current.length > 0 && estimateTokens(build([...current, unit])) > tokenLimit) {
      chunks.push(build(current));
      current = overlapUnits > 0 ? current.slice(-overlapUnits) : [];
      if (current.length > 0 && estimateTokens(build(current)) > tokenLimit) current = [];
    }
    const single = build([unit]);
    if (estimateTokens(single) > tokenLimit) {
      if (current.length > 0) {
        chunks.push(build(current));
        current = [];
      }
      chunks.push(...textWindows(serialize(single), tokenLimit).chunks);
      continue;
    }
    current = [...current, unit];
  }

  if (current.length > 0) chunks.push(build(current));
  return chunks.length === 0 ? [''] : chunks;
}

function chunkJson(state: JsonValue, tokenLimit: number, options: OversizeOptions): JsonValue[] {
  if (typeof state === 'string') {
    return textWindows(state, tokenLimit, options.overlapChars ?? 64).chunks;
  }
  if (Array.isArray(state)) {
    return pack(state, (subset) => [...subset], tokenLimit, 1);
  }
  if (state !== null && typeof state === 'object') {
    const entries = Object.entries(state);
    return pack(entries, (subset) => Object.fromEntries(subset), tokenLimit, 1);
  }
  return [state];
}

/**
 * Apply the configured oversize behaviour (PLAN.md section 7.1).
 * Chunking marks `partial` only when MAX_CHUNKS truncates the set.
 */
export function applyOversizePolicy(
  state: JsonValue,
  budget: SizeBudget,
  options: OversizeOptions,
): OversizeResult {
  const stateTokens = estimateTokens(state);
  const { stateQuestionTokens, requestTokens } = effectiveBudget(budget);
  const limit = Math.min(stateQuestionTokens, requestTokens);
  if (stateTokens <= limit) {
    return { kind: 'fits', state, stateTokens };
  }
  switch (options.policy) {
    case 'reject':
      return { kind: 'rejected', reason: 'OVERSIZE', stateTokens };
    case 'truncate': {
      const truncated = truncateText(serialize(state), limit);
      return {
        kind: 'truncated',
        state: truncated,
        stateTokens: estimateTokens(truncated),
        partial: true,
      };
    }
    case 'chunk': {
      const chunks = chunkJson(state, limit, options);
      const capped = chunks.slice(0, Math.max(1, options.maxChunks));
      return {
        kind: 'chunked',
        chunks: capped,
        stateTokens,
        partial: chunks.length > capped.length,
      };
    }
  }
}
