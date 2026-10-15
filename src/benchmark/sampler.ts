/**
 * Sampler — the lifecycle of ONE benchmark sample (Prompt 2 §12, §13, §18).
 *
 * Sequence:
 *   1. resolve the inbox address via the adapter
 *   2. send the synthetic message through the configured transport
 *   3. record SMTP acceptance (lower bound for every latency metric)
 *   4. poll the channel until the CORRECT message is detected
 *   5. retrieve content
 *   6. validate content
 *   7. classify the outcome
 *
 * Invariants enforced here:
 *   - latency is null unless BOTH endpoints of the interval exist
 *   - exactly one failure category for a failing sample
 *   - the timeout value is never written into a latency field
 */

import type {
  ApiChannel,
  Channel,
  DetectedMessage,
  EnvironmentMetadata,
  FailureCategory,
  Attribution,
  OutgoingMessage,
  ProviderAdapter,
  SampleOrigin,
  SampleRecord,
  SmtpTransport,
  TimeoutStatus,
  UiChannel,
  WaitResult,
} from '../domain/types.js';
import { createClock, type Clock } from '../domain/clock.js';
import { deriveMetrics } from '../metrics/metrics.js';
import { validateContent } from '../validation/validate.js';
import { classify, pickContentAvailable, pickDetected, type ClassificationInput } from './classify.js';
import { AdapterError } from '../providers/adapter-support.js';
import { FRAMEWORK_VERSION } from '../config/config.js';

export interface SamplerDeps {
  readonly transport: SmtpTransport;
  readonly clock?: Clock;
  readonly environment: EnvironmentMetadata;
  readonly configurationVersion: string;
}

export interface SampleInput {
  readonly runId: string;
  readonly sampleId: string;
  readonly provider: ProviderAdapter;
  readonly channel: Channel;
  readonly sampleOrigin: SampleOrigin;
  readonly message: OutgoingMessage & {
    readonly correlationId: string;
    readonly expectedSubject: string;
    readonly expectedText: string;
    readonly expectedHtml: string | null;
  };
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
  readonly validationMode: 'strict' | 'normalized';
  readonly expectHtml: boolean;
  /** Forces an error path for deterministic tests. */
  readonly injectedAdapterError?: AdapterError | undefined;
}

export class ConfigurationMissingError extends Error {
  override readonly name = 'ConfigurationMissingError';
}

export class Sampler {
  private readonly clock: Clock;

  constructor(private readonly deps: SamplerDeps) {
    this.clock = deps.clock ?? createClock();
  }

