/**
 * Mailinator adapter (API channel).
 *
 * Documented REST API v2 (https://www.mailinator.com/mailinator-api/) requiring
 * an API token. Because a token requires a (free-with-verification or paid) plan,
 * this adapter reports CONFIGURATION_REQUIRED when no token is present rather
 * than fabricating results (verified 2026-10-14).
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

const BASE_URL = 'https://api.mailinator.com/api/v2';

interface MailinatorMessageSummary {
  readonly id: string;
  readonly subject?: string | null;
  readonly time?: number | null;
  readonly fromfull?: { readonly email?: string; readonly name?: string } | null;
}

interface MailinatorInboxResponse {
  readonly msgs?: readonly MailinatorMessageSummary[];
}

interface MailinatorParts {
  readonly body?: string | null;
  readonly headers?: Record<string, string> | null;
}

interface MailinatorMessageResponse {
  readonly id: string;
  readonly subject?: string | null;
  readonly from?: string | null;
  readonly fromfull?: { readonly email?: string; readonly name?: string } | null;
  readonly to?: string | null;
  readonly time?: number | null;
  readonly headers?: Record<string, string> | null;
  readonly parts?: readonly MailinatorParts[];
  readonly data?: unknown;
}

export interface MailinatorAdapterOptions {
  readonly token: string | null;
  readonly domain?: string;
  readonly inbox?: string;
  readonly timeoutMs?: number;
  readonly limiter?: RateLimiter;
}

export class MailinatorApiAdapter implements ApiChannel {
  readonly channel = 'API' as const;
  private readonly limiter: RateLimiter;
  private readonly domain: string;
  private readonly inbox: string;

  constructor(private readonly options: MailinatorAdapterOptions) {
    this.limiter = options.limiter ?? RateLimiter.forProvider('mailinator');
    this.domain = options.domain ?? 'public';
    this.inbox = options.inbox ?? `ebm-${Math.random().toString(36).slice(2, 10)}`;
  }

  isConfigured(): boolean {
    return Boolean(this.options.token);
  }

  async getInboxAddress(): Promise<string> {
    const domainPart = this.domain === 'public' ? 'mailinator.com' : this.domain;
    return `${this.inbox}@${domainPart}`;
  }

  async waitForMessage(req: WaitRequest): Promise<WaitResult> {
    const result = await pollUntil<DetectedMessage>(req, async () => {
      const response = await this.getJson<MailinatorInboxResponse>(
        `/domains/${this.domain}/inboxes/${encodeURIComponent(this.inbox)}`,
      );
      const match = (response.msgs ?? []).find((m) => (m.subject ?? '').includes(req.correlationId));
      if (!match) return null;
      return { detectedAt: new Date().toISOString(), messageRef: match.id, raw: match };
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
    const response = await this.getJson<MailinatorMessageResponse>(
      `/domains/${this.domain}/inboxes/${encodeURIComponent(this.inbox)}/messages/${encodeURIComponent(ref.messageRef)}`,
    );
    const textBody = (response.parts ?? [])
      .map((p) => p.body ?? '')
      .filter((b) => b.length > 0)
      .join('\n');
    const htmlPart = (response.parts ?? [])
      .map((p) => p.body ?? '')
      .find((b) => /<\w+[^>]*>/.test(b));

    const metadata: Record<string, string> = {};
    if (response.from) metadata['from'] = response.from;
    if (response.fromfull?.email) metadata['fromfull'] = response.fromfull.email;
    if (response.to) metadata['to'] = response.to;
    if (typeof response.time === 'number') metadata['time'] = new Date(response.time).toISOString();

    return {
      contentAvailableAt: new Date().toISOString(),
      subject: response.subject ?? null,
      textBody: textBody || null,
      htmlBody: htmlPart ?? null,
      metadata,
    };
  }

  private async getJson<T>(path: string): Promise<T> {
    await this.limiter.acquire();
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set('token', this.options.token ?? '');

    let response: Response;
    try {
      response = await fetch(url, {
        // Connection: close avoids undici keep-alive socket stalls (see adapter-support.ts).
        headers: { Connection: 'close' },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      });
    } catch (err) {
      throw new AdapterError('API_REQUEST_FAILED', `Mailinator request failed: ${(err as Error).message}`);
    }

    if (response.status === 401 || response.status === 403) {
      throw new AdapterError('CONFIGURATION_ERROR', 'Mailinator rejected the API token', {
        httpStatus: response.status,
      });
    }
    if (response.status === 429) {
      throw new AdapterError('API_REQUEST_FAILED', 'Mailinator rate limited (HTTP 429)', {
        httpStatus: response.status,
      });
    }
    if (!response.ok) {
      throw new AdapterError('API_REQUEST_FAILED', `Mailinator HTTP ${response.status}`, {
        httpStatus: response.status,
      });
    }
    return (await response.json()) as T;
  }
}

export function createMailinatorAdapter(options: MailinatorAdapterOptions): ProviderAdapter {
  const entry = getCapabilityEntry('mailinator');
  if (!entry) throw new Error('mailinator capability entry missing');
  const capabilities = entry.capabilities;
  // Only attach an API channel when configured; otherwise the provider remains
  // CONFIGURATION_REQUIRED and is skipped (never mocked).
  const adapter: ProviderAdapter = {
    id: entry.id,
    displayName: entry.displayName,
    officialWebsite: entry.officialWebsite,
    domains: entry.domains,
    notes: entry.knownLimitations,
    capabilities: () => capabilities,
  };
  if (options.token) {
    return { ...adapter, api: new MailinatorApiAdapter(options) };
  }
  return adapter;
}

export type { ProviderCapabilities };
