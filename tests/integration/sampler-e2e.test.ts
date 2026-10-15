import { describe, it, expect } from 'vitest';
import { createEnvironmentMetadata } from '../../src/benchmark/runner.js';
import { buildReport } from '../../src/reporting/report-model.js';
import { toCsv, toHtml } from '../../src/reporting/writers.js';
import type { OutgoingMessage, SendResult, SmtpTransport, TransportMode } from '../../src/domain/types.js';
import type { WaitRequest, WaitResult, DetectedMessage, RetrievedContent, ApiChannel } from '../../src/domain/types.js';
import { generateMessage as gen } from '../../src/smtp/message.js';

/**
 * A transport that "delivers" the message into an in-memory mailbox, standing in
 * for the external SMTP path. Results are labelled SIMULATED so they can never be
 * mistaken for real provider evidence.
 */
class InMemoryTransport implements SmtpTransport {
  readonly mode: TransportMode = 'relay';
  private store = new Map<string, OutgoingMessage[]>();
  constructor(private readonly mailboxOf: (address: string) => string) {}
  isConfigured(): boolean {
    return true;
  }
  async send(message: OutgoingMessage): Promise<SendResult> {
    const box = this.mailboxOf(message.to);
    const list = this.store.get(box) ?? [];
    list.push(message);
    this.store.set(box, list);
    return {
      accepted: true,
      acceptedAt: new Date().toISOString(),
      transportMode: this.mode,
      response: '250 OK',
      error: null,
    };
  }
  messagesFor(address: string): readonly OutgoingMessage[] {
    return this.store.get(this.mailboxOf(address)) ?? [];
  }
}

/** A fake provider API that serves whatever the transport stored. */
class FakeApiChannel implements ApiChannel {
  readonly channel = 'API' as const;
  constructor(private readonly transport: InMemoryTransport, private readonly address: string) {}
  isConfigured(): boolean {
    return true;
  }
  async getInboxAddress(): Promise<string> {
    return this.address;
  }
  async waitForMessage(req: WaitRequest): Promise<WaitResult> {
    const deadline = Date.now() + req.timeoutMs;
    let attempts = 0;
    let lastNegativeAt: string | null = null;
    for (;;) {
      attempts += 1;
      const match = this.transport
        .messagesFor(this.address)
        .find((m) => m.subject.includes(req.correlationId));
      const at = new Date().toISOString();
      req.onPoll?.({ attempt: attempts, at, found: Boolean(match), requestDurationMs: 12 });
      if (match) {
        return { detected: { detectedAt: at, messageRef: match.messageId }, attempts, lastNegativeAt, firstPositiveAt: at, timedOut: false };
      }
      lastNegativeAt = at;
      if (Date.now() >= deadline) {
        return { detected: null, attempts, lastNegativeAt, firstPositiveAt: null, timedOut: true };
      }
      await new Promise((r) => setTimeout(r, Math.min(req.pollIntervalMs, 50)));
    }
  }
  async getMessage(ref: DetectedMessage): Promise<RetrievedContent> {
    const msg = this.transport
      .messagesFor(this.address)
      .find((m) => m.messageId === ref.messageRef) as OutgoingMessage;
    return {
      contentAvailableAt: new Date().toISOString(),
      subject: msg.subject,
      textBody: msg.text,
      htmlBody: msg.html ?? null,
      metadata: { to: msg.to, from: msg.from },
    };
  }
}

class FakeProviderAdapter {
  readonly id = 'maildrop';
  readonly displayName = 'Maildrop (fixture)';
  readonly officialWebsite = 'https://maildrop.cc/';
  readonly domains = ['maildrop.cc'];
  readonly notes: string[] = [];
  readonly capabilities: () => ReturnType<typeof loadCapabilities>;
  readonly api: FakeApiChannel;
  constructor(transport: InMemoryTransport, address: string) {
    this.api = new FakeApiChannel(transport, address);
    this.capabilities = () => loadCapabilities();
  }
}

