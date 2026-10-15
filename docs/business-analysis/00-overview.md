# Email Provider Benchmark Framework — Business Analysis Package

**Document set:** `docs/business-analysis/`
**Status:** Draft for QA Manager review — *not approved for implementation*
**Version:** 1.0
**Date:** 2026-10-14
**Author role:** Senior Business Analyst / QA Manager / QA Architect / Test Strategy Consultant
**Implementation target:** Playwright + TypeScript (deferred; no code written in this package)

---

## How to read this package

This package answers **Prompt 1: Business Analysis, Requirements Engineering & Benchmark Strategy**. It defines *what* will be measured and *why*, not *how* it is coded.

| Doc | Content |
|---|---|
| [00-overview.md](./00-overview.md) | Executive summary, objectives, scope, stakeholders, functional & non-functional requirements, provider capability matrix |
| [01-methodology.md](./01-methodology.md) | Benchmark methodology, metrics & formula catalogue, UI/API comparison strategy, failure taxonomy |
| [02-statistics-and-reporting.md](./02-statistics-and-reporting.md) | Statistical analysis strategy, reporting requirements, security & compliance |
| [03-requirements-and-acceptance.md](./03-requirements-and-acceptance.md) | Prioritized requirements catalogue (MoSCoW) with acceptance criteria |
| [04-risk-register.md](./04-risk-register.md) | Risk register and open questions / assumptions |
| [05-definition-of-done.md](./05-definition-of-done.md) | Definition of Done for the benchmark study |
| [06-technical-handoff.md](./06-technical-handoff.md) | Technical handoff for the VS Code implementation agent |

### Evidence labelling convention (used throughout)

Every claim is tagged so reviewers can weigh it:

- **[FACT]** — Supported by an official provider source (URL cited). Confirmed as of the stated verification date.
- **[ASSUMPTION]** — Stated by us to unblock work; not yet verified.
- **[RECOMMENDATION]** — A proposed approach we recommend; open to adjustment.
- **[OPEN]** — Unresolved; requires verification (hands-on or official clarification).

Capability states are always reported with **[FACT]**, **[ASSUMPTION]**, or **[OPEN]** — never presented as verified without a source.

---

## 1. Executive Summary

### 1.1 Business objective

Determine which temporary/disposable email receiving provider is best suited for **automated QA email-verification tasks**, using a reproducible, evidence-based benchmark. The benchmark measures *observed* behavior (reliability, latency, content fidelity, automation maintainability, operational suitability) — not provider-internal delivery times.

### 1.2 Why this matters

QA teams need to verify that an application under test actually sends email (signup confirmation, password reset, OTP, receipts). Today, deciding which provider to standardize on is anecdotal. A documented, repeatable benchmark lets a QA Manager make a defensible choice, and lets engineering review the evidence.

### 1.3 What the evidence already tells us (pre-benchmark, documentary)

> These are **documented** findings from official sources, verified 2026-10-14. They are *inputs to* the benchmark, not benchmark results. The benchmark exists to confirm or refute them empirically.

- **Mailinator** is the only provider of the five with a **full, officially documented REST API**, a productized **free-with-verification tier (Verified Pro)**, and paid QA tiers ($79–$699+/mo). **[FACT]** It is receive-only and its public inboxes are not private. **[FACT]**
- **Maildrop** documents a **GraphQL API requiring no authentication**, with the **richest message payload** (`subject`, raw `data`, `html`, headers) and a **published rate limit (50 queries / 10s)**. It has **no sending/forwarding** and applies **greylisting**. **[FACT]**
- **Guerrilla Mail** publishes an **open JSON API with no API key** (session cookie + `ip`/`agent` params) but a **1-hour message retention** and an **explicit ToS clause prohibiting request flooding**. **[FACT]**
- **YOPmail** has **no official API found**, **8-day retention**, inboxes that **never expire**, and a **`robots.txt` that disallows `/*?`** (query-string inbox access). **[FACT]** Its field-level programmatic retrievability is **[OPEN]**.
- **10 Minute Mail** has **no official API found**, **~10-minute self-destructing** mailboxes, and — critically — an **active Cloudflare bot challenge that returned HTTP 403 to non-browser clients** during our 2026-10-14 probe. **[FACT]** Whether automated access is permitted at all is **[OPEN]** (no accessible ToS).

### 1.4 Provisional segment winners (to be confirmed or refuted by the benchmark)

The business does **not** require a single overall winner. Documentary evidence suggests **different winners per use case**:

