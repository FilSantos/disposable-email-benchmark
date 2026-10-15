/**
 * Failure classification (Prompt 1 §6 / Prompt 2 §14).
 *
 * `classify` is a pure function: given the observations of one sample it returns
 * exactly ONE terminal category plus an attribution. Infrastructure and harness
 * failures are never attributed to a provider.
 */

import type {
  Attribution,
  ContentValidationStatus,
  FailureCategory,
  SampleRecord,
  SmtpStatus,
  TimeoutStatus,
  TransportMode,
} from '../domain/types.js';

export interface ClassificationInput {
  readonly smtpStatus: SmtpStatus;
  readonly detected: boolean;
  readonly contentAvailable: boolean;
  readonly contentValidationStatus: ContentValidationStatus;
  readonly validationDifferences: readonly string[];
  readonly wrongMessageMatched: boolean;
  readonly timeoutStatus: TimeoutStatus;
  readonly providerReachable: boolean;
  readonly rateLimited: boolean;
  readonly channel: 'UI' | 'API';
  /**
   * Loopback proves the harness, not delivery: no message ever reaches the
   * provider, so a non-detection there must NOT be attributed to the provider.
   */
  readonly transportMode?: TransportMode;
  /** Human-readable error code already classified by an adapter, if any. */
  readonly adapterErrorCode?: string | undefined;
}

export interface ClassificationResult {
  readonly category: FailureCategory;
  readonly attribution: Attribution;
}

/**
 * Determines whether a validation difference is an encoding problem.
 * Encoding issues are reported distinctly so they are not confused with a
 * genuine content mismatch (Prompt 1 §6.3).
 */
function isEncodingDifference(diff: string): boolean {
  return /encoding|utf-?8|mojibake|charset|replacement character|\\ufffd/i.test(diff);
}

export function classify(input: ClassificationInput): ClassificationResult {
  // 1. Transport failed before anything else could happen.
  if (input.smtpStatus === 'REJECTED' || input.smtpStatus === 'ERROR') {
    return { category: 'SMTP_SEND_FAILED', attribution: 'ENVIRONMENT' };
  }
  if (input.smtpStatus === 'NOT_ATTEMPTED') {
    return { category: 'TEST_INFRASTRUCTURE_ERROR', attribution: 'HARNESS' };
  }

  // 1b. Loopback never delivers externally, so non-detection is a staging
  //     limitation of the harness, never a provider failure.
  if (input.transportMode === 'loopback' && !input.detected) {
    return { category: 'MESSAGE_NOT_DETECTED', attribution: 'HARNESS' };
  }

  // 2. Harness-level failures take precedence over provider blame.
  if (input.adapterErrorCode === 'CONFIGURATION_ERROR') {
    return { category: 'CONFIGURATION_ERROR', attribution: 'HARNESS' };
  }
  if (input.adapterErrorCode === 'TEST_INFRASTRUCTURE_ERROR') {
    return { category: 'TEST_INFRASTRUCTURE_ERROR', attribution: 'HARNESS' };
  }

  // 3. Provider availability and throttling.
  if (!input.providerReachable) {
    return { category: 'PROVIDER_UNAVAILABLE', attribution: 'PROVIDER' };
  }
  if (input.rateLimited) {
    return { category: 'PROVIDER_RATE_LIMITED', attribution: 'PROVIDER' };
  }

  // 4. Channel-specific transport errors surfaced by an adapter.
  if (input.adapterErrorCode === 'UI_AUTOMATION_FAILED') {
    return { category: 'UI_AUTOMATION_FAILED', attribution: 'HARNESS' };
  }
  if (input.adapterErrorCode === 'API_REQUEST_FAILED') {
    return { category: 'API_REQUEST_FAILED', attribution: 'PROVIDER' };
  }

  // 5. Detection.
  if (!input.detected) {
    if (input.timeoutStatus === 'TRANSPORT_TIMEOUT') {
      return { category: 'TEST_INFRASTRUCTURE_ERROR', attribution: 'ENVIRONMENT' };
    }
    return { category: 'MESSAGE_NOT_DETECTED', attribution: 'PROVIDER' };
  }

  // 6. A different message satisfied the lookup.
  if (input.wrongMessageMatched) {
    return { category: 'WRONG_MESSAGE_MATCHED', attribution: 'HARNESS' };
  }

  // 7. Content retrieval.
  if (!input.contentAvailable) {
    return { category: 'MESSAGE_CONTENT_UNAVAILABLE', attribution: 'PROVIDER' };
  }

  // 8. Content accuracy.
  if (input.contentValidationStatus === 'FAIL') {
    if (input.validationDifferences.some(isEncodingDifference)) {
      return { category: 'ENCODING_MISMATCH', attribution: 'PROVIDER' };
    }
    const hasSubject = input.validationDifferences.some((d) => /^subject/i.test(d));
    const hasBody = input.validationDifferences.some((d) => /^(body|text|html)/i.test(d));
    if (hasBody && !hasSubject) return { category: 'BODY_MISMATCH', attribution: 'PROVIDER' };
    if (hasSubject && !hasBody) return { category: 'SUBJECT_MISMATCH', attribution: 'PROVIDER' };
    // Both (or unspecified) — report the subject first as the primary assertion.
    return { category: 'SUBJECT_MISMATCH', attribution: 'PROVIDER' };
  }

  // 9. Everything passed.
  throw new Error('classify() called for a passing sample; only failures are classified');
}

/**
 * Applies classification to a sample that has already been observed.
 * Returns the same record with outcome/failureCategory/attribution set.
 */
export function classifySample(
  sample: SampleRecord,
  input: Omit<ClassificationInput, 'smtpStatus' | 'detected' | 'contentAvailable' | 'timeoutStatus' | 'channel'>,
): SampleRecord {
  const detected = pickDetected(sample);
  const contentAvailable = pickContentAvailable(sample);
  const result = classify({
    ...input,
    smtpStatus: sample.smtpStatus,
    detected,
    contentAvailable,
    timeoutStatus: sample.timeoutStatus,
    channel: sample.channel,
    transportMode: sample.transportMode,
  });
  return { ...sample, outcome: 'FAIL', failureCategory: result.category, attribution: result.attribution };
}

export function pickDetected(sample: SampleRecord): boolean {
  return sample.channel === 'UI'
    ? sample.uiFirstDetectedAt !== null
    : sample.apiFirstDetectedAt !== null;
}

export function pickContentAvailable(sample: SampleRecord): boolean {
  return sample.channel === 'UI'
    ? sample.uiContentAvailableAt !== null
    : sample.apiContentAvailableAt !== null;
}
