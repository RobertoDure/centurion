export function formatDateTime(value: string | undefined): string {
  if (value === undefined) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function formatPercent(value: number, fractionDigits = 0): string {
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatProbability(value: number | undefined): string {
  return value === undefined ? 'not set' : formatPercent(value, 1);
}
