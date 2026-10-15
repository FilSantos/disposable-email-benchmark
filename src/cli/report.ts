#!/usr/bin/env node
/**
 * Report regeneration CLI.
 *
 * Rebuilds HTML and CSV from a stored JSON report, proving that JSON is the
 * single source of truth and that aggregates are reproducible without re-running
 * the benchmark (Prompt 2 §19, §23 Phase 5).
 *
 * Usage: npm run report -- --in=runs/benchmark-run-abc.json [--out=runs]
 */

import { readFileSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import type { BenchmarkReport } from '../reporting/report-model.js';
import { writeReports } from '../reporting/writers.js';
import { createLogger } from '../observability/logger.js';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function main(): void {
  const log = createLogger('report');
  const input = arg('in');
  if (!input) {
    process.stderr.write('usage: npm run report -- --in=<report.json> [--out=<dir>]\n');
    process.exitCode = 1;
    return;
  }

  const report = JSON.parse(readFileSync(input, 'utf8')) as BenchmarkReport;
  const outDir = arg('out') ?? dirname(input);
  const base = basename(input).replace(/\.json$/, '');

  const written = writeReports(report, { outDir, basename: base });
  log.info('reports regenerated from JSON source of truth', {
    json: written.jsonPath,
    csv: written.csvPath,
    html: written.htmlPath,
  });
}

main();
