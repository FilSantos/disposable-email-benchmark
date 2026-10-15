import { describe, it, expect } from 'vitest';
import { summarize, wilsonInterval, percentile, P99_MIN_SAMPLE } from '../../src/metrics/metrics.js';

describe('percentile', () => {
  it('returns null for an empty sample', () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it('returns the only value for a single sample', () => {
    expect(percentile([42], 0.9)).toBe(42);
  });

  it('interpolates between neighbours', () => {
    // sorted [10,20,30,40]; position for q=0.5 is 1.5 => 20 + (30-20)*0.5 = 25
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
  });

  it('returns the max at q=1', () => {
    expect(percentile([1, 2, 3, 4, 5], 1)).toBe(5);
  });
});

describe('summarize', () => {
  it('reports nulls for no data and never fabricates', () => {
    const s = summarize([]);
    expect(s.n).toBe(0);
    expect(s.mean).toBeNull();
    expect(s.median).toBeNull();
    expect(s.p99).toBeNull();
    expect(s.p99Eligible).toBe(false);
  });

  it('computes mean, median and dispersion', () => {
    const s = summarize([10, 20, 30, 40]);
    expect(s.n).toBe(4);
    expect(s.mean).toBe(25);
    expect(s.median).toBe(25);
    expect(s.min).toBe(10);
    expect(s.max).toBe(40);
    expect(s.stdDev).toBeCloseTo(Math.sqrt(125), 6);
  });

  it('withholds P99 below the minimum sample size', () => {
    const small = summarize(Array.from({ length: P99_MIN_SAMPLE - 1 }, (_, i) => i));
    expect(small.p99).toBeNull();
    expect(small.p99Eligible).toBe(false);

    const large = summarize(Array.from({ length: P99_MIN_SAMPLE }, (_, i) => i));
    expect(large.p99).not.toBeNull();
    expect(large.p99Eligible).toBe(true);
  });

  it('ignores non-finite values', () => {
    const s = summarize([1, Number.NaN, 3, Number.POSITIVE_INFINITY]);
    expect(s.n).toBe(2);
    expect(s.mean).toBe(2);
  });
});

describe('wilsonInterval', () => {
  it('returns null rate for a zero denominator', () => {
    const r = wilsonInterval(0, 0);
    expect(r.rate).toBeNull();
    expect(r.ci95Low).toBeNull();
  });

  it('bounds the interval within [0,1]', () => {
    const r = wilsonInterval(19, 20);
    expect(r.rate).toBeCloseTo(0.95, 6);
    expect(r.ci95Low).toBeGreaterThan(0);
    expect(r.ci95High).toBeLessThanOrEqual(1);
  });

  it('is wider for small samples than for large ones', () => {
    const small = wilsonInterval(9, 10);
    const large = wilsonInterval(900, 1000);
    const smallWidth = (small.ci95High ?? 0) - (small.ci95Low ?? 0);
    const largeWidth = (large.ci95High ?? 0) - (large.ci95Low ?? 0);
    expect(smallWidth).toBeGreaterThan(largeWidth);
  });

  it('handles a perfect score without exceeding 1', () => {
    const r = wilsonInterval(10, 10);
    expect(r.ci95High).toBeLessThanOrEqual(1);
    expect(r.ci95Low).toBeGreaterThan(0.5);
  });
});
