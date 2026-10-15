# 06 — Technical Handoff for the VS Code Implementation Agent

**Parent:** [00-overview.md](./00-overview.md) · **Status:** Draft for QA Manager review · **Date:** 2026-10-14
**Audience:** an implementation agent working in VS Code with Playwright + TypeScript.

> This document is specific enough to translate the approved requirements into architecture, implementation tasks, and automated tests. **No production code is written in this package**; the snippets below are illustrative contracts only.

---

## 1. Scope of the implementation

Build a **benchmark harness** that:
1. generates synthetic email messages with a correlation ID,
2. sends them through a **local SMTP server**,
3. observes arrival via **provider UI adapters** and **documented API adapters**,
4. validates content,
5. records timestamps and outcomes,
6. emits **JSON (source of truth) + HTML + CSV** reports.

It is **not** a production email platform, and it must **not** bypass provider controls.

---

## 2. Suggested repository layout

```
disposable-email-benchmark/
├─ docs/business-analysis/          # this package (approved)
├─ src/
│  ├─ config/
│  │   ├─ providers.ts              # capability matrix (data, not prose)
│  │   ├─ run.ts                    # run manifest schema + defaults
│  │   └─ env.ts                    # secrets loading + validation
│  ├─ smtp/
│  │   ├─ server.ts                 # local SMTP server; emits SMTP_ACCEPTED_AT
│  │   └─ injector.ts               # synthetic message builder + correlation IDs
│  ├─ adapters/
│  │   ├─ types.ts                  # ProviderAdapter / UiAdapter / ApiAdapter contracts
│  │   ├─ capabilities.ts           # SUPPORTED | NOT_SUPPORTED | ... state handling
│  │   ├─ ui/
│  │   │   ├─ mailinator.ui.ts
│  │   │   ├─ guerrillamail.ui.ts
│  │   │   ├─ maildrop.ui.ts
│  │   │   ├─ yopmail.ui.ts
│  │   │   └─ tenminutemail.ui.ts
│  │   └─ api/
│  │       ├─ mailinator.api.ts
│  │       ├─ guerrillamail.api.ts
│  │       └─ maildrop.api.ts
│  ├─ core/
│  │   ├─ runner.ts                 # orchestrates samples, order, timeouts
│  │   ├─ sampler.ts                # one sample lifecycle (state machine)
│  │   ├─ clock.ts                  # single monotonic clock source
│  │   ├─ polling.ts                # fixed-interval poll with drift detection
│  │   ├─ rateLimit.ts              # per-provider limiter + back-off
│  │   ├─ validate.ts               # subject/body/encoding/correlation checks
│  │   ├─ classify.ts               # failure taxonomy decision tree
│  │   └─ evidence.ts               # sample JSON, screenshots, traces, redaction
│  ├─ metrics/
│  │   ├─ latency.ts                # the six derived metrics
│  │   ├─ reliability.ts            # rates + Wilson CIs
│  │   └─ aggregate.ts              # funnel denominators
│  └─ report/
│      ├─ json.ts                   # source of truth
│      ├─ html.ts                   # executive + technical
│      └─ csv.ts
├─ tests/
│  ├─ unit/                         # formulas, classifier, limiter, redaction
│  └─ contract/                     # adapter contract tests (mocked)
├─ runs/                            # run manifests + sample JSON (gitignored)
└─ playwright.config.ts
```

---

## 3. Core data contracts

### 3.1 Sample record (JSON — source of truth)

```ts
type SampleOrigin = 'REAL' | 'SIMULATED' | 'UNEXECUTED';
type Mode = 'UI' | 'API';
type CapabilityState =
  | 'SUPPORTED' | 'NOT_SUPPORTED' | 'CONFIGURATION_REQUIRED'
  | 'TEMPORARILY_UNAVAILABLE' | 'BLOCKED_BY_PROVIDER' | 'NOT_TESTED';

type FailureCategory =
  | 'SMTP_SEND_FAILED' | 'MESSAGE_NOT_DETECTED' | 'MESSAGE_CONTENT_UNAVAILABLE'
  | 'SUBJECT_MISMATCH' | 'BODY_MISMATCH' | 'ENCODING_MISMATCH'
  | 'WRONG_MESSAGE_MATCHED' | 'UI_AUTOMATION_FAILED' | 'API_REQUEST_FAILED'
  | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'CONFIGURATION_ERROR'
  | 'TEST_INFRASTRUCTURE_ERROR';

interface SampleRecord {
  sampleId: string;
  runId: string;
  provider: string;
  mode: Mode;
  sampleOrigin: SampleOrigin;
  correlationId: string;
  capabilityAtRun: Partial<Record<string, CapabilityState>>;

  smtpAcceptedAt: string | null;        // ISO-8601, monotonic-derived
  uiFirstDetectedAt: string | null;
  uiContentAvailableAt: string | null;
  apiFirstDetectedAt: string | null;
  apiContentAvailableAt: string | null;

  detectionLatencyMs: number | null;    // NEVER fabricated on timeout
  contentLatencyMs: number | null;
  contentAccessDurationMs: number | null;
  apiRequestResponseMs: number[];       // separate metric, per request

  detected: boolean;
  contentAvailable: boolean;
  contentValid: boolean;
  duplicateCount: number;
  matchedOtherCorrelationId: boolean;

  outcome: 'PASS' | 'FAIL';
  failureCategory: FailureCategory | null;
  attribution: 'PROVIDER' | 'HARNESS' | 'ENVIRONMENT';
  pollIntervalMs: number;
  timeoutMs: number;
  artifacts: { screenshot?: string; trace?: string };
  notes?: string;
}
```

