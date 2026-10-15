#!/usr/bin/env node
/**
 * Benchmark CLI.
 *
 * Usage:
 *   npm run bench -- [--providers=maildrop,guerrillamail] [--samples=3]
 *                    [--scenario=ascii|utf8|long|html] [--channel=API|UI]
 *                    [--out=runs] [--label=name]
 *
 * The transport comes from configuration (default: loopback). With the loopback
 * transport the message is accepted locally and no external delivery occurs, so
 * API detection will time out — that is expected and is reported as such.
 */

import { loadDotEnv, loadConfig, FRAMEWORK_VERSION } from '../config/config.js';
import { createLogger } from '../observability/logger.js';
import { LocalSmtpServer } from '../smtp/server.js';
import { LoopbackTransport, DirectMxTransport, RelayTransport } from '../smtp/transports.js';
import type { SmtpTransport } from '../domain/types.js';
import { BenchmarkRunner, createEnvironmentMetadata } from '../benchmark/runner.js';
import { closeRegistry, type RegisteredProvider } from '../providers/registry.js';
import { buildReport } from '../reporting/report-model.js';
import { writeReports } from '../reporting/writers.js';
import type { Scenario } from '../smtp/message.js';

function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  if (process.argv.includes(`--${name}`)) return 'true';
  return fallback;
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const log = createLogger('bench', process.env['EBM_LOG_LEVEL'] === 'debug' ? 'debug' : 'info');

  const providers = arg('providers')?.split(',').filter(Boolean);
  const samples = Number.parseInt(arg('samples', String(config.defaults.samplesPerProvider)) ?? '3', 10);
  const scenario = (arg('scenario', 'ascii') ?? 'ascii') as Scenario;
  const channels = (arg('channel', 'API') ?? 'API').split(',').filter(Boolean) as ('API' | 'UI')[];
  const outDir = arg('out', 'runs') ?? 'runs';
  const label = arg('label');
  // Stable inbox names make a UI run reproducible and let an operator watch the
  // same inbox in a browser while it runs.
  const maildropMailbox = arg('maildrop-mailbox');
  const mailinatorInbox = arg('mailinator-inbox');
  const yopmailInbox = arg('yopmail-inbox');
  // Opt-in: YOPmail UI automation is feasible but not contractually confirmed.
  const enableYopmailUi = arg('yopmail-ui') === 'true';

  let server: LocalSmtpServer | null = null;
  let activeRegistry: readonly RegisteredProvider[] = [];
  let transport: SmtpTransport;

  if (config.transport === 'loopback') {
    server = new LocalSmtpServer({
      host: config.smtpHost,
      port: config.smtpPort,
      logger: log.child('smtp'),
      onMessage: (m) => log.debug('smtp accepted', { subject: m.subject ?? '' }),
    });
    await server.start();
    transport = new LoopbackTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      timeoutMs: config.smtpTimeoutMs,
      logger: log.child('loopback'),
    });
  } else if (config.transport === 'relay') {
    if (!config.relay) throw new Error('relay transport selected without relay configuration');
    transport = new RelayTransport({
      relay: config.relay,
      timeoutMs: config.smtpTimeoutMs,
      logger: log.child('relay'),
    });
  } else {
    transport = new DirectMxTransport({ timeoutMs: config.smtpTimeoutMs, logger: log.child('direct-mx') });
  }

  // Everything from here runs inside try/finally so the SMTP listener is always
  // released — including when planning or reporting throws — leaving no orphan.
  try {
    const runner = new BenchmarkRunner({
      config,
      transport,
      environment: createEnvironmentMetadata(),
      sendFrom: config.sendFrom,
      ...(enableYopmailUi ? { enableYopmailUi: true } : {}),
      logger: log,
    });

    const plan = runner.buildPlan({
      ...(providers ? { providers } : {}),
      channels,
      samplesPerProvider: samples,
      scenario,
      ...(label ? { runId: label } : {}),
    });

    log.info('plan built', {
      runId: plan.runId,
      transport: plan.transportMode,
      providers: plan.providers.join(',') || '(none)',
      samples: plan.samplesPerProvider,
      channels: plan.channels.join(','),
    });
    for (const skip of plan.skipped) {
      log.warn('provider skipped', { provider: skip.provider, reason: skip.reason });
    }

    const result = await runner.execute(plan, {
      mailboxOverrides: {
        ...(maildropMailbox ? { maildrop: maildropMailbox } : {}),
        ...(mailinatorInbox ? { mailinator: mailinatorInbox } : {}),
        ...(yopmailInbox ? { yopmail: yopmailInbox } : {}),
      },
    });
    activeRegistry = result.registry;
    const report = buildReport([result.plan], result.samples);
    const written = writeReports(report, {
      outDir,
      ...(label ? { basename: `benchmark-${label}` } : {}),
    });

    const real = result.samples.filter((s) => s.sampleOrigin === 'REAL');
    log.info('run complete', {
      samples: result.samples.length,
      realSamples: real.length,
      passed: real.filter((s) => s.outcome === 'PASS').length,
      failed: real.filter((s) => s.outcome === 'FAIL').length,
      framework: FRAMEWORK_VERSION,
    });
    log.info('reports written', { json: written.jsonPath, csv: written.csvPath, html: written.htmlPath });
  } finally {
    // Always release the SMTP listener and any UI browsers, including on
    // failure, so no orphaned process survives the run.
    await server?.stop();
    // Close the SAME browser instances the run used, not fresh ones.
    await closeRegistry(activeRegistry);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`benchmark failed: ${(err as Error)?.stack ?? String(err)}\n`);
  process.exitCode = 1;
});
