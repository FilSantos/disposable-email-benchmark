# 03 — Requirements Catalogue, Acceptance Criteria & MoSCoW Prioritization

**Parent:** [00-overview.md](./00-overview.md) · **Status:** Draft for QA Manager review · **Date:** 2026-10-14

**MoSCoW key:** **M** = Must Have (release-blocking) · **S** = Should Have · **C** = Could Have · **W** = Won't Have (initial release, i.e. future enhancement)

Each requirement: ID · description · rationale · priority · acceptance criteria · verification method · dependencies · risks · open questions.

---

## 1. Foundation Requirements

### BR-001 — Independent provider evaluation
- **Description:** Evaluate each of the five providers independently, with no cross-provider state sharing in a run.
- **Rationale:** Fair comparison requires isolation; one provider's failure must not affect another's result.
- **Priority:** **M**
- **Acceptance criteria:** A single run produces a distinct result set per provider per mode; no sample is attributed to two providers; disabling one adapter does not alter another's results.
- **Verification:** Run with one adapter enabled vs disabled; compare the other adapters' outputs (must be identical).
- **Dependencies:** Adapter registry (BR-011).
- **Risks:** Shared mailbox names across providers cause collisions.
- **Open questions:** Should providers run sequentially or in parallel? **[RECOMMENDATION]** sequentially, or parallel with disjoint resources.

### BR-002 — UI-based message verification
- **Description:** Detect and read a message through each provider's UI using Playwright.
- **Rationale:** UI verification is the fallback path when no API exists, and the primary realistic QA workflow.
- **Priority:** **M**
- **Acceptance criteria:** For a provider with UI `SUPPORTED`, the harness opens the inbox, detects the target correlation ID, opens the message, and extracts subject + body; all five timestamps captured.
- **Verification:** Positive run against a provider with a known-good mailbox.
- **Dependencies:** Playwright adapter (BR-011), synthetic message (BR-004).
- **Risks:** UI changes; Cloudflare challenges (10 Minute Mail).
- **Open questions:** Which providers will block headless automation? **[OPEN]** — Phase 0 spike.

### BR-003 — Authorized API-based message verification
- **Description:** Detect and read a message via each provider's official, documented API **where one exists**.
- **Rationale:** API access is faster and more stable for CI when available; must not be fabricated for providers lacking one.
- **Priority:** **M**
- **Acceptance criteria:** For providers with `SUPPORTED` API (Mailinator, Guerrilla Mail, Maildrop), the harness authenticates/initializes as documented and retrieves subject+body; providers without an API are recorded `NOT_SUPPORTED` and **excluded**, not failed.
- **Verification:** Positive runs for the three API providers; capability report for the other two.
- **Dependencies:** Credentials (BR-020), capability matrix (BR-008).
- **Risks:** Undocumented rate limits; auth changes.
- **Open questions:** Mailinator HTTP request-rate limits **[OPEN]**; YOPmail/10 Minute Mail API existence **[OPEN]**.

### BR-004 — Synthetic message generation with correlation ID
- **Description:** Generate deterministic synthetic messages containing a unique correlation ID in subject and body, with ASCII and UTF-8 variants.
- **Rationale:** Unique IDs are prerequisites for duplicate/wrong-message metrics and reliable identification in shared inboxes.
- **Priority:** **M**
- **Acceptance criteria:** Every sample has a correlation ID unique within the run; the ID appears in subject and body; UTF-8 variant round-trips correctly in at least one provider.
- **Verification:** Validator asserts ID presence and uniqueness across the run.
- **Dependencies:** Deterministic seed config.
- **Risks:** Provider sanitization strips the ID (Guerrilla Mail HTML sanitization).
- **Open questions:** None.

