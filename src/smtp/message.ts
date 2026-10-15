/**
 * Synthetic message generation (Prompt 2 §10).
 *
 * Every message carries a unique Message-ID, run id, sample id and correlation
 * marker. Expected content is persisted before sending so a later assertion
 * cannot be satisfied by an unrelated older message.
 *
 * The subject alone is never used as the identifier: the correlation marker is
 * embedded in the subject AND the body, and is validated independently.
 */

import { randomUUID } from 'node:crypto';
import type { OutgoingMessage } from '../domain/types.js';

export type Scenario = 'ascii' | 'utf8' | 'long' | 'html' | 'similar';

export interface SyntheticMessage extends OutgoingMessage {
  readonly expectedSubject: string;
  readonly expectedText: string;
  readonly expectedHtml: string | null;
  readonly correlationId: string;
  readonly runId: string;
  readonly sampleId: string;
}

export interface GenerateOptions {
  readonly runId: string;
  readonly sampleId: string;
  readonly from: string;
  readonly to: string;
  readonly scenario: Scenario;
  /** Optional shared marker so "similar" messages differ only by correlation id. */
  readonly marker?: string;
}

const ASCII_LOREM =
  'This is a synthetic benchmark message generated for QA verification. ' +
  'It contains no personal or confidential data.';

const UTF8_LOREM =
  'Verificação sintética: ação, coração, café, naïve, Straße, 日本語, Ελληνικά, ' +
  'emoji 🎯 und Umlaute äöü.';

/** Builds a correlation marker that is unlikely to collide with real traffic. */
export function buildCorrelationId(runId: string, sampleId: string): string {
  const short = randomUUID().slice(0, 8);
  return `EBM-${runId}-${sampleId}-${short}`;
}

export function generateMessage(options: GenerateOptions): SyntheticMessage {
  const correlationId = buildCorrelationId(options.runId, options.sampleId);
  const messageId = `<${randomUUID()}@ebm.local>`;

  const prefix = options.marker ?? 'EBM-BENCH';
  const subjectBase = `${prefix} ${options.scenario}`;
  const expectedSubject = `${subjectBase} [${correlationId}]`;

  const bodyForScenario: Record<Scenario, string> = {
    ascii: ASCII_LOREM,
    utf8: UTF8_LOREM,
    long: Array.from({ length: 40 }, (_, i) => `${i + 1}. ${ASCII_LOREM}`).join('\n'),
    html: ASCII_LOREM,
    similar: ASCII_LOREM,
  };

  const expectedText = `${bodyForScenario[options.scenario]}\n\nCorrelation: ${correlationId}\n`;

  const includeHtml = options.scenario === 'html';
  const expectedHtml = includeHtml
    ? `<html><body><p>${ASCII_LOREM}</p><p><strong>${correlationId}</strong></p></body></html>`
    : null;

  const headers: Record<string, string> = {
    'X-EBM-Run-Id': options.runId,
    'X-EBM-Sample-Id': options.sampleId,
    'X-EBM-Correlation-Id': correlationId,
  };

  return {
    messageId,
    from: options.from,
    to: options.to,
    subject: expectedSubject,
    text: expectedText,
    ...(expectedHtml ? { html: expectedHtml } : {}),
    headers,
    expectedSubject,
    expectedText,
    expectedHtml,
    correlationId,
    runId: options.runId,
    sampleId: options.sampleId,
  };
}

/**
 * Builds a pair of messages that are identical except for the correlation id,
 * used to test that the framework selects the CORRECT message rather than the
 * first one it sees.
 */
export function generateSimilarPair(options: Omit<GenerateOptions, 'scenario'>): {
  readonly decoy: SyntheticMessage;
  readonly target: SyntheticMessage;
} {
  const marker = `EBM-SIMILAR-${randomUUID().slice(0, 6)}`;
  return {
    decoy: generateMessage({ ...options, scenario: 'similar', marker }),
    target: generateMessage({ ...options, scenario: 'similar', marker }),
  };
}
