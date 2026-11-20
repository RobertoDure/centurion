import type { RuleVerdict } from '@centurion/contracts';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

import type { TokenCalibrator } from '../jev/token-estimator';
import type { Metrics } from '../pipeline/orchestrator';

export interface ApiMetricsOptions {
  /** Defaults to a fresh registry so tests do not share global state. */
  registry?: Registry;
  calibrator?: TokenCalibrator;
}

function asVerdict(value: string | undefined): RuleVerdict {
  return value === 'TRIGGERED' || value === 'UNCERTAIN' || value === 'NOT_TRIGGERED'
    ? value
    : 'NOT_TRIGGERED';
}

/**
 * Prometheus metrics for T5.4. Implements the pipeline `Metrics` interface so
 * `Pipeline` can report counters without depending on prom-client, and exposes
 * typed helpers for gateway instrumentation and /ready.
 */
export class ApiMetrics implements Metrics {
  readonly registry: Registry;
  readonly consumerLag: Gauge;
  readonly messagesProcessed: Counter<'status'>;
  readonly jevDuration: Histogram<'model'>;
  readonly jevThrottled: Counter<'code'>;
  readonly verdicts: Counter<'verdict'>;
  readonly dlq: Counter<'reason'>;
  readonly uncertainIgnored: Counter;
  readonly rulesInScope: Histogram;
  readonly tokenEstimateActualRatio: Gauge;
  readonly tokenEstimated: Gauge;
  readonly tokenActual: Gauge;
  readonly tokenSamples: Gauge;

  private readonly calibrator: TokenCalibrator | undefined;
  private readonly dynamicCounters = new Map<string, Counter>();

  constructor(options: ApiMetricsOptions = {}) {
    this.registry = options.registry ?? new Registry();
    this.calibrator = options.calibrator;
    const registers = [this.registry];

    this.consumerLag = new Gauge({
      name: 'centurion_consumer_lag',
      help: 'Approximate Kafka consumer lag (topic high watermarks minus committed offsets)',
      registers,
    });
    this.messagesProcessed = new Counter({
      name: 'centurion_messages_processed_total',
      help: 'Kafka messages processed by pipeline status',
      labelNames: ['status'],
      registers,
    });
    this.jevDuration = new Histogram({
      name: 'centurion_jev_request_duration_seconds',
      help: 'Jev request latency in seconds',
      labelNames: ['model'],
      registers,
    });
    this.jevThrottled = new Counter({
      name: 'centurion_jev_throttled_total',
      help: 'Jev throttling responses (429 rate limit / 529 overloaded)',
      labelNames: ['code'],
      registers,
    });
    this.verdicts = new Counter({
      name: 'centurion_rule_verdicts_total',
      help: 'Rule verdicts by outcome',
      labelNames: ['verdict'],
      registers,
    });
    this.dlq = new Counter({
      name: 'centurion_dlq_total',
      help: 'Messages published to the dead-letter topic by reason',
      labelNames: ['reason'],
      registers,
    });
    this.uncertainIgnored = new Counter({
      name: 'centurion_uncertain_ignored_total',
      help: 'Uncertain verdicts dropped by uncertainPolicy=ignore',
      registers,
    });
    this.rulesInScope = new Histogram({
      name: 'centurion_rules_in_scope',
      help: 'Number of rules selected for one message after the scope pre-filter',
      registers,
    });
    this.tokenEstimateActualRatio = new Gauge({
      name: 'centurion_jev_token_estimate_actual_ratio',
      help: 'Actual / estimated Jev input tokens (1 means the heuristic is exact)',
      registers,
    });
    this.tokenEstimated = new Gauge({
      name: 'centurion_jev_token_estimated_total',
      help: 'Cumulative estimated Jev input tokens',
      registers,
    });
    this.tokenActual = new Gauge({
      name: 'centurion_jev_token_actual_total',
      help: 'Cumulative actual Jev input tokens reported by the API',
      registers,
    });
    this.tokenSamples = new Gauge({
      name: 'centurion_jev_token_calibration_samples',
      help: 'Number of Jev responses used for token calibration',
      registers,
    });
  }

  increment(name: string, labels: Record<string, string> = {}): void {
    switch (name) {
      case 'pipeline_dlq_total':
        this.dlq.inc({ reason: labels['reason'] ?? 'unknown' });
        return;
      case 'pipeline_messages_processed_total':
        this.messagesProcessed.inc({ status: labels['status'] ?? 'unknown' });
        return;
      case 'pipeline_uncertain_ignored_total':
        this.uncertainIgnored.inc();
        return;
      case 'pipeline_verdict_total':
        this.recordVerdict(asVerdict(labels['verdict']));
        return;
      default:
        this.incrementDynamic(name, labels);
    }
  }

  observe(name: string, value: number): void {
    if (name === 'pipeline_rules_in_scope') this.rulesInScope.observe(value);
  }

  recordJevRequest(model: string, seconds: number): void {
    this.jevDuration.observe({ model }, seconds);
    this.refreshTokenCalibration();
  }

  recordJevError(code: '429' | '529'): void {
    this.jevThrottled.inc({ code });
  }

  recordVerdict(verdict: RuleVerdict): void {
    this.verdicts.inc({ verdict });
  }

  setConsumerLag(lag: number): void {
    this.consumerLag.set(lag);
  }

  refreshTokenCalibration(): void {
    if (this.calibrator === undefined) return;
    const snapshot = this.calibrator.snapshot();
    this.tokenSamples.set(snapshot.samples);
    this.tokenEstimated.set(snapshot.estimatedTokens);
    this.tokenActual.set(snapshot.actualTokens);
    this.tokenEstimateActualRatio.set(snapshot.ratio ?? 0);
  }

  private incrementDynamic(name: string, labels: Record<string, string>): void {
    let metric = this.dynamicCounters.get(name);
    if (metric === undefined) {
      metric = new Counter({
        name,
        help: `${name} (auto-registered by ApiMetrics)`,
        labelNames: Object.keys(labels),
        registers: [this.registry],
      });
      this.dynamicCounters.set(name, metric);
    }
    metric.inc(labels);
  }
}
