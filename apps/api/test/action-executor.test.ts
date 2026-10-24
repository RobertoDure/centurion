import type { ActionDefinition, ActionPayload } from '@centurion/contracts';
import { describe, expect, it, vi } from 'vitest';

import { ActionExecutor, type ExecutionStore } from '../src/actions/executor';
import { ActionRegistry } from '../src/actions/registry';
import type { ActionHandler } from '../src/actions/types';
import type { ClaimedExecution, ExecutionContext } from '../src/db/repositories/action-executions';

const payload: ActionPayload = {
  flagId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  rule: { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3302', name: 'r', version: 1 },
  source: { id: 'svc' },
  messageRef: { topic: 'logs.raw', partition: 0, offset: '1' },
  answer: { type: 'noul', noul: 0.9 },
  triggeredAt: '2026-10-01T12:00:00.000Z',
};

interface Row {
  id: string;
  flagId: string;
  actionId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  attempts: number;
  lastError: string | null;
  nextAttemptAt: Date | null;
}

class FakeStore implements ExecutionStore {
  readonly rows: Row[] = [];
  readonly contexts = new Map<string, ExecutionContext>();
  recovered = 0;

  add(id: string): void {
    this.rows.push({
      id,
      flagId: payload.flagId,
      actionId: 'action-1',
      status: 'pending',
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
    });
  }

  setContext(id: string, action: ActionDefinition, execPayload: ActionPayload = payload): void {
    this.contexts.set(id, {
      execution: { id, flagId: payload.flagId, actionId: action.id, attempts: 0 },
      action,
      payload: execPayload,
    });
  }

  async claimDue(limit: number): Promise<ClaimedExecution[]> {
    const due = this.rows.filter((row) => row.status === 'pending').slice(0, limit);
    return due.map((row) => {
      row.status = 'running';
      row.attempts += 1;
      return { id: row.id, flagId: row.flagId, actionId: row.actionId, attempts: row.attempts };
    });
  }

  async loadContext(execution: ClaimedExecution): Promise<ExecutionContext | undefined> {
    return this.contexts.get(execution.id);
  }

  async markSucceeded(id: string): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row !== undefined) row.status = 'succeeded';
  }

  async markFailed(
    id: string,
    error: string,
    options: { final: boolean; nextAttemptAt?: Date },
  ): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row === undefined) return;
    row.status = options.final ? 'failed' : 'pending';
    row.lastError = error;
    row.nextAttemptAt = options.nextAttemptAt ?? null;
  }

  async recoverStuck(): Promise<number> {
    this.recovered += 1;
    return 0;
  }
}

const action: ActionDefinition = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3303',
  type: 'kafka_topic',
  name: 'a',
  enabled: true,
  config: { topic: 'logs.flags' },
};

function registryWith(execute: ActionHandler<{ topic: string }>['execute']): ActionRegistry {
  return new ActionRegistry().register({ type: 'kafka_topic', execute });
}

describe('ActionExecutor', () => {
  it('retries with backoff and eventually succeeds', async () => {
    const store = new FakeStore();
    store.add('exec-1');
    store.setContext('exec-1', action);
    let calls = 0;
    const registry = registryWith(async () => {
      calls += 1;
      if (calls <= 2) throw new Error(`failure ${calls}`);
      return { detail: 'ok' };
    });
    const executor = new ActionExecutor({
      store,
      registry,
      maxAttempts: 5,
      backoffBaseMs: 100,
      random: () => 0,
      now: () => 1_000_000,
    });

    await executor.runOnce();
    expect(store.rows[0]?.status).toBe('pending');
    expect(store.rows[0]?.attempts).toBe(1);
    expect(store.rows[0]?.lastError).toBe('failure 1');
    expect(store.rows[0]?.nextAttemptAt?.getTime()).toBe(1_000_100);

    await executor.runOnce();
    expect(store.rows[0]?.status).toBe('pending');
    expect(store.rows[0]?.attempts).toBe(2);

    await executor.runOnce();
    expect(store.rows[0]?.status).toBe('succeeded');
    expect(calls).toBe(3);
  });

  it('marks permanently failed after ACTION_MAX_ATTEMPTS', async () => {
    const store = new FakeStore();
    store.add('exec-2');
    store.setContext('exec-2', action);
    const registry = registryWith(async () => {
      throw new Error('permanent');
    });
    const executor = new ActionExecutor({ store, registry, maxAttempts: 2, random: () => 0 });

    await executor.runOnce();
    expect(store.rows[0]?.status).toBe('pending');
    await executor.runOnce();
    expect(store.rows[0]?.status).toBe('failed');
    expect(store.rows[0]?.lastError).toBe('permanent');
    await executor.runOnce();
    expect(store.rows[0]?.attempts).toBe(2);
  });

  it('fails permanently when the context is missing', async () => {
    const store = new FakeStore();
    store.add('exec-3');
    const registry = registryWith(vi.fn(async () => ({})));
    const executor = new ActionExecutor({ store, registry, maxAttempts: 5 });
    const result = await executor.runOnce();
    expect(result.failed).toBe(1);
    expect(store.rows[0]?.status).toBe('failed');
  });

  it('never claims the same execution twice concurrently (store contract)', async () => {
    const store = new FakeStore();
    store.add('exec-4');
    store.setContext('exec-4', action);
    const registry = registryWith(async () => ({}));
    const executor = new ActionExecutor({ store, registry, maxAttempts: 1 });
    const [first, second] = await Promise.all([executor.runOnce(), executor.runOnce()]);
    expect(first.claimed + second.claimed).toBe(1);
  });

  it('recovers stuck rows on start and stops cleanly', async () => {
    const store = new FakeStore();
    const registry = registryWith(async () => ({}));
    const executor = new ActionExecutor({ store, registry, maxAttempts: 1 });
    await executor.start(100_000);
    expect(store.recovered).toBe(1);
    executor.stop();
  });
});
