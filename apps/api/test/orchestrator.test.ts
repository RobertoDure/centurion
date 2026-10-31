import type { JevAnswer, Rule, SseEvent } from '@centurion/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { ConsumedMessage, MessageContext } from '../src/consumer/runner';
import type { FlagToRecord, RecordedFlag, RecordOutcomeInput } from '../src/db/repositories';
import type { JevGateway } from '../src/jev/gateway';
import {
  Pipeline,
  type DlqPublisher,
  type EventPublisher,
  type Metrics,
  type OutcomeRecorder,
  type RuleSelector,
} from '../src/pipeline/orchestrator';

const RULE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const FLAG_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: RULE_ID,
    name: 'Payment failures',
    enabled: true,
    scope: {},
    question: { type: 'noul', instructions: 'Is the payment declined?' },
    condition: { type: 'noul', op: 'gte', threshold: 0.5 },
    uncertainPolicy: 'ignore',
    actionIds: [],
    version: 1,
    ...overrides,
  };
}

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'msg-1',
    source: { id: 'checkout-api' },
    timestamp: '2026-10-01T00:00:00.000Z',
    level: 'error',
    payload: 'payment declined',
    ...overrides,
  };
}

function message(value: unknown): ConsumedMessage {
  return {
    topic: 'logs.raw',
    partition: 0,
    offset: '42',
    key: 'checkout-api',
    value: typeof value === 'string' ? value : JSON.stringify(value),
    headers: {},
    timestamp: '2026-10-01T00:00:00.000Z',
  };
}

interface Harness {
  pipeline: Pipeline;
  gateway: JevGateway & { calls: number };
  rules: RuleSelector;
  recorded: RecordOutcomeInput[];
  dlq: DlqPublisher & { reasons: string[] };
  events: SseEvent[];
  metrics: Metrics & { counters: Record<string, number> };
  commit: ReturnType<typeof vi.fn>;
  context: MessageContext;
}

function harness(options: {
  rules?: Rule[];
  answer?: JevAnswer;
  outcomeCreated?: boolean;
  persistAllEvaluations?: boolean;
  oversizePolicy?: 'chunk' | 'truncate' | 'reject';
  stateQuestionTokenLimit?: number;
} = {}): Harness {
  const rules = options.rules ?? [rule()];
  const answer: JevAnswer = options.answer ?? { type: 'noul', noul: 0.93 };
  const recordedInputs: RecordOutcomeInput[] = [];
  const events: SseEvent[] = [];
  const counters: Record<string, number> = {};
  const dlqReasons: string[] = [];
  const gateway: JevGateway & { calls: number } = {
    calls: 0,
    async evaluate(input) {
      gateway.calls += 1;
      const answers: Record<string, JevAnswer> = {};
      for (const id of Object.keys(input.questions)) answers[id] = answer;
      return { model: 'jev-1.13.0', answers, usage: { inputTokens: 12, outputTokens: 3 } };
    },
  };
  const outcomes: OutcomeRecorder = {
    async record(input) {
      recordedInputs.push(input);
      return input.flags.map(
        (flag: FlagToRecord): RecordedFlag => ({
          ruleId: flag.ruleId,
          flagId: FLAG_ID,
          created: options.outcomeCreated ?? true,
        }),
      );
    },
  };
  const dlq: DlqPublisher & { reasons: string[] } = {
    reasons: dlqReasons,
    async publish({ reason }) {
      dlqReasons.push(reason);
    },
  };
  const eventsPublisher: EventPublisher = {
    publish(event) {
      events.push(event);
    },
  };
  const metrics: Metrics & { counters: Record<string, number> } = {
    counters,
    increment(name) {
      counters[name] = (counters[name] ?? 0) + 1;
    },
    observe() {},
  };
  const commit = vi.fn(async () => {});
  const context: MessageContext = { message: message(envelope()), commit };
  const pipeline = new Pipeline({
    gateway,
    ruleCache: { selectFor: async () => rules },
    outcomes,
    dlq,
    events: eventsPublisher,
    metrics,
    config: {
      budget: {
        stateQuestionTokenLimit: options.stateQuestionTokenLimit ?? 32_000,
        requestTokenLimit: 64_000,
        safetyMargin: 0.1,
      },
      oversize: { policy: options.oversizePolicy ?? 'chunk', maxChunks: 8 },
      excerptChars: 0,
      persistAllEvaluations: options.persistAllEvaluations ?? false,
      redactKeys: [],
    },
    now: () => new Date('2026-10-01T00:00:01.000Z'),
  });
  return {
    pipeline,
    gateway,
    rules: { selectFor: async () => rules },
    recorded: recordedInputs,
    dlq,
    events,
    metrics,
    commit,
    context,
  };
}

