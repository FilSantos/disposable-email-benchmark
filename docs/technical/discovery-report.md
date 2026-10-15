# Phase 1 — Discovery, Feasibility Validation & Implementation Plan

**Project:** Email Provider Benchmark Framework
**Phase:** 1 (Discovery and Validation) — *gate before Phase 2*
**Date:** 2026-10-14
**Roles:** Senior SDET / QA Architect / TypeScript Engineer / Technical Lead
**Source of truth:** approved business analysis package in [`docs/business-analysis/`](../business-analysis/00-overview.md)

---

## 0. Executive Summary of Discovery

The repository is **empty of application code** — it contains only the business analysis package, the two prompt files, a README, and a license. There is no `package.json`, no TypeScript config, no Playwright config, no tests, and no CI workflow. This means **everything is greenfield**; the suggested structure in Prompt 2 §22 can be adopted without conflict.

Two findings dominate the plan:

1. **🔴 Outbound SMTP port 25 is blocked in this environment.** Every MX host timed out on port 25; ports 587/443 succeed. This is the **R-01 / A-01** risk materialising. The framework's transport model must therefore support an **explicitly configured relay** as a first-class, separately-labelled transport mode, and must never claim external delivery from local acceptance alone.
2. **🟡 Only three of five providers have a documented, authorized API** (Mailinator, Maildrop, Guerrilla Mail). YOPmail and 10 Minute Mail have **no documented API**, and 10 Minute Mail is behind an active Cloudflare bot challenge. **No fake adapters will be written.**

The recommendation is to proceed to Phase 2 with a **transport-agnostic** design that works today for local/loopback validation and works in CI once an SMTP relay credential is supplied.

---

## 1. Repository Assessment

### 1.1 Current contents

| Path | State | Notes |
|---|---|---|
| `LICENSE` | present | Apache-2.0 (35 KB) |
| `README.md` | present | Updated during Prompt 1 with package index |
| `prompt.txt` | present | Prompt 1 input (business analysis) |
| `prompt_2.txt` | present | Prompt 2 input (this implementation brief) |
| `docs/business-analysis/*.md` | present | **Approved source of truth** (7 documents) |
| `docs/technical/*.md` | created | This discovery report |
| `package.json` | **absent** | Must be created |
| `package-lock.json` | **absent** | Will be generated |
| `tsconfig.json` | **absent** | Must be created (strict) |
| `playwright.config.ts` | **absent** | Must be created |
| `vitest.config.ts` | **absent** | Must be created |
| `.github/workflows/*` | **absent** | Must be created |
| `src/`, `tests/` | **absent** | Must be created |
| `.gitignore` | **absent** | Must be created |

### 1.2 Tooling available in the environment

| Tool | Version | Verdict |
|---|---|---|
| Node.js | **v23.3.0** | Works, but v23 is *not* an LTS line. **Recommendation:** target **Node 22 LTS** (`engines: ">=20 <23"` range acceptable; CI pinned to 22). Local dev on 23 is fine for now. |
| npm | 10.9.0 | Fine |
| git | available | Fine |

### 1.3 Existing conventions to preserve

- **None for code** (greenfield).
- **Documentation style:** evidence-labelled (`[FACT]`/`[ASSUMPTION]`/`[RECOMMENDATION]`/`[OPEN]`), source-cited, tables-first. The implementation docs will follow the same style.
- **Methodology contract:** timestamp names, failure taxonomy, and denominator rules are **already frozen** in the business package. The code must match them exactly.

### 1.4 Reuse decisions

Nothing to reuse in code. The **business analysis package is reused as the requirements source**, and its capability matrix is transcribed into machine-readable config (not re-derived).

---

## 2. Business Requirement Summary (from the approved package)

Full catalogue: [`03-requirements-and-acceptance.md`](../business-analysis/03-requirements-and-acceptance.md). Highlights that shape the architecture:

- **BR-001** independent per-provider evaluation → plugin adapters, no shared state.
- **BR-002/003** UI **and** API verification as separate channels → two adapter interfaces.
- **BR-005/006** observed latency measured **separately from** reliability → metrics layer split cleanly.
- **BR-008** capability states with **capability status separated from execution outcome** → two distinct fields everywhere.
- **BR-012** exactly one terminal failure category per sample, with attribution → classifier as a pure function.
- **BR-013** rate-limit compliance and back-off → first-class limiter.
- **BR-016/017/020** no secrets in output; real/simulated/unexecuted labelling; credentials from env → config + redaction layer.
- **NFR-04** timeouts are first-class, never silent exclusions; **NFR-06** honour published limits.

**Non-negotiable invariants carried into code:**
1. Never fabricate a timestamp or latency for an undetected message.
2. Never report metrics over non-`REAL` samples.
3. Never present `NOT_SUPPORTED`/`NOT_TESTED` as a failure.
4. Latency tables always sit beside detection rates.

