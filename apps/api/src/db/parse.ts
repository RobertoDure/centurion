import type { z } from 'zod';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Parse a value that came from outside the type system (JSONB, Kafka, HTTP).
 * Invalid data is reported as a marker instead of throwing, so one bad row can
 * never crash the consumer (PLAN.md section 8.2).
 */
export function parseExternal<T>(schema: z.ZodType<T>, value: unknown): ParseResult<T> {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  const reason = result.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return { ok: false, reason };
}