describe('Pipeline', () => {
  it('evaluates a message, persists a flag and emits SSE events', async () => {
    const h = harness();
    const outcome = await h.pipeline.handle(h.context);

    expect(outcome.status).toBe('flagged');
    expect(outcome.flagCount).toBe(1);
    expect(h.gateway.calls).toBe(1);
    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0]?.evaluation?.status).toBe('flagged');
    expect(h.recorded[0]?.flags[0]?.outcome).toBe('triggered');
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.events.map((event) => event.type)).toEqual(['flag.created', 'log.processed']);
    expect(h.metrics.counters.pipeline_messages_processed_total).toBe(1);
  });

  it('sends invalid JSON to the DLQ and still commits', async () => {
    const h = harness();
    h.context.message.value = 'not json';
    const outcome = await h.pipeline.handle(h.context);
    expect(outcome.status).toBe('error');
    expect(h.dlq.reasons).toEqual(['INVALID_ENVELOPE']);
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.gateway.calls).toBe(0);
  });

  it('rejects an unknown schema version with a specific DLQ reason', async () => {
    const h = harness();
    h.context.message.value = JSON.stringify(envelope({ schemaVersion: 2 }));
    await h.pipeline.handle(h.context);
    expect(h.dlq.reasons).toEqual(['UNSUPPORTED_SCHEMA_VERSION']);
  });

  it('skips Jev entirely when no rule is in scope', async () => {
    const h = harness({ rules: [] });
    const outcome = await h.pipeline.handle(h.context);
    expect(outcome.status).toBe('clean');
    expect(h.gateway.calls).toBe(0);
    expect(h.recorded).toHaveLength(0);
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.events.map((event) => event.type)).toEqual(['log.processed']);
  });

  it('drops an uncertain verdict under uncertainPolicy=ignore', async () => {
    const h = harness({
      rules: [rule({ uncertainPolicy: 'ignore', condition: { type: 'noul', op: 'gte', threshold: 0.5 } })],
      answer: { type: 'noul', noul: 0.2 },
    });
    const outcome = await h.pipeline.handle(h.context);
    expect(outcome.flagCount).toBe(0);
    expect(outcome.status).toBe('clean');
    expect(h.recorded).toHaveLength(0);
    expect(h.metrics.counters.pipeline_uncertain_ignored_total).toBeUndefined();
  });

  it('persists an uncertain flag under uncertainPolicy=review without actions', async () => {
    const h = harness({
      rules: [
        rule({
          uncertainPolicy: 'review',
          condition: { type: 'choice', anyOf: ['declined'], minConfidence: 0.9 },
        }),
      ],
      answer: { type: 'choice', choice: 'declined', probabilities: { declined: 0.8 }, confidence: 0.4 },
    });
    const outcome = await h.pipeline.handle(h.context);
    expect(outcome.status).toBe('uncertain');
    expect(outcome.uncertainCount).toBe(1);
    expect(h.recorded[0]?.flags[0]?.outcome).toBe('uncertain');
    expect(h.recorded[0]?.flags[0]?.actionIds).toEqual([]);
  });

  it('rejects an oversize state to the DLQ', async () => {
    const h = harness({ oversizePolicy: 'reject', stateQuestionTokenLimit: 3 });
    h.context.message.value = JSON.stringify(envelope({ payload: 'a'.repeat(500) }));
    await h.pipeline.handle(h.context);
    expect(h.dlq.reasons).toEqual(['OVERSIZE']);
    expect(h.gateway.calls).toBe(0);
    expect(h.commit).toHaveBeenCalledTimes(1);
  });

  it('does not emit flag.created for a redelivered duplicate', async () => {
    const h = harness({ outcomeCreated: false });
    await h.pipeline.handle(h.context);
    expect(h.events.map((event) => event.type)).toEqual(['log.processed']);
  });

  it('persists a clean evaluation when PERSIST_ALL_EVALUATIONS is on', async () => {
    const h = harness({ rules: [], persistAllEvaluations: true });
    await h.pipeline.handle(h.context);
    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0]?.evaluation?.status).toBe('clean');
  });
});
