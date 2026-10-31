import {
  evaluateRule,
  flagSchema,
  logEnvelopeSchema,
  RULE_VERDICT_RANK,
  type EvaluationStatus,
  type JevAnswer,
  type LogEnvelope,
  type Rule,
  type RuleVerdict,
  type SseEvent,
} from '@centurion/contracts';

import type { ConsumedMessage, MessageContext } from '../consumer/runner';
import type { FlagToRecord, NewEvaluation, RecordedFlag, RecordOutcomeInput } from '../db/repositories';
import type { JevGateway } from '../jev/gateway';
import { applyOversizePolicy, type OversizeOptions, type SizeBudget } from '../jev/size-guard';
import { buildState } from '../jev/state-builder';
import { estimateTokens } from '../jev/token-estimator';
import { evaluateWithIsolation } from '../jev/isolate';
import { batchQuestions } from './question-batcher';

export interface RuleSelector {
  selectFor(envelope: Pick<LogEnvelope, 'source' | 'level'>): Promise<Rule[]>;
}

export interface OutcomeRecorder {
  record(input: RecordOutcomeInput): Promise<RecordedFlag[]>;
}

export interface DlqPublisher {
  publish(input: { reason: string; message: ConsumedMessage }): Promise<void>;
}

export interface Metrics {
  increment(name: string, labels?: Record<string, string>): void;
  observe(name: string, value: number, labels?: Record<string, string>): void;
}

export const noopMetrics: Metrics = { increment: () => {}, observe: () => {} };

export interface EventPublisher {
  publish(event: SseEvent): void;
}

export const noopEventPublisher: EventPublisher = { publish: () => {} };

export interface PipelineConfig {
  budget: SizeBudget;
  oversize: OversizeOptions;
  excerptChars: number;
  persistAllEvaluations: boolean;
  redactKeys: readonly string[];
}

export interface PipelineDependencies {
  gateway: JevGateway;
  ruleCache: RuleSelector;
  outcomes: OutcomeRecorder;
  dlq: DlqPublisher;
  events: EventPublisher;
  metrics: Metrics;
  config: PipelineConfig;
  /** Auto-disable a rule Jev rejected (T2.5); API wiring persists disabled_reason. */
  onInvalidRule?: (ruleId: string, reason: string) => Promise<void>;
  now?: () => Date;
}

export interface PipelineOutcome {
  status: EvaluationStatus;
  flagCount: number;
  uncertainCount: number;
  partial: boolean;
  model: string | undefined;
  disabledRuleIds: string[];
}

function serializePayload(payload: LogEnvelope['payload']): string {
  return typeof payload === 'string' ? payload : (JSON.stringify(payload) ?? '');
}

/**
 * Implements PLAN.md section 7 steps 1-10: validate, select rules, build state,
 * size-guard, batch questions, call Jev, evaluate, persist (outbox) in one
 * transaction, commit the offset, then emit SSE events.
 */
export class Pipeline {
  private readonly deps: PipelineDependencies;

