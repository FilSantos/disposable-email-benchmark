import { describe, it, expect } from 'vitest';
import { summarize, computeReliability, observedLatencies, deriveMetrics } from '../../src/metrics/metrics.js';
import type { SampleRecord } from '../../src/domain/types.js';

function sample(overrides: Partial<SampleRecord>): SampleRecord {
  const base: SampleRecord = {
    runId: 'run-1',
    sampleId: 's1',
    provider: 'maildrop',
    channel: 'API',
    sampleOrigin: 'REAL',
    transportMode: 'loopback',
    inboxIdentifier: 'box@maildrop.cc',
    messageId: '<a@ebm.local>',
    correlationId: 'EBM-1',
    smtpAcceptedAt: '2026-10-14T00:00:00.000Z',
    uiFirstDetectedAt: null,
    uiContentAvailableAt: null,
    apiFirstDetectedAt: null,
    apiContentAvailableAt: null,
    detectionLatencyMs: null,
    contentLatencyMs: null,
    contentAccessDurationMs: null,
    apiRequestResponseMs: [],
    smtpStatus: 'ACCEPTED',
    contentValidationStatus: 'NOT_ATTEMPTED',
    requestCount: 0,
    retryCount: 0,
    pollingIntervalMs: 2000,
    pollingAttempts: 0,
    lastNegativePollAt: null,
    firstPositivePollAt: null,
    timeoutMs: 180000,
    timeoutStatus: 'NONE',
    outcome: 'PASS',
    failureCategory: null,
    attribution: null,
    validationMode: null,
    validationDifferences: [],
    artifacts: {},
    errorDetails: null,
    frameworkVersion: '0.1.0',
    configurationVersion: 'test',
    environment: { nodeVersion: 'x', platform: 'x', arch: 'x', hostname: 'x', cwd: 'x' },
  };
  return { ...base, ...overrides };
}

describe('deriveMetrics', () => {
  it('returns nulls when the message was never detected (never fabricates)', () => {
    const m = deriveMetrics(sample({}));
    expect(m.detectionLatencyMs).toBeNull();
    expect(m.contentLatencyMs).toBeNull();
    expect(m.contentAccessDurationMs).toBeNull();
  });

  it('computes API detection and content latency from SMTP acceptance', () => {
    const m = deriveMetrics(
      sample({
        apiFirstDetectedAt: '2026-10-14T00:00:05.000Z',
        apiContentAvailableAt: '2026-10-14T00:00:07.500Z',
      }),
    );
    expect(m.detectionLatencyMs).toBe(5000);
    expect(m.contentLatencyMs).toBe(7500);
    expect(m.contentAccessDurationMs).toBe(2500);
  });

  it('computes UI metrics on the UI channel and ignores API fields', () => {
    const m = deriveMetrics(
      sample({
        channel: 'UI',
        uiFirstDetectedAt: '2026-10-14T00:00:03.000Z',
        uiContentAvailableAt: '2026-10-14T00:00:04.000Z',
        apiFirstDetectedAt: '2026-10-14T00:00:01.000Z',
      }),
    );
    expect(m.detectionLatencyMs).toBe(3000);
    expect(m.contentLatencyMs).toBe(4000);
    expect(m.contentAccessDurationMs).toBe(1000);
  });
});

describe('computeReliability', () => {
  it('excludes non-REAL samples from every metric', () => {
    const metrics = computeReliability([
      sample({ sampleId: 'a' }),
      sample({ sampleId: 'b', sampleOrigin: 'SIMULATED' }),
      sample({ sampleId: 'c', sampleOrigin: 'UNEXECUTED' }),
    ]);
    expect(metrics.funnel.attempted).toBe(1);
  });

  it('uses SMTP-accepted samples as the detection denominator', () => {
    const metrics = computeReliability([
      // accepted + detected
      sample({ sampleId: 'a', apiFirstDetectedAt: '2026-10-14T00:00:05.000Z' }),
      // accepted, not detected
      sample({ sampleId: 'b' }),
      // SMTP rejected: cannot be a delivery miss, excluded from detection denominator
      sample({ sampleId: 'c', smtpStatus: 'REJECTED', failureCategory: 'SMTP_SEND_FAILED' }),
    ]);
    expect(metrics.detectionRate.denominator).toBe(2);
    expect(metrics.detectionRate.numerator).toBe(1);
    expect(metrics.smtpFailureRate.numerator).toBe(1);
    expect(metrics.smtpFailureRate.denominator).toBe(3);
  });

  it('counts timeouts separately and keeps the failure distribution', () => {
    const metrics = computeReliability([
      sample({ sampleId: 'a', timeoutStatus: 'DETECTION_TIMEOUT', failureCategory: 'MESSAGE_NOT_DETECTED' }),
      sample({ sampleId: 'b', failureCategory: 'MESSAGE_NOT_DETECTED' }),
    ]);
    expect(metrics.timeoutRate.numerator).toBe(1);
    expect(metrics.failureDistribution['MESSAGE_NOT_DETECTED']).toBe(2);
  });
});

describe('observedLatencies', () => {
  it('only returns observed values for the requested channel and mode', () => {
    const values = observedLatencies(
      [
        sample({ sampleId: 'a', detectionLatencyMs: 100 }),
        sample({ sampleId: 'b', detectionLatencyMs: null }), // timeout censored
        sample({ sampleId: 'c', detectionLatencyMs: 300, sampleOrigin: 'SIMULATED' }),
        sample({ sampleId: 'd', channel: 'UI', detectionLatencyMs: 999 }),
      ],
      'API',
      'detection',
    );
    expect(values).toEqual([100]);
  });

  it('feeds summarize without treating nulls as observations', () => {
    const s = summarize([100, 200]);
    expect(s.n).toBe(2);
    expect(s.median).toBe(150);
  });
});
