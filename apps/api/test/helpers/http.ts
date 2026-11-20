import { randomUUID } from 'node:crypto';

import type {
  ActionContent,
  ActionDefinition,
  Flag,
  Rule,
  RuleContent,
} from '@centurion/contracts';

import type { Repositories } from '../../src/db/repositories';
import type { ExecutionSummary } from '../../src/db/repositories/action-executions';
import type { FlagEntry } from '../../src/db/repositories/flags';
import type { RuleListEntry, RuleVersionEntry } from '../../src/db/repositories/types';
import { buildApp } from '../../src/http/app';
import type { HttpAppDeps } from '../../src/http/deps';
import { ApiMetrics } from '../../src/ops/metrics';
import { SseHub } from '../../src/sse/hub';

export interface FakeBackend {
  repositories: Repositories;
  rules: Map<string, Rule>;
  versions: Map<string, RuleVersionEntry[]>;
  actions: Map<string, ActionDefinition>;
  executions: Map<string, ExecutionSummary[]>;
  flags: FlagEntry[];
  invalidations: number;
}

export function nowIso(): string {
  return '2026-10-01T12:00:00.000Z';
}

export function noulRuleContent(overrides: Partial<RuleContent> = {}): RuleContent {
  return {
    name: 'Payment failures',
    enabled: true,
    scope: {},
    question: { type: 'noul', instructions: 'Is the payment declined?' },
    condition: { type: 'noul', op: 'gte', threshold: 0.5 },
    uncertainPolicy: 'ignore',
    actionIds: [],
    ...overrides,
  };
}

export function ruleFromContent(content: RuleContent, id: string = randomUUID(), version = 1): Rule {
  return { id, version, ...content, createdAt: nowIso(), updatedAt: nowIso() };
}

export function webhookActionContent(overrides: Partial<ActionContent> = {}): ActionContent {
  return {
    type: 'webhook',
    name: 'Notify Slack',
    enabled: true,
    config: { url: 'https://example.com/hook', secret: 's3cr3t', timeoutMs: 10_000 },
    ...overrides,
  } as ActionContent;
}

export function actionFromContent(content: ActionContent, id: string = randomUUID()): ActionDefinition {
  return { id, ...content };
}

export function makeFlag(overrides: Partial<Flag> = {}): Flag {
  return {
    id: randomUUID(),
    messageId: 'msg-1',
    ruleId: randomUUID(),
    ruleVersion: 1,
    outcome: 'triggered',
    answer: { type: 'noul', noul: 0.9 },
    sourceId: 'checkout-api',
    createdAt: nowIso(),
    ...overrides,
  };
}

