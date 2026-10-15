/**
 * Metrics (Prompt 2 §15, §16).
 *
 * Derived metrics are computed ONLY when both endpoints exist. An undetected
 * message has `null` latency — the timeout value is never substituted as if it
 * were an observation. Timeout-censored samples are counted separately.
 *
 * Percentiles are computed only from samples that have a real observation, and
 * the sample size used is always returned so a caller can judge meaning.
 */

import type { Channel, SampleRecord } from '../domain/types.js';

export interface DerivedMetrics {
  readonly detectionLatencyMs: number | null;
  readonly contentLatencyMs: number | null;
  readonly contentAccessDurationMs: number | null;
}

export function delta(fromIso: string | null, toIso: string | null): number | null {
  if (!fromIso || !toIso) return null;
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return b - a;
}

/**
 * Computes the three channel-specific derived metrics for a sample.
 * Returns nulls rather than fabricating values when data is missing.
 */
export function deriveMetrics(sample: SampleRecord): DerivedMetrics {
  const t0 = sample.smtpAcceptedAt;
  const isUi = sample.channel === 'UI';
  const firstDetected = isUi ? sample.uiFirstDetectedAt : sample.apiFirstDetectedAt;
  const contentAvailable = isUi ? sample.uiContentAvailableAt : sample.apiContentAvailableAt;

  return {
    detectionLatencyMs: delta(t0, firstDetected),
    contentLatencyMs: delta(t0, contentAvailable),
    contentAccessDurationMs: delta(firstDetected, contentAvailable),
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface PercentileSet {
  readonly n: number;
  readonly mean: number | null;
  readonly median: number | null;
  readonly p90: number | null;
  readonly p95: number | null;
  /** Only meaningful at n >= 100; otherwise null and flagged in the report. */
  readonly p99: number | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly stdDev: number | null;
  /** P95 - P50: a simple spread indicator. */
  readonly spread: number | null;
  readonly p99Eligible: boolean;
}

export const P99_MIN_SAMPLE = 100;

export function percentile(sortedAsc: readonly number[], q: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0] ?? null;
  const position = (sortedAsc.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lo = sortedAsc[lower] as number;
  const hi = sortedAsc[upper] as number;
  if (lower === upper) return lo;
  return lo + (hi - lo) * (position - lower);
}

export function summarize(values: readonly number[]): PercentileSet {
  const clean = values.filter((v) => Number.isFinite(v));
  const n = clean.length;
  if (n === 0) {
    return {
      n: 0,
      mean: null,
      median: null,
      p90: null,
      p95: null,
      p99: null,
      min: null,
      max: null,
      stdDev: null,
      spread: null,
      p99Eligible: false,
    };
  }
  const sorted = [...clean].sort((a, b) => a - b);
  const mean = clean.reduce((a, b) => a + b, 0) / n;
  const variance = clean.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const median = percentile(sorted, 0.5);
  const p90 = percentile(sorted, 0.9);
  const p95 = percentile(sorted, 0.95);
  return {
    n,
    mean,
    median,
    p90,
    p95,
    p99: n >= P99_MIN_SAMPLE ? percentile(sorted, 0.99) : null,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
    stdDev: Math.sqrt(variance),
    spread: p95 !== null && median !== null ? p95 - median : null,
    p99Eligible: n >= P99_MIN_SAMPLE,
  };
}

// ---------------------------------------------------------------------------
// Wilson score interval for rates (Prompt 2 §16)
// ---------------------------------------------------------------------------

export interface RateEstimate {
  readonly numerator: number;
  readonly denominator: number;
  /** Proportion as a number in [0,1], or null when the denominator is zero. */
  readonly rate: number | null;
  readonly ci95Low: number | null;
  readonly ci95High: number | null;
}

export function wilsonInterval(successes: number, total: number, z = 1.96): RateEstimate {
  if (total === 0) {
    return { numerator: successes, denominator: total, rate: null, ci95Low: null, ci95High: null };
  }
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return {
    numerator: successes,
    denominator: total,
    rate: p,
    ci95Low: Math.max(0, (center - margin) / denom),
    ci95High: Math.min(1, (center + margin) / denom),
  };
}

// ---------------------------------------------------------------------------
// Reliability funnel + failure distribution
// ---------------------------------------------------------------------------

export interface FunnelCounts {
  readonly attempted: number;
  readonly smtpAccepted: number;
  readonly detected: number;
  readonly contentAvailable: number;
  readonly validated: number;
}

export interface ReliabilityMetrics {
  readonly funnel: FunnelCounts;
  readonly detectionRate: RateEstimate;
  readonly contentAvailabilityRate: RateEstimate;
  readonly contentValidationRate: RateEstimate;
  readonly timeoutRate: RateEstimate;
  readonly smtpFailureRate: RateEstimate;
  readonly failureDistribution: Readonly<Record<string, number>>;
}

export function isDetected(sample: SampleRecord): boolean {
  return sample.channel === 'UI'
    ? sample.uiFirstDetectedAt !== null
    : sample.apiFirstDetectedAt !== null;
}

export function isContentAvailable(sample: SampleRecord): boolean {
  return sample.channel === 'UI'
    ? sample.uiContentAvailableAt !== null
    : sample.apiContentAvailableAt !== null;
}

/**
 * Computes reliability from REAL samples only (Prompt 2 §19).
 * Every rate carries its own explicit denominator.
 */
export function computeReliability(samples: readonly SampleRecord[]): ReliabilityMetrics {
  const real = samples.filter((s) => s.sampleOrigin === 'REAL');
  const attempted = real.length;
  const smtpAccepted = real.filter((s) => s.smtpStatus === 'ACCEPTED').length;
  const detected = real.filter(isDetected).length;
  const contentAvailable = real.filter(isContentAvailable).length;
  const validated = real.filter((s) => s.contentValidationStatus === 'PASS').length;
  const timedOut = real.filter((s) => s.timeoutStatus !== 'NONE').length;
  const smtpFailed = real.filter((s) => s.smtpStatus !== 'ACCEPTED').length;

  const failureDistribution: Record<string, number> = {};
  for (const s of real) {
    if (s.failureCategory) {
      failureDistribution[s.failureCategory] = (failureDistribution[s.failureCategory] ?? 0) + 1;
    }
  }

  return {
    funnel: { attempted, smtpAccepted, detected, contentAvailable, validated },
    // Detection/validation denominators use SMTP-accepted samples: no message was
    // sent for samples the SMTP server rejected, so they cannot be a delivery miss.
    detectionRate: wilsonInterval(detected, smtpAccepted),
    contentAvailabilityRate: wilsonInterval(contentAvailable, detected),
    contentValidationRate: wilsonInterval(validated, contentAvailable),
    timeoutRate: wilsonInterval(timedOut, smtpAccepted),
    smtpFailureRate: wilsonInterval(smtpFailed, attempted),
    failureDistribution,
  };
}

/** Samples eligible for a latency statistic (REAL + observed). */
export function observedLatencies(
  samples: readonly SampleRecord[],
  channel: Channel,
  metric: 'detection' | 'content',
): number[] {
  const out: number[] = [];
  for (const s of samples) {
    if (s.sampleOrigin !== 'REAL' || s.channel !== channel) continue;
    const value = metric === 'detection' ? s.detectionLatencyMs : s.contentLatencyMs;
    if (value !== null) out.push(value);
  }
  return out;
}
