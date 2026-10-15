/**
 * Canonical domain types for the benchmark framework.
 *
 * These names are the CONTRACT frozen by the approved business analysis package
 * (docs/business-analysis). Do not rename metric or failure identifiers without
 * updating that package: reports and traceability depend on exact string equality.
 */

// ---------------------------------------------------------------------------
// Capability states (Prompt 2 §5, Prompt 1 §5)
// ---------------------------------------------------------------------------

export const CAPABILITY_STATES = [
  'SUPPORTED',
  'NOT_SUPPORTED',
  'CONFIGURATION_REQUIRED',
  'TEMPORARILY_UNAVAILABLE',
  'BLOCKED_BY_PROVIDER',
  'NOT_TESTED',
] as const;

export type CapabilityState = (typeof CAPABILITY_STATES)[number];

/** How the capability claim was established. Keeps facts separate from guesses. */
export type CapabilityEvidence = 'DOCUMENTED' | 'OBSERVED' | 'UNVERIFIED';

export interface CapabilityClaim {
  readonly state: CapabilityState;
  readonly evidence: CapabilityEvidence;
  /** Required when evidence is DOCUMENTED. */
  readonly sourceUrl?: string;
  /** ISO date the claim was last verified. */
  readonly verifiedAt: string;
  readonly notes?: string;
}

// ---------------------------------------------------------------------------
// Channels, origins and transports
// ---------------------------------------------------------------------------

export type Channel = 'UI' | 'API';

/**
 * Real = executed against a provider. Simulated = fixture/mock driven.
 * Unexecuted = planned but not run. Headline metrics may only use REAL.
 */
export type SampleOrigin = 'REAL' | 'SIMULATED' | 'UNEXECUTED';

export type TransportMode = 'loopback' | 'direct-mx' | 'relay';

// ---------------------------------------------------------------------------
// Failure taxonomy (Prompt 1 §6 / Prompt 2 §14) — exactly 13 categories
// ---------------------------------------------------------------------------

