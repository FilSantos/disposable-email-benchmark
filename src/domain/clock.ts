/**
 * Clock seam.
 *
 * Elapsed durations use a MONOTONIC source (process.hrtime.bigint) so they
 * cannot be skewed by wall-clock adjustments. Audit records use UTC ISO strings
 * for correlation (Prompt 2 §15).
 */

export interface Clock {
  /** UTC ISO-8601 timestamp for audit records. */
  nowUtc(): string;
  /** Monotonic milliseconds since an arbitrary epoch. Only differences are meaningful. */
  monotonicMs(): number;
}

export function createClock(): Clock {
  const origin = process.hrtime.bigint();
  return {
    nowUtc: () => new Date().toISOString(),
    monotonicMs: () => Number(process.hrtime.bigint() - origin) / 1_000_000,
  };
}

/** Milliseconds between two ISO timestamps. Returns null if either is missing. */
export function deltaMs(fromIso: string | null, toIso: string | null): number | null {
  if (!fromIso || !toIso) return null;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return to - from;
}

/** Injectable clock for deterministic tests. */
export function createFixedClock(startIso: string): Clock {
  let offsetMs = 0;
  return {
    nowUtc: () => new Date(Date.parse(startIso) + offsetMs).toISOString(),
    monotonicMs: () => offsetMs,
    // test helper
    ...({ advance: (ms: number) => (offsetMs += ms) } as Record<string, unknown>),
  };
}
