/**
 * SMTP transports (Prompt 2 §9).
 *
 * Three modes, each explicitly labelled and never silently interchangeable:
 *
 *  - loopback : the message is delivered to OUR local SMTP server only. This
 *               proves the harness works end-to-end but performs NO external
 *               delivery. It is the safe default and the only mode guaranteed to
 *               work without network egress.
 *  - direct-mx: connects to the provider's MX on port 25. Frequently blocked by
 *               networks/ISPs; failures are classified as transport errors.
 *  - relay    : sends through an authenticated submission relay. Requires
 *               explicit configuration.
 *
 * The selected mode is recorded on every sample. Direct and relay results are
 * never merged unlabelled, and there is no automatic fallback between modes.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { resolveMx } from 'node:dns/promises';
import type { ErrorInfo, OutgoingMessage, SendResult, SmtpTransport, TransportMode } from '../domain/types.js';
import type { RelayConfig } from '../config/config.js';
import { createLogger, type Logger } from '../observability/logger.js';

function toErrorInfo(err: unknown): ErrorInfo {
  const e = err as NodeJS.ErrnoException & { responseCode?: number; response?: string };
  const info: ErrorInfo = {
    name: e?.name ?? 'Error',
    message: e?.message ?? String(err),
  };
  if (e?.code) (info as { code?: string }).code = e.code;
  if (e?.responseCode) (info as { httpStatus?: number }).httpStatus = e.responseCode;
  return info;
}

export type TransportErrorKind =
  | 'TRANSPORT_BLOCKED'
  | 'DNS_FAILURE'
  | 'AUTH_FAILED'
  | 'REJECTED'
  | 'TIMEOUT'
  | 'UNKNOWN';

/** Classifies a transport failure so it is never mistaken for a delivery issue. */
export function classifyTransportError(err: unknown): TransportErrorKind {
  const e = err as NodeJS.ErrnoException & { responseCode?: number };
  if (e?.code === 'ETIMEDOUT' || e?.code === 'ESOCKET') return 'TIMEOUT';
  if (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN') return 'DNS_FAILURE';
  if (e?.code === 'ECONNREFUSED' || e?.code === 'EHOSTUNREACH' || e?.code === 'ENETUNREACH') {
    return 'TRANSPORT_BLOCKED';
  }
  // Credential problems (bad password, or an IP not on the relay's allowlist) are
  // a CONFIGURATION matter owned by the harness — never the provider's fault.
  if (e?.code === 'EAUTH' || e?.responseCode === 535 || e?.responseCode === 525) return 'AUTH_FAILED';
  if (typeof e?.responseCode === 'number') return 'REJECTED';
  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Loopback
// ---------------------------------------------------------------------------

export interface LoopbackOptions {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
  readonly logger?: Logger;
}

export class LoopbackTransport implements SmtpTransport {
  readonly mode: TransportMode = 'loopback';
  private readonly log: Logger;
  private readonly transporter: Transporter;

  constructor(private readonly options: LoopbackOptions) {
    this.log = options.logger ?? createLogger('smtp:loopback');
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: false,
      // Our local server does not advertise STARTTLS/AUTH.
      ignoreTLS: true,
      connectionTimeout: options.timeoutMs,
      greetingTimeout: options.timeoutMs,
      socketTimeout: options.timeoutMs,
      tls: { rejectUnauthorized: false },
    });
  }

  isConfigured(): boolean {
    return Boolean(this.options.host && this.options.port);
  }

  async send(message: OutgoingMessage): Promise<SendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        messageId: message.messageId,
        headers: { ...message.headers },
      });
      const anyInfo = info as { accepted?: unknown[]; rejected?: unknown[] };
      const accepted = (anyInfo.accepted?.length ?? 0) > 0;
      return {
        accepted,
        acceptedAt: accepted ? new Date().toISOString() : null,
        transportMode: this.mode,
        response: info.response ?? null,
        error: accepted ? null : { name: 'RejectedError', message: 'No recipients accepted' },
      };
    } catch (err) {
      this.log.debug('loopback send failed', { kind: classifyTransportError(err) });
      return {
        accepted: false,
        acceptedAt: null,
        transportMode: this.mode,
        response: null,
        error: toErrorInfo(err),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Direct MX
// ---------------------------------------------------------------------------

export interface DirectMxOptions {
  readonly timeoutMs: number;
  readonly logger?: Logger;
  /** Override the MX lookup for tests. */
  readonly resolveMxFn?: (domain: string) => Promise<string[]>;
}

export class DirectMxTransport implements SmtpTransport {
  readonly mode: TransportMode = 'direct-mx';
  private readonly log: Logger;
  private readonly resolve: (domain: string) => Promise<string[]>;

  constructor(private readonly options: DirectMxOptions) {
    this.log = options.logger ?? createLogger('smtp:direct-mx');
    this.resolve =
      options.resolveMxFn ?? (async (domain) => (await resolveMx(domain)).map((r) => r.exchange));
  }

  isConfigured(): boolean {
    // Direct MX needs no credentials, but may still be blocked by the network.
    return true;
  }

  async send(message: OutgoingMessage): Promise<SendResult> {
    const domain = message.to.split('@')[1] ?? '';
    let mxHosts: string[];
    try {
      mxHosts = await this.resolve(domain);
    } catch (err) {
      return {
        accepted: false,
        acceptedAt: null,
        transportMode: this.mode,
        response: null,
        error: toErrorInfo(err),
      };
    }
    if (mxHosts.length === 0) {
      return {
        accepted: false,
        acceptedAt: null,
        transportMode: this.mode,
        response: null,
        error: { name: 'NoMxError', message: `No MX records for ${domain}` },
      };
    }

    const failures: string[] = [];
    for (const host of mxHosts) {
      const transport = nodemailer.createTransport({
        host,
        port: 25,
        secure: false,
        ignoreTLS: true,
        connectionTimeout: this.options.timeoutMs,
        greetingTimeout: this.options.timeoutMs,
        socketTimeout: this.options.timeoutMs,
        tls: { rejectUnauthorized: false },
      });
      try {
        const info = await transport.sendMail({
          from: message.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          messageId: message.messageId,
          headers: { ...message.headers },
        });
        const accepted = (info.accepted?.length ?? 0) > 0;
        if (accepted) {
          return {
            accepted: true,
            acceptedAt: new Date().toISOString(),
            transportMode: this.mode,
            response: info.response ?? null,
            error: null,
          };
        }
        failures.push(`${host}: rejected`);
      } catch (err) {
        failures.push(`${host}: ${classifyTransportError(err)}`);
      } finally {
        transport.close();
      }
    }

    return {
      accepted: false,
      acceptedAt: null,
      transportMode: this.mode,
      response: null,
      error: { name: 'DirectMxError', message: failures.join('; ') },
    };
  }
}

// ---------------------------------------------------------------------------
// Relay
// ---------------------------------------------------------------------------

export interface RelayTransportOptions {
  readonly relay: RelayConfig;
  readonly timeoutMs: number;
  readonly logger?: Logger;
}

export class RelayTransport implements SmtpTransport {
  readonly mode: TransportMode = 'relay';
  private readonly log: Logger;
  private readonly transporter: Transporter;

  constructor(private readonly options: RelayTransportOptions) {
    this.log = options.logger ?? createLogger('smtp:relay');
    this.transporter = nodemailer.createTransport({
      host: options.relay.host,
      port: options.relay.port,
      secure: options.relay.secure,
      ...(options.relay.user
        ? { auth: { user: options.relay.user, pass: options.relay.pass } }
        : {}),
      connectionTimeout: options.timeoutMs,
      greetingTimeout: options.timeoutMs,
      socketTimeout: options.timeoutMs,
    });
  }

  isConfigured(): boolean {
    return Boolean(this.options.relay.host);
  }

  async send(message: OutgoingMessage): Promise<SendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        messageId: message.messageId,
        headers: { ...message.headers },
      });
      const accepted = (info.accepted?.length ?? 0) > 0;
      return {
        accepted,
        acceptedAt: accepted ? new Date().toISOString() : null,
        transportMode: this.mode,
        response: info.response ?? null,
        error: accepted ? null : { name: 'RejectedError', message: 'Relay accepted no recipients' },
      };
    } catch (err) {
      const kind = classifyTransportError(err);
      this.log.debug('relay send failed', { kind });
      const info = toErrorInfo(err);
      // Surface the classification so a failed run explains itself.
      return {
        accepted: false,
        acceptedAt: null,
        transportMode: this.mode,
        response: null,
        error: { ...info, code: info.code ?? kind, message: `[${kind}] ${info.message}` },
      };
    }
  }
}