export const FAILURE_CATEGORIES = [
  'SMTP_SEND_FAILED',
  'MESSAGE_NOT_DETECTED',
  'MESSAGE_CONTENT_UNAVAILABLE',
  'SUBJECT_MISMATCH',
  'BODY_MISMATCH',
  'ENCODING_MISMATCH',
  'WRONG_MESSAGE_MATCHED',
  'UI_AUTOMATION_FAILED',
  'API_REQUEST_FAILED',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'CONFIGURATION_ERROR',
  'TEST_INFRASTRUCTURE_ERROR',
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/**
 * Who is responsible for a failure. Infrastructure failures must never be
 * auto-attributed to a provider (Prompt 2 §14).
 */
export type Attribution = 'PROVIDER' | 'HARNESS' | 'ENVIRONMENT';

export interface ErrorInfo {
  readonly name: string;
  /** Already redacted by the logging boundary. */
  readonly message: string;
  readonly code?: string;
  readonly httpStatus?: number;
}

// ---------------------------------------------------------------------------
// Timestamps and measurements
// ---------------------------------------------------------------------------

export interface ObservationWindow {
  readonly smtpAcceptedAt: string | null;
  readonly uiFirstDetectedAt: string | null;
  readonly uiContentAvailableAt: string | null;
  readonly apiFirstDetectedAt: string | null;
  readonly apiContentAvailableAt: string | null;
}

// ---------------------------------------------------------------------------
// Sample record (Prompt 2 §18) — the unit of evidence
// ---------------------------------------------------------------------------

export type ContentValidationStatus = 'PASS' | 'FAIL' | 'NOT_ATTEMPTED' | 'NOT_APPLICABLE';

export type SmtpStatus = 'ACCEPTED' | 'REJECTED' | 'ERROR' | 'NOT_ATTEMPTED';

export type TimeoutStatus =
  | 'NONE'
  | 'DETECTION_TIMEOUT'
  | 'CONTENT_TIMEOUT'
  | 'TRANSPORT_TIMEOUT';

export interface SampleRecord extends ObservationWindow {
  readonly runId: string;
  readonly sampleId: string;
  readonly provider: string;
  readonly channel: Channel;
  readonly sampleOrigin: SampleOrigin;
  readonly transportMode: TransportMode;

  readonly inboxIdentifier: string | null;
  readonly messageId: string | null;
  readonly correlationId: string;

  // Derived metrics: null whenever they cannot be computed. Never fabricated.
  readonly detectionLatencyMs: number | null;
  readonly contentLatencyMs: number | null;
  readonly contentAccessDurationMs: number | null;

  /** HTTP durations for the API channel, kept separate from detection latency. */
  readonly apiRequestResponseMs: readonly number[];

  readonly smtpStatus: SmtpStatus;
  readonly contentValidationStatus: ContentValidationStatus;
  readonly requestCount: number;
  readonly retryCount: number;
  readonly pollingIntervalMs: number;
  readonly pollingAttempts: number;
  readonly lastNegativePollAt: string | null;
  readonly firstPositivePollAt: string | null;
  readonly timeoutMs: number;
  readonly timeoutStatus: TimeoutStatus;

  readonly outcome: 'PASS' | 'FAIL' | 'NOT_EXECUTED';
  readonly failureCategory: FailureCategory | null;
  readonly attribution: Attribution | null;

  readonly validationMode: 'strict' | 'normalized' | null;
  readonly validationDifferences: readonly string[];

  readonly artifacts: Readonly<Record<string, string>>;
  readonly errorDetails: ErrorInfo | null;

  readonly frameworkVersion: string;
  readonly configurationVersion: string;
  readonly environment: EnvironmentMetadata;
}

export interface EnvironmentMetadata {
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly hostname: string;
  readonly cwd: string;
}

// ---------------------------------------------------------------------------
// Provider adapter contract (Prompt 2 §11)
// ---------------------------------------------------------------------------

export interface DetectedMessage {
  readonly detectedAt: string;
  readonly messageRef: string;
  readonly raw?: unknown;
}

export interface RetrievedContent {
  readonly contentAvailableAt: string;
  readonly subject: string | null;
  readonly textBody: string | null;
  readonly htmlBody: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface ProviderCapabilities {
  readonly uiAccess: CapabilityClaim;
  readonly uiAutomation: CapabilityClaim;
  readonly officialApi: CapabilityClaim;
  readonly apiConfiguration: CapabilityClaim;
  readonly subject: CapabilityClaim;
  readonly textBody: CapabilityClaim;
  readonly htmlBody: CapabilityClaim;
  readonly metadata: CapabilityClaim;
}

export interface ProviderMetadata {
  readonly id: string;
  readonly displayName: string;
  readonly officialWebsite: string;
  readonly domains: readonly string[];
  readonly notes: readonly string[];
}

export interface PollInfo {
  readonly attempt: number;
  readonly at: string;
  readonly found: boolean;
  readonly requestDurationMs: number;
}

export interface WaitResult {
  readonly detected: DetectedMessage | null;
  readonly attempts: number;
  readonly lastNegativeAt: string | null;
  readonly firstPositiveAt: string | null;
  readonly timedOut: boolean;
}

export interface WaitRequest {
  readonly inbox: string;
  readonly correlationId: string;
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
  /** Reports each poll so the sampler can record last-negative/first-positive. */
  readonly onPoll?: (info: PollInfo) => void;
}

/** A provider is required to implement only the channels it actually supports. */
export interface ApiChannel {
  readonly channel: 'API';
  isConfigured(): boolean;
  getInboxAddress(): Promise<string>;
  waitForMessage(req: WaitRequest): Promise<WaitResult>;
  getMessage(ref: DetectedMessage): Promise<RetrievedContent>;
}

export interface UiChannel {
  readonly channel: 'UI';
  getInboxAddress(): Promise<string>;
  waitForMessage(req: WaitRequest): Promise<WaitResult>;
  getMessage(ref: DetectedMessage): Promise<RetrievedContent>;
}

export interface ProviderAdapter extends ProviderMetadata {
  capabilities(): ProviderCapabilities;
  readonly api?: ApiChannel;
  readonly ui?: UiChannel;
}

// ---------------------------------------------------------------------------
// Transport contract
// ---------------------------------------------------------------------------

export interface OutgoingMessage {
  readonly messageId: string;
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface SendResult {
  readonly accepted: boolean;
  readonly acceptedAt: string | null;
  readonly transportMode: TransportMode;
  /** Provider SMTP response text, sanitized. */
  readonly response: string | null;
  readonly error: ErrorInfo | null;
}

export interface SmtpTransport {
  readonly mode: TransportMode;
  /** Whether this transport can actually be used with the current configuration. */
  isConfigured(): boolean;
  send(message: OutgoingMessage): Promise<SendResult>;
}