### BR-005 — Measure observed detection latency
- **Description:** Capture the five timestamps and compute the six derived metrics defined in [01-methodology.md §2](./01-methodology.md#2-measurement-methodology--timestamps).
- **Rationale:** Core business question — how quickly a verification can proceed.
- **Priority:** **M**
- **Acceptance criteria:** All detected samples have non-null `UI/API_FIRST_DETECTED_AT` and `*_CONTENT_AVAILABLE_AT`; derived metrics computed by the documented formulas; timeout samples carry no fabricated latency.
- **Verification:** Unit tests on formula functions; manual spot-check of 5 samples.
- **Dependencies:** Clock discipline (NFR-05), SMTP timestamp capture.
- **Risks:** Clock skew; polling granularity.
- **Open questions:** None.

### BR-006 — Measure reliability independently of latency
- **Description:** Report detection/validation/timeout rates separately from latency, with explicit denominators.
- **Rationale:** Latency-only rankings are misleading when failure rates differ ([02-statistics-and-reporting.md §4](./02-statistics-and-reporting.md#4-why-latency-only-rankings-lie)).
- **Priority:** **M**
- **Acceptance criteria:** Every latency table in the executive report is adjacent to its detection rate; percentages carry denominators.
- **Verification:** Report review checklist.
- **Dependencies:** BR-007, BR-012.
- **Risks:** Reviewer over-simplifies to one number.
- **Open questions:** None.

### BR-007 — Preserve sample-level evidence
- **Description:** Persist per-sample records (timestamps, outcome, failure code, payloads, artifacts) in JSON.
- **Rationale:** Engineering reviewability and reproducibility.
- **Priority:** **M**
- **Acceptance criteria:** Each sample yields one JSON record with run ID, provider, mode, correlation ID, timestamps, outcome, failure code, and artifact references; records are sufficient to recompute every aggregate.
- **Verification:** Recompute aggregates from records; compare to reported aggregates (must match).
- **Dependencies:** Evidence store.
- **Risks:** Storage growth; secret leakage into records.
- **Open questions:** Retention duration. **[RECOMMENDATION]** 30 days for artifacts, JSON retained.

### BR-008 — Report unsupported capabilities
- **Description:** Record and report provider capabilities with the six defined states, separating capability status from execution outcome.
- **Rationale:** Prevents penalizing providers for capabilities they do not claim; docd in [01-methodology.md §6.4](./01-methodology.md#64-capability-status-vs-execution-outcome-mandatory-separation).
- **Priority:** **M**
- **Acceptance criteria:** Capability matrix present in every report with states validated against the allowed vocabulary; no `NOT_SUPPORTED` cell appears as a failure.
- **Verification:** Schema validation of the capability matrix; report inspection.
- **Dependencies:** Capability data source.
- **Risks:** Stale capability data.
- **Open questions:** Re-verification cadence. **[RECOMMENDATION]** before every run.

### BR-009 — Generate executive and technical reports
- **Description:** Produce the two reports defined in [02-statistics-and-reporting.md §2](./02-statistics-and-reporting.md#2-reporting-requirements) in HTML, JSON, CSV.
- **Rationale:** Two audiences with different needs.
- **Priority:** **M**
- **Acceptance criteria:** All content sections present; JSON is the single source of truth from which HTML/CSV are generated; origin labels displayed.
- **Verification:** Report template checklist; regenerate HTML from JSON and diff.
- **Dependencies:** BR-007, BR-012.
- **Risks:** Divergence between formats.
- **Open questions:** None.

### BR-010 — Support reproducible benchmark execution
- **Description:** A run is fully described by a manifest (config, seeds, code version, order) and can be re-executed to produce structurally identical output.
- **Rationale:** Evidence must be reviewable and defensible.
- **Priority:** **M**
- **Acceptance criteria:** Re-running with the same manifest produces the same sample plan and structurally identical report (values may differ); manifest hash recorded.
- **Verification:** Two consecutive runs compared structurally.
- **Dependencies:** Config system, VCS commit capture.
- **Risks:** Provider-side nondeterminism (expected).
- **Open questions:** None.

---

## 2. Adapter & Integration Requirements

### BR-011 — Pluggable provider adapter interface
- **Description:** A common interface implemented per provider per mode (`openInbox`, `detect`, `readContent`, `capability`).
- **Rationale:** Independent evaluation (BR-001) and maintainability.
- **Priority:** **M**
- **Acceptance criteria:** Adding/removing an adapter requires no changes to the runner or reporting; interface conformance tested.
- **Verification:** Contract tests against each adapter.
- **Dependencies:** BR-002, BR-003.
- **Risks:** Over-abstraction.
- **Open questions:** None.

### BR-012 — Failure classification
- **Description:** Assign exactly one terminal category per sample from the 13-category taxonomy, plus attribution.
- **Rationale:** Distinguishes provider limitation from our defect and environment noise.
- **Priority:** **M**
- **Acceptance criteria:** No sample without a category; failure distribution sums correctly; attribution follows the decision tree.
- **Verification:** Category coverage test; failure-injection tests.
- **Dependencies:** BR-011.
- **Risks:** Mis-attribution inflates provider blame.
- **Open questions:** None.

### BR-013 — Rate-limit compliance and back-off
- **Description:** Honour published limits (Maildrop 50/10s) and implement back-off on 429.
- **Rationale:** Legal/policy compliance and avoiding self-inflicted failures.
- **Priority:** **M**
- **Acceptance criteria:** No adapter exceeds published limits; 429 triggers back-off; self-inflicted 429 logged as harness defect.
- **Verification:** Throttled test; log review.
- **Dependencies:** BR-003.
- **Risks:** Unpublished limits (Guerrilla Mail, Mailinator HTTP).
- **Open questions:** Mailinator HTTP limits **[OPEN]**.

### BR-014 — Independent UI/API samples
- **Description:** Use independent samples for UI and API of the same provider to avoid caching/order effects.
- **Rationale:** Fair comparison ([01-methodology.md §5.4](./01-methodology.md#54-independent-samples-rule)).
- **Priority:** **S**
- **Acceptance criteria:** Where practical, UI and API samples use different correlation IDs; deviations documented per provider.
- **Verification:** Sample-plan inspection.
- **Dependencies:** BR-004.
- **Risks:** Maildrop 10-message cap; shared mailboxes.
- **Open questions:** Feasible for Maildrop? **[OPEN]**

---

## 3. Data, Security & Reporting Requirements

### BR-015 — Evidence capture (screenshots/traces)
- **Description:** Capture screenshot + Playwright trace on UI failure; redact secrets.
- **Rationale:** Diagnosability of `UI_AUTOMATION_FAILED`.
- **Priority:** **S**
- **Acceptance criteria:** Every UI failure has artifacts (unless provider blocks capture); no secret visible in artifacts.
- **Verification:** Artifact inspection; secret-scan of artifacts.
- **Dependencies:** BR-007.
- **Risks:** Storage growth; accidental secret capture.
- **Open questions:** Retention period.

### BR-016 — Log sanitization
- **Description:** Redact tokens, cookies, auth headers, and message bodies by default.
- **Rationale:** Security ([02-statistics-and-reporting.md §3](./02-statistics-and-reporting.md#3-security--responsible-use)).
- **Priority:** **M**
- **Acceptance criteria:** Automated secret-scan of logs/reports passes; debug mode still redacts secrets.
- **Verification:** Inject a dummy token; assert it never appears in output.
- **Dependencies:** —
- **Risks:** Over-redaction hides debugging info.
- **Open questions:** None.

### BR-017 — Origin labelling (real/simulated/unexecuted)
- **Description:** Tag every sample `REAL`/`SIMULATED`/`UNEXECUTED`; headline metrics use `REAL` only.
- **Rationale:** Prevent fabricated benchmark data from reaching executives.
- **Priority:** **M**
- **Acceptance criteria:** Reports display origin counts; metrics computed over `REAL` only; a run with zero `REAL` samples is labelled "no benchmark data".
- **Verification:** Run a simulated-only config and confirm refusal to publish metrics.
- **Dependencies:** BR-009.
- **Risks:** Silent mixing.
- **Open questions:** None.

### BR-018 — Cost/plan transparency
- **Description:** Record the provider plan/tier used for each result and whether a paid tier was required.
- **Rationale:** Cost is a decision factor; a paid-only capability must be visible.
- **Priority:** **S**
- **Acceptance criteria:** Every provider result states plan + cost + pricing verification date.
- **Verification:** Report inspection.
- **Dependencies:** Capability matrix.
- **Risks:** Pricing changes.
- **Open questions:** Budget approval for paid tiers. **[ASSUMPTION A-02]**

### BR-019 — Capability re-verification per run
- **Description:** Re-verify the capability matrix before each run and record the verification date.
- **Rationale:** Provider behavior changes invalidate cross-run comparison.
- **Priority:** **S**
- **Acceptance criteria:** Each run manifest embeds a capability snapshot with date; changes are highlighted.
- **Verification:** Run-manifest inspection.
- **Dependencies:** BR-008.
- **Risks:** Manual effort.
- **Open questions:** Automate capability probing? **[RECOMMENDATION]** partially (ping/status endpoints).

### BR-020 — Credential management
- **Description:** Secrets from env/secret store only; never committed or logged.
- **Rationale:** Security.
- **Priority:** **M**
- **Acceptance criteria:** Repo secret-scan clean; a run with a missing secret yields `CONFIGURATION_ERROR` (not a provider failure).
- **Verification:** Secret scan; missing-secret test.
- **Dependencies:** BR-016.
- **Risks:** CI secret availability.
- **Open questions:** Which secret store for CI? **[OPEN]**

### BR-021 — CI/CD suitability assessment
- **Description:** Assess each provider's suitability for headless CI (no GUI, stable selectors, auth-free where possible).
- **Rationale:** Operational suitability dimension.
- **Priority:** **S**
- **Acceptance criteria:** Per-provider CI-suitability verdict with evidence (headless run success, flakiness rate).
- **Verification:** Headless CI run.
- **Dependencies:** BR-002, BR-003.
- **Risks:** CI network egress restrictions.
- **Open questions:** CI egress policy. **[OPEN — A-01]**

### BR-022 — Retention/expiry awareness
- **Description:** Account for provider retention (Guerrilla 1h, Maildrop 24h, YOPmail 8d, 10MM 10m) in scheduling and cleanup.
- **Rationale:** Prevents "message expired before we read it" being misclassified as a provider failure.
- **Priority:** **S**
- **Acceptance criteria:** Harness warns if a sample's read window exceeds the provider retention; expiry-caused misses are classified, not blamed.
- **Verification:** Configuration review.
- **Dependencies:** Capability matrix.
- **Risks:** Approximate retention values.
- **Open questions:** Exact Mailinator public TTL **[OPEN]**.

---

## 4. Enhancements (Could Have / Won't Have)

### BR-023 — Historical trend dashboard — **C**
- **Description:** Track metrics across runs over time.
- **Acceptance criteria:** Runs are comparable by manifest hash; trend charts render.
- **Rationale:** Detects provider drift.

### BR-024 — Additional providers — **C**
- **Description:** Extend the framework beyond the initial five.
- **Acceptance criteria:** New provider pluggable via BR-011 with no runner changes.

### BR-025 — Load/throughput testing — **W**
- **Description:** Measure behavior under high concurrency.
- **Rationale:** Out of scope for a per-provider reliability benchmark; risks ToS violations. Deferred.

### BR-026 — Automated capability discovery from provider docs — **W**
- **Description:** Scrape official docs to auto-build the matrix.
- **Rationale:** Adds fragility and legal risk. Deferred.

### BR-027 — Geographic latency comparison — **W**
- **Description:** Run from multiple regions.
- **Rationale:** Out of scope initially; requires distributed infra. Deferred.

### BR-028 — SMTP-level (MX) delivery confirmation — **W**
- **Description:** Verify delivery at the MX layer.
- **Rationale:** The prompt explicitly forbids claiming provider-internal delivery times; our observation model is end-to-end via UI/API. Deferred.

---

## 5. MoSCoW Summary

| Priority | Count | IDs |
|---|---|---|
| **Must Have** | 16 | BR-001…BR-013, BR-016, BR-017, BR-020 |
| **Should Have** | 6 | BR-014, BR-015, BR-018, BR-019, BR-021, BR-022 |
| **Could Have** | 2 | BR-023, BR-024 |
| **Won't Have** | 4 | BR-025, BR-026, BR-027, BR-028 |

**Release gate:** All **Must Have** requirements must satisfy their acceptance criteria before the benchmark is considered complete. **Should Have** items are strongly recommended and require documented justification if omitted.

---

## 6. Traceability: Business Questions → Requirements

| Business question (§3 of prompt) | Answered by |
|---|---|
| Highest message detection reliability? | BR-006, BR-012, BR-005 |
| Lowest observed detection latency? | BR-005, BR-006 |
| Content available most quickly? | BR-005 |
| Most reliable UI automation? | BR-002, BR-012, BR-021 |
| Most reliable API access? | BR-003, BR-013 |
| Lowest operational complexity? | BR-008, BR-018, BR-021 |
| Most restrictive policies? | BR-008, BR-019 |
| Sufficient capabilities? | BR-008, BR-019 |
| Consistency across runs/windows? | BR-010, BR-006 ([02 §1.7](./02-statistics-and-reporting.md#17-run-level-consistency)) |
| Limitations preventing fair comparison? | BR-008, BR-014, [01 §7](./01-methodology.md#7-fair-comparison-rules-summary) |
| Best for UI verification? | BR-002, BR-006 |
| Best for API verification? | BR-003, BR-006 |
| Best overall balance? | All — via segment scorecard ([02 §5](./02-statistics-and-reporting.md#5-declaring-a-winner)) |

---

*Next: [04-risk-register.md](./04-risk-register.md).*
