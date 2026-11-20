import type { JevAnswer, Rule } from '@centurion/contracts';
import { describe, expect, it } from 'vitest';

import type { MessageContext } from '../src/consumer/runner';
import { TokenCalibrator } from '../src/jev/token-estimator';
import { ApiMetrics } from '../src/ops/metrics';
import { Pipeline } from '../src/pipeline/orchestrator';

const RULE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('ApiMetrics', () => {
  it('maps the pipeline counters, lag and throttle metrics onto the registry', async () => {
    const metrics = new ApiMetrics();
    metrics.increment('pipeline_messages_processed_total', { status: 'flagged' });
    metrics.increment('pipeline_dlq_total', { reason: 'OVERSIZE' });
    metrics.increment('pipeline_verdict_total', { verdict: 'TRIGGERED' });
    metrics.increment('pipeline_verdict_total', { verdict: 'NOT_TRIGGERED' });
    metrics.increment('pipeline_uncertain_ignored_total');
    metrics.observe('pipeline_rules_in_scope', 3);
    metrics.setConsumerLag(42);
    metrics.recordJevRequest('jev-1.13.0', 0.25);
    metrics.recordJevError('429');

    const text = await metrics.registry.metrics();
    expect(text).toContain('centurion_messages_processed_total{status="flagged"} 1');
    expect(text).toContain('centurion_dlq_total{reason="OVERSIZE"} 1');
    expect(text).toContain('centurion_rule_verdicts_total{verdict="TRIGGERED"} 1');
    expect(text).toContain('centurion_rule_verdicts_total{verdict="NOT_TRIGGERED"} 1');
    expect(text).toContain('centurion_uncertain_ignored_total 1');
    expect(text).toContain('centurion_consumer_lag 42');
    expect(text).toContain('centurion_jev_throttled_total{code="429"} 1');
    expect(text).toContain('centurion_jev_request_duration_seconds');
    expect(text).toContain('centurion_rules_in_scope');
  });

  it('exposes the token estimate/actual ratio from the calibrator', async () => {
    const calibrator = new TokenCalibrator();
    calibrator.record(100, 150);
    const metrics = new ApiMetrics({ calibrator });
    metrics.refreshTokenCalibration();
    const text = await metrics.registry.metrics();
    expect(text).toContain('centurion_jev_token_estimate_actual_ratio 1.5');
    expect(text).toContain('centurion_jev_token_calibration_samples 1');
    expect(text).toContain('centurion_jev_token_actual_total 150');
  });

  it('records one verdict per in-scope rule from the pipeline', async () => {
    const metrics = new ApiMetrics();
    const rule: Rule = {
      id: RULE_ID,
      name: 'Payment failures',
      enabled: true,
      scope: {},
      question: { type: 'noul', instructions: 'Is the payment declined?' },
      condition: { type: 'noul', op: 'gte', threshold: 0.5 },
      uncertainPolicy: 'ignore',
      actionIds: [],
      version: 1,
    };
    const gateway = {
      evaluate: async (input: { questions: Record<string, unknown> }) => {
        const answers: Record<string, JevAnswer> = {};
        for (const id of Object.keys(input.questions)) answers[id] = { type: 'noul', noul: 0.1 };
        return {
          model: 'jev-1.13.0',
          answers,
          usage: { inputTokens: 5, outputTokens: 1 },
        };
      },
    };
    const pipeline = new Pipeline({
      gateway,
      ruleCache: { selectFor: async () => [rule] },
      outcomes: { record: async () => [] },
      dlq: { publish: async () => {} },
      events: { publish: () => {} },
      metrics,
      config: {
        budget: { stateQuestionTokenLimit: 32_000, requestTokenLimit: 64_000, safetyMargin: 0.1 },
        oversize: { policy: 'chunk', maxChunks: 8 },
        excerptChars: 0,
        persistAllEvaluations: false,
        redactKeys: [],
      },
      now: () => new Date('2026-10-01T00:00:00.000Z'),
    });
    const context: MessageContext = {
      message: {
        topic: 'logs.raw',
        partition: 0,
        offset: '1',
        key: 'svc',
        value: JSON.stringify({
          schemaVersion: 1,
          id: 'm1',
          source: { id: 'svc' },
          timestamp: '2026-10-01T00:00:00.000Z',
          payload: 'payment declined',
        }),
        headers: {},
        timestamp: '2026-10-01T00:00:00.000Z',
      },
      commit: async () => {},
    };

    await pipeline.handle(context);
    const text = await metrics.registry.metrics();
    expect(text).toContain('centurion_rule_verdicts_total{verdict="NOT_TRIGGERED"} 1');
    expect(text).toContain('centurion_messages_processed_total{status="clean"} 1');
  });
});
