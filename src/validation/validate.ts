/**
 * Content validation (Prompt 2 §14).
 *
 * Two explicit modes:
 *  - strict     : exact comparison, preserving every difference.
 *  - normalized : applies a documented, configurable set of transformations.
 *
 * The mode and the transformations applied are recorded on the sample so a
 * reviewer always knows how a PASS was obtained.
 */

import { decodeQuotedPrintable, htmlToText, unwrapSoftLineBreaks } from './mime.js';

export type ValidationMode = 'strict' | 'normalized';

export interface NormalizationOptions {
  /** Collapse runs of whitespace (including newlines) into a single space. */
  readonly collapseWhitespace?: boolean;
  /** Trim leading/trailing whitespace. */
  readonly trim?: boolean;
  /** Compare case-insensitively. */
  readonly caseInsensitive?: boolean;
  /** Compare after Unicode NFC normalisation. */
  readonly unicodeNfc?: boolean;
}

export const DEFAULT_NORMALIZATION: Required<NormalizationOptions> = {
  collapseWhitespace: true,
  trim: true,
  caseInsensitive: false,
  unicodeNfc: true,
};

export interface ValidationInput {
  readonly mode: ValidationMode;
  readonly normalization?: NormalizationOptions;
  readonly expected: {
    readonly subject: string;
    readonly text: string;
    readonly html?: string | null;
  };
  readonly actual: {
    readonly subject: string | null;
    readonly textBody: string | null;
    readonly htmlBody: string | null;
  };
  /** Capability gating: only validate what the provider claims to expose. */
  readonly expectHtml?: boolean;
  readonly correlationId: string;
  readonly recipient: string;
  readonly actualRecipient?: string | null;
}

export interface ValidationResult {
  readonly status: 'PASS' | 'FAIL' | 'NOT_APPLICABLE';
  readonly mode: ValidationMode;
  readonly appliedTransformations: readonly string[];
  readonly differences: readonly string[];
  readonly correlationFoundInSubject: boolean;
  readonly correlationFoundInBody: boolean;
}

function apply(value: string, mode: ValidationMode, opts: Required<NormalizationOptions>, applied: Set<string>): string {
  if (mode === 'strict') return value;
  let out = value;
  if (opts.unicodeNfc) {
    out = out.normalize('NFC');
    applied.add('unicode-nfc');
  }
  if (opts.trim) {
    out = out.trim();
    applied.add('trim');
  }
  if (opts.collapseWhitespace) {
    out = out.replace(/\s+/g, ' ');
    applied.add('collapse-whitespace');
  }
  if (opts.caseInsensitive) {
    out = out.toLowerCase();
    applied.add('case-insensitive');
  }
  return out;
}

/** Detects mojibake / replacement characters that indicate an encoding fault. */
function hasEncodingDamage(value: string | null): boolean {
  if (!value) return false;
  return value.includes('\uFFFD') || /Ã[\u0080-\u00BF]|â€|Ã¢â‚¬/.test(value);
}

/**
 * Conservative "same content" comparison.
 *
 * A relay may legitimately transform a message in transit: plain text becomes
 * HTML, tracking pixels are injected, and quoted-printable soft line breaks
 * appear. A raw substring check therefore produced a FALSE mismatch in a real
 * run. Containment is attempted on:
 *   1. the value as-is,
 *   2. the value with HTML/quoted-printable artefacts removed,
 *   3. with all whitespace removed (guards against re-wrapping).
 *
 * The original values are still returned in the result for audit.
 */
/**
 * Equality for short values (subject, correlation id). Strict mode is exact;
 * normalized mode tolerates HTML/quoted-printable wrapping.
 */
function equalsValue(
  actual: string,
  expected: string,
  mode: ValidationMode,
  transform: (value: string) => string,
): boolean {
  if (mode === 'strict') return actual === expected;
  const strip = (s: string): string => htmlToText(decodeQuotedPrintable(unwrapSoftLineBreaks(s))).trim();
  return transform(strip(actual)) === transform(strip(expected));
}

