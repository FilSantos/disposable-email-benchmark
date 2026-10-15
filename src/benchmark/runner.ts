/**
 * Benchmark runner (Prompt 2 §11, §16, §23 Phase 5).
 *
 * Builds a deterministic sample plan, executes it sequentially (concurrency 1
 * per provider by default to avoid self-inflicted rate limiting), and collects
 * REAL samples for reporting.
 */

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { Channel, SampleOrigin, SampleRecord, TransportMode } from '../domain/types.js';
import type { AppConfig } from '../config/config.js';
import type { SmtpTransport } from '../domain/types.js';
import { Sampler, type SamplerDeps } from './sampler.js';
import { generateMessage, type Scenario } from '../smtp/message.js';
import { buildRegistry, type RegisteredProvider } from '../providers/registry.js';
import { createLogger, silentLogger, type Logger } from '../observability/logger.js';
import { FRAMEWORK_VERSION } from '../config/config.js';
import type { EnvironmentMetadata } from '../domain/types.js';

export interface RunPlan {
  readonly runId: string;
  readonly transportMode: TransportMode;
  readonly providers: readonly string[];
  readonly channels: readonly Channel[];
  readonly samplesPerProvider: number;
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
  readonly scenario: Scenario;
  readonly validationMode: 'strict' | 'normalized';
  readonly createdAt: string;
  readonly configurationVersion: string;
  readonly frameworkVersion: string;
  readonly environment: EnvironmentMetadata;
  /** Providers included for capability reporting but not executed. */
  readonly skipped: readonly { readonly provider: string; readonly reason: string }[];
}

export interface RunResult {
  readonly plan: RunPlan;
  readonly samples: readonly SampleRecord[];
  /** The exact adapters used, so the caller can release their resources. */
  readonly registry: readonly RegisteredProvider[];
}

export interface RunnerOptions {
  readonly config: AppConfig;
  readonly transport: SmtpTransport;
  readonly environment: EnvironmentMetadata;
  readonly sendFrom?: string;
  readonly logger?: Logger;
  readonly samplerDeps?: Partial<SamplerDeps>;
  /** Opt in to YOPmail UI automation (policy question DQ-5 unresolved). */
  readonly enableYopmailUi?: boolean;
}

export function defaultChannelsFor(config: AppConfig): readonly Channel[] {
  // API is the lower-friction channel; UI is only exercised for providers whose
  // capability matrix permits it and when explicitly requested by the CLI.
  void config;
  return ['API'];
}

export class BenchmarkRunner {
  private readonly log: Logger;
  private readonly sampler: Sampler;

  constructor(private readonly options: RunnerOptions) {
    this.log = options.logger ?? silentLogger;
    this.sampler = new Sampler({
      transport: options.transport,
      environment: options.environment,
      configurationVersion: FRAMEWORK_VERSION,
      ...options.samplerDeps,
    });
  }

  buildPlan(options: {
    readonly providers?: readonly string[];
    readonly channels?: readonly Channel[];
    readonly samplesPerProvider?: number;
    readonly scenario?: Scenario;
    readonly runId?: string;
  } = {}): RunPlan {
    const registry = buildRegistry(this.options.config, {
      enableYopmailUi: this.options.enableYopmailUi ?? false,
    });
    const requested = options.providers ?? registry.map((r) => r.adapter.id);
    const skipped: { provider: string; reason: string }[] = [];
    const executable: string[] = [];

    for (const id of requested) {
      const entry = registry.find((r) => r.adapter.id === id);
      if (!entry) {
        skipped.push({ provider: id, reason: 'unknown provider' });
        continue;
      }
      if (entry.executableChannels.length === 0) {
        const apiState = entry.adapter.capabilities().officialApi.state;
        const uiState = entry.adapter.capabilities().uiAutomation.state;
        skipped.push({
          provider: id,
          reason: `no executable channel (api=${apiState}, uiAutomation=${uiState})`,
        });
        continue;
      }
      executable.push(id);
    }

    return {
      runId: options.runId ?? `run-${randomUUID().slice(0, 8)}`,
      transportMode: this.options.transport.mode,
      providers: executable,
      channels: options.channels ?? defaultChannelsFor(this.options.config),
      samplesPerProvider: options.samplesPerProvider ?? this.options.config.defaults.samplesPerProvider,
      timeoutMs: this.options.config.defaults.detectionTimeoutMs,
      pollIntervalMs: this.options.config.defaults.pollIntervalMs,
      scenario: options.scenario ?? 'ascii',
      validationMode: 'normalized',
      createdAt: new Date().toISOString(),
      configurationVersion: FRAMEWORK_VERSION,
      frameworkVersion: FRAMEWORK_VERSION,
      environment: this.options.environment,
      skipped,
    };
  }