  /** Runs one sample end to end. Never throws for a provider-side failure. */
  async run(input: SampleInput): Promise<SampleRecord> {
    const channelImpl = this.resolveChannel(input);

    let inboxIdentifier: string | null = null;
    let transportError: unknown = null;

    // 1. Resolve the inbox address ------------------------------------------
    try {
      inboxIdentifier = await channelImpl.getInboxAddress();
    } catch (err) {
      return this.finishError(input, inboxIdentifier, err, 'inbox-resolution');
    }

    // 2/3. Send the message and record local SMTP acceptance ----------------
    const sendResult = await this.deps.transport.send(input.message);
    if (!sendResult.accepted) {
      transportError = sendResult.error ?? new Error('transport rejected the message');
    }

    const smtpAcceptedAt = sendResult.acceptedAt;

    // 4. Poll for the CORRECT message --------------------------------------
    let detection: DetectedMessage | null = null;
    let detectedAt: string | null = null;
    let contentAt: string | null = null;
    let pollResult: WaitResult | null = null;
    let wrongMessageMatched = false;
    let pollError: unknown = null;
    const apiDurations: number[] = [];
    let requestCount = 0;

    if (smtpAcceptedAt) {
      try {
        pollResult = await this.poll(channelImpl, input, apiDurations, () => {
          requestCount += 1;
        });
        detection = pollResult.detected;
        detectedAt = pollResult.detected?.detectedAt ?? null;
      } catch (err) {
        pollError = err;
      }
    }

    // 5. Retrieve content ---------------------------------------------------
    let content: Awaited<ReturnType<typeof channelImpl.getMessage>> | null = null;
    let contentError: unknown = null;
    if (detection) {
      try {
        content = await channelImpl.getMessage(detection);
        contentAt = content.contentAvailableAt;
        requestCount += 1;
      } catch (err) {
        contentError = err;
      }
    }

    // 6. Validate -----------------------------------------------------------
    let contentValidationStatus: SampleRecord['contentValidationStatus'] = 'NOT_ATTEMPTED';
    let differences: string[] = [];
    if (content) {
      const result = validateContent({
        mode: input.validationMode,
        expected: {
          subject: input.message.expectedSubject,
          text: input.message.expectedText,
          html: input.message.expectedHtml,
        },
        actual: {
          subject: content.subject,
          textBody: content.textBody,
          htmlBody: content.htmlBody,
        },
        expectHtml: input.expectHtml,
        correlationId: input.message.correlationId,
        recipient: input.message.to,
        actualRecipient: content.metadata['rcptto'] ?? content.metadata['to'] ?? null,
      });
      contentValidationStatus = result.status;
      differences = [...result.differences];
    }

    // Check for the "wrong message" condition: detected but the correlation id
    // is absent from whatever was retrieved.
    if (content && !differences.some((d) => d.includes('correlation id not found'))) {
      const correlationPresent =
        (content.subject ?? '').includes(input.message.correlationId) ||
        (content.textBody ?? '').includes(input.message.correlationId);
      if (!correlationPresent) wrongMessageMatched = true;
    }

    const timeoutStatus: TimeoutStatus =
      smtpAcceptedAt && !detectedAt && !pollError
        ? 'DETECTION_TIMEOUT'
        : detection && !contentAt && contentError
          ? 'CONTENT_TIMEOUT'
          : transportError
            ? 'TRANSPORT_TIMEOUT'
            : 'NONE';

    // 7. Build the record ---------------------------------------------------
    const window = {
      smtpAcceptedAt,
      uiFirstDetectedAt: input.channel === 'UI' ? detectedAt : null,
      uiContentAvailableAt: input.channel === 'UI' ? contentAt : null,
      apiFirstDetectedAt: input.channel === 'API' ? detectedAt : null,
      apiContentAvailableAt: input.channel === 'API' ? contentAt : null,
    };

    const base: SampleRecord = {
      runId: input.runId,
      sampleId: input.sampleId,
      provider: input.provider.id,
      channel: input.channel,
      sampleOrigin: input.sampleOrigin,
      transportMode: this.deps.transport.mode,
      inboxIdentifier,
      messageId: input.message.messageId,
      correlationId: input.message.correlationId,
      ...window,
      detectionLatencyMs: null,
      contentLatencyMs: null,
      contentAccessDurationMs: null,
      apiRequestResponseMs: apiDurations,
      smtpStatus: sendResult.accepted ? 'ACCEPTED' : 'REJECTED',
      contentValidationStatus,
      requestCount,
      retryCount: 0,
      pollingIntervalMs: input.pollIntervalMs,
      pollingAttempts: pollResult?.attempts ?? 0,
      lastNegativePollAt: pollResult?.lastNegativeAt ?? null,
      firstPositivePollAt: pollResult?.firstPositiveAt ?? null,
      timeoutMs: input.timeoutMs,
      timeoutStatus,
      outcome: 'PASS',
      failureCategory: null,
      attribution: null,
      validationMode: content ? input.validationMode : null,
      validationDifferences: differences,
      artifacts: {},
      errorDetails: null,
      frameworkVersion: FRAMEWORK_VERSION,
      configurationVersion: this.deps.configurationVersion,
      environment: this.deps.environment,
    };

    // Derived metrics computed only from real timestamps.
    const derived = deriveMetrics(base);
    const withMetrics: SampleRecord = {
      ...base,
      detectionLatencyMs: derived.detectionLatencyMs,
      contentLatencyMs: derived.contentLatencyMs,
      contentAccessDurationMs: derived.contentAccessDurationMs,
    };

    // Decide PASS vs FAIL.
    const passed =
      sendResult.accepted &&
      pickDetected(withMetrics) &&
      pickContentAvailable(withMetrics) &&
      contentValidationStatus === 'PASS';

    if (passed) {
      return withMetrics;
    }

    // Classify exactly one terminal category.
    const adapterError = this.latestError(input, transportError, pollError, contentError);
    const input_ = {
      contentValidationStatus,
      validationDifferences: differences,
      wrongMessageMatched,
      providerReachable: !isUnreachable(pollError) && !isUnreachable(contentError),
      rateLimited: isRateLimited(pollError) || isRateLimited(contentError),
      adapterErrorCode: adapterError?.code,
    } satisfies Omit<ClassificationInput, 'smtpStatus' | 'detected' | 'contentAvailable' | 'timeoutStatus' | 'channel'>;

    const classification = classify({
      ...input_,
      smtpStatus: withMetrics.smtpStatus,
      detected: pickDetected(withMetrics),
      contentAvailable: pickContentAvailable(withMetrics),
      timeoutStatus: withMetrics.timeoutStatus,
      channel: withMetrics.channel,
      transportMode: withMetrics.transportMode,
    });

    return {
      ...withMetrics,
      outcome: 'FAIL',
      failureCategory: classification.category as FailureCategory,
      attribution: classification.attribution as Attribution,
      errorDetails: adapterError
        ? { name: adapterError.name, message: adapterError.message, ...(adapterError.httpStatus ? { httpStatus: adapterError.httpStatus } : {}) }
        : null,
    };
  }