export function createFakeBackend(): FakeBackend {
  const rules = new Map<string, Rule>();
  const versions = new Map<string, RuleVersionEntry[]>();
  const actions = new Map<string, ActionDefinition>();
  const executions = new Map<string, ExecutionSummary[]>();
  const flags: FlagEntry[] = [];
  const backend: FakeBackend = {
    repositories: undefined as unknown as Repositories,
    rules,
    versions,
    actions,
    executions,
    flags,
    invalidations: 0,
  };

  const rulesRepo = {
    async list(): Promise<RuleListEntry[]> {
      return [...rules.values()].map((rule) => ({ kind: 'valid' as const, rule }));
    },
    async get(id: string): Promise<RuleListEntry | undefined> {
      const rule = rules.get(id);
      return rule === undefined ? undefined : { kind: 'valid' as const, rule };
    },
    async create(content: RuleContent): Promise<Rule> {
      const rule = ruleFromContent(content);
      rules.set(rule.id, rule);
      versions.set(rule.id, [{ version: rule.version, createdAt: nowIso(), rule }]);
      return rule;
    },
    async update(id: string, content: RuleContent): Promise<RuleListEntry | undefined> {
      const previous = rules.get(id);
      if (previous === undefined) return undefined;
      const rule = { ...ruleFromContent(content, id, previous.version + 1) };
      rules.set(id, rule);
      const list = versions.get(id) ?? [];
      list.unshift({ version: rule.version, createdAt: nowIso(), rule });
      versions.set(id, list);
      return { kind: 'valid', rule };
    },
    async setEnabled(id: string, enabled: boolean, disabledReason?: string): Promise<RuleListEntry | undefined> {
      const previous = rules.get(id);
      if (previous === undefined) return undefined;
      const rule: Rule = {
        ...previous,
        enabled,
        ...(enabled || disabledReason === undefined ? {} : { disabledReason }),
      };
      if (enabled) delete (rule as { disabledReason?: string }).disabledReason;
      rules.set(id, rule);
      return { kind: 'valid', rule };
    },
    async delete(id: string): Promise<boolean> {
      versions.delete(id);
      return rules.delete(id);
    },
    async listVersions(id: string): Promise<RuleVersionEntry[]> {
      return versions.get(id) ?? [];
    },
  };

  const actionsRepo = {
    async list(): Promise<(ActionEntryLike)[]> {
      return [...actions.values()].map((action) => ({
        kind: 'valid' as const,
        action,
        hasSecret:
          action.type === 'webhook' &&
          action.config.secret !== undefined &&
          action.config.secret.length > 0,
      }));
    },
    async get(id: string): Promise<ActionEntryLike | undefined> {
      const action = actions.get(id);
      if (action === undefined) return undefined;
      return {
        kind: 'valid',
        action,
        hasSecret:
          action.type === 'webhook' &&
          action.config.secret !== undefined &&
          action.config.secret.length > 0,
      };
    },
    async create(content: ActionContent): Promise<ActionDefinition> {
      const action = actionFromContent(content);
      actions.set(action.id, action);
      return action;
    },
    async update(id: string, content: ActionContent): Promise<ActionEntryLike | undefined> {
      if (!actions.has(id)) return undefined;
      const action = actionFromContent(content, id);
      actions.set(id, action);
      return {
        kind: 'valid',
        action,
        hasSecret:
          action.type === 'webhook' &&
          action.config.secret !== undefined &&
          action.config.secret.length > 0,
      };
    },
    async delete(id: string): Promise<boolean> {
      return actions.delete(id);
    },
    async getForExecution(id: string): Promise<ActionDefinition | undefined> {
      return actions.get(id);
    },
  };

  const executionsRepo = {
    async listByAction(actionId: string): Promise<ExecutionSummary[]> {
      return executions.get(actionId) ?? [];
    },
    async listByFlag(flagId: string): Promise<ExecutionSummary[]> {
      return [...executions.values()].flat().filter((row) => row.flagId === flagId);
    },
  };

  const flagsRepo = {
    async list(filter: {
      ruleId?: string;
      sourceId?: string;
      outcome?: string;
      limit?: number;
      offset?: number;
    } = {}): Promise<FlagEntry[]> {
      const filtered = flags.filter((entry) => {
        if (entry.kind !== 'valid') return true;
        const flag = entry.flag;
        if (filter.ruleId !== undefined && flag.ruleId !== filter.ruleId) return false;
        if (filter.sourceId !== undefined && flag.sourceId !== filter.sourceId) return false;
        if (filter.outcome !== undefined && flag.outcome !== filter.outcome) return false;
        return true;
      });
      return filtered.slice(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 50));
    },
    async get(id: string): Promise<FlagEntry | undefined> {
      return flags.find((entry) => (entry.kind === 'valid' ? entry.flag.id : entry.id) === id);
    },
  };

  backend.repositories = {
    rules: rulesRepo,
    actions: actionsRepo,
    executions: executionsRepo,
    flags: flagsRepo,
  } as unknown as Repositories;
  return backend;
}

interface ActionEntryLike {
  kind: 'valid';
  action: ActionDefinition;
  hasSecret: boolean;
}

export interface TestAppOptions extends Partial<HttpAppDeps> {
  backend?: FakeBackend;
}

export interface TestApp {
  app: ReturnType<typeof buildApp>;
  deps: HttpAppDeps;
  backend: FakeBackend;
}

export function createTestApp(options: TestAppOptions = {}): TestApp {
  const backend = options.backend ?? createFakeBackend();
  const deps: HttpAppDeps = {
    repositories: backend.repositories,
    ruleCache: {
      invalidate: () => {
        backend.invalidations += 1;
      },
    },
    gateway: {
      evaluate: async () => {
        throw new Error('fake gateway was not configured');
      },
    },
    metrics: new ApiMetrics(),
    readiness: {
      database: async () => {},
      kafka: async () => {},
      jevAuth: () => ({ ok: true }),
    },
    ...options,
  };
  const app = buildApp(deps);
  return { app, deps, backend };
}

export function testHub(): SseHub {
  return new SseHub({ heartbeatMs: 0 });
}
