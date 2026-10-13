/**
 * Token estimation for Jev requests (PLAN.md section 7.1).
 *
 * Jev does not document a tokenizer, so we use a conservative character-based
 * heuristic and calibrate it against the `usage.input_tokens` that real
 * responses report.
 */
export const TOKENS_PER_CHAR_DIVISOR = 3;

export function serializedLength(value: unknown): number {
  if (typeof value === 'string') return value.length;
  const json = JSON.stringify(value);
  return json === undefined ? 0 : json.length;
}

export function estimateTokens(value: unknown, divisor: number = TOKENS_PER_CHAR_DIVISOR): number {
  if (!Number.isFinite(divisor) || divisor <= 0) {
    throw new Error('divisor must be a positive number');
  }
  return Math.ceil(serializedLength(value) / divisor);
}

export interface TokenCalibrationSnapshot {
  samples: number;
  estimatedTokens: number;
  actualTokens: number;
  /** Actual / estimated; 1 means the heuristic is exact. `null` before the first sample. */
  ratio: number | null;
}

/** Tracks the estimate/actual ratio so the heuristic can be tuned from metrics. */
export class TokenCalibrator {
  private samples = 0;
  private estimatedTokens = 0;
  private actualTokens = 0;

  record(estimated: number, actual: number): void {
    if (actual < 0 || estimated < 0) return;
    this.samples += 1;
    this.estimatedTokens += estimated;
    this.actualTokens += actual;
  }

  snapshot(): TokenCalibrationSnapshot {
    return {
      samples: this.samples,
      estimatedTokens: this.estimatedTokens,
      actualTokens: this.actualTokens,
      ratio: this.estimatedTokens === 0 ? null : this.actualTokens / this.estimatedTokens,
    };
  }
}