  private resolveChannel(input: SampleInput): ApiChannel | UiChannel {
    if (input.injectedAdapterError) throw input.injectedAdapterError;
    const channelImpl = input.channel === 'API' ? input.provider.api : input.provider.ui;
    if (!channelImpl) {
      throw new ConfigurationMissingError(
        `${input.provider.id} has no ${input.channel} channel available`,
      );
    }
    return channelImpl;
  }

  private async poll(
    channelImpl: ApiChannel | UiChannel,
    input: SampleInput,
    apiDurations: number[],
    countRequest: () => void,
  ): Promise<WaitResult> {
    const inbox = await channelImpl.getInboxAddress();
    return channelImpl.waitForMessage({
      inbox,
      correlationId: input.message.correlationId,
      timeoutMs: input.timeoutMs,
      pollIntervalMs: input.pollIntervalMs,
      onPoll: (info) => {
        countRequest();
        if (input.channel === 'API') apiDurations.push(info.requestDurationMs);
      },
    });
  }

  private finishError(
    input: SampleInput,
    inboxIdentifier: string | null,
    err: unknown,
    stage: string,
  ): SampleRecord {
    const adapterError = err instanceof AdapterError ? err : null;
    const category: FailureCategory = adapterError
      ? (adapterError.code as FailureCategory)
      : err instanceof ConfigurationMissingError
        ? 'CONFIGURATION_ERROR'
        : 'TEST_INFRASTRUCTURE_ERROR';
    const attribution: Attribution =
      category === 'CONFIGURATION_ERROR' || category === 'TEST_INFRASTRUCTURE_ERROR' ? 'HARNESS' : 'PROVIDER';
    return {
      runId: input.runId,
      sampleId: input.sampleId,
      provider: input.provider.id,
      channel: input.channel,
      sampleOrigin: input.sampleOrigin,
      transportMode: this.deps.transport.mode,
      inboxIdentifier,
      messageId: input.message.messageId,
      correlationId: input.message.correlationId,
      smtpAcceptedAt: null,
      uiFirstDetectedAt: null,
      uiContentAvailableAt: null,
      apiFirstDetectedAt: null,
      apiContentAvailableAt: null,
      detectionLatencyMs: null,
      contentLatencyMs: null,
      contentAccessDurationMs: null,
      apiRequestResponseMs: [],
      smtpStatus: 'NOT_ATTEMPTED',
      contentValidationStatus: 'NOT_ATTEMPTED',
      requestCount: 0,
      retryCount: 0,
      pollingIntervalMs: input.pollIntervalMs,
      pollingAttempts: 0,
      lastNegativePollAt: null,
      firstPositivePollAt: null,
      timeoutMs: input.timeoutMs,
      timeoutStatus: 'NONE',
      outcome: 'FAIL',
      failureCategory: category,
      attribution,
      validationMode: null,
      validationDifferences: [],
      artifacts: {},
      errorDetails: { name: (err as Error)?.name ?? 'Error', message: `${stage}: ${(err as Error)?.message ?? String(err)}` },
      frameworkVersion: FRAMEWORK_VERSION,
      configurationVersion: this.deps.configurationVersion,
      environment: this.deps.environment,
    };
  }

  private latestError(
    input: SampleInput,
    transportError: unknown,
    pollError: unknown,
    contentError: unknown,
  ): AdapterError | null {
    void input;
    for (const candidate of [pollError, contentError]) {
      if (candidate instanceof AdapterError) return candidate;
    }
    if (transportError) {
      return new AdapterError('TEST_INFRASTRUCTURE_ERROR', String((transportError as Error)?.message ?? transportError));
    }
    return null;
  }
}

function isRateLimited(err: unknown): boolean {
  return err instanceof AdapterError && err.httpStatus === 429;
}

function isUnreachable(err: unknown): boolean {
  return err instanceof AdapterError && err.code === 'API_REQUEST_FAILED';
}
