import type { Rule } from '@centurion/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { RuleListEntry } from '../src/db/repositories/types';
import { RuleCache, type RuleSource } from '../src/pipeline/rule-cache';

function rule(id: string, scope: Rule['scope'] = {}): Rule {
  return {
    id,
    name: id,
    enabled: true,
    scope,
    question: { type: 'noul', instructions: 'x' },
    condition: { type: 'noul', op: 'gte', threshold: 0.5 },
    uncertainPolicy: 'ignore',
    actionIds: [],
    version: 1,
  };
}

function sourceOf(entries: RuleListEntry[]): RuleSource & { calls: number } {
  const source = {
    calls: 0,
    list: async () => {
      source.calls += 1;
      return entries;
    },
  };
  return source;
}

describe('RuleCache', () => {
  it('loads valid rules and reports invalid ones', async () => {
    const source = sourceOf([
      { kind: 'valid', rule: rule('a') },
      { kind: 'invalid', id: 'b', name: 'broken', enabled: true, version: 1, reason: 'bad question' },
    ]);
    const cache = new RuleCache({ source, refreshSeconds: 60 });
    const snapshot = await cache.getSnapshot();
    expect(snapshot.rules.map((entry) => entry.id)).toEqual(['a']);
    expect(snapshot.invalid).toEqual([{ id: 'b', name: 'broken', reason: 'bad question' }]);
  });

  it('skips disabled rules', async () => {
    const source = sourceOf([
      { kind: 'valid', rule: { ...rule('a'), enabled: false } },
      { kind: 'valid', rule: rule('b') },
    ]);
    const cache = new RuleCache({ source, refreshSeconds: 60 });
    const snapshot = await cache.getSnapshot();
    expect(snapshot.rules.map((entry) => entry.id)).toEqual(['b']);
  });

  it('reloads after invalidate without a restart', async () => {
    const source = sourceOf([{ kind: 'valid', rule: rule('a') }]);
    const cache = new RuleCache({ source, refreshSeconds: 60 });
    await cache.getSnapshot();
    cache.invalidate();
    await cache.getSnapshot();
    expect(source.calls).toBe(2);
  });

  it('refreshes once the refresh interval elapses', async () => {
    let current = 0;
    const source = sourceOf([{ kind: 'valid', rule: rule('a') }]);
    const cache = new RuleCache({ source, refreshSeconds: 10, now: () => current });
    await cache.getSnapshot();
    current += 5_000;
    await cache.getSnapshot();
    expect(source.calls).toBe(1);
    current += 6_000;
    await cache.getSnapshot();
    expect(source.calls).toBe(2);
  });

  it('applies scope in code before any Jev call', async () => {
    const source = sourceOf([
      { kind: 'valid', rule: rule('all') },
      { kind: 'valid', rule: rule('checkout', { sources: ['checkout-api'], levels: ['error'] }) },
      { kind: 'valid', rule: rule('search', { sources: ['search-api'] }) },
    ]);
    const cache = new RuleCache({ source, refreshSeconds: 60 });
    const selected = await cache.selectFor({ source: { id: 'checkout-api' }, level: 'error' });
    expect(selected.map((entry) => entry.id)).toEqual(['all', 'checkout']);
  });

  it('coalesces concurrent refreshes', async () => {
    const source = sourceOf([{ kind: 'valid', rule: rule('a') }]);
    const cache = new RuleCache({ source, refreshSeconds: 60 });
    await Promise.all([cache.refresh(), cache.refresh(), cache.refresh()]);
    expect(source.calls).toBe(1);
  });

  it('keeps the previous snapshot when a background refresh fails', async () => {
    let calls = 0;
    const logger = { warn: vi.fn<(message: string) => void>() };
    const source: RuleSource = {
      list: async () => {
        calls += 1;
        if (calls === 1) return [{ kind: 'valid', rule: rule('a') }];
        throw new Error('db down');
      },
    };
    const cache = new RuleCache({ source, refreshSeconds: 60, logger });
    await cache.getSnapshot();
    cache.invalidate();
    await expect(cache.getSnapshot()).rejects.toThrow('db down');
    cache.stop();
  });

  it('starts and stops the background refresh timer', async () => {
    const source = sourceOf([{ kind: 'valid', rule: rule('a') }]);
    const cache = new RuleCache({ source, refreshSeconds: 3600 });
    cache.start();
    cache.start();
    cache.stop();
    cache.stop();
    expect(source.calls).toBe(0);
  });
});