---

## 3. Provider Capability Matrix (evidence-backed)

Transcribed from verified sources (2026-10-14); see [`00-overview.md §6`](../business-analysis/00-overview.md#6-provider-capability-matrix) for full citations.

| Provider | UI access | Authorized UI automation | Official API | API configuration | Content access | Constraints |
|---|---|---|---|---|---|---|
| **Mailinator** | `SUPPORTED` | `SUPPORTED` (API intended for automation) | `SUPPORTED` (REST v2) | `CONFIGURATION_REQUIRED` (token; Verified Pro free tier or paid) | subject, text, HTML, metadata | public inboxes not private; mail expires "a few hours"; HTTP rate limits unpublished |
| **Maildrop** | `SUPPORTED` | `SUPPORTED` | `SUPPORTED` (GraphQL) | `SUPPORTED` (no auth) | subject, raw `data`, `html`, rich metadata | greylisting; 24h retention; 10-msg cap; 50 queries/10s |
| **Guerrilla Mail** | `SUPPORTED` | `NOT_TESTED` (ToS forbids flooding) | `SUPPORTED` (JSON v1.0) | `SUPPORTED` (no key; cookies + `ip`/`agent`) | subject, body (**HTML sanitized**), partial metadata | 1h retention; ToS explicitly prohibits request flooding |
| **YOPmail** | `SUPPORTED` | `NOT_TESTED` (`robots.txt` disallows `/*?`) | `NOT_SUPPORTED` (none found) | n/a | UI-level only | no documented API; 8-day retention; inboxes never expire |
| **10 Minute Mail** | `SUPPORTED` | `BLOCKED_BY_PROVIDER` (Cloudflare challenge, observed HTTP 403) | `NOT_SUPPORTED` (none found) | n/a | UI-level only | ~10-min expiry; no accessible ToS |

### 3.1 Gate classification (Prompt 2 §6)

| Category | Providers |
|---|---|
| **Ready for implementation (no credentials)** | Maildrop (API + UI), Guerrilla Mail (API) |
| **Requires credentials/configuration** | Mailinator (API token) |
| **Supports UI but not authorized API** | YOPmail |
| **Blocked by policy or technical restrictions** | 10 Minute Mail (Cloudflare); YOPmail automation stance unverified |
| **Requirements that cannot be met as written** | API benchmarking for YOPmail/10 Minute Mail — recorded as `NOT_SUPPORTED`, provider excluded from API denominators |
| **Dependencies needing a stakeholder decision** | Mailinator tier funding (A-02/Q-15); SMTP relay credentials (new, see §4) |

**Proof-of-concept provider selection:** **Maildrop** — documented API, **no authentication required**, richest payload, and a published rate limit. It is the lowest-friction path to a real end-to-end run. *(Second choice: Guerrilla Mail, but 1-hour retention and sanitized HTML add noise.)*

> **Note:** Mailinator remains the strategic recommendation for API-based QA verification (it is the only productized QA API). Maildrop is chosen for the *PoC* purely because it needs no credentials, not because it wins the benchmark.

---

## 4. SMTP Feasibility Assessment 🔴

### 4.1 Evidence (probed 2026-10-14 from this environment)

| Probe | Result |
|---|---|
| DNS MX `mailinator.com` | `mail2.mailinator.com`, `mail.mailinator.com` |
| DNS MX `guerrillamail.com` | `mail.guerrillamail.com` |
| DNS MX `maildrop.cc` | `mx.maildrop.cc` |
| DNS MX `yopmail.com` | `smtp.yopmail.com` |
| DNS MX `10minutemail.com` | **`ENODATA`** (no MX; would fall back to A) |
| DNS MX `10minutemail.net` | `ms1.fishyes.net` |
| TCP **port 25** → `mailinator.com` | **TIMEOUT** |
| TCP **port 25** → `yopmail.com` | **TIMEOUT** |
| TCP **port 25** → `aspmx.l.google.com` | **TIMEOUT** |
| TCP **port 25** → `smtp.yopmail.com` | **TIMEOUT** |
| TCP **port 587** → `smtp.gmail.com` | **OPEN** |
| TCP **port 587** → `smtp.yopmail.com` | **OPEN** |
| TCP **port 443** → general | **OPEN** |

### 4.2 Conclusion

**Direct outbound SMTP on port 25 is not possible from this environment.** Every tested host times out on 25 while 587 and 443 are open — a network-wide egress block, not a per-MX rejection. DNS/MX resolution works, so the blocker is purely transport.

### 4.3 Impact on the methodology

This is exactly risk **R-01** and assumption **A-01**. The approved methodology (Prompt 1 §4) states the local SMTP server is the sending mechanism and that acceptance ≠ external delivery. It does **not** mandate port 25; it anticipates a relay ("*If a relay is needed, support it as a separate, explicitly configured transport mode*" — Prompt 2 §9).

**No methodology change is required.** The compliant design is:

| Transport mode | Use | Status |
|---|---|---|
| `loopback` | Local SMTP accepts and captures the message; no external send. Used to validate the full harness pipeline deterministically. | **Available now** |
| `direct-mx` | Connect to provider MX on port 25. | **Unavailable here** (blocked) — implemented but will report a classified transport error |
| `relay` | Send via a configured authenticated SMTP relay (587/submission) that then delivers to the provider. | **Requires credentials** — `CONFIGURATION_REQUIRED` |

**Rules enforced in code:**
- The transport mode is recorded in **every** run manifest and sample.
- Direct and relay results are **never** merged unlabelled.
- No silent fallback: a failed transport yields a classified error, not a retry on a different mode.
- The framework **never** claims external delivery from local acceptance alone.
- So-called "verification of delivery" can only come from **detecting the message via the provider UI/API** — which is the whole point of the benchmark.

### 4.4 Recommendation

Proceed with Phase 2 building the **transport-agnostic** layer. The `loopback` mode lets Phases 2–5 be fully exercised and tested **today** without network egress. Real provider runs (Phase 4 execution evidence) will need a relay credential; until then, provider adapters will be reported as **implemented but not executed**, exactly as Prompt 2 §24 requires.

**[OPEN]** Q-01 (egress) is now partially answered: **port 25 blocked**. Remaining question: **is a relay credential available for CI?** — owner: Infrastructure / QA Manager.

---

## 5. Dependency Recommendations (Prompt 2 §7)

| Purpose | Candidate | License | Why | Decision |
|---|---|---|---|---|
| Local SMTP **server** | `smtp-server` | MIT | Mature, low-level, explicit lifecycle control, no magic | ✅ **Adopt** |
| SMTP **client** | `nodemailer` | MIT | De-facto standard; supports direct-MX and authenticated relay; clean error surface | ✅ **Adopt** |
| UI automation | `@playwright/test` | Apache-2.0 | Mandated by brief; built-in tracing/screenshots | ✅ **Adopt** |
| HTTP client | global `fetch` (Node 18+) | n/a | Zero dependency; sufficient for JSON/GraphQL | ✅ **Adopt** (no axios) |
| Test runner | `vitest` | MIT | Fast, TS-native, good mocking; pairs with Playwright for E2E | ✅ **Adopt** |
| Types | `@types/node` | MIT | Required | ✅ **Adopt** |
| TS runtime | `tsx` | MIT | Run TS directly for scripts | ✅ **Adopt** |
| Lint | `eslint` + `typescript-eslint` | MIT | Standards + strict TS rules | ✅ **Adopt** |
| HTML report | hand-rolled template | n/a | Avoids a heavy dependency; report is a controlled document | ✅ **Adopt** (no templating engine) |
| CSV export | hand-rolled | n/a | Trivial, fully controlled | ✅ **Adopt** |

**Rejected:** `axios` (redundant), `winston`/`pino` (built-in structured logger is sufficient and keeps redaction under our control), `nodemailer-mock` (we mock at our own transport seam), any SMTP-relay SaaS SDK (out of scope).

**Node target:** pin CI to **Node 22 LTS**; `engines` allows `>=20 <24`.

---

## 6. Proposed Architecture

```
CLI / npm scripts
      │
      ▼
┌───────────────────────────────────────────────────────────────┐
│ benchmark/runner        orchestrates runs, order, windows     │
│ benchmark/sampler       ONE sample lifecycle (state machine)  │
└───────┬───────────────────────────────────────────────────────┘
        │ uses
        ├──────────────► smtp/            server + client + transport modes
        ├──────────────► providers/       capability-gated adapters
        │                   ├─ types.ts   ProviderAdapter contract
        │                   ├─ registry.ts
        │                   ├─ maildrop/  (api + ui)
        │                   ├─ guerrillamail/ (api)
        │                   ├─ mailinator/ (api, CONFIGURATION_REQUIRED)
        │                   ├─ yopmail/   (ui only)
        │                   └─ tenminutemail/ (status-only, blocked)
        ├──────────────► validation/      strict + normalized validators
        ├──────────────► metrics/         latency, reliability, percentiles, CIs
        ├──────────────► reporting/       json (source of truth) → html, csv
        ├──────────────► config/          env, schemas, run manifest
        └──────────────► observability/   logger + redaction
```

### 6.1 Layer contracts (kept small and testable)

- **Transport seam** — `interface SmtpTransport { send(msg): Promise<SendResult> }` with `LoopbackTransport`, `RelayTransport`, `DirectMxTransport`. Swapping transports must not touch adapters.
- **Provider adapter seam** — `interface ProviderAdapter { checkCapabilities(); getInboxAddress(); waitForMessage(); getMessage(); }` split into `UiChannel` / `ApiChannel` so a provider can implement one, both, or neither.
- **Clock seam** — `interface Clock { nowUtc(): string; monotonicMs(): number }` so elapsed time uses a monotonic source and audit records use UTC (Prompt 2 §15).
- **Classifier** — pure function `classify(input): { category, attribution }`.
- **Redaction** — applied at the logger boundary, so secrets cannot leak even on a debug path.

### 6.2 Invariant enforcement points

| Invariant | Enforced by |
|---|---|
| No fabricated latency | metrics layer returns `null` unless both endpoints exist; schema test |
| Non-REAL excluded from metrics | metrics layer filters on `sample_origin`; negative test |
| Capability ≠ outcome | separate fields in the sample schema; report renders both |
| One failure category per sample | classifier returns a single category; sampler asserts |
| No secrets in output | redaction at logger + secret-scan test |

---

## 7. Technical Risks

| ID | Risk | Disposition |
|---|---|---|
| T-R1 | **Port 25 blocked** (confirmed) | Mitigated by transport modes; relay needed for real runs. Real runs gated on credentials. |
| T-R2 | Mailinator API needs a token | `CONFIGURATION_REQUIRED`; capability-gated skip. |
| T-R3 | Maildrop greylisting delays first send | Separate labelled cohort; extended timeout; not a provider failure. |
| T-R4 | YOPmail/10 Minute Mail have no API | `NOT_SUPPORTED`; excluded from API denominators. |
| T-R5 | 10 Minute Mail Cloudflare challenge | `BLOCKED_BY_PROVIDER`; **not** circumvented. |
| T-R6 | Provider UI selectors change | Resilient locators + traces; adapters are contract-tested with fixtures. |
| T-R7 | Node 23 locally vs 22 LTS in CI | `engines` range + CI pin; document. |
| T-R8 | Secrets in logs/artifacts | Redaction boundary + secret-scan test. |
| T-R9 | Unpublished rate limits (Guerrilla Mail, Mailinator HTTP) | Conservative default limiter + back-off; self-inflicted 429 classified as harness defect. |

---

## 8. Incremental Implementation Plan

| Phase | Deliverable | Test gate |
|---|---|---|
| **2a Scaffold** | `package.json`, strict `tsconfig`, eslint, vitest + playwright configs, `.gitignore`, `.env.example` | `npm run typecheck` + empty test run pass |
| **2b Infrastructure** | SMTP server lifecycle, transports (loopback/relay/direct), message generation + correlation, clock, config, classifier, redaction | `npm run test:unit`, `npm run test:integration` |
| **3 PoC** | Maildrop API end-to-end: SMTP → detect → retrieve → validate → measure → report | A real (or loopback-labelled) sample produces a JSON/HTML/CSV report |
| **4 Adapters** | Remaining adapters per verified capability; status-only entries for blocked providers | Adapter contract tests; capability gating tests |
| **5 Stats & Reporting** | Metrics, percentiles, Wilson CIs, three report formats, capability matrix section | Metric + report unit tests; recomputation test |
| **6 Hardening & Docs** | Lifecycle cleanup, security review, CI workflow, runbook, traceability matrix, final status | Full suite green; no orphan processes |

**Phase 1 gate:** this report is the deliverable. Proceeding to Phase 2a.

---

## 9. Open Questions Raised by Discovery

| # | Question | Owner | Impact |
|---|---|---|---|
| DQ-1 | Is an authenticated SMTP **relay credential** available for CI (needed for real provider runs)? | Infrastructure / QA Manager | Blocks real-run evidence for all providers |
| DQ-2 | Is a Mailinator **API token** (free Verified Pro or paid) approved? | QA Manager / Procurement | Mailinator API path |
| DQ-3 | Confirm target Node LTS for CI pins (recommend 22) | Engineering | CI config |
| DQ-4 | Evidence retention period (screenshots/traces/sample JSON) | Security | Cleanup + `.gitignore` |
| DQ-5 | Is YOPmail automation acceptable given only a `robots.txt` signal? | Legal / QA Manager | YOPmail UI channel |

---

## 10. Phase-1 Verdict

- ✅ Repository assessed; greenfield confirmed; no destructive changes needed.
- ✅ Requirements extracted and traceability seed defined.
- ✅ Provider capability matrix validated and transcribed.
- ✅ SMTP feasibility **tested with evidence** — port 25 blocked; relay required for real runs.
- ✅ Dependencies evaluated and selected.
- ✅ Architecture and phased plan proposed.
- 🔴 **Blocker for real-run evidence:** relay credentials (DQ-1). Phases 2–3 remain fully executable via `loopback`.

**Recommendation: proceed to Phase 2.**
