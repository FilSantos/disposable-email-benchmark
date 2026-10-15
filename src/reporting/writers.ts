/**
 * Report writers.
 *
 * JSON is the source of truth. CSV and HTML are derived from the same report
 * object so the three formats cannot disagree (Prompt 2 §19).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BenchmarkReport } from './report-model.js';
import type { SampleRecord } from '../domain/types.js';
import { redact } from '../observability/redact.js';

export interface WriteOptions {
  readonly outDir: string;
  readonly basename?: string;
}

export interface WrittenReports {
  readonly jsonPath: string;
  readonly csvPath: string;
  readonly htmlPath: string;
}

export function writeReports(report: BenchmarkReport, options: WriteOptions): WrittenReports {
  mkdirSync(options.outDir, { recursive: true });
  const base = options.basename ?? `benchmark-${report.plan.runId}`;

  const jsonPath = join(options.outDir, `${base}.json`);
  const csvPath = join(options.outDir, `${base}-samples.csv`);
  const htmlPath = join(options.outDir, `${base}.html`);

  writeFileSync(jsonPath, JSON.stringify(report, redactJson, 2), 'utf8');
  writeFileSync(csvPath, toCsv(report.samples), 'utf8');
  writeFileSync(htmlPath, toHtml(report), 'utf8');

  return { jsonPath, csvPath, htmlPath };
}

/** JSON.stringify replacer that redacts every string value. */
function redactJson(key: string, value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  return value;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const CSV_COLUMNS: readonly (keyof SampleRecord | 'apiRequestResponseMsJson')[] = [
  'runId',
  'sampleId',
  'provider',
  'channel',
  'sampleOrigin',
  'transportMode',
  'inboxIdentifier',
  'messageId',
  'correlationId',
  'smtpStatus',
  'smtpAcceptedAt',
  'uiFirstDetectedAt',
  'uiContentAvailableAt',
  'apiFirstDetectedAt',
  'apiContentAvailableAt',
  'detectionLatencyMs',
  'contentLatencyMs',
  'contentAccessDurationMs',
  'apiRequestResponseMsJson',
  'contentValidationStatus',
  'requestCount',
  'retryCount',
  'pollingIntervalMs',
  'pollingAttempts',
  'lastNegativePollAt',
  'firstPositivePollAt',
  'timeoutMs',
  'timeoutStatus',
  'outcome',
  'failureCategory',
  'attribution',
  'validationMode',
  'frameworkVersion',
  'configurationVersion',
];

export function toCsv(samples: readonly SampleRecord[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows = samples.map((sample) =>
    CSV_COLUMNS.map((col) => {
      const raw =
        col === 'apiRequestResponseMsJson'
          ? JSON.stringify(sample.apiRequestResponseMs)
          : (sample[col as keyof SampleRecord] as unknown);
      return csvCell(raw);
    }).join(','),
  );
  return [header, ...rows].join('\n') + '\n';
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = redact(String(value));
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function pct(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function ms(value: number | null): string {
  return value === null ? 'n/a' : `${value.toFixed(0)} ms`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toHtml(report: BenchmarkReport): string {
  const providerRows = report.providers
    .map((p) => {
      const rel = p.reliability;
      const api = p.apiLatency;
      const ui = p.uiLatency;
      const executed = p.executed
        ? '<span class="ok">executed</span>'
        : `<span class="skip">not executed</span> &mdash; ${esc(p.notExecutedReason ?? '')}`;
      return `
      <tr>
        <td><strong>${esc(p.provider)}</strong><br /><small>${executed}</small></td>
        <td>${pct(rel.detectionRate.rate)}<br /><small>${rel.detectionRate.numerator}/${rel.detectionRate.denominator}</small></td>
        <td>${pct(rel.contentAvailabilityRate.rate)}<br /><small>${rel.contentAvailabilityRate.numerator}/${rel.contentAvailabilityRate.denominator}</small></td>
        <td>${pct(rel.contentValidationRate.rate)}<br /><small>${rel.contentValidationRate.numerator}/${rel.contentValidationRate.denominator}</small></td>
        <td>${pct(rel.timeoutRate.rate)}</td>
        <td>${api ? ms(api.detection.median) : 'n/a'}</td>
        <td>${api ? ms(api.content.median) : 'n/a'}</td>
        <td>${ui ? ms(ui.detection.median) : 'n/a'}</td>
      </tr>`;
    })
    .join('');

  const capabilityRows = report.providers
    .map((p) => {
      const caps = Object.entries(p.capabilitySnapshot)
        .map(([k, v]) => `<div class="cap"><span class="capk">${esc(k)}</span><span class="capv state-${esc(v.state)}">${esc(v.state)}</span><small>${esc(v.evidence)}</small></div>`)
        .join('');
      return `<div class="capcard"><h3>${esc(p.provider)}</h3>${caps}</div>`;
    })
    .join('');

  const failureRows = report.providers
    .flatMap((p) =>
      Object.entries(p.reliability.failureDistribution).map(
        ([category, count]) => `<tr><td>${esc(p.provider)}</td><td>${esc(category)}</td><td>${count}</td></tr>`,
      ),
    )
    .join('');

  const sampleRows = report.samples
    .slice(0, 500)
    .map(
      (s) => `<tr class="origin-${esc(s.sampleOrigin)}">
        <td>${esc(s.sampleId)}</td><td>${esc(s.provider)}</td><td>${esc(s.channel)}</td>
        <td>${esc(s.sampleOrigin)}</td><td>${esc(s.smtpStatus)}</td>
        <td>${esc(s.outcome)}</td><td>${esc(s.failureCategory ?? '')}</td>
        <td>${esc(s.attribution ?? '')}</td>
        <td>${s.detectionLatencyMs === null ? 'n/a' : s.detectionLatencyMs}</td>
        <td>${s.contentLatencyMs === null ? 'n/a' : s.contentLatencyMs}</td>
        <td>${s.pollingAttempts}</td><td>${s.timeoutStatus}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<title>Email Provider Benchmark — ${esc(report.plan.runId)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 2rem; max-width: 1400px; }
  h1, h2, h3 { font-weight: 600; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.9rem; }
  th, td { border: 1px solid #8884; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
  th { background: #8882; }
  small { color: #888; }
  .ok { color: #1a7f37; font-weight: 600; }
  .skip { color: #9a6700; font-weight: 600; }
  .warn { background: #fff8c5; border-left: 4px solid #d4a72c; padding: 0.6rem 0.9rem; margin: 0.8rem 0; }
  .caps { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 0.8rem; }
  .capcard { border: 1px solid #8884; border-radius: 6px; padding: 0.6rem; }
  .cap { display: flex; justify-content: space-between; gap: 0.4rem; font-size: 0.8rem; padding: 1px 0; }
  .capk { color: #888; }
  .state-SUPPORTED { color: #1a7f37; } .state-NOT_SUPPORTED { color: #888; }
  .state-CONFIGURATION_REQUIRED { color: #9a6700; } .state-BLOCKED_BY_PROVIDER { color: #cf222e; }
  .state-NOT_TESTED { color: #8250df; } .state-TEMPORARILY_UNAVAILABLE { color: #bc4c00; }
  tr.origin-SIMULATED { background: #8250df11; } tr.origin-UNEXECUTED { background: #8881; }
  code { background: #8882; padding: 0 0.25rem; border-radius: 3px; }
</style></head>
<body>
<h1>Email Provider Benchmark Report</h1>
<p>
  Run <code>${esc(report.plan.runId)}</code> &middot; generated ${esc(report.generatedAt)} &middot;
  framework ${esc(report.frameworkVersion)} &middot; transport <strong>${esc(report.plan.transportMode)}</strong>
</p>

<div class="warn">
  <strong>Read before trusting any number.</strong> Latency is measured from <em>local SMTP acceptance</em>,
  not the provider's internal delivery. Detection latency cannot be finer than the
  <strong>${report.plan.pollIntervalMs} ms</strong> polling interval. Never-detected samples have
  <em>no</em> latency value. Compare latency only alongside the detection rate.
</div>

<div class="warn">
  <strong>Sample origins:</strong>
  REAL ${report.sampleOrigins['REAL'] ?? 0} &middot;
  SIMULATED ${report.sampleOrigins['SIMULATED'] ?? 0} &middot;
  UNEXECUTED ${report.sampleOrigins['UNEXECUTED'] ?? 0}.
  <strong>Only REAL samples back the metrics below.</strong>
</div>

<h2>Provider comparison</h2>
<table>
  <thead><tr>
    <th>Provider</th><th>Detection rate</th><th>Content availability</th>
    <th>Validation pass</th><th>Timeout rate</th>
    <th>API median detection</th><th>API median content</th><th>UI median detection</th>
  </tr></thead>
  <tbody>${providerRows || '<tr><td colspan="8">No providers executed.</td></tr>'}</tbody>
</table>
<p><small>Percentages show the exact fraction (numerator/denominator). Latency cells are medians over
detected samples only.</small></p>

<h2>Capability matrix</h2>
<div class="caps">${capabilityRows}</div>

<h2>Failure categories</h2>
<table>
  <thead><tr><th>Provider</th><th>Category</th><th>Count</th></tr></thead>
  <tbody>${failureRows || '<tr><td colspan="3">No failures recorded.</td></tr>'}</tbody>
</table>

<h2>Sample-level detail</h2>
<table>
  <thead><tr>
    <th>Sample</th><th>Provider</th><th>Channel</th><th>Origin</th><th>SMTP</th>
    <th>Outcome</th><th>Failure</th><th>Attribution</th>
    <th>Detection (ms)</th><th>Content (ms)</th><th>Polls</th><th>Timeout</th>
  </tr></thead>
  <tbody>${sampleRows || '<tr><td colspan="12">No samples.</td></tr>'}</tbody>
</table>

<h2>Known limitations</h2>
<ul>${report.limitations.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>

<h2>Comparability warnings</h2>
<ul>${report.comparabilityWarnings.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>

<h2>Execution history</h2>
<table>
  <thead><tr><th>Run</th><th>Created</th><th>Transport</th><th>Samples</th><th>REAL samples</th></tr></thead>
  <tbody>${report.executionHistory
    .map((h) => `<tr><td>${esc(h.runId)}</td><td>${esc(h.createdAt)}</td><td>${esc(h.transportMode)}</td><td>${h.samples}</td><td>${h.realSamples}</td></tr>`)
    .join('')}</tbody>
</table>

<h2>Configuration &amp; environment</h2>
<table>
  <tbody>
    <tr><th>Channels</th><td>${esc(report.plan.channels.join(', '))}</td></tr>
    <tr><th>Samples per provider</th><td>${report.plan.samplesPerProvider}</td></tr>
    <tr><th>Timeout</th><td>${report.plan.timeoutMs} ms</td></tr>
    <tr><th>Polling interval</th><td>${report.plan.pollIntervalMs} ms</td></tr>
    <tr><th>Scenario</th><td>${esc(report.plan.scenario)}</td></tr>
    <tr><th>Validation mode</th><td>${esc(report.plan.validationMode)}</td></tr>
    <tr><th>Node</th><td>${esc(report.plan.environment.nodeVersion)}</td></tr>
    <tr><th>Platform</th><td>${esc(report.plan.environment.platform)} / ${esc(report.plan.environment.arch)}</td></tr>
    <tr><th>Configuration version</th><td>${esc(report.plan.environment.cwd)}</td></tr>
  </tbody>
</table>

${
  report.plan.skipped.length > 0
    ? `<h2>Skipped providers</h2><ul>${report.plan.skipped
        .map((s) => `<li><strong>${esc(s.provider)}</strong> &mdash; ${esc(s.reason)}</li>`)
        .join('')}</ul>`
    : ''
}
</body></html>`;
}