  async execute(
    plan: RunPlan,
    options: {
      readonly sampleOrigin?: SampleOrigin;
      readonly mailboxOverrides?: Readonly<Record<string, string>>;
      readonly onSample?: (sample: SampleRecord) => void;
    } = {},
  ): Promise<RunResult> {
    const origin = options.sampleOrigin ?? 'REAL';
    const registry = buildRegistry(this.options.config, {
      ...(options.mailboxOverrides?.['maildrop']
        ? { maildropMailbox: options.mailboxOverrides['maildrop'] }
        : {}),
      ...(options.mailboxOverrides?.['mailinator']
        ? { mailinatorInbox: options.mailboxOverrides['mailinator'] }
        : {}),
      ...(options.mailboxOverrides?.['yopmail']
        ? { yopmailInbox: options.mailboxOverrides['yopmail'] }
        : {}),
      // YOPmail UI is only attached when the operator explicitly opts in.
      enableYopmailUi: this.options.enableYopmailUi ?? false,
    });
    const samples: SampleRecord[] = [];

    for (const providerId of plan.providers) {
      const entry = registry.find((r) => r.adapter.id === providerId);
      if (!entry) continue;

      for (const channel of plan.channels) {
        if (!entry.executableChannels.includes(channel)) {
          this.log.warn('channel not executable; skipping', { provider: providerId, channel });
          continue;
        }
        for (let i = 0; i < plan.samplesPerProvider; i += 1) {
          const sampleId = `${providerId}-${channel.toLowerCase()}-${i + 1}`;
          const inbox = await this.resolveInbox(entry.adapter, channel);
          const message = generateMessage({
            runId: plan.runId,
            sampleId,
            from: this.options.sendFrom ?? 'benchmark@ebm.local',
            to: inbox,
            scenario: plan.scenario,
          });

          this.log.info('running sample', { provider: providerId, channel, sampleId });
          const sample = await this.sampler.run({
            runId: plan.runId,
            sampleId,
            provider: entry.adapter,
            channel,
            sampleOrigin: origin,
            message,
            timeoutMs: plan.timeoutMs,
            pollIntervalMs: plan.pollIntervalMs,
            validationMode: plan.validationMode,
            // HTML is only expected when the scenario actually sends HTML AND the
            // provider claims to expose it. Deriving this from capability alone
            // previously demanded an HTML part that was never sent.
            expectHtml:
              Boolean(message.expectedHtml) &&
              entry.adapter.capabilities().htmlBody.state === 'SUPPORTED',
          });
          samples.push(sample);
          options.onSample?.(sample);
        }
      }
    }

    return { plan, samples, registry };
  }

  private async resolveInbox(
    adapter: ReturnType<typeof buildRegistry>[number]['adapter'],
    channel: Channel,
  ): Promise<string> {
    const impl = channel === 'API' ? adapter.api : adapter.ui;
    if (!impl) {
      throw new Error(`${adapter.id} has no ${channel} channel`);
    }
    return impl.getInboxAddress();
  }
}

export function createEnvironmentMetadata(cwd = process.cwd()): EnvironmentMetadata {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    hostname: hostname(),
    cwd,
  };
}

export { createLogger };
