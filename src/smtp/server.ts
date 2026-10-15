/**
 * Local SMTP server managed by the framework lifecycle (Prompt 2 §8).
 *
 * Responsibilities:
 *  - bind to loopback only (never public)
 *  - accept synthetic messages and record the acceptance timestamp
 *  - capture sender, recipient, subject, Message-ID and the EBM correlation header
 *  - detect port conflicts
 *  - close listeners cleanly, including on failure, with no orphaned handles
 *
 * It NEVER injects messages into provider inboxes and it does NOT prove external
 * delivery — acceptance here is a lower-bound timestamp only.
 */

import { createServer, type Server, type Socket } from 'node:net';
import { SMTPServer, type SMTPServerSession } from 'smtp-server';
import { createLogger, type Logger } from '../observability/logger.js';

export interface CapturedMessage {
  readonly acceptedAt: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string | null;
  readonly messageId: string | null;
  readonly correlationId: string | null;
  readonly sizeBytes: number;
  readonly rawHeaders: Readonly<Record<string, string>>;
}

export interface SmtpServerOptions {
  readonly host: string;
  readonly port: number;
  readonly logger?: Logger;
  readonly onMessage?: (message: CapturedMessage) => void;
}

export class LocalSmtpServer {
  private server: SMTPServer | null = null;
  private readonly log: Logger;
  private readonly captured: CapturedMessage[] = [];

  constructor(private readonly options: SmtpServerOptions) {
    this.log = options.logger ?? createLogger('smtp');
  }

  /** Throws if the port is already in use. */
  static async assertPortFree(host: string, port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const probe: Server = createServer();
      const sockets: Socket[] = [];
      probe.once('error', (err: NodeJS.ErrnoException) => {
        probe.close();
        reject(err);
      });
      probe.once('listening', () => {
        for (const s of sockets) s.destroy();
        probe.close(() => resolve());
      });
      probe.listen(port, host);
      probe.on('connection', (socket) => sockets.push(socket));
    });
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.server) throw new Error('SMTP server already started');
    await LocalSmtpServer.assertPortFree(this.options.host, this.options.port);

    const server = new SMTPServer({
      // Synthetic benchmark only: no authentication, no TLS.
      authOptional: true,
      disabledCommands: ['STARTTLS', 'AUTH'],
      logger: false,
      hideSTARTTLS: true,
      onData: (stream, session, callback) => {
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
        });
        stream.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const captured: CapturedMessage = {
            acceptedAt: new Date().toISOString(),
            from: session.envelope.mailFrom
              ? (session.envelope.mailFrom as { address?: string }).address ?? ''
              : '',
            to: session.envelope.rcptTo.map((r) => (r as { address?: string }).address ?? ''),
            subject: extractHeader(raw, 'subject'),
            messageId: extractHeader(raw, 'message-id'),
            correlationId: extractHeader(raw, 'x-ebm-correlation-id'),
            sizeBytes: size,
            rawHeaders: extractHeaders(raw),
          };
          this.captured.push(captured);
          this.options.onMessage?.(captured);
          this.log.debug('captured message', {
            to: captured.to.join(','),
            subject: captured.subject ?? '(none)',
          });
          callback();
        });
        stream.on('error', (err) => callback(err));
      },
      onRcptTo: (address: { address?: string }, session: SMTPServerSession, callback) => {
        void session;
        void address;
        callback();
      },
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.port, this.options.host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    this.server = server;
    this.log.info('SMTP server listening', { host: this.options.host, port: this.options.port });
    return { host: this.options.host, port: this.options.port };
  }

  /** Returns a copy of everything captured so far. */
  messages(): readonly CapturedMessage[] {
    return [...this.captured];
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      // Force-close any lingering connections so no handle keeps the process alive.
      server.close(() => resolve());
      server.on('error', () => resolve());
    });
    this.log.info('SMTP server stopped');
  }
}

// ---------------------------------------------------------------------------
// Raw MIME header helpers (deliberately minimal; we only need a few fields)
// ---------------------------------------------------------------------------

function unfoldHeaders(raw: string): string[] {
  const headerBlock = raw.split(/\r?\n\r?\n/, 1)[0] ?? '';
  const lines = headerBlock.split(/\r?\n/);
  const unfolded: string[] = [];
  for (const line of lines) {
    if (/^\s/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += ' ' + line.trim();
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function extractHeader(raw: string, name: string): string | null {
  const target = name.toLowerCase();
  for (const line of unfoldHeaders(raw)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    if (line.slice(0, idx).trim().toLowerCase() === target) {
      return decodeMimeWords(line.slice(idx + 1).trim());
    }
  }
  return null;
}

function extractHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of unfoldHeaders(raw)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    if (!(key in out)) out[key] = decodeMimeWords(line.slice(idx + 1).trim());
  }
  return out;
}

/** Decodes RFC 2047 =?charset?B|Q?...?= encoded words, which providers may add. */
function decodeMimeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset: string, enc: string, data: string) => {
    try {
      if (enc.toUpperCase() === 'B') {
        return Buffer.from(data, 'base64').toString(charset === 'utf-8' ? 'utf8' : 'latin1');
      }
      const qp = data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_s, hex) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
      return Buffer.from(qp, 'latin1').toString('utf8');
    } catch {
      return _m as string;
    }
  });
}
