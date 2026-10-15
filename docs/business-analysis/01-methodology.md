# 01 — Benchmark Methodology, Metrics, UI/API Strategy & Failure Taxonomy

**Parent:** [00-overview.md](./00-overview.md) · **Status:** Draft for QA Manager review · **Date:** 2026-10-14

---

## 1. Benchmark Dimensions

For each dimension: **business rationale → measurable indicators → data source → limitations**.

### A. Reliability

**Rationale:** If a provider cannot reliably surface a message, latency is irrelevant. Reliability gates every other dimension.

| Indicator | Definition | Data source | Limitations |
|---|---|---|---|
| Message detection rate | detected samples ÷ eligible sent samples | Per-sample outcome | Requires successful SMTP acceptance to be eligible |
| Content availability rate | samples where subject **and** required body were retrievable ÷ eligible sent | Per-sample outcome | "Required body" depends on provider capability |
| Content validation pass rate | samples matching expected content ÷ samples with content available | Validator output | Denominator differs from detection rate — **state it** |
| Timeout rate | samples hitting the detection/content timeout ÷ eligible sent | Harness timeout | Timeout value materially changes this |
| Duplicate message rate | duplicate detections ÷ samples where ≥1 detection occurred | Correlation-ID match | Requires unique correlation IDs |
| Wrong-message identification rate | detections matching a *different* correlation ID ÷ detections | Correlation-ID match | Public inboxes raise this risk |
| Successful execution rate | samples completing the full flow ÷ eligible sent | Harness | Composite; decompose before comparing |
| Stability across repeated executions | per-run variance in detection rate | Run-level aggregates | Needs ≥3 runs to be meaningful |

### B. Performance

**Rationale:** Users care how quickly a verification can proceed. Measured as *observed latency from local SMTP acceptance*.

| Indicator | Definition | Data source | Limitations |
|---|---|---|---|
| UI message detection latency | `UI_FIRST_DETECTED_AT − SMTP_ACCEPTED_AT` | Timestamps | Dominated by polling interval |
| UI content availability latency | `UI_CONTENT_AVAILABLE_AT − SMTP_ACCEPTED_AT` | Timestamps | Includes render/parse time |
| API message detection latency | `API_FIRST_DETECTED_AT − SMTP_ACCEPTED_AT` | Timestamps | Dominated by polling interval |
| API content availability latency | `API_CONTENT_AVAILABLE_AT − SMTP_ACCEPTED_AT` | Timestamps | — |
| API request response time | HTTP round-trip for one request | Client timing | **Never** mixed into detection latency |
| Time to open & read a message | `CONTENT_AVAILABLE_AT − FIRST_DETECTED_AT` | Timestamps | UI-only concept (interaction cost) |
| Variability in latency | IQR / std-dev / P95−P50 spread | Aggregated samples | Sensitive to outliers; report with n |

