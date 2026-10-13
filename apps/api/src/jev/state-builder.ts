import type { JsonValue, LogEnvelope } from '@centurion/contracts';

export interface StateBuilderOptions {
  /** Object keys redacted before the payload becomes Jev state (privacy, section 11). */
  redactKeys?: readonly string[];
  /** Maximum size, in characters, of a string state; longer strings are truncated. 0 disables. */
  maxStateChars?: number;
}

export const REDACTED = '[REDACTED]';

export function redactJson(value: JsonValue, keys: ReadonlySet<string>): JsonValue {
  if (Array.isArray(value)) return value.map((item) => redactJson(item, keys));
  if (value !== null && typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = keys.has(key) ? REDACTED : redactJson(item, keys);
    }
    return result;
  }
  return value;
}

/**
 * The log payload becomes Jev state (assumption A3); non-semantic metadata such
 * as ids and timestamps stays out unless a rule explicitly needs it.
 */
export function buildState(envelope: LogEnvelope, options: StateBuilderOptions = {}): JsonValue {
  const keys = options.redactKeys === undefined ? undefined : new Set(options.redactKeys);
  const payload =
    keys === undefined || keys.size === 0 ? envelope.payload : redactJson(envelope.payload, keys);
  const maxChars = options.maxStateChars ?? 0;
  if (maxChars > 0 && typeof payload === 'string' && payload.length > maxChars) {
    return payload.slice(0, maxChars);
  }
  return payload;
}
