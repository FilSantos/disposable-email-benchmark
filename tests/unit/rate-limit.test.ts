import { describe, it, expect } from 'vitest';
import { RateLimiter, withBackoff, RATE_LIMITS } from '../../src/providers/rate-limit.js';

describe('RateLimiter', () => {
  it('allows requests up to the limit within the window', () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 }, () => 0);
    expect(limiter.nextSlotDelayMs()).toBe(0);
    limiter.record();
    limiter.record();
    limiter.record();
    expect(limiter.nextSlotDelayMs()).toBeGreaterThan(0);
  });

  it('frees slots once the window slides', () => {
    let now = 0;
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 }, () => now);
    limiter.record();
    limiter.record();
    expect(limiter.nextSlotDelayMs()).toBe(1000);
    now = 1500;
    expect(limiter.nextSlotDelayMs()).toBe(0);
  });

  it('honours the published Maildrop limit (50 per 10s)', () => {
    expect(RATE_LIMITS['maildrop']).toEqual({ maxRequests: 50, windowMs: 10_000 });
  });

  it('applies a conservative default for providers with unpublished limits', () => {
    const limiter = RateLimiter.forProvider('guerrillamail', () => 0);
    for (let i = 0; i < 5; i += 1) limiter.record();
    expect(limiter.nextSlotDelayMs()).toBeGreaterThan(0);
  });
});

describe('withBackoff', () => {
  it('returns immediately when the first attempt succeeds', async () => {
    let calls = 0;
    const result = await withBackoff(
      async () => {
        calls += 1;
        return { status: 200 };
      },
      (r) => r.status === 429,
      { sleep: async () => {} },
    );
    expect(calls).toBe(1);
    expect(result.retries).toBe(0);
    expect(result.rateLimitedExhausted).toBe(false);
  });

  it('retries on 429 and succeeds', async () => {
    let calls = 0;
    const sequence = [429, 429, 200];
    const result = await withBackoff(
      async () => ({ status: sequence[calls++] ?? 200 }),
      (r) => r.status === 429,
      { maxRetries: 5, sleep: async () => {} },
    );
    expect(calls).toBe(3);
    expect(result.result.status).toBe(200);
    expect(result.retries).toBe(2);
  });

  it('reports exhaustion rather than looping forever', async () => {
    let calls = 0;
    const result = await withBackoff(
      async () => {
        calls += 1;
        return { status: 429 };
      },
      (r) => r.status === 429,
      { maxRetries: 2, sleep: async () => {} },
    );
    expect(calls).toBe(3); // initial + 2 retries
    expect(result.rateLimitedExhausted).toBe(true);
  });
});
