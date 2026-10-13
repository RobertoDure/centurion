export interface RateLimiter {
  acquire(): Promise<void>;
}

export interface TokenBucketOptions {
  /** Sustained requests per second (JEV_MAX_RPS). */
  maxRps: number;
  /** Burst capacity; defaults to one second worth of requests. */
  burst?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Token bucket driven by JEV_MAX_RPS. Jev's advertised rate limits are dynamic,
 * so the limit is configuration, never a constant.
 */
export class TokenBucketRateLimiter implements RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxRps: number;
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: TokenBucketOptions) {
    if (!Number.isFinite(options.maxRps) || options.maxRps <= 0) {
      throw new Error('maxRps must be a positive number');
    }
    this.maxRps = options.maxRps;
    this.capacity = options.burst ?? Math.max(1, Math.ceil(options.maxRps));
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? defaultSleep;
    this.tokens = this.capacity;
    this.lastRefill = this.now();
  }

  private refill(): void {
    const now = this.now();
    const elapsedMs = Math.max(0, now - this.lastRefill);
    this.tokens = Math.min(this.capacity, this.tokens + (elapsedMs / 1000) * this.maxRps);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.max(1, Math.ceil(((1 - this.tokens) / this.maxRps) * 1000));
      await this.sleep(waitMs);
    }
  }
}
