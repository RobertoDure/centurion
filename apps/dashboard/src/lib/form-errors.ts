/**
 * Flatten RHF/zod field errors into readable messages for an error summary.
 * Accepts `unknown` so callers can pass `formState.errors` without casts.
 */
export function collectErrorMessages(errors: unknown, prefix = ''): string[] {
  if (errors === null || errors === undefined) return [];
  if (Array.isArray(errors)) {
    return errors.flatMap((entry, index) => collectErrorMessages(entry, `${prefix}[${index}]`));
  }
  if (typeof errors !== 'object') return [];

  const record = errors as Record<string, unknown>;
  const messages: string[] = [];
  if (typeof record.message === 'string') {
    messages.push(prefix === '' ? record.message : `${prefix}: ${record.message}`);
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === 'message' || key === 'type' || key === 'ref') continue;
    messages.push(...collectErrorMessages(value, prefix === '' ? key : `${prefix}.${key}`));
  }
  return messages;
}
