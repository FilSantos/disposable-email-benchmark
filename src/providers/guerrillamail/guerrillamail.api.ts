/**
 * Guerrilla Mail adapter (API channel).
 *
 * Documented public JSON API (v1.0) at https://www.guerrillamail.com/ajax.php.
 * No API key; the client must supply `ip` and `agent` params and persist the
 * PHPSESSID cookie across calls (verified 2026-10-14).
 *
 * Retention is 1 hour. The ToS explicitly prohibits request flooding, so a
 * conservative limiter is applied.
 */

import type {
  ApiChannel,
  DetectedMessage,
  ProviderAdapter,
  ProviderCapabilities,
  RetrievedContent,
  WaitRequest,
  WaitResult,
} from '../../domain/types.js';
import { getCapabilityEntry } from '../capabilities.js';
import { AdapterError, pollUntil } from '../adapter-support.js';
import { RateLimiter } from '../rate-limit.js';

const ENDPOINT = 'https://www.guerrillamail.com/ajax.php';

interface GuerrillaEmail {
  readonly mail_id: string;
  readonly mail_from: string;
  readonly mail_subject: string;
  readonly mail_excerpt?: string;
  readonly mail_timestamp?: string;
  readonly mail_date?: string;
}

interface GuerrillaListResponse {
  readonly list?: readonly GuerrillaEmail[];
  /** Live response field for the current address. */
  readonly email_addr?: string;
  /** Documented alias for the same value. */
  readonly email?: string;
  readonly sid_token?: string;
  readonly count?: string;
}

interface GuerrillaFetchResponse extends GuerrillaEmail {
  readonly mail_body?: string;
}

export interface GuerrillaMailAdapterOptions {
  readonly agent?: string;
  readonly clientIp?: string;
  readonly timeoutMs?: number;
  readonly limiter?: RateLimiter;
  /** Injects a session cookie store for deterministic tests. */
  readonly cookieStore?: { get(): string | null; set(value: string): void };
}

export class GuerrillaMailApiAdapter implements ApiChannel {
  readonly channel = 'API' as const;
  private readonly limiter: RateLimiter;
  private sidToken: string | null = null;
  private sessionCookie: string | null = null;
  private inboxAddress: string | null = null;

  constructor(private readonly options: GuerrillaMailAdapterOptions = {}) {
    this.limiter = options.limiter ?? RateLimiter.forProvider('guerrillamail');
    this.sessionCookie = options.cookieStore?.get() ?? null;
  }

  isConfigured(): boolean {
    return true; // no credentials required
  }

  async getInboxAddress(): Promise<string> {
    if (this.inboxAddress) return this.inboxAddress;
    const response = await this.call<GuerrillaListResponse>('get_email_address', {});
    // The live API returns `email_addr`; `email` is kept as a documented alias.
    const email = response.email_addr ?? response.email;
    if (!email) {
      throw new AdapterError('API_REQUEST_FAILED', 'Guerrilla Mail did not return an email address');
    }
    if (response.sid_token) this.sidToken = response.sid_token;
    this.inboxAddress = email;
    return email;
  }

  async waitForMessage(req: WaitRequest): Promise<WaitResult> {
    const result = await pollUntil<DetectedMessage>(req, async () => {
      const list = await this.call<GuerrillaListResponse>('check_email', { seq: '0' });
      // The session token can rotate between calls; keep the latest.
      if (list.sid_token) this.sidToken = list.sid_token;
      const match = (list.list ?? []).find((m) =>
        decodeHtmlEntities(m.mail_subject ?? '').includes(req.correlationId),
      );
      if (!match) return null;
      return { detectedAt: new Date().toISOString(), messageRef: match.mail_id, raw: match };
    });

    return {
      detected: result.found,
      attempts: result.attempts,
      lastNegativeAt: result.lastNegativeAt,
      firstPositiveAt: result.firstPositiveAt,
      timedOut: result.timedOut,
    };
  }

  async getMessage(ref: DetectedMessage): Promise<RetrievedContent> {
    const response = await this.call<GuerrillaFetchResponse>('fetch_email', { email_id: ref.messageRef });
    const metadata: Record<string, string> = {};
    if (response.mail_from) metadata['mail_from'] = response.mail_from;
    if (response.mail_date) metadata['mail_date'] = response.mail_date;
    if (response.mail_timestamp) metadata['mail_timestamp'] = response.mail_timestamp;

    const rawBody = decodeHtmlEntities(response.mail_body ?? '');
    // Guerrilla Mail returns the (sanitized) body in `mail_body`. When the
    // message was HTML the body is HTML; otherwise it is plain text. Surface both
    // views rather than claiming HTML is unavailable while the capability matrix
    // says otherwise.
    const looksLikeHtml = /<html[\s>]|<body[\s>]|<br\s*\/?>|<p[\s>]|<div[\s>]/i.test(rawBody);

    return {
      contentAvailableAt: new Date().toISOString(),
      subject: decodeHtmlEntities(response.mail_subject ?? '') || null,
      textBody: rawBody || null,
      // Sanitized by the provider (scripts/iframes removed) — surfaced as-is.
      htmlBody: looksLikeHtml ? rawBody : null,
      metadata,
    };
  }

  private async call<T>(fn: string, params: Record<string, string>): Promise<T> {
    await this.limiter.acquire();
    const url = new URL(ENDPOINT);
    url.searchParams.set('f', fn);
    url.searchParams.set('ip', this.options.clientIp ?? '127.0.0.1');
    url.searchParams.set('agent', this.options.agent ?? 'ebm-benchmark');
    // Session continuity: the documented API accepts the sid_token as a parameter.
    if (this.sidToken && !('sid_token' in params)) url.searchParams.set('sid_token', this.sidToken);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    // Connection: close avoids undici keep-alive socket stalls (see adapter-support.ts).
    const headers: Record<string, string> = { Accept: 'application/json', Connection: 'close' };
    if (this.sessionCookie) headers['Cookie'] = `PHPSESSID=${this.sessionCookie}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      });
    } catch (err) {
      throw new AdapterError('API_REQUEST_FAILED', `Guerrilla Mail request failed: ${(err as Error).message}`);
    }

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const match = /PHPSESSID=([^;]+)/.exec(setCookie);
      if (match?.[1]) {
        this.sessionCookie = match[1];
        this.options.cookieStore?.set(match[1]);
      }
    }

    if (response.status === 429) {
      throw new AdapterError('API_REQUEST_FAILED', 'Guerrilla Mail rate limited (HTTP 429)', { httpStatus: 429 });
    }
    if (!response.ok) {
      throw new AdapterError('API_REQUEST_FAILED', `Guerrilla Mail HTTP ${response.status}`, {
        httpStatus: response.status,
      });
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new AdapterError('API_REQUEST_FAILED', 'Guerrilla Mail returned a non-JSON response');
    }
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

export function createGuerrillaMailAdapter(options: GuerrillaMailAdapterOptions = {}): ProviderAdapter {
  const entry = getCapabilityEntry('guerrillamail');
  if (!entry) throw new Error('guerrillamail capability entry missing');
  const capabilities: ProviderCapabilities = entry.capabilities;
  return {
    id: entry.id,
    displayName: entry.displayName,
    officialWebsite: entry.officialWebsite,
    domains: entry.domains,
    notes: entry.knownLimitations,
    capabilities: () => capabilities,
    api: new GuerrillaMailApiAdapter(options),
  };
}
