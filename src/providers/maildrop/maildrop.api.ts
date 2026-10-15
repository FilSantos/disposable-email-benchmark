/**
 * Maildrop adapter (API channel).
 *
 * Documented GraphQL API at https://api.maildrop.cc/graphql with no
 * authentication (verified 2026-10-14). Published limit: 50 queries / 10s.
 *
 * The listing query returns lightweight metadata; the full body (`data`, `html`)
 * is only returned by the single-message query, exactly as documented.
 */

import { randomUUID } from 'node:crypto';
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
import { AdapterError, graphql, pollUntil } from '../adapter-support.js';
import { decodePayload } from '../../validation/mime.js';
import { RateLimiter } from '../rate-limit.js';

const ENDPOINT = 'https://api.maildrop.cc/graphql';

interface InboxMessage {
  readonly id: string;
  readonly subject?: string | null;
  readonly date?: string | null;
  readonly headerfrom?: string | null;
}

interface FullMessage extends InboxMessage {
  readonly data?: string | null;
  readonly html?: string | null;
  readonly mailfrom?: string | null;
  readonly rcptto?: readonly string[] | null;
  readonly ip?: string | null;
  readonly helo?: string | null;
}

const INBOX_QUERY = `query Inbox($mailbox: String!) {
  inbox(mailbox: $mailbox) { id subject date headerfrom }
}`;

const MESSAGE_QUERY = `query Message($mailbox: String!, $id: String!) {
  message(mailbox: $mailbox, id: $id) {
    id subject date headerfrom mailfrom rcptto ip helo data html
  }
}`;

export interface MaildropAdapterOptions {
  /** Fixed mailbox name; a random one is generated when omitted. */
  readonly mailbox?: string;
  readonly timeoutMs?: number;
  readonly limiter?: RateLimiter;
  readonly requestDurations?: number[];
}

export class MaildropApiAdapter implements ApiChannel {
  readonly channel = 'API' as const;
  private readonly limiter: RateLimiter;
  private readonly mailbox: string;

  constructor(private readonly options: MaildropAdapterOptions = {}) {
    this.limiter = options.limiter ?? RateLimiter.forProvider('maildrop');
    this.mailbox = options.mailbox ?? `ebm-${randomUUID().slice(0, 12)}`;
  }

  /** Maildrop requires no credentials, so it is always configured. */
  isConfigured(): boolean {
    return true;
  }

  async getInboxAddress(): Promise<string> {
    return `${this.mailbox}@maildrop.cc`;
  }

  async waitForMessage(req: WaitRequest): Promise<WaitResult> {
    const mailbox = mailboxFrom(req.inbox);
    const result = await pollUntil<DetectedMessage>(req, async () => {
      await this.limiter.acquire();
      const { data, durationMs } = await graphql<{ inbox: readonly InboxMessage[] }>(
        ENDPOINT,
        INBOX_QUERY,
        { mailbox },
        { timeoutMs: this.options.timeoutMs ?? 15_000 },
      );
      this.recordDuration(durationMs, req);

      // Identify the CORRECT message: never accept the first message blindly.
      const match = data.inbox.find((m) => (m.subject ?? '').includes(req.correlationId));
      if (!match) return null;
      return { detectedAt: new Date().toISOString(), messageRef: match.id, raw: match };
    });

    if (!result.found) {
      // Distinguish "provider unreachable" from "message not found" via a final check.
      const reachable = await this.probeReachable();
      if (!reachable) {
        throw new AdapterError('API_REQUEST_FAILED', 'Maildrop API unreachable during polling');
      }
    }
    return {
      detected: result.found,
      attempts: result.attempts,
      lastNegativeAt: result.lastNegativeAt,
      firstPositiveAt: result.firstPositiveAt,
      timedOut: result.timedOut,
    };
  }

  async getMessage(ref: DetectedMessage): Promise<RetrievedContent> {
    await this.limiter.acquire();
    const { data } = await graphql<{ message: FullMessage | null }>(
      ENDPOINT,
      MESSAGE_QUERY,
      { mailbox: this.mailbox, id: ref.messageRef },
      { timeoutMs: this.options.timeoutMs ?? 15_000 },
    );
    if (!data.message) {
      throw new AdapterError('API_REQUEST_FAILED', `Maildrop message ${ref.messageRef} disappeared before retrieval`);
    }
    const message = data.message;
    const metadata: Record<string, string> = {};
    if (message.headerfrom) metadata['headerfrom'] = message.headerfrom;
    if (message.mailfrom) metadata['mailfrom'] = message.mailfrom;
    if (message.date) metadata['date'] = message.date;
    if (message.ip) metadata['ip'] = message.ip;
    if (message.helo) metadata['helo'] = message.helo;
    if (message.rcptto?.length) metadata['rcptto'] = message.rcptto.join(', ');

    // Maildrop's `data` is the raw SMTP payload. Relays commonly convert the
    // original plain text into HTML and add tracking pixels, so decode it and
    // surface a real text view instead of the raw MIME body.
    const decoded = message.data ? decodePayload(message.data) : null;

    return {
      contentAvailableAt: new Date().toISOString(),
      subject: message.subject ?? null,
      textBody: decoded?.textView ?? null,
      // Prefer the structured `html` field; fall back to the HTML view of `data`.
      htmlBody: message.html ?? decoded?.htmlView ?? null,
      metadata,
    };
  }

  private recordDuration(durationMs: number, req: WaitRequest): void {
    void req;
    this.options.requestDurations?.push(durationMs);
  }

  private async probeReachable(): Promise<boolean> {
    try {
      await this.limiter.acquire();
      await graphql<{ inbox: readonly InboxMessage[] }>(ENDPOINT, INBOX_QUERY, { mailbox: this.mailbox });
      return true;
    } catch {
      return false;
    }
  }
}

function mailboxFrom(address: string): string {
  return address.includes('@') ? (address.split('@')[0] ?? address) : address;
}

export function createMaildropAdapter(options: MaildropAdapterOptions = {}): ProviderAdapter {
  const entry = getCapabilityEntry('maildrop');
  if (!entry) throw new Error('maildrop capability entry missing');
  const api = new MaildropApiAdapter(options);
  const capabilities: ProviderCapabilities = entry.capabilities;
  return {
    id: entry.id,
    displayName: entry.displayName,
    officialWebsite: entry.officialWebsite,
    domains: entry.domains,
    notes: entry.knownLimitations,
    capabilities: () => capabilities,
    api,
  };
}