**Hard rules the code must enforce:**
- `detectionLatencyMs` is `null` when not detected. **Never** write the timeout value as a latency.
- `contentLatencyMs` requires both `smtpAcceptedAt` and `*ContentAvailableAt`.
- Every `FAIL` has exactly one `failureCategory`.
- `sampleOrigin !== 'REAL'` ⇒ excluded from reported metrics.

### 3.2 Adapter contracts

```ts
interface ProviderAdapterBase {
  readonly provider: string;
  readonly mode: Mode;
  capability(): CapabilityState;
}

interface UiAdapter extends ProviderAdapterBase {
  readonly mode: 'UI';
  openInbox(ctx: PlaywrightContext, address: string): Promise<void>;
  detect(ctx: PlaywrightContext, correlationId: string, pollMs: number): Promise<DetectResult>;
  readContent(ctx: PlaywrightContext, ref: DetectResult): Promise<ContentResult>;
}

interface ApiAdapter extends ProviderAdapterBase {
  readonly mode: 'API';
  init(creds: Credentials): Promise<void>;
  detect(correlationId: string, pollMs: number): Promise<DetectResult>;
  readContent(ref: DetectResult): Promise<ContentResult>;
  /** honours documented limits; throws RateLimitedError on 429 after back-off */
  readonly rateLimit?: { maxRequests: number; windowMs: number };
}

interface DetectResult { detectedAt: string; messageRef: string; }
interface ContentResult {
  contentAvailableAt: string;
  subject: string | null;
  textBody: string | null;
  htmlBody: string | null;      // may be sanitized by provider (Guerrilla Mail)
  metadata: Record<string, string>;
}
```

---

## 4. Capability matrix as data

