/**
 * Provider rate limiting (Prompt 2 §13, §20; BR-013).
 *
 * A sliding-window limiter that refuses to exceed a published limit, plus
 * exponential back-off on HTTP 429. Exceeding our own limit is a HARNESS defect,
 * not a provider finding, so the limiter is deliberately strict.
 */

export interface RateLimitRule {
  readonly maxRequests: number;
  readonly windowMs: number;
}

/** Documented limits we must honour. Providers with unpublished limits get a conservative default. */
export const RATE_LIMITS: Readonly<Record<string, RateLimitRule | undefined>> = {
  // Published: 50 queries per 10 seconds.
  maildrop: { maxRequests: 50, windowMs: 10_000 },
  // Unpublished — conservative defaults to avoid triggering provider protections.
  mailinator: { maxRequests: 10, windowMs: 10_000 },
  guerrillamail: { maxRequests: 5, windowMs: 10_000 },
  yopmail: { maxRequests: 5, windowMs: 10_000 },
  tenminutemail: { maxRequests: 5, windowMs: 10_000 },
};

const DEFAULT_RULE: RateLimitRule = { maxRequests: 5, windowMs: 10_000 };

export class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    private readonly rule: RateLimitRule,
    private readonly now: () => number = () => Date.now(),
  ) {}

  static forProvider(providerId: string, now?: () => number): RateLimiter {
    return new RateLimiter(RATE_LIMITS[providerId] ?? DEFAULT_RULE, now);
  }

  private prune(): void {
    const cutoff = this.now() - this.rule.windowMs;
    this.timestamps = this.timestamps.filter((t) => t > cutoff);
  }

  /** Milliseconds to wait before the next request is permitted. */
  nextSlotDelayMs(): number {
    this.prune();
    if (this.timestamps.length < this.rule.maxRequests) return 0;
    const oldest = this.timestamps[0] as number;
    return Math.max(0, oldest + this.rule.windowMs - this.now());
  }

  async acquire(): Promise<void> {
    for (;;) {
      const wait = this.nextSlotDelayMs();
      if (wait <= 0) break;
      await new Promise((r) => setTimeout(r, wait));
    }
    this.timestamps.push(this.now());
  }

  /** Records usage without waiting (used when a request already happened). */
  record(): void {
    this.timestamps.push(this.now());
  }
}

export interface BackoffOptions {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 15_000,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** Runs an operation, retrying on HTTP 429 with exponential back-off + jitter. */
export async function withBackoff<T>(
  operation: () => Promise<T>,
  isRateLimited: (result: T) => boolean,
  options: Partial<BackoffOptions> = {},
): Promise<{ readonly result: T; readonly retries: number; readonly rateLimitedExhausted: boolean }> {
  const opts = { ...DEFAULT_BACKOFF, ...options };
  const sleep = opts.sleep ?? DEFAULT_BACKOFF.sleep!;
  let attempt = 0;
  let last!: T;
  for (;;) {
    last = await operation();
    if (!isRateLimited(last)) {
      return { result: last, retries: attempt, rateLimitedExhausted: false };
    }
    if (attempt >= opts.maxRetries) {
      return { result: last, retries: attempt, rateLimitedExhausted: true };
    }
    const delay = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
    const jitter = Math.floor(Math.random() * 250);
    await sleep(delay + jitter);
    attempt += 1;
  }
}
