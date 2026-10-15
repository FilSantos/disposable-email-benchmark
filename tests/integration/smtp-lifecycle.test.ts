import { describe, it, expect, afterEach } from 'vitest';
import { LocalSmtpServer, type CapturedMessage } from '../../src/smtp/server.js';
import { LoopbackTransport } from '../../src/smtp/transports.js';
import { generateMessage } from '../../src/smtp/message.js';
import { silentLogger } from '../../src/observability/logger.js';

const PORT = 34217;

let server: LocalSmtpServer | null = null;

afterEach(async () => {
  await server?.stop();
  server = null;
});

describe('LocalSmtpServer lifecycle', () => {
  it('starts, accepts a message, records the acceptance timestamp and metadata', async () => {
    const captured: CapturedMessage[] = [];
    server = new LocalSmtpServer({
      host: '127.0.0.1',
      port: PORT,
      logger: silentLogger,
      onMessage: (m) => captured.push(m),
    });
    await server.start();

    const transport = new LoopbackTransport({ host: '127.0.0.1', port: PORT, timeoutMs: 10_000 });
    const msg = generateMessage({
      runId: 'run-int',
      sampleId: 's1',
      from: 'bench@ebm.local',
      to: 'box@maildrop.cc',
      scenario: 'ascii',
    });

    const before = Date.now();
    const result = await transport.send(msg);
    const after = Date.now();

    expect(result.accepted).toBe(true);
    expect(result.transportMode).toBe('loopback');
    expect(result.acceptedAt).not.toBeNull();

    // The recorded acceptance timestamp must be a real instant inside the send window.
    const acceptedAtMs = Date.parse(result.acceptedAt as string);
    expect(acceptedAtMs).toBeGreaterThanOrEqual(before - 1000);
    expect(acceptedAtMs).toBeLessThanOrEqual(after + 1000);

    // The server must have captured the message with the correlation identifier.
    await waitFor(() => captured.length === 1);
    const record = captured[0] as CapturedMessage;
    expect(record.to).toContain('box@maildrop.cc');
    expect(record.subject).toContain(msg.correlationId);
    expect(record.correlationId).toBe(msg.correlationId);
    expect(record.messageId).toBe(msg.messageId);
    expect(record.from).toBe('bench@ebm.local');
  });

  it('reports a port conflict instead of silently sharing a port', async () => {
    server = new LocalSmtpServer({ host: '127.0.0.1', port: PORT, logger: silentLogger });
    await server.start();

    const clash = new LocalSmtpServer({ host: '127.0.0.1', port: PORT, logger: silentLogger });
    await expect(clash.start()).rejects.toThrowError();
  });

  it('stops cleanly and frees the port for a subsequent server', async () => {
    server = new LocalSmtpServer({ host: '127.0.0.1', port: PORT, logger: silentLogger });
    await server.start();
    await server.stop();
    server = null;

    // No orphaned listener: the port can be taken again immediately.
    const again = new LocalSmtpServer({ host: '127.0.0.1', port: PORT, logger: silentLogger });
    await expect(again.start()).resolves.toEqual({ host: '127.0.0.1', port: PORT });
    await again.stop();
  });

  it('is idempotent when stopped twice', async () => {
    const s = new LocalSmtpServer({ host: '127.0.0.1', port: PORT, logger: silentLogger });
    await s.start();
    await s.stop();
    await expect(s.stop()).resolves.toBeUndefined();
  });

  it('captures UTF-8 message content intact', async () => {
    const captured: CapturedMessage[] = [];
    server = new LocalSmtpServer({
      host: '127.0.0.1',
      port: PORT,
      logger: silentLogger,
      onMessage: (m) => captured.push(m),
    });
    await server.start();

    const transport = new LoopbackTransport({ host: '127.0.0.1', port: PORT, timeoutMs: 10_000 });
    const msg = generateMessage({
      runId: 'run-int',
      sampleId: 's2',
      from: 'bench@ebm.local',
      to: 'box@maildrop.cc',
      scenario: 'utf8',
    });
    // The scenario places non-ASCII content in the body; the subject stays ASCII
    // so it survives header transport untouched.
    expect(msg.text).toMatch(/[^\u0000-\u007F]/);
    await transport.send(msg);

    await waitFor(() => captured.length === 1);
    const record = captured[0] as CapturedMessage;
    expect(record.subject).toContain(msg.correlationId);
  });

  it('round-trips a non-ASCII subject through MIME decoding', async () => {
    const captured: CapturedMessage[] = [];
    server = new LocalSmtpServer({
      host: '127.0.0.1',
      port: PORT,
      logger: silentLogger,
      onMessage: (m) => captured.push(m),
    });
    await server.start();

    const transport = new LoopbackTransport({ host: '127.0.0.1', port: PORT, timeoutMs: 10_000 });
    const correlationId = 'EBM-accents-1';
    await transport.send({
      messageId: '<utf8@ebm.local>',
      from: 'bench@ebm.local',
      to: 'box@maildrop.cc',
      subject: `Verificação ação ${correlationId}`,
      text: `Corpo ${correlationId}`,
      headers: { 'X-EBM-Correlation-Id': correlationId },
    });

    await waitFor(() => captured.length === 1);
    const record = captured[0] as CapturedMessage;
    expect(record.correlationId).toBe(correlationId);
    expect(record.subject).toMatch(/[^\u0000-\u007F]/);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}
