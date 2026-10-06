import type {
  ActionExecutionStatus,
  ActionType,
  EvaluationStatus,
  FlagOutcome,
  JevAnswer,
  JevQuestion,
  Rule,
  RuleCondition,
  RuleScope,
  UncertainPolicy,
} from '@centurion/contracts';
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** Rule definitions. Edits bump `currentVersion` and write a `rule_versions` row. */
export const rules = pgTable(
  'rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    enabled: boolean('enabled').notNull().default(true),
    scope: jsonb('scope').$type<RuleScope>().notNull().default({}),
    question: jsonb('question').$type<JevQuestion>().notNull(),
    condition: jsonb('condition').$type<RuleCondition>().notNull(),
    uncertainPolicy: text('uncertain_policy').$type<UncertainPolicy>().notNull().default('ignore'),
    currentVersion: integer('current_version').notNull().default(1),
    disabledReason: text('disabled_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('rules_enabled_idx').on(table.enabled)],
);

/** Immutable snapshot of every rule revision. */
export const ruleVersions = pgTable(
  'rule_versions',
  {
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => rules.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<Rule>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.ruleId, table.version] })],
);

/** Action definitions. `config` holds encrypted secrets at rest for webhooks. */
export const actions = pgTable('actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type').$type<ActionType>().notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Ordered many-to-many between rules and actions. */
export const ruleActions = pgTable(
  'rule_actions',
  {
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => rules.id, { onDelete: 'cascade' }),
    actionId: uuid('action_id')
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.ruleId, table.actionId] })],
);

/**
 * One row per processed Kafka message, written only when the message produced
 * a flag or an error unless PERSIST_ALL_EVALUATIONS is set.
 */
export const evaluations = pgTable(
  'evaluations',
  {
    messageId: text('message_id').primaryKey(),
    sourceId: text('source_id').notNull(),
    topic: text('topic').notNull(),
    partition: integer('partition').notNull(),
    offset: text('offset').notNull(),
    model: text('model'),
    tokenEstimate: integer('token_estimate'),
    partial: boolean('partial').notNull().default(false),
    status: text('status').$type<EvaluationStatus>().notNull(),
    excerpt: text('excerpt'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('evaluations_created_at_idx').on(table.createdAt)],
);

/** A rule reaching TRIGGERED or UNCERTAIN(review). Unique per (message, rule) for idempotency. */
export const flags = pgTable(
  'flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: text('message_id').notNull(),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => rules.id, { onDelete: 'cascade' }),
    ruleVersion: integer('rule_version').notNull(),
    outcome: text('outcome').$type<FlagOutcome>().notNull(),
    answer: jsonb('answer').$type<JevAnswer>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('flags_message_id_rule_id_key').on(table.messageId, table.ruleId),
    index('flags_rule_id_created_at_idx').on(table.ruleId, table.createdAt),
    index('flags_outcome_created_at_idx').on(table.outcome, table.createdAt),
  ],
);

/** Transactional outbox of actions to run. Unique per (flag, action). */
export const actionExecutions = pgTable(
  'action_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    flagId: uuid('flag_id')
      .notNull()
      .references(() => flags.id, { onDelete: 'cascade' }),
    actionId: uuid('action_id')
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    status: text('status').$type<ActionExecutionStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('action_executions_flag_id_action_id_key').on(table.flagId, table.actionId),
    index('action_executions_status_next_attempt_at_idx').on(table.status, table.nextAttemptAt),
  ],
);

export type RuleRow = typeof rules.$inferSelect;
export type RuleVersionRow = typeof ruleVersions.$inferSelect;
export type ActionRow = typeof actions.$inferSelect;
export type FlagRow = typeof flags.$inferSelect;
export type EvaluationRow = typeof evaluations.$inferSelect;
export type ActionExecutionRow = typeof actionExecutions.$inferSelect;
