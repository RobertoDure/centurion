import { describe, expect, it } from 'vitest';

import { gaugeValue, parsePrometheus, sumSamples } from './metrics';

const TEXT = [
  '# HELP centurion_consumer_lag lag',
  '# TYPE centurion_consumer_lag gauge',
  'centurion_consumer_lag 9',
  'centurion_dlq_total{reason="invalid_envelope"} 3',
  'centurion_dlq_total{reason="oversize"} 1',
  'centurion_jev_request_duration_seconds_count{model="jev-1"} 100',
  'centurion_jev_throttled_total{code="429"} 4',
  '',
].join('\n');

describe('parsePrometheus', () => {
  it('parses counters, gauges and labels', () => {
    const samples = parsePrometheus(TEXT);
    expect(gaugeValue(samples, 'centurion_consumer_lag')).toBe(9);
    expect(sumSamples(samples, 'centurion_dlq_total')).toBe(4);
    expect(sumSamples(samples, 'centurion_jev_request_duration_seconds_count')).toBe(100);
    expect(sumSamples(samples, 'centurion_jev_throttled_total')).toBe(4);
    expect(
      samples.find((sample) => sample.name === 'centurion_dlq_total')?.labels['reason'],
    ).toBe('invalid_envelope');
  });

  it('ignores comments and malformed lines', () => {
    const samples = parsePrometheus('# comment\nnot a metric\nmetric_without_value\n');
    expect(samples).toHaveLength(0);
  });
});
