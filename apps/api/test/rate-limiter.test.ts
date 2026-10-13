import { describe, expect, it } from 'vitest';

import { TokenBucketRateLimiter } from '../src/jev/rate-limiter';

function fakeClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  sleeps: number[];
  advance: (ms: number) => void;
} {
  let current = 0;
  const sleeps: number[] = [];
  return {
    now: () => current,
    sleeps,
    advance: (ms) => {
      current += ms;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      current += ms;
    },
  };
}

describe('TokenBucketRateLimiter', () => {
  it('rejects an invalid rate', () => {
    expect(() => new TokenBucketRateLimiter({ maxRps: 0 })).toThrow();
    expect(() => new TokenBucketRateLimiter({ maxRps: Number.NaN })).toThrow();
  });

  it('consumes the burst without sleeping', async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({ maxRps: 10, burst: 3, now: clock.now, sleep: clock.sleep });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(clock.sleeps).toEqual([]);
  });

  it('waits for a refill once the burst is exhausted', async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({ maxRps: 2, burst: 1, now: clock.now, sleep: clock.sleep });
    await limiter.acquire();
    await limiter.acquire();
    expect(clock.sleeps).toEqual([500]);
    expect(clock.now()).toBe(500);
  });

  it('refills over elapsed time without sleeping', async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({ maxRps: 2, burst: 1, now: clock.now, sleep: clock.sleep });
    await limiter.acquire();
    clock.advance(1000);
    await limiter.acquire();
    expect(clock.sleeps).toEqual([]);
  });

  it('caps tokens at the burst capacity', async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({ maxRps: 1, burst: 1, now: clock.now, sleep: clock.sleep });
    await limiter.acquire();
    clock.advance(100_000);
    await limiter.acquire();
    clock.sleeps.length = 0;
    await limiter.acquire();
    expect(clock.sleeps).toEqual([1000]);
  });
});