function loadCapabilities() {
  const entry = {
    uiAccess: { state: 'SUPPORTED', evidence: 'DOCUMENTED', verifiedAt: '2026-10-14' },
    uiAutomation: { state: 'SUPPORTED', evidence: 'DOCUMENTED', verifiedAt: '2026-10-14' },
    officialApi: { state: 'SUPPORTED', evidence: 'DOCUMENTED', verifiedAt: '2026-10-14' },
    apiConfiguration: { state: 'SUPPORTED', evidence: 'DOCUMENTED', verifiedAt: '2026-10-14' },
    subject: { state: 'SUPPORTED', evidence: 'DOCUMENTED', verifiedAt: '2026-10-14' },
    textBody: { state: 'SUPPORTED', evidence: 'DOCUMENTED', verifiedAt: '2026-10-14' },
    htmlBody: { state: 'SUPPORTED', evidence: 'DOCUMENTED', verifiedAt: '2026-10-14' },
    metadata: { state: 'SUPPORTED', evidence: 'DOCUMENTED', verifiedAt: '2026-10-14' },
  } as const;
  return { ...entry };
}

describe('sampler end-to-end (simulated transport, real harness)', () => {
  it('sends, detects, retrieves, validates, measures and classifies as PASS', async () => {
    const address = 'ebm-e2e@maildrop.cc';
    const transport = new InMemoryTransport(() => address);
    const provider = new FakeProviderAdapter(transport, address);

    const { Sampler } = await import('../../src/benchmark/sampler.js');
    const sampler = new Sampler({
      transport,
      environment: createEnvironmentMetadata(),
      configurationVersion: 'test',
    });

    const message = gen({
      runId: 'e2e',
      sampleId: 's1',
      from: 'bench@ebm.local',
      to: address,
      scenario: 'ascii',
    });

    const sample = await sampler.run({
      runId: 'e2e',
      sampleId: 's1',
      provider: provider as never,
      channel: 'API',
      sampleOrigin: 'SIMULATED',
      message,
      timeoutMs: 5000,
      pollIntervalMs: 50,
      validationMode: 'normalized',
      expectHtml: false,
    });

    expect(sample.outcome).toBe('PASS');
    expect(sample.failureCategory).toBeNull();
    expect(sample.smtpStatus).toBe('ACCEPTED');
    expect(sample.apiFirstDetectedAt).not.toBeNull();
    expect(sample.apiContentAvailableAt).not.toBeNull();
    // Real measurements must exist for a passing sample.
    expect(sample.detectionLatencyMs).not.toBeNull();
    expect(sample.contentLatencyMs).not.toBeNull();
    expect(sample.contentValidationStatus).toBe('PASS');
    expect(sample.sampleOrigin).toBe('SIMULATED');
  });

  it('produces a report that excludes SIMULATED samples from headline metrics', async () => {
    const address = 'ebm-e2e2@maildrop.cc';
    const transport = new InMemoryTransport(() => address);
    const provider = new FakeProviderAdapter(transport, address);
    const { Sampler } = await import('../../src/benchmark/sampler.js');
    const sampler = new Sampler({
      transport,
      environment: createEnvironmentMetadata(),
      configurationVersion: 'test',
    });

    const message = gen({ runId: 'e2e2', sampleId: 's1', from: 'b@ebm.local', to: address, scenario: 'ascii' });
    const sample = await sampler.run({
      runId: 'e2e2',
      sampleId: 's1',
      provider: provider as never,
      channel: 'API',
      sampleOrigin: 'SIMULATED',
      message,
      timeoutMs: 5000,
      pollIntervalMs: 50,
      validationMode: 'normalized',
      expectHtml: false,
    });

    const plan = {
      runId: 'e2e2',
      transportMode: 'relay' as const,
      providers: ['maildrop'],
      channels: ['API' as const],
      samplesPerProvider: 1,
      timeoutMs: 5000,
      pollIntervalMs: 50,
      scenario: 'ascii' as const,
      validationMode: 'normalized' as const,
      createdAt: new Date().toISOString(),
      configurationVersion: 'test',
      frameworkVersion: '0.1.0',
      environment: createEnvironmentMetadata(),
      skipped: [],
    };
    const report = buildReport([plan], [sample]);

    expect(report.sampleOrigins['SIMULATED']).toBe(1);
    // Headline metrics must ignore SIMULATED samples entirely.
    const providerReport = report.providers.find((p) => p.provider === 'maildrop');
    expect(providerReport?.reliability.funnel.attempted).toBe(0);
    expect(providerReport?.executed).toBe(false);
  });
});

