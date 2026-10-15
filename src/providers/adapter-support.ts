/**
 * Shared adapter helpers.
 *
 * Providers are only required to implement the channels they actually support
 * (Prompt 2 §6, §11). A provider with no authorized API must NOT get a fake API
 * adapter — it is represented by capability state only.
 */

import type { PollInfo, WaitRequest } from '../domain/types.js';

export class AdapterError extends Error {
  override readonly name: string;
  readonly code: 'CONFIGURATION_ERROR' | 'API_REQUEST_FAILED' | 'UI_AUTOMATION_FAILED' | 'TEST_INFRASTRUCTURE_ERROR';
  readonly httpStatus?: number;

  constructor(
    code: AdapterError['code'],
    message: string,
    options: { httpStatus?: number } = {},
  ) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    if (options.httpStatus !== undefined) this.httpStatus = options.httpStatus;
  }
}

export interface PollLoopResult<T> {
  readonly found: T | null;
  readonly attempts: number;
  readonly lastNegativeAt: string | null;
  readonly firstPositiveAt: string | null;
  readonly timedOut: boolean;
}

/**
 * Generic polling loop.
 *
 * A fixed interval is used (no fixed sleeps as the primary sync mechanism beyond
 * the poll gap itself, which is a deliberate documented parameter). Each attempt
 * is reported via `onPoll` so the sampler can record the last negative and first
 * positive poll.
 */
export async function pollUntil<T>(
  request: WaitRequest,
  attempt: (attemptIndex: number) => Promise<T | null>,
): Promise<PollLoopResult<T>> {
  const deadline = Date.now() + request.timeoutMs;
  let attempts = 0;
  let lastNegativeAt: string | null = null;

  for (;;) {
    attempts += 1;
    const startedAt = Date.now();
    const result = await attempt(attempts);
    const at = new Date().toISOString();

    const info: PollInfo = {
      attempt: attempts,
      at,
      found: result !== null,
      requestDurationMs: Date.now() - startedAt,
    };
    request.onPoll?.(info);

    if (result !== null) {
      return { found: result, attempts, lastNegativeAt, firstPositiveAt: at, timedOut: false };
    }
    lastNegativeAt = at;

    if (Date.now() >= deadline) {
      return { found: null, attempts, lastNegativeAt, firstPositiveAt: null, timedOut: true };
    }
    const remaining = deadline - Date.now();
    await sleep(Math.min(request.pollIntervalMs, Math.max(0, remaining)));
  }
}

/** Injectable sleep so poll loops can be tested deterministically. */
let sleepImpl: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

export function setSleepImpl(fn: (ms: number) => Promise<void>): void {
  sleepImpl = fn;
}

export function sleep(ms: number): Promise<void> {
  return sleepImpl(ms);
}

/**
 * Minimal POST-JSON helper built on global fetch.
 *
 * `Connection: close` is sent deliberately: Node's bundled fetch (undici) reuses
 * keep-alive sockets, and against at least one provider endpoint (api.maildrop.cc)
 * a reused socket can stall indefinitely — a 773 ms request was observed taking
 * ~270 s. Our poll cadence is seconds apart, so connection reuse buys nothing,
 * and forcing close makes the HTTP client deterministic.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ readonly status: number; readonly json: T | null; readonly durationMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Connection: 'close',
        ...(options.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const durationMs = Date.now() - startedAt;
    let json: T | null = null;
    try {
      json = (await response.json()) as T;
    } catch {
      json = null;
    }
    return { status: response.status, json, durationMs };
  } catch (err) {
    const e = err as Error;
    const durationMs = Date.now() - startedAt;
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new AdapterError('API_REQUEST_FAILED', `Request to ${url} timed out after ${durationMs}ms`);
    }
    throw new AdapterError('API_REQUEST_FAILED', `Request to ${url} failed: ${e.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export interface GraphQlResponse<T> {
  readonly data?: T | null;
  readonly errors?: readonly { readonly message: string }[];
}

/** Executes a GraphQL query and unwraps the data or throws an AdapterError. */
export async function graphql<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown> = {},
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ readonly data: T; readonly durationMs: number }> {
  const { status, json, durationMs } = await postJson<GraphQlResponse<T>>(
    endpoint,
    { query, variables },
    options,
  );
  if (status === 429) {
    throw new AdapterError('API_REQUEST_FAILED', 'Provider rate limited (HTTP 429)', { httpStatus: 429 });
  }
  if (status >= 500) {
    throw new AdapterError('API_REQUEST_FAILED', `Provider error (HTTP ${status})`, { httpStatus: status });
  }
  if (status >= 400) {
    throw new AdapterError('API_REQUEST_FAILED', `Request rejected (HTTP ${status})`, { httpStatus: status });
  }
  if (json?.errors && json.errors.length > 0) {
    throw new AdapterError('API_REQUEST_FAILED', `GraphQL error: ${json.errors[0]?.message ?? 'unknown'}`);
  }
  if (json?.data === undefined || json.data === null) {
    throw new AdapterError('API_REQUEST_FAILED', 'GraphQL response contained no data');
  }
  return { data: json.data, durationMs };
}
