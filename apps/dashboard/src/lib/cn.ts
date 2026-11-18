export type ClassValue =
  | string
  | number
  | null
  | false
  | undefined
  | ClassValue[]
  | Record<string, boolean | null | undefined>;

/** Tiny class-name joiner; avoids a runtime dependency for a handful of variants. */
export function cn(...values: ClassValue[]): string {
  const parts: string[] = [];
  for (const value of values) {
    if (value === null || value === undefined || value === false || value === '') continue;
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(String(value));
    } else if (Array.isArray(value)) {
      const nested = cn(...value);
      if (nested !== '') parts.push(nested);
    } else {
      for (const [key, enabled] of Object.entries(value)) {
        if (enabled === true) parts.push(key);
      }
    }
  }
  return parts.join(' ');
}