| Use case | Provisional lead | Basis |
|---|---|---|
| **API-based verification** | **Mailinator** | Only provider with a documented, authenticated, productized API + paid QA tiers **[FACT]** |
| **UI-based verification** | **Maildrop** or **Mailinator** | Both document account-free inboxes; Maildrop documents exact content fields; Mailinator's free UI has automation-friendly docs **[FACT]** |
| **Zero-cost API testing** | **Maildrop** or **Guerrilla Mail** | Both free, both no-key; Maildrop has published limits, Guerrilla Mail has 1h retention **[FACT]** |
| **Longest message retention** | **YOPmail** (8 days) | **[FACT]** |
| **Lowest operational complexity for CI** | **Maildrop** (no auth) | **[ASSUMPTION]** pending empirical confirmation of greylisting impact |
| **Least suitable for automation (expected)** | **10 Minute Mail** | Active Cloudflare challenge; no API; no accessible ToS **[FACT]/[OPEN]** |

**[RECOMMENDATION]** Present the final report as a **segment-based scorecard**, not a single ranking — unless the benchmark produces a provider that dominates reliability *and* latency *and* maintainability, which the documentary evidence does not currently anticipate.

### 1.5 Confidence and limitations (read before trusting any number)

1. **We have not executed a benchmark.** All provider statements above are documentary. **[FACT]** label means "the provider's official docs say so," **not** "we measured it." [ASSUMPTION] and [OPEN] items require the hands-on phase.
2. **The local SMTP timestamp is a lower bound, not a delivery time.** `SMTP_ACCEPTED_AT` records when *our* server accepted the message. The gap to a provider's internal infrastructure is outside our visibility.
3. **Providers can change behavior** between the verification date and the benchmark run. The capability matrix must be re-verified per run.
4. **Comparisons across UI and API are not apples-to-apples** and are reported on separate axes by design.
5. **Some providers may be unsuitable for any automation** (10 Minute Mail's bot challenge). "Could not be automated within policy" is a valid, reportable finding — not a benchmark failure.

### 1.6 Recommendation

Approve this methodology, then proceed to a **capability verification spike** (Phase 0) before committing to the full benchmark. Phase 0 resolves the ~14 open questions in [04-risk-register.md §2](./04-risk-register.md#2-open-questions) with minimal cost and prevents building adapters for providers that turn out to be policy- or technically-blocked.

---

## 2. Business Objectives and Scope

### 2.1 Business objectives

| ID | Objective | Success indicator |
|---|---|---|
| OBJ-01 | Produce a defensible, evidence-based comparison of 5 providers for QA email verification | A QA Manager can select a provider and justify it with cited evidence |
| OBJ-02 | Quantify **reliability** independently of **latency** | Detection rate, content-availability rate, validation pass rate, timeout rate reported separately from latency |
| OBJ-03 | Quantify **observed latency** from local SMTP acceptance | UI and API detection/content latencies with documented definitions |
| OBJ-04 | Assess **automation maintainability** | Selector stability, workflow complexity, maintenance frequency captured per provider |
| OBJ-05 | Assess **operational suitability** | Cost, retention, rate limits, ToS restrictions, CI suitability documented |
| OBJ-06 | Preserve **sample-level evidence** for engineering review | Per-sample timestamps, payloads, screenshots/traces, failure codes |
| OBJ-07 | Ensure **reproducibility** | A run can be re-executed and produce structurally identical reports |
| OBJ-08 | Distinguish **provider limitation vs. our defect vs. environment** | Failure taxonomy applied consistently; capability status reported separately from outcome |

### 2.2 In scope

- Generating synthetic email messages with unique correlation identifiers.
- Sending via a **locally managed SMTP server** (the sending mechanism; source of `SMTP_ACCEPTED_AT`).
- Observing arrival via **provider UIs** (Playwright).
- Observing arrival via **documented, authorized APIs** where such APIs exist.
- Reading subject, plain-text body, HTML body, and available metadata.
- Validating content against expected values (subject match, body match, UTF-8, correlation ID).
- Measuring observed latency, success/failure/timeout rates.
- Evaluating UI automation stability across repeated runs.
- Producing executive + technical reports (HTML, JSON, CSV) and preserving evidence.
- Comparing providers using one documented methodology.

### 2.3 Explicitly out of scope

| Out of scope | Reason |
|---|---|
| Implementing a production email delivery platform | This is a benchmark harness, not a product |
| Building a public-facing SMTP service | The SMTP server is local and ephemeral |
| Bypassing provider security controls | Policy (see §12 in [02-statistics-and-reporting.md](./02-statistics-and-reporting.md)) |
| Using undocumented private APIs **by default** | Only documented/authorized APIs are first-class; undocumented endpoints are `NOT_TESTED` by default |
| Circumventing CAPTCHA or access restrictions | Explicitly prohibited; a challenge is a *finding*, not an obstacle to defeat |
| Treating unsupported API functionality as a delivery failure | Capability vs. outcome are reported separately (see [01-methodology.md §5](./01-methodology.md)) |
| Claiming the exact time a message reached provider internals | We only measure observed latency from local SMTP acceptance |

### 2.4 Boundary rule

> `SMTP_ACCEPTED_AT` is captured when **our local SMTP server accepts the message for processing**. This does **not** establish successful delivery to the external provider. Every latency metric in this package is therefore an **observed end-to-end latency from local acceptance**, and must be described that way wherever a number is published.

---

## 3. Stakeholder and Decision-Maker Assumptions

**[ASSUMPTION]** The following stakeholders and interests are assumed; correct if wrong.

| Stakeholder | Interest | Decision authority |
|---|---|---|
| **QA Manager** | Final provider selection; methodology approval | **Approves this package**; signs off the benchmark |
| **Engineering / SDET** | Maintainability, CI fit, integration effort | Advises; implements adapters |
| **QA Leadership** | Evidence quality, cross-team standardization | Reviews executive report |
| **Security / Privacy** | Credential handling, log sanitization, public-inbox risk | Veto on data handling |
| **Procurement / Finance** | Cost of paid tiers (e.g., Mailinator) | Approves any paid subscription |
| **Legal / Compliance** | Provider Terms of Service adherence | Veto on ToS-violating methods |

**Decision to be made:** which provider(s) to standardize on for UI verification, for API verification, and for CI use — recognising these may differ.

**[ASSUMPTION]** Budget is available for at least one paid tier if the evidence justifies it (Mailinator Business is $79/mo billed yearly). **[FACT — pricing source cited in [01-methodology.md §4](./01-methodology.md#4-provider-capability-matrix)]**

---

## 4. Functional Requirements (summary)

Full prioritized catalogue with acceptance criteria is in [03-requirements-and-acceptance.md](./03-requirements-and-acceptance.md). Summary of functional capability areas:

- **FR-A Synthetic message generation** — unique correlation ID, deterministic subject/body, UTF-8 and ASCII variants, configurable per sample.
- **FR-B Local SMTP send** — capture `SMTP_ACCEPTED_AT`; record acceptance outcome per recipient.
- **FR-C Provider adapters (UI)** — Playwright adapters per provider; inbox open, detect, open message, extract subject/body.
- **FR-D Provider adapters (API)** — documented-API adapters where available; capability-gated.
- **FR-E Content validation** — subject/body/encoding/correlation-ID checks against expected values.
- **FR-F Latency measurement** — capture the 5 timestamps; compute the 6 derived metrics.
- **FR-G Reliability measurement** — per-sample outcome; aggregate rates with explicit denominators.
- **FR-H Failure classification** — assign exactly one terminal category from the taxonomy.
- **FR-I Evidence capture** — per-sample JSON, screenshots/traces on failure, sanitized logs.
- **FR-J Reporting** — executive HTML + technical HTML/JSON/CSV; real/simulated/unexecuted distinguished.
- **FR-K Reproducibility** — fixed seeds/config; run manifests; capability re-verification per run.

## 5. Non-Functional Requirements (summary)

| ID | Category | Requirement |
|---|---|---|
| NFR-01 | Reproducibility | Identical config + code version ⇒ structurally identical report |
| NFR-02 | Isolation | UI and API for the same provider use independent samples |
| NFR-03 | Determinism | Synthetic messages generated from a fixed seed per run for correlation stability |
| NFR-04 | Timeouts | Every wait has an explicit timeout; timeouts are first-class outcomes, never silent exclusions |
| NFR-05 | Clock discipline | Single monotonic clock source per run; clock-skew assumption documented |
| NFR-06 | Rate-limit compliance | Adapters must honour published limits (e.g., Maildrop 50/10s) and back off on HTTP 429 |
| NFR-07 | Policy compliance | No CAPTCHA circumvention; no undocumented APIs by default; ToS-respecting rate |
| NFR-08 | Security | No secrets in logs/traces; credentials from env/secret store only |
| NFR-09 | Observability | Every sample traceable to a run ID and correlation ID |
| NFR-10 | Portability | Runnable locally and in CI; no hard dependency on interactive GUI |
| NFR-11 | Cost transparency | Provider cost tier recorded in every report (free vs. paid) |
| NFR-12 | Data hygiene | Public-inbox data treated as non-confidential synthetic only |

---

## 6. Provider Capability Matrix

### 6.1 Capability state definitions

| State | Meaning | When to use |
|---|---|---|
| `SUPPORTED` | Capability exists and is officially documented/authorized | Provider docs explicitly describe it |
| `NOT_SUPPORTED` | Provider officially does not offer it | Docs state absence (e.g., "cannot send") |
| `CONFIGURATION_REQUIRED` | Exists but needs a plan, key, or setting | API needs a token / paid tier |
| `TEMPORARILY_UNAVAILABLE` | Documented but observed failing at verification time | Downtime, incident |
| `BLOCKED_BY_PROVIDER` | Actively prevented (bot challenge, access control) | Cloudflare 403, robots disallow + observed block |
| `NOT_TESTED` | Not yet verified by us | Default for anything we have not confirmed |

**Rule:** capability status describes *what the provider offers*; execution outcome describes *what happened in a run*. They are reported in separate columns and never merged.

### 6.2 Capability matrix — verified 2026-10-14

Legend: ✅ `SUPPORTED` · ❌ `NOT_SUPPORTED` · 🔑 `CONFIGURATION_REQUIRED` · ⛔ `BLOCKED_BY_PROVIDER` · ❓ `NOT_TESTED`/`OPEN`
Source tags: `[D]` documented (official) · `[O]` observed · `[?]` unresolved

| Capability | Mailinator | Guerrilla Mail | Maildrop | YOPmail | 10 Minute Mail |
|---|---|---|---|---|---|
| Public UI availability | ✅ [D] | ✅ [D] | ✅ [D] | ✅ [D] | ✅ [D] |
| Authorized UI automation | ✅ [D] (API intended for automation) | ❓ [?] (ToS restricts flooding) | ✅ [D] | ⛔/❓ (robots `/*?`) | ⛔ [O] (Cloudflare 403) |
| Official documented API | ✅ [D] REST v2 | ✅ [D] JSON v1.0 | ✅ [D] GraphQL | ❌ none found [?] | ❌ none found [?] |
| API authentication | 🔑 [D] API token | ✅ [D] none (cookie+ip/agent) | ✅ [D] none | N/A [?] | N/A [?] |
| API subscription/licensing | 🔑 [D] Verified Pro ($0 w/ verification) or paid | ✅ [D] free | ✅ [D] free | N/A [?] | N/A [?] |
| Programmatic inbox create/retrieve | ✅ [D] | ✅ [D] `set_email_user` | ✅ [D] implicit | ❓ [?] | ❓ [?] |
| Subject availability | ✅ [D] | ✅ [D] | ✅ [D] | ❓ [?] | ❓ [?] |
| Plain-text body | ✅ [D] | ✅ [D] | ✅ [D] (`data`) | ❓ [?] | ❓ [?] |
| HTML body | ✅ [D] | ⚠️ [D] sanitized | ✅ [D] (`html`) | ❓ [?] | ❓ [?] |
| Message metadata (from/date/headers) | ✅ [D] | ⚠️ [D] partial | ✅ [D] rich | ❓ [?] | ❓ [?] |
| Message retention | hours (public) / persistent (paid) [D] | 1 hour [D] | 24 hours [D] | 8 days [D] | ~10 min [D] |
| Address/inbox expiration | inbox persists, mail expires [D] | address persists, mail 1h [D] | content cleared after 24h idle [D] | never deleted [D] | ~10 min, extendable [D] |
| Request limits | email quotas only [D]; HTTP limits [?] | unpublished [D] | **50 queries / 10s** [D] | none published [?] | none published [?] |
| Automation restrictions (ToS) | overuse clause [D] | explicit overuse/flooding clause [D] | none found [?] | robots `Disallow: /*?` [D] | no ToS accessible [?] |
| Terms of service URL | `mailinator.com/terms-of-use/` [D] | `guerrillamail.com/tos` [D] | none found (privacy only) [?] | none found [?] | none accessible [?] |
| Operational complexity | medium (key/plan) | low | low (no auth) | unknown [?] | high/blocked [O] |
| Known limitations | receive-only; public inboxes not private | 1h retention; sanitized HTML; no spam folder | greylisting ~15 min; 10-msg cap; 24h retention | no API; anti-scrape robots | Cloudflare challenge; 10-min life |
| Evidence source | [01-methodology.md §4](./01-methodology.md#4-provider-capability-matrix) | same | same | same | same |
| Verification date | 2026-10-14 | 2026-10-14 | 2026-10-14 | 2026-10-14 | 2026-10-14 |

#### Source URLs (official, fetched 2026-10-14)

| Provider | Official sources |
|---|---|
| **Mailinator** | [pricing](https://www.mailinator.com/pricing/) · [API overview](https://www.mailinator.com/mailinator-api/) · [documentation](https://www.mailinator.com/documentation/) · [terms of use](https://www.mailinator.com/terms-of-use/) · [public mailbox docs](https://www.mailinator.com/documentation/docs/core/publicmailbox/index.html) · [FAQs](https://www.mailinator.com/mailinator-faqs/) |
| **Guerrilla Mail** | [JSON API v1.0](https://www.guerrillamail.com/GuerrillaMailAPI.html) · [about](https://www.guerrillamail.com/about) · [terms](https://www.guerrillamail.com/tos) |
| **Maildrop** | [developer documentation](https://docs.maildrop.cc/developer-documentation) · [API overview](https://docs.maildrop.cc/api-reference/overview) · [rate limiting](https://docs.maildrop.cc/api-reference/rate-limiting) · [message type](https://docs.maildrop.cc/graphql-types/message) · [privacy policy](https://maildrop.cc/privacy/) · [how it works](https://maildrop.cc/how-it-works/) |
| **YOPmail** | [homepage](https://yopmail.com/en/) · [privacy](https://yopmail.com/en/privacy) · [robots.txt](https://yopmail.com/robots.txt) |
| **10 Minute Mail** | [live site](https://10minutemail.com/) (Cloudflare 403 to non-browser clients, observed 2026-10-14) · [archived FAQ](https://web.archive.org/web/20200120051837/https://10minutemail.com/10MinuteMail/faq.html) |

> **No official API reference page was found for YOPmail or 10 Minute Mail.** Their API rows are therefore `NOT_SUPPORTED` (documented absence) / `NOT_TESTED` (unresolved), never assumed.

> **[RECOMMENDATION]** This matrix is the *template*. Store it as machine-readable data (see [06-technical-handoff.md](./06-technical-handoff.md)) and **re-verify it before every benchmark run**, because provider behavior changes.

### 6.3 Capability gaps that most affect fairness

1. **10 Minute Mail's Cloudflare challenge** makes automated UI testing likely **impossible within policy**. This provider may end up `BLOCKED_BY_PROVIDER` for UI — reported as a finding, and **not** counted as a "delivery failure." **[FACT — observed 403]** / **[OPEN — policy]**
2. **YOPmail's absent documented API** means API evaluation for YOPmail is **structurally not comparable**. Report as `NOT_SUPPORTED` (documented) rather than a failure. **[FACT]**
3. **Maildrop's greylisting** can cause the *first* message from a new sender to be delayed ~15 minutes, which would dominate any latency measurement unless the harness accounts for it. **[FACT — documented]**
4. **Guerrilla Mail's 1-hour retention** vs **YOPmail's 8 days** affects only *retention* metrics, not detection latency — do not conflate the two. **[FACT]**

---

## 7. Assumptions Register (summary)

Full list in [04-risk-register.md §2](./04-risk-register.md#2-open-questions). Headline assumptions:

| ID | Assumption | Impact if wrong |
|---|---|---|
| A-01 | Outbound SMTP from the local network to provider MX hosts is permitted | Whole benchmark blocked; pivot to provider-side injection |
| A-02 | A paid/free-verified Mailinator tier is acceptable if needed | Mailinator API path degrades to `NOT_TESTED` |
| A-03 | Public inboxes are acceptable for **synthetic, non-confidential** data only | Security veto; methodology redesign |
| A-04 | Provider UIs are stable enough over the benchmark window | Higher `UIAUTOMATION_FAILED` rate; re-runs required |
| A-05 | The benchmark runs from a network location representative of CI | Latency numbers not CI-representative |
| A-06 | 30–50 samples per provider per mode is an acceptable initial sample size | Confidence intervals wide; conclusions weak |
| A-07 | A single execution host is acceptable (no geo-distribution) | Results valid for one region only |
| A-08 | CAPTCHA/bot challenges will be documented, not circumvented | Some providers partially unevaluable (expected) |

---

*Next: [01-methodology.md](./01-methodology.md) — benchmark methodology, metrics, UI/API strategy, failure taxonomy.*