/**
 * Containment for long content (bodies). Strict mode requires plain containment;
 * normalized mode tolerates relay transformations that are not the provider's
 * fault: HTML wrapping, quoted-printable, injected pixels, re-wrapping.
 */
function containsValue(
  haystack: string,
  needle: string,
  mode: ValidationMode,
  transform: (value: string) => string,
): boolean {
  // MIME decoding MUST happen before whitespace normalisation: collapsing
  // whitespace first destroys quoted-printable soft line breaks (`=\r\n`),
  // leaving a stray `= ` that can no longer be decoded.
  const strip = (s: string): string => htmlToText(decodeQuotedPrintable(unwrapSoftLineBreaks(s)));

  if (mode === 'strict') {
    // Strict mode preserves exact differences — no decoding, no collapsing.
    return haystack.includes(needle);
  }

  const h = transform(strip(haystack));
  const n = transform(strip(needle));
  if (h.includes(n)) return true;

  const squeeze = (s: string): string => transform(strip(s)).replace(/\s+/g, '');
  const ns = squeeze(needle);
  return ns.length > 0 && squeeze(haystack).includes(ns);
}

export function validateContent(input: ValidationInput): ValidationResult {
  const applied = new Set<string>();
  const opts = { ...DEFAULT_NORMALIZATION, ...(input.normalization ?? {}) };
  const differences: string[] = [];

  const norm = (v: string): string => apply(v, input.mode, opts, applied);
  const sameValue = (actual: string, expected: string): boolean =>
    equalsValue(actual, expected, input.mode, norm);
  const hasContent = (haystack: string, needle: string): boolean =>
    containsValue(haystack, needle, input.mode, norm);

  // Subject ------------------------------------------------------------------
  if (input.actual.subject === null) {
    differences.push('subject: not available from provider');
  } else if (!sameValue(input.actual.subject, input.expected.subject)) {
    differences.push(
      `subject mismatch: expected ${JSON.stringify(input.expected.subject)}, got ${JSON.stringify(input.actual.subject)}`,
    );
    if (hasEncodingDamage(input.actual.subject)) differences.push('subject encoding damage detected');
  }

  // Plain-text body ----------------------------------------------------------
  if (input.actual.textBody === null) {
    differences.push('body: plain text not available from provider');
  } else if (!hasContent(input.actual.textBody, input.expected.text)) {
    differences.push('body mismatch: expected plain-text content not found');
    if (hasEncodingDamage(input.actual.textBody)) differences.push('body encoding damage detected');
  }

  // HTML body — validated ONLY when the sent message actually contained HTML.
  //
  // Bug fixed: `expectHtml` used to be derived from the provider capability
  // alone, so a plain-text scenario demanded an HTML part that was never sent.
  // That produced a false provider failure. HTML is only required when
  // `expected.html` exists AND the provider claims to expose HTML.
  if (input.expected.html) {
    if (!input.expectHtml) {
      differences.push('html body not supported by provider capability');
    } else if (input.actual.htmlBody === null) {
      differences.push('html body not available from provider');
    } else if (!hasContent(input.actual.htmlBody, input.expected.html)) {
      differences.push('html body mismatch: expected HTML content not found');
    }
  }

  // Correlation identifier ---------------------------------------------------
  const subjectValue = input.actual.subject ?? '';
  const bodyValue = input.actual.textBody ?? '';
  const correlationFoundInSubject = hasContent(subjectValue, input.correlationId);
  const correlationFoundInBody = hasContent(bodyValue, input.correlationId);
  if (!correlationFoundInSubject && !correlationFoundInBody) {
    differences.push('correlation id not found in subject or body');
  }

  // Recipient ----------------------------------------------------------------
  if (input.actualRecipient && input.actualRecipient.toLowerCase() !== input.recipient.toLowerCase()) {
    differences.push(
      `recipient mismatch: expected ${input.recipient}, got ${input.actualRecipient}`,
    );
  }

  return {
    status: differences.length === 0 ? 'PASS' : 'FAIL',
    mode: input.mode,
    appliedTransformations: [...applied],
    differences,
    correlationFoundInSubject,
    correlationFoundInBody,
  };
}
