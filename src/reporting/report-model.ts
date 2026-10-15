/**
 * Report model — the JSON document that is the single source of truth.
 * HTML and CSV are generated from this structure so they cannot disagree
 * (Prompt 2 §19).
 */

import type { SampleRecord } from '../domain/types.js';
import type { RunPlan } from '../benchmark/runner.js';
import {
  computeReliability,
  observedLatencies,
  summarize,
  type PercentileSet,
  type ReliabilityMetrics,
} from '../metrics/metrics.js';
import { PROVIDER_CAPABILITIES } from '../providers/capabilities.js';
import { FRAMEWORK_VERSION } from '../config/config.js';

export interface LatencyBlock {
  readonly channel: 'UI' | 'API';
  readonly detection: PercentileSet;
  readonly content: PercentileSet;
  readonly contentAccessDuration: PercentileSet;
}

export interface ProviderReport {
  readonly provider: string;
  readonly capabilitySnapshot: Readonly<Record<string, { state: string; evidence: string; sourceUrl?: string }>>;
  readonly reliability: ReliabilityMetrics;
  readonly apiLatency: LatencyBlock | null;
  readonly uiLatency: LatencyBlock | null;
  /** Whether this provider had any REAL sample in the run. */
  readonly executed: boolean;
  readonly notExecutedReason: string | null;
  readonly notes: readonly string[];
}

export interface ExecutionHistoryEntry {
  readonly runId: string;
  readonly createdAt: string;
  readonly transportMode: string;
  readonly samples: number;
  readonly realSamples: number;
}

export interface BenchmarkReport {
  readonly frameworkVersion: string;
  readonly generatedAt: string;
  readonly plan: {
    readonly runId: string;
    readonly transportMode: string;
    readonly channels: readonly string[];
    readonly samplesPerProvider: number;
    readonly timeoutMs: number;
    readonly pollIntervalMs: number;
    readonly scenario: string;
    readonly validationMode: string;
    readonly createdAt: string;
    readonly environment: RunPlan['environment'];
    readonly skipped: RunPlan['skipped'];
  };
  readonly sampleOrigins: Readonly<Record<string, number>>;
  readonly providers: readonly ProviderReport[];
  readonly executionHistory: readonly ExecutionHistoryEntry[];
  readonly limitations: readonly string[];
  readonly comparabilityWarnings: readonly string[];
  readonly samples: readonly SampleRecord[];
}

export function buildReport(plans: readonly RunPlan[], samples: readonly SampleRecord[]): BenchmarkReport {
  const origins: Record<string, number> = { REAL: 0, SIMULATED: 0, UNEXECUTED: 0 };
  for (const s of samples) origins[s.sampleOrigin] = (origins[s.sampleOrigin] ?? 0) + 1;

  const providerIds = new Set<string>([
    ...samples.map((s) => s.provider),
    ...plans.flatMap((p) => [...p.providers, ...p.skipped.map((s) => s.provider)]),
  ]);

  const providers: ProviderReport[] = [...providerIds].sort().map((id) =>
    buildProviderReport(id, samples, plans),
  );

  const firstPlan = plans[0];

  return {
    frameworkVersion: FRAMEWORK_VERSION,
    generatedAt: new Date().toISOString(),
    plan: {
      runId: firstPlan?.runId ?? 'n/a',
      transportMode: firstPlan?.transportMode ?? 'loopback',
      channels: firstPlan?.channels ?? [],
      samplesPerProvider: firstPlan?.samplesPerProvider ?? 0,
      timeoutMs: firstPlan?.timeoutMs ?? 0,
      pollIntervalMs: firstPlan?.pollIntervalMs ?? 0,
      scenario: firstPlan?.scenario ?? 'n/a',
      validationMode: firstPlan?.validationMode ?? 'n/a',
      createdAt: firstPlan?.createdAt ?? new Date().toISOString(),
      environment:
        firstPlan?.environment ?? {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          hostname: 'unknown',
          cwd: process.cwd(),
        },
      skipped: firstPlan?.skipped ?? [],
    },
    sampleOrigins: origins,
    providers,
    executionHistory: plans.map((p) => ({
      runId: p.runId,
      createdAt: p.createdAt,
      transportMode: p.transportMode,
      samples: samples.filter((s) => s.runId === p.runId).length,
      realSamples: samples.filter((s) => s.runId === p.runId && s.sampleOrigin === 'REAL').length,
    })),
    limitations: [
      'Latency is measured from LOCAL SMTP acceptance. It does not represent the provider\'s internal delivery time.',
      'Detection latency is bounded below by the polling interval and cannot be measured finer than that gap.',
      'A sample that was never detected has NO latency value; the timeout is never substituted as an observation.',
      'Latency statistics are conditioned on detection and must be read alongside the detection rate.',
      'Capability claims are documentary (verified 2026-10-14) and must be re-verified before each run.',
    ],
    comparabilityWarnings: [
      'UI and API channels are NOT directly comparable; HTTP response time is never compared against end-to-end UI detection latency.',
      'Providers without an authorized API are excluded from API comparisons rather than ranked as failures.',
      'A provider blocked by the provider itself (e.g. bot challenge) is excluded from comparative denominators.',
    ],
    samples,
  };
}

function buildProviderReport(
  id: string,
  samples: readonly SampleRecord[],
  plans: readonly RunPlan[],
): ProviderReport {
  const own = samples.filter((s) => s.provider === id);
  const real = own.filter((s) => s.sampleOrigin === 'REAL');
  const capability = PROVIDER_CAPABILITIES.find((p) => p.id === id);

  const capabilitySnapshot: Record<string, { state: string; evidence: string; sourceUrl?: string }> = {};
  if (capability) {
    for (const [key, claim] of Object.entries(capability.capabilities)) {
      capabilitySnapshot[key] = {
        state: claim.state,
        evidence: claim.evidence,
        ...(claim.sourceUrl ? { sourceUrl: claim.sourceUrl } : {}),
      };
    }
  }

  const apiSamples = real.filter((s) => s.channel === 'API');
  const uiSamples = real.filter((s) => s.channel === 'UI');

  const skipEntry = plans.flatMap((p) => p.skipped).find((s) => s.provider === id);

  return {
    provider: id,
    capabilitySnapshot,
    reliability: computeReliability(real),
    apiLatency: apiSamples.length > 0 ? buildLatency('API', apiSamples) : null,
    uiLatency: uiSamples.length > 0 ? buildLatency('UI', uiSamples) : null,
    executed: real.length > 0,
    notExecutedReason: real.length === 0 ? (skipEntry?.reason ?? 'no REAL samples collected') : null,
    notes: capability?.knownLimitations ?? [],
  };
}

function buildLatency(channel: 'UI' | 'API', samples: readonly SampleRecord[]): LatencyBlock {
  return {
    channel,
    detection: summarize(observedLatencies(samples, channel, 'detection')),
    content: summarize(observedLatencies(samples, channel, 'content')),
    contentAccessDuration: summarize(
      samples
        .filter((s) => s.sampleOrigin === 'REAL' && s.channel === channel)
        .map((s) => s.contentAccessDurationMs)
        .filter((v): v is number => v !== null),
    ),
  };
}