Encode [00-overview.md §6](./00-overview.md#6-provider-capability-matrix) as data with sources, so the report can cite and re-verify it:

```ts
interface CapabilityEntry {
  provider: string;
  capability: string;
  state: CapabilityState;
  evidence: 'DOCUMENTED' | 'OBSERVED' | 'UNVERIFIED';
  sourceUrl?: string;
  verifiedAt: string;   // ISO date, e.g. '2026-10-14'
  notes?: string;
}
```

Test requirement: a validation test asserts every `state` is in the allowed vocabulary, and that every `DOCUMENTED` entry has a `sourceUrl`.

---

## 5. Metric formulas (implement exactly)

```ts
const t0 = record.smtpAcceptedAt;

uiDetectionLatency        = t0 && record.uiFirstDetectedAt
                              ? ms(record.uiFirstDetectedAt, t0) : null;
uiContentLatency          = t0 && record.uiContentAvailableAt
                              ? ms(record.uiContentAvailableAt, t0) : null;
apiDetectionLatency       = t0 && record.apiFirstDetectedAt
                              ? ms(record.apiFirstDetectedAt, t0) : null;
apiContentLatency         = t0 && record.apiContentAvailableAt
                              ? ms(record.apiContentAvailableAt, t0) : null;

uiContentAccessDuration   = record.uiFirstDetectedAt && record.uiContentAvailableAt
                              ? ms(record.uiContentAvailableAt, record.uiFirstDetectedAt) : null;
apiContentAccessDuration  = record.apiFirstDetectedAt && record.apiContentAvailableAt
                              ? ms(record.apiContentAvailableAt, record.apiFirstDetectedAt) : null;
```

`apiRequestResponseMs` is recorded **per HTTP request** and reported separately. **Do not** fold it into detection latency.

---

## 6. Implementation tasks (ordered backlog)

| # | Task | Requirement | Notes |
|---|---|---|---|
| T-01 | Scaffold TS project, Playwright, lint, test runner | — | Node + TS strict |
| T-02 | `config/env.ts` secret loading + `CONFIGURATION_ERROR` on missing | BR-020 | Never log values |
| T-03 | Capability matrix data + validator test | BR-008, BR-019 | §4 above |
| T-04 | Local SMTP server emitting `smtpAcceptedAt` | BR-005 | Must record acceptance outcome per recipient |
| T-05 | Synthetic message builder + correlation IDs + UTF-8 variant | BR-004 | Deterministic from seed |
| T-06 | Monotonic clock abstraction | NFR-05 | Single source |
| T-07 | Adapter interfaces + contract tests (mocked) | BR-011 | §3.2 |
| T-08 | Polling utility with drift detection | BR-005 | Fixed 2 s default |
| T-09 | Rate limiter + back-off | BR-013 | Maildrop 50/10s; conservative defaults others |
| T-10 | Sample lifecycle state machine | BR-007 | Enforces one terminal category |
| T-11 | Failure classifier following decision tree | BR-012 | Unit-tested per branch |
| T-12 | Validation module (subject/body/encoding/correlation) | BR-004, content | Normalization documented |
| T-13 | Evidence capture + redaction | BR-015, BR-016 | Secret-scan test |
| T-14 | Metrics + aggregation + Wilson CI | BR-005, BR-006 | §5 above |
| T-15 | JSON reporter (source of truth) | BR-009 | Schema-stable |
| T-16 | HTML + CSV generators from JSON | BR-009 | No independent computation |
| T-17 | Origin labelling + refusal to publish non-REAL metrics | BR-017 | Negative test |
| T-18 | UI adapters ×5 (capability-gated) | BR-002 | 10 Minute Mail may be `BLOCKED_BY_PROVIDER` |
| T-19 | API adapters ×3 (Mailinator, Guerrilla Mail, Maildrop) | BR-003 | Capability-gated |
| T-20 | Runner orchestration + manifest | BR-010 | Sequential default |
| T-21 | Runbook + reproduction commands | BR-010, D5-4 | Technical handoff §8 |

Recommended order: T-01→T-06 (foundation), T-07→T-13 (core), T-14→T-17 (metrics/report), T-18→T-21 (adapters/ops). Adapters depend on the core being contract-tested first.

---

## 7. Automated tests the agent must write

### Unit
- **Formulas:** each derived metric returns `null` when inputs missing; correct value given timestamps.
- **Classifier:** one test per taxonomy branch; asserts exactly one category; asserts attribution.
- **Rate limiter:** never exceeds published limit; 429 triggers back-off; self-inflicted 429 flagged as harness defect.
- **Redaction:** injected dummy token never appears in any output channel.
- **Capability validation:** unknown state rejected; `DOCUMENTED` without source rejected.
- **Origin gating:** metrics computed only over `REAL`; simulated-only run yields "no benchmark data".

### Contract (mocked, no network)
- Each adapter satisfies `ProviderAdapterBase`; `capability()` returns a valid state.
- `detect()` timeout path yields `MESSAGE_NOT_DETECTED` (not a crash).
- `readContent()` provider-sanitized HTML (Guerrilla Mail) is recorded, not treated as an error.

### Report
- Aggregates recomputed from sample JSON equal reported aggregates (empty diff).
- HTML/CSV regenerated from JSON are byte-identical to published (modulo timestamps).
- Every latency cell in the report has an adjacent detection rate (assertion on the report model, not the HTML string).

---

## 8. Runbook (reproduction)

```text
1. cp .env.example .env            # fill provider secrets (never commit)
2. npm ci
3. npm run capability:verify       # BR-019; produces capability snapshot
4. npm run bench -- --manifest runs/<id>.json
5. npm run report -- --run runs/<id>   # JSON -> HTML + CSV
6. npm run test                    # unit + contract
```

The manifest must embed: config hash, git commit, capability snapshot, seeds, provider order, timeouts, poll interval, environment metadata.

---

## 9. Guardrails for the implementation agent

1. **Do not** add code paths that circumvent CAPTCHA, Cloudflare, or access controls. 10 Minute Mail's challenge is a finding to report.
2. **Do not** call undocumented APIs as a basis for published metrics.
3. **Do not** write a timeout value into a latency field.
4. **Do not** report metrics over non-`REAL` samples.
5. **Do not** log secrets, cookies, tokens, or full bodies by default.
6. **Do not** exceed published provider limits (Maildrop 50/10s; Guerrilla Mail's no-flooding ToS).
7. **Do** keep capability status and execution outcome in separate fields everywhere.
8. **Do** make every number traceable to sample-level evidence.
9. **Do** keep the reports generated from one JSON source of truth.
10. **Do** stop and surface a blocker if a policy question (e.g., 10 Minute Mail automation) is unresolved — do not guess.

---

## 10. Acceptance handshake

The implementation agent should be able to produce:
- a run manifest,
- a sample JSON set,
- HTML + CSV reports,
- and a passing unit/contract test suite,

such that a reviewer can recompute every published aggregate from the sample JSON. That recomputation is the final acceptance test of the whole framework.

---

*End of package. Return to [00-overview.md](./00-overview.md) for the executive summary.*
