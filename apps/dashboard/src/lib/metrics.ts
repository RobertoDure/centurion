export interface PromSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

function parseLabels(raw: string | undefined): Record<string, string> {
  const labels: Record<string, string> = {};
  if (raw === undefined) return labels;
  const inner = raw.slice(1, -1);
  const matcher = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
  for (const match of inner.matchAll(matcher)) {
    const key = match[1];
    const value = match[2];
    if (key === undefined || value === undefined) continue;
    labels[key] = value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return labels;
}

/** Parse the Prometheus text exposition format into flat samples (comments/help ignored). */
export function parsePrometheus(text: string): PromSample[] {
  const samples: PromSample[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(.+)$/.exec(line);
    if (match === null) continue;
    const name = match[1];
    const valueText = match[3];
    if (name === undefined || valueText === undefined) continue;
    const value = Number(valueText);
    if (!Number.isFinite(value)) continue;
    samples.push({ name, labels: parseLabels(match[2]), value });
  }
  return samples;
}

export function sumSamples(samples: readonly PromSample[], name: string): number {
  let total = 0;
  for (const sample of samples) {
    if (sample.name === name) total += sample.value;
  }
  return total;
}

export function gaugeValue(samples: readonly PromSample[], name: string): number | undefined {
  let found: number | undefined;
  for (const sample of samples) {
    if (sample.name === name) found = sample.value;
  }
  return found;
}
