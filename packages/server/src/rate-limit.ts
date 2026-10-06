/** What one `take` saw: whether it was allowed, and the numbers for the RateLimit headers. */
export interface Take {
  allowed: boolean;
  /** Whole requests left right now. */
  remaining: number;
  /** Seconds until the bucket is full again. */
  reset: number;
  /** Seconds until the next request would be allowed (0 if one would be now). */
  retryAfter: number;
}

/** Token bucket. `capacity` actions burst, refilled at `perSecond`. Clock is injected for tests. */
export class RateLimiter {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  take(): boolean {
    return this.takeInfo().allowed;
  }

  takeInfo(): Take {
    this.refill();
    const allowed = this.tokens >= 1;
    if (allowed) this.tokens -= 1;
    return {
      allowed,
      remaining: Math.floor(this.tokens),
      reset: Math.ceil((this.capacity - this.tokens) / this.perSecond),
      retryAfter: this.tokens >= 1 ? 0 : Math.ceil((1 - this.tokens) / this.perSecond),
    };
  }

  /** True when the bucket has refilled completely, so forgetting it changes nothing. */
  isFull(): boolean {
    this.refill();
    return this.tokens >= this.capacity;
  }

  private refill() {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.perSecond);
    this.last = t;
  }
}

/** One bucket per key (resident or IP). Full buckets are dropped by `prune()` so memory stays bounded. */
export class RateLimiters {
  private readonly buckets = new Map<string, RateLimiter>();

  constructor(
    readonly capacity: number,
    readonly perSecond: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): boolean {
    return this.takeInfo(key).allowed;
  }

  takeInfo(key: string): Take {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new RateLimiter(this.capacity, this.perSecond, this.now);
      this.buckets.set(key, bucket);
    }
    return bucket.takeInfo();
  }

  prune() {
    for (const [key, bucket] of this.buckets) if (bucket.isFull()) this.buckets.delete(key);
  }

  get size(): number {
    return this.buckets.size;
  }
}
