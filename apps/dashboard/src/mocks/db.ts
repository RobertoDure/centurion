import type {
  ActionDto,
  ActionExecution,
  Flag,
  Rule,
  RuleDto,
  RuleVersion,
} from '@centurion/contracts';

export const WEBHOOK_ACTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const KAFKA_ACTION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const NOUL_RULE_ID = '11111111-1111-4111-8111-111111111111';
const CHOICE_RULE_ID = '22222222-2222-4222-8222-222222222222';
const SCORE_RULE_ID = '33333333-3333-4333-8333-333333333333';

const T0 = '2026-09-20T09:00:00.000Z';
const T1 = '2026-09-25T14:30:00.000Z';
const T2 = '2026-09-30T11:15:00.000Z';

function seedRules(): RuleDto[] {
  const noul: Rule = {
    id: NOUL_RULE_ID,
    name: 'Payment failure needs follow-up',
    description: 'Flags checkout logs where a payment failure likely needs a human.',
    enabled: true,
    version: 3,
    scope: { sources: ['checkout-service'], levels: ['error', 'fatal'] },
    question: {
      type: 'noul',
      instructions:
        'Does this log describe a payment or checkout failure that a human should follow up on?',
      criteria: {
        true: 'A payment or checkout failure the customer could not resolve on their own',
        false: 'A successful payment, a successful retry, or an unrelated event',
      },
    },
    condition: { type: 'noul', op: 'gte', threshold: 0.7 },
    uncertainPolicy: 'review',
    actionIds: [WEBHOOK_ACTION_ID],
    createdAt: T0,
    updatedAt: T2,
  };

  const choice: Rule = {
    id: CHOICE_RULE_ID,
    name: 'Support request intent',
    description: 'Classifies the primary intent of a support message.',
    enabled: false,
    version: 1,
    scope: { sources: ['support-bot'] },
    question: {
      type: 'choice',
      instructions: 'What is the primary intent expressed in this support message?',
      criteria: {
        billing: 'A question about invoices, charges or refunds',
        technical: 'A question about errors, outages or configuration',
        sales: 'A question about pricing, plans or purchasing',
        none: null,
      },
    },
    condition: { type: 'choice', anyOf: ['billing'], minProbability: 0.6, minConfidence: 0.5 },
    uncertainPolicy: 'review',
    actionIds: [WEBHOOK_ACTION_ID],
    createdAt: T0,
    updatedAt: T1,
  };

  const score: Rule = {
    id: SCORE_RULE_ID,
    name: 'Customer frustration score',
    description: 'Scores how frustrated the customer sounds.',
    enabled: false,
    version: 2,
    disabledReason: 'Auto-disabled: Jev rejected the question with 422 (malformed criteria)',
    scope: { levels: ['warn', 'error'] },
    question: {
      type: 'score',
      instructions: 'Rate the customer frustration expressed in this log on the given scale.',
      criteria: ['Calm or neutral', 'Frustrated', 'Very angry or threatening to churn'],
    },
    condition: { type: 'score', op: 'gte', threshold: 1, minConfidence: 0.6 },
    uncertainPolicy: 'ignore',
    actionIds: [KAFKA_ACTION_ID],
    createdAt: T0,
    updatedAt: T1,
  };

  return [
    { ...noul, invalid: false },
    {
      ...choice,
      invalid: true,
      invalidReason: 'Stored JSONB failed contract validation; the engine skips this rule',
    },
    { ...score, invalid: false },
  ];
}

export function toRuleSnapshot(dto: RuleDto): Rule {
  return {
    id: dto.id,
    name: dto.name,
    enabled: dto.enabled,
    version: dto.version,
    scope: dto.scope,
    question: dto.question,
    condition: dto.condition,
    uncertainPolicy: dto.uncertainPolicy,
    actionIds: dto.actionIds,
    ...(dto.description !== undefined ? { description: dto.description } : {}),
    ...(dto.disabledReason !== undefined ? { disabledReason: dto.disabledReason } : {}),
    ...(dto.createdAt !== undefined ? { createdAt: dto.createdAt } : {}),
    ...(dto.updatedAt !== undefined ? { updatedAt: dto.updatedAt } : {}),
  };
}

function seedVersions(rules: RuleDto[]): RuleVersion[] {
  const versions: RuleVersion[] = [];
  for (const rule of rules) {
    for (let version = rule.version; version >= 1; version -= 1) {
      versions.push({
        ruleId: rule.id,
        version,
        snapshot: { ...toRuleSnapshot(rule), version },
        createdAt: version === rule.version ? T2 : version === 1 ? T0 : T1,
      });
    }
  }
  return versions;
}

function seedActions(): ActionDto[] {
  return [
    {
      id: WEBHOOK_ACTION_ID,
      type: 'webhook',
      name: 'Ops webhook',
      enabled: true,
      config: {
        url: 'https://hooks.example.com/centurion',
        headers: { 'x-centurion': 'rules' },
        timeoutMs: 10_000,
      },
      hasSecret: true,
    },
    {
      id: KAFKA_ACTION_ID,
      type: 'kafka_topic',
      name: 'Publish to logs.flags',
      enabled: true,
      config: { topic: 'logs.flags', brokers: ['localhost:9092'] },
      hasSecret: false,
    },
  ];
}

function seedExecutions(): ActionExecution[] {
  return [
    {
      id: 'c0000000-0000-4000-8000-000000000001',
      flagId: 'f0000000-0000-4000-8000-000000000001',
      actionId: WEBHOOK_ACTION_ID,
      status: 'succeeded',
      attempts: 1,
    },
    {
      id: 'c0000000-0000-4000-8000-000000000002',
      flagId: 'f0000000-0000-4000-8000-000000000002',
      actionId: KAFKA_ACTION_ID,
      status: 'failed',
      attempts: 3,
      lastError: 'Connection refused while publishing to logs.flags',
    },
  ];
}

function seedFlags(): Flag[] {
  return [
    {
      id: 'f0000000-0000-4000-8000-000000000001',
      messageId: 'm-0001',
      ruleId: NOUL_RULE_ID,
      ruleVersion: 3,
      outcome: 'triggered',
      answer: { type: 'noul', noul: 0.91 },
      sourceId: 'checkout-service',
      createdAt: T2,
    },
    {
      id: 'f0000000-0000-4000-8000-000000000002',
      messageId: 'm-0002',
      ruleId: SCORE_RULE_ID,
      ruleVersion: 2,
      outcome: 'uncertain',
      answer: {
        type: 'score',
        score: 1.4,
        legend: { '0': 'Calm', '1': 'Frustrated', '2': 'Very angry' },
        probabilities: { '0': 0.05, '1': 0.5, '2': 0.45 },
        confidence: 0.42,
      },
      sourceId: 'support-bot',
      createdAt: T1,
    },
  ];
}

export interface DashboardDb {
  rules: RuleDto[];
  ruleVersions: RuleVersion[];
  actions: ActionDto[];
  actionExecutions: ActionExecution[];
  flags: Flag[];
}

function createSeed(): DashboardDb {
  const rules = seedRules();
  return {
    rules,
    ruleVersions: seedVersions(rules),
    actions: seedActions(),
    actionExecutions: seedExecutions(),
    flags: seedFlags(),
  };
}

export const db: DashboardDb = createSeed();

/** Restore the deterministic fixture state between tests. */
export function resetDb(): void {
  const seed = createSeed();
  db.rules = seed.rules;
  db.ruleVersions = seed.ruleVersions;
  db.actions = seed.actions;
  db.actionExecutions = seed.actionExecutions;
  db.flags = seed.flags;
}