  constructor(deps: PipelineDependencies) {
    this.deps = deps;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async handle(context: MessageContext): Promise<PipelineOutcome> {
    const { message } = context;
    const envelope = this.parseEnvelope(message);
    if (envelope === undefined) {
      await this.publishDlq(message, 'INVALID_ENVELOPE');
      await context.commit();
      this.deps.metrics.increment('pipeline_dlq_total', { reason: 'INVALID_ENVELOPE' });
      this.deps.events.publish({
        type: 'log.processed',
        data: { messageId: 'unknown', sourceId: 'unknown', status: 'error', flagCount: 0, partial: false },
      });
      return {
        status: 'error',
        flagCount: 0,
        uncertainCount: 0,
        partial: false,
        model: undefined,
        disabledRuleIds: [],
      };
    }
    if (envelope === 'UNSUPPORTED_SCHEMA_VERSION') {
      await this.publishDlq(message, 'UNSUPPORTED_SCHEMA_VERSION');
      await context.commit();
      this.deps.metrics.increment('pipeline_dlq_total', { reason: 'UNSUPPORTED_SCHEMA_VERSION' });
      this.deps.events.publish({
        type: 'log.processed',
        data: { messageId: 'unknown', sourceId: 'unknown', status: 'error', flagCount: 0, partial: false },
      });
      return {
        status: 'error',
        flagCount: 0,
        uncertainCount: 0,
        partial: false,
        model: undefined,
        disabledRuleIds: [],
      };
    }

    const rules = await this.deps.ruleCache.selectFor(envelope);
    this.deps.metrics.observe('pipeline_rules_in_scope', rules.length);
    if (rules.length === 0) {
      await this.finish(context, envelope, {
        status: 'clean',
        flags: [],
        model: undefined,
        tokenEstimate: 0,
        partial: false,
        disabledRuleIds: [],
        uncertainCount: 0,
      });
      return {
        status: 'clean',
        flagCount: 0,
        uncertainCount: 0,
        partial: false,
        model: undefined,
        disabledRuleIds: [],
      };
    }

    const state = buildState(envelope, { redactKeys: this.deps.config.redactKeys });
    const oversize = applyOversizePolicy(state, this.deps.config.budget, this.deps.config.oversize);
    if (oversize.kind === 'rejected') {
      await this.publishDlq(message, 'OVERSIZE');
      await context.commit();
      this.deps.metrics.increment('pipeline_dlq_total', { reason: 'OVERSIZE' });
      this.deps.events.publish({
        type: 'log.processed',
        data: {
          messageId: envelope.id,
          sourceId: envelope.source.id,
          level: envelope.level,
          status: 'error',
          flagCount: 0,
          partial: false,
        },
      });
      return {
        status: 'error',
        flagCount: 0,
        uncertainCount: 0,
        partial: false,
        model: undefined,
        disabledRuleIds: [],
      };
    }
    const chunks = oversize.kind === 'chunked' ? oversize.chunks : [oversize.state];
    const partial = oversize.kind === 'truncated' || (oversize.kind === 'chunked' && oversize.partial);

    const verdicts = new Map<string, { verdict: RuleVerdict; answer: JevAnswer }>();
    const disabledRuleIds = new Set<string>();
    let model: string | undefined;
    let tokenEstimate = 0;

    for (const chunk of chunks) {
      const stateTokens = estimateTokens(chunk);
      const { batches, unbatchable } = batchQuestions({
        stateTokens,
        rules: rules.map((rule) => ({ id: rule.id, question: rule.question })),
        budget: this.deps.config.budget,
      });
      for (const ruleId of unbatchable) {
        disabledRuleIds.add(ruleId);
        await this.deps.onInvalidRule?.(ruleId, 'question exceeds the Jev token budget');
      }
      const byId = new Map(rules.map((rule) => [rule.id, rule]));
      for (const batch of batches) {
        const batchRules = batch.ruleIds
          .map((id) => byId.get(id))
          .filter((rule): rule is Rule => rule !== undefined);
        const isolation = await evaluateWithIsolation({
          gateway: this.deps.gateway,
          state: chunk,
          rules: batchRules.map((rule) => ({ ruleId: rule.id, question: rule.question })),
          onInvalidRule: async (ruleId, reason) => {
            disabledRuleIds.add(ruleId);
            await this.deps.onInvalidRule?.(ruleId, reason);
          },
        });
        tokenEstimate += isolation.usage.inputTokens;
        model = model ?? isolation.model;
        for (const rule of batchRules) {
          const answer = isolation.answers[rule.id];
          if (answer === undefined) continue;
          const verdict = evaluateRule(rule, answer);
          const existing = verdicts.get(rule.id);
          if (existing === undefined || RULE_VERDICT_RANK[verdict] > RULE_VERDICT_RANK[existing.verdict]) {
            verdicts.set(rule.id, { verdict, answer });
          }
        }
      }
    }

    const flags: FlagToRecord[] = [];
    let uncertainCount = 0;
    for (const rule of rules) {
      const result = verdicts.get(rule.id);
      if (result === undefined || result.verdict === 'NOT_TRIGGERED') continue;
      if (result.verdict === 'UNCERTAIN') {
        if (rule.uncertainPolicy === 'ignore') {
          this.deps.metrics.increment('pipeline_uncertain_ignored_total');
          continue;
        }
        uncertainCount += 1;
        flags.push({
          ruleId: rule.id,
          ruleVersion: rule.version,
          outcome: 'uncertain',
          answer: result.answer,
          actionIds: [],
        });
        continue;
      }
      flags.push({
        ruleId: rule.id,
        ruleVersion: rule.version,
        outcome: 'triggered',
        answer: result.answer,
        actionIds: rule.actionIds,
      });
    }

    const triggeredCount = flags.filter((flag) => flag.outcome === 'triggered').length;
    const evaluatedCount = verdicts.size;
    let status: EvaluationStatus = 'clean';
    if (partial) status = 'partial';
    if (uncertainCount > 0) status = 'uncertain';
    if (triggeredCount > 0) status = 'flagged';
    if (triggeredCount === 0 && uncertainCount === 0 && evaluatedCount === 0 && disabledRuleIds.size > 0) {
      status = 'error';
    }

    await this.finish(context, envelope, {
      status,
      flags,
      model,
      tokenEstimate,
      partial,
      disabledRuleIds: [...disabledRuleIds],
      uncertainCount,
    });

    return {
      status,
      flagCount: flags.length,
      uncertainCount,
      partial,
      model,
      disabledRuleIds: [...disabledRuleIds],
    };
  }

  private async finish(
    context: MessageContext,
    envelope: LogEnvelope,
    outcome: {
      status: EvaluationStatus;
      flags: FlagToRecord[];
      model: string | undefined;
      tokenEstimate: number;
      partial: boolean;
      disabledRuleIds: string[];
      uncertainCount: number;
    },
  ): Promise<void> {
    const { message } = context;
    const shouldPersist = outcome.flags.length > 0 || this.deps.config.persistAllEvaluations;
    let recorded: RecordedFlag[] = [];
    if (shouldPersist) {
      const evaluation: NewEvaluation = {
        messageId: envelope.id,
        sourceId: envelope.source.id,
        topic: message.topic,
        partition: message.partition,
        offset: message.offset,
        model: outcome.model,
        tokenEstimate: outcome.tokenEstimate,
        partial: outcome.partial,
        status: outcome.status,
        excerpt: this.buildExcerpt(envelope),
      };
      recorded = await this.deps.outcomes.record({
        messageId: envelope.id,
        evaluation,
        flags: outcome.flags,
      });
    }

    await context.commit();
    this.deps.metrics.increment('pipeline_messages_processed_total', { status: outcome.status });

    const byRule = new Map(outcome.flags.map((flag) => [flag.ruleId, flag]));
    for (const entry of recorded) {
      if (!entry.created) continue;
      const flag = byRule.get(entry.ruleId);
      if (flag === undefined) continue;
      const parsed = flagSchema.safeParse({
        id: entry.flagId,
        messageId: envelope.id,
        ruleId: flag.ruleId,
        ruleVersion: flag.ruleVersion,
        outcome: flag.outcome,
        answer: flag.answer,
        sourceId: envelope.source.id,
        createdAt: this.now().toISOString(),
      });
      if (parsed.success) this.deps.events.publish({ type: 'flag.created', data: parsed.data });
    }

    this.deps.events.publish({
      type: 'log.processed',
      data: {
        messageId: envelope.id,
        sourceId: envelope.source.id,
        level: envelope.level,
        status: outcome.status,
        flagCount: outcome.flags.length,
        partial: outcome.partial,
        model: outcome.model,
      },
    });
  }

  private buildExcerpt(envelope: LogEnvelope): string | undefined {
    const max = this.deps.config.excerptChars;
    if (max <= 0) return undefined;
    return serializePayload(envelope.payload).slice(0, max);
  }

  private parseEnvelope(message: ConsumedMessage): LogEnvelope | 'UNSUPPORTED_SCHEMA_VERSION' | undefined {
    if (message.value === null) return undefined;
    let json: unknown;
    try {
      json = JSON.parse(message.value);
    } catch {
      return undefined;
    }
    const parsed = logEnvelopeSchema.safeParse(json);
    if (parsed.success) return parsed.data;
    if (
      typeof json === 'object' &&
      json !== null &&
      'schemaVersion' in json &&
      typeof (json as { schemaVersion: unknown }).schemaVersion === 'number' &&
      (json as { schemaVersion: number }).schemaVersion !== 1
    ) {
      return 'UNSUPPORTED_SCHEMA_VERSION';
    }
    return undefined;
  }

  private async publishDlq(message: ConsumedMessage, reason: string): Promise<void> {
    await this.deps.dlq.publish({ reason, message });
  }
}