describe('report serialisation', () => {
  it('renders CSV with explicit nulls and JSON-encoded request durations', () => {
    const sample = {
      runId: 'r',
      sampleId: 's',
      provider: 'maildrop',
      channel: 'API',
      sampleOrigin: 'REAL',
      transportMode: 'loopback',
      inboxIdentifier: null,
      messageId: null,
      correlationId: 'c',
      smtpAcceptedAt: null,
      uiFirstDetectedAt: null,
      uiContentAvailableAt: null,
      apiFirstDetectedAt: null,
      apiContentAvailableAt: null,
      detectionLatencyMs: null,
      contentLatencyMs: null,
      contentAccessDurationMs: null,
      apiRequestResponseMs: [12, 15],
      smtpStatus: 'NOT_ATTEMPTED',
      contentValidationStatus: 'NOT_ATTEMPTED',
      requestCount: 0,
      retryCount: 0,
      pollingIntervalMs: 2000,
      pollingAttempts: 0,
      lastNegativePollAt: null,
      firstPositivePollAt: null,
      timeoutMs: 180000,
      timeoutStatus: 'NONE',
      outcome: 'FAIL',
      failureCategory: 'CONFIGURATION_ERROR',
      attribution: 'HARNESS',
      validationMode: null,
      validationDifferences: [],
      artifacts: {},
      errorDetails: null,
      frameworkVersion: '0.1.0',
      configurationVersion: 'test',
      environment: { nodeVersion: 'x', platform: 'x', arch: 'x', hostname: 'x', cwd: 'x' },
    } as const;
    const csv = toCsv([sample]);
    const [headerLine, rowLine] = csv.trim().split('\n');
    const columns = parseCsvLine(headerLine ?? '');
    const cells = parseCsvLine(rowLine ?? '');

    // Null latencies must render as empty cells — never as a number and never as
    // the timeout value masquerading as an observation.
    for (const column of ['detectionLatencyMs', 'contentLatencyMs', 'contentAccessDurationMs']) {
      expect(cells[columns.indexOf(column)]).toBe('');
    }
    // timeoutMs is real data and may legitimately contain 180000.
    expect(cells[columns.indexOf('timeoutMs')]).toBe('180000');
    expect(cells[columns.indexOf('apiRequestResponseMsJson')]).toBe('[12,15]');
  });

  it('renders HTML that warns about poll-interval limits and shows participants', () => {
    const html = toHtml({
      frameworkVersion: '0.1.0',
      generatedAt: new Date().toISOString(),
      plan: {
        runId: 'r',
        transportMode: 'loopback',
        channels: ['API'],
        samplesPerProvider: 1,
        timeoutMs: 1000,
        pollIntervalMs: 2000,
        scenario: 'ascii',
        validationMode: 'normalized',
        createdAt: new Date().toISOString(),
        environment: { nodeVersion: 'x', platform: 'x', arch: 'x', hostname: 'x', cwd: 'x' },
        skipped: [{ provider: 'tenminutemail', reason: 'blocked' }],
      },
      sampleOrigins: { REAL: 0, SIMULATED: 1, UNEXECUTED: 0 },
      providers: [],
      executionHistory: [],
      limitations: ['latency is from local SMTP acceptance'],
      comparabilityWarnings: ['UI and API are not comparable'],
      samples: [],
    });
    expect(html).toContain('2000 ms');
    expect(html).toContain('tenminutemail');
    expect(html).toContain('Only REAL samples back the metrics');
  });
});

/** Minimal RFC4180 CSV line parser (handles quoted fields containing commas). */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}