> **[RECOMMENDATION]** Report detection and content latency **only over samples that were detected**, and *always* alongside the detection rate. See the survivorship warning in [02-statistics-and-reporting.md §4](./02-statistics-and-reporting.md#4-why-latency-only-rankings-lie).

### C. Automation Maintainability

**Rationale:** A provider that is fast but breaks every week costs more engineer-hours than a slower, stable one. Maintainability determines total cost of ownership for QA automation.

| Indicator | How measured | Data source | Limitations |
|---|---|---|---|
| UI selector stability | Count of selectors that broke between runs / total selectors | Run-over-run selector diff | Needs ≥2 runs |
| UI workflow complexity | Number of steps to detect+read a message | Adapter step count | Structural, not empirical |
| Authentication complexity | Steps/credentials needed before first read | Adapter config | 0 for no-auth providers |
| API integration complexity | Effort classification (none / key / OAuth / plan) | Capability matrix | Qualitative |
| Maintenance frequency | Adapter edits required per N runs | VCS history | Only meaningful over time |
| Error diagnosability | Availability of structured error codes | Adapter logs | — |
| Test execution reproducibility | Deterministic pass/fail across identical runs | Run comparison | Flaky providers penalized |

### D. Operational Suitability

**Rationale:** A provider may be reliable and fast yet unusable — because it costs too much, expires too quickly, forbids automation, or cannot run in CI. Operational fit is a gating consideration, not a tiebreaker.

**Measurable indicators:** Cost and plan requirements; address lifetime; retention limitations; rate limits; restrictions on automated testing; suitability for local execution; suitability for CI/CD; availability of authorized programmatic access.

**Data source:** capability matrix ([00-overview.md §6](./00-overview.md#6-provider-capability-matrix)) + benchmark observations.

**Limitations:** pricing changes; restriction wording is legal, not technical; CI suitability is environment-dependent.

### E. Content Validation

**Rationale:** Detecting a message is worthless if the retrieved content cannot be trusted — subject/body fidelity is what makes an email verification assertion meaningful.

| Indicator | Definition | Data source | Limitations |
|---|---|---|---|
| Subject accuracy | Exact + normalized match vs expected | Validator | Normalization rules must be documented |
| Plain-text body accuracy | Expected token(s) present | Validator | Providers may trim |
| HTML content accuracy | Expected token(s) present in HTML part | Validator | Guerrilla Mail **sanitizes** HTML **[FACT]** |
| UTF-8 handling | Non-ASCII round-trip intact | Validator | Encoding artifacts must be distinguished from content mismatch |
| Correlation-ID availability | Unique ID found in subject/body | Validator | Prerequisite for duplicate/wrong-message metrics |
| Message identification reliability | Correct message located in a multi-message inbox | Validator | Public/decayed inboxes complicate this |
| Metadata required for auditing | From/date/headers available | Adapter | Varies by provider |

---

## 2. Measurement Methodology — Timestamps

### 2.1 Timestamp definitions

| Timestamp | Definition | Captured where |
|---|---|---|
| `SMTP_ACCEPTED_AT` | Local SMTP server accepted the message for processing | SMTP harness |
| `UI_FIRST_DETECTED_AT` | Message first detected through the UI | Playwright adapter |
| `UI_CONTENT_AVAILABLE_AT` | Required subject + body became accessible in UI | Playwright adapter |
| `API_FIRST_DETECTED_AT` | Message first identified through the API | API adapter |
| `API_CONTENT_AVAILABLE_AT` | Required content became accessible via API | API adapter |

**Naming note:** the prompt renders these as `SMTPACCEPTEDAT`, `UIFIRSTDETECTED_AT`, etc. This package normalizes them to `SMTP_ACCEPTED_AT`, `UI_FIRST_DETECTED_AT`, `UI_CONTENT_AVAILABLE_AT`, `API_FIRST_DETECTED_AT`, `API_CONTENT_AVAILABLE_AT`. **The normalized names are the contract** used in the metrics catalogue and the technical handoff.

**Critical caveat:** these are **observed** timestamps. `SMTP_ACCEPTED_AT` is when *our* server accepted the message; it says nothing about the provider's internal delivery time. Every derived metric is an **observed latency from local SMTP acceptance**.

### 2.2 Derived metrics (canonical formulas)

Let `T0 = SMTP_ACCEPTED_AT`.

```
UI_detection_latency        = UI_FIRST_DETECTED_AT     − T0
UI_content_latency          = UI_CONTENT_AVAILABLE_AT  − T0
API_detection_latency       = API_FIRST_DETECTED_AT    − T0
API_content_latency         = API_CONTENT_AVAILABLE_AT − T0
UI_content_access_duration  = UI_CONTENT_AVAILABLE_AT  − UI_FIRST_DETECTED_AT
API_content_access_duration = API_CONTENT_AVAILABLE_AT − API_FIRST_DETECTED_AT
```

> **[RECOMMENDATION]** `API_request_response_time` is deliberately **excluded** from the list above. It is a per-request HTTP measurement, defined separately in §3, and **must never** be compared against end-to-end UI detection latency.

### 2.3 Sources of measurement distortion (must be accounted for)

| Source | Effect | Mitigation |
|---|---|---|
| **Polling interval** | Detection latency cannot be measured finer than the poll gap; adds up to 1 interval of error | Use a fixed, documented poll interval; report it with every latency number |
| **Request duration** | Slow responses inflate observed latency | Record request durations separately (API response time) |
| **Clock precision / skew** | Timestamps from different sources may disagree | Single monotonic clock per run; document resolution |
| **Timeouts** | Truncate the distribution at the timeout value | Report timeout rate; treat as a distinct outcome |
| **Network delays** | Add variance unrelated to the provider | Run from a stable network; report network RTT baseline |
| **Provider-specific behavior** | Greylisting (Maildrop ~15 min), sanitization, expiry | Per-provider configuration; not a failure |
| **UI vs. API differences** | Different code paths, caching | Separate samples; never cross-compare |
| **Caching / observation-order effects** | A prior read may warm a cache or consume an inbox | Independent samples for UI and API |

---

## 3. API Request Response Time (separate metric)

```
API_request_response_time = HTTP_response_received_at − HTTP_request_sent_at
```

Reported as a **distribution per endpoint** (mean/median/P90/P95), **never** as a substitute for detection latency. Rationale: a fast API that has not yet received the message still returns quickly; response time measures the transport, detection latency measures end-to-end availability.

---

## 4. Provider Capability Matrix

The canonical matrix, its states, and source citations live in [00-overview.md §6](./00-overview.md#6-provider-capability-matrix). Key documented facts driving methodology:

- **Mailinator** — REST API v2, API token required; Verified Pro free-with-verification (2K emails/mo, 60/day) up to Enterprise; public inboxes auto-delete "after a few hours"; paid tiers persistent. ToS: no overburdening; API intended for automation. **[FACT]**
- **Guerrilla Mail** — JSON API, no key, cookies `PHPSESSID`+`SUBSCR`, requires `ip`/`agent`; emails expire after **60 min**; HTML **sanitized**; ToS explicitly prohibits flooding. **[FACT]**
- **Maildrop** — GraphQL, **no auth**, `subject`/`data`/`html` on single-message query only; **50 queries/10s** published; **24h** retention, 10-message cap; **greylisting**. **[FACT]**
- **YOPmail** — no API found; **8-day** retention; inboxes never deleted; `robots.txt` disallows `/*?`. **[FACT]** Field-level programmatic retrievability **[OPEN]**.
- **10 Minute Mail** — no API found; **~10 min** self-destruct; Cloudflare challenge **observed HTTP 403** on 2026-10-14. **[FACT]** Policy **[OPEN]**.

---

## 5. UI vs. API Comparison Strategy

### 5.1 UI evaluation path

| Step | Observable | Recorded |
|---|---|---|
| 1. Inbox access | Inbox page opens for the target address | `inbox_access_ok`, duration |
| 2. Message detection | Target correlation ID appears in list | `UI_FIRST_DETECTED_AT` |
| 3. Message opening | Message view renders | duration |
| 4. Subject extraction | Subject text retrieved | value + `subject_match` |
| 5. Body extraction | Plain/HTML body retrieved | values + match flags |
| 6. Content validation | Expected tokens present | `content_valid` |
| 7. Automation stability | Selectors resolved without retry/hard-fail | `selector_retries`, `UIAUTOMATION_FAILED` |

### 5.2 API evaluation path

| Step | Observable | Recorded |
|---|---|---|
| 1. API availability | Endpoint reachable, authoritative response | `api_available` |
| 2. Authentication | Token/session obtained (if required) | `auth_ok`, duration |
| 3. Inbox query | Message list for target address | `API_FIRST_DETECTED_AT` |
| 4. Message identification | Target correlation ID located | `message_id` |
| 5. Content retrieval | Subject/body fetched | `API_CONTENT_AVAILABLE_AT` |
| 6. Response time | Per-request RTT | `API_request_response_time` |
| 7. Rate limiting | 429/back-off behavior | `PROVIDER_RATE_LIMITED` |
| 8. Error handling | Structured errors, retryability | error class |
| 9. Content validation | Expected tokens present | `content_valid` |

### 5.3 Providers with UI but no authorized API

If a provider (e.g., YOPmail, 10 Minute Mail) has no documented API:

1. Record API capability as `NOT_SUPPORTED` **[FACT]** or `NOT_TESTED` **[OPEN]** in the matrix.
2. **Exclude the provider from API-mode comparisons** — do **not** fill the cell with a failure.
3. Report the API comparison over the **eligible subset only**, and state the subset in the report header.
4. Never silently rank a no-API provider as "worst at API" — it is simply *not comparable*.

### 5.4 Independent samples rule

**[RECOMMENDATION]** UI and API evaluation for the same provider use **independent, equivalent samples** (different correlation IDs, different mailboxes where possible), because reading a message via one path may warm a cache or mutate inbox state. When independent samples are impossible (shared mailbox with strict caps, e.g. Maildrop's 10-message limit), document the deviation and treat results as lower-confidence.

### 5.5 Non-comparability rules

- Do **not** compare raw HTTP response time against end-to-end UI detection latency.
- Do **not** compare UI and API detection latency as if they measure the same thing.
- Do **not** compare latency across providers without also citing each provider's detection rate and poll interval.
- Do **not** compare a greylisting-affected first send against a warmed-path send without labelling it.

---

## 6. Failure Taxonomy

### 6.1 Terminal failure categories

Each sample ends in **exactly one** terminal category.

| Category | Meaning | Owner |
|---|---|---|
| `SMTP_SEND_FAILED` | Local SMTP server rejected/failed to accept | Harness |
| `MESSAGE_NOT_DETECTED` | SMTP accepted, but no detection within timeout | Provider or environment |
| `MESSAGE_CONTENT_UNAVAILABLE` | Detected, but required content never became accessible | Provider |
| `SUBJECT_MISMATCH` | Content retrieved; subject ≠ expected | Validator / provider |
| `BODY_MISMATCH` | Content retrieved; body missing expected token | Provider |
| `ENCODING_MISMATCH` | Content present but UTF-8/encoding corrupted | Provider or harness |
| `WRONG_MESSAGE_MATCHED` | A message from a different correlation ID was matched | Harness logic or shared inbox |
| `UI_AUTOMATION_FAILED` | Selector/timeout/DOM error during UI flow | Harness (provider UI change) |
| `API_REQUEST_FAILED` | HTTP error/transport failure on API call | Provider or harness |
| `PROVIDER_RATE_LIMITED` | 429 / documented limit exceeded | Harness (if self-inflicted) or provider |
| `PROVIDER_UNAVAILABLE` | Provider site/API down or unreachable | Provider |
| `CONFIGURATION_ERROR` | Missing key/plan/mailbox config | Harness |
| `TEST_INFRASTRUCTURE_ERROR` | Harness bug, disk, browser crash, clock error | Harness |

### 6.2 Attribution decision tree

```
Did our SMTP server accept the message?
├── NO  → SMTP_SEND_FAILED                (environment / our infra)
└── YES → Did our harness execute without its own error?
         ├── NO  → UI_AUTOMATION_FAILED / API_REQUEST_FAILED /
         │         CONFIGURATION_ERROR / TEST_INFRASTRUCTURE_ERROR
         │         (our defect)
         └── YES → Was a message detected within timeout?
                  ├── NO  → Is the provider reachable & within limits?
                  │        ├── NO  → PROVIDER_UNAVAILABLE / PROVIDER_RATE_LIMITED
                  │        └── YES → MESSAGE_NOT_DETECTED  (provider or network)
                  └── YES → Was the required content retrievable?
                           ├── NO  → MESSAGE_CONTENT_UNAVAILABLE
                           └── YES → Validation:
                                     subject  ✗ → SUBJECT_MISMATCH
                                     body     ✗ → BODY_MISMATCH
                                     encoding ✗ → ENCODING_MISMATCH
                                     wrong id ✗ → WRONG_MESSAGE_MATCHED
                                     all      ✓ → PASS
```

### 6.3 Distinguishing the seven confusions

| Confusion | Disambiguation rule |
|---|---|
| **Provider limitation vs. our defect** | If our harness logged its own error, it is our defect. If the provider returned a well-formed "not found", it is a provider outcome. |
| **Configuration problem** | Reproducible with a known-good config? No → `CONFIGURATION_ERROR`. |
| **Network/SMTP problem** | SMTP server itself failed or network RTT baseline is abnormal → environment category. |
| **UI automation defect** | Selector not found / DOM changed → `UI_AUTOMATION_FAILED` (our code, provider change). |
| **API integration defect** | We called the wrong endpoint or mis-parsed a valid response → `API_REQUEST_FAILED` + `TEST_INFRASTRUCTURE_ERROR`. |
| **Genuine detection failure** | Provider reachable, within limits, message simply never appears → `MESSAGE_NOT_DETECTED`. |
| **Content validation failure** | Message detected and retrieved, content differs → mismatch categories. |

### 6.4 Capability status vs. execution outcome (mandatory separation)

| Report column | Answers | Example |
|---|---|---|
| **Capability status** | *Does the provider offer this?* | YOPmail API: `NOT_SUPPORTED` |
| **Execution outcome** | *What happened in this run?* | YOPmail API: `N/A — not attempted`; YOPmail UI: `PASS` |

Rules:
- `NOT_SUPPORTED` + **no attempt** ⇒ excluded from that mode's denominator.
- `BLOCKED_BY_PROVIDER` ⇒ reported as a **finding**, excluded from comparative denominators, and clearly labelled.
- `NOT_TESTED` ⇒ reported as a **gap**, never as a pass or a fail.
- A provider is **never** penalized in the outcome column for a capability it does not claim.

---

## 7. Fair-Comparison Rules (summary)

1. Only compare providers within the **same mode** (UI vs UI, API vs API).
2. Always publish **detection rate next to latency**.
3. Publish the **poll interval, timeout, and n** with every latency figure.
4. Publish the **denominator** for every percentage.
5. Exclude `NOT_SUPPORTED`/`BLOCKED_BY_PROVIDER` cells from comparative denominators, and say so.
6. Never declare a winner from a single run or a statistically insignificant difference ([02-statistics-and-reporting.md §5](./02-statistics-and-reporting.md#5-declaring-a-winner)).
7. Re-verify the capability matrix per run; a changed capability invalidates cross-run comparison.

---

*Next: [02-statistics-and-reporting.md](./02-statistics-and-reporting.md).*
