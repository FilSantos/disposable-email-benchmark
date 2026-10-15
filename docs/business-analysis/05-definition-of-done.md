# 05 — Definition of Done

**Parent:** [00-overview.md](./00-overview.md) · **Status:** Draft for QA Manager review · **Date:** 2026-10-14

The benchmark study is **Done** only when every item below is satisfied. "Done" is at the **study** level (this is a research/benchmark deliverable, not a shipped product feature).

---

## 1. Phase 0 — Capability Verification Spike (gate to Phase 1)

| # | Criterion | Evidence |
|---|---|---|
| D0-1 | All 20 open questions in [04-risk-register.md §2](./04-risk-register.md#2-open-questions) are answered or explicitly deferred with owner and date | Q-resolution log |
| D0-2 | Egress/SMTP reachability to each provider MX is confirmed or definitively ruled out | Egress test report |
| D0-3 | Provider capability matrix is re-verified against official sources with dates | Updated matrix |
| D0-4 | A policy verdict exists for each provider: automate / restrict / do-not-automate | Legal + QA sign-off |
| D0-5 | Credentials for API-enabled providers (Mailinator, Guerrilla Mail, Maildrop) are provisioned in a secret store | Secret-store reference (no values) |
| D0-6 | At least one provider completes a **full end-to-end smoke sample** (SMTP → detect → read → validate) | Smoke sample JSON |

**Phase 0 is a gate:** if a provider is ruled do-not-automate, it proceeds to the benchmark as a documented `BLOCKED_BY_PROVIDER` finding rather than a testable target.

## 2. Functional Completeness

| # | Criterion | Evidence |
|---|---|---|
| D1-1 | All **Must Have** requirements (16) meet their acceptance criteria | Requirement traceability matrix |
| D1-2 | All **Should Have** requirements implemented or explicitly waived with rationale | Waiver log |
| D1-3 | Every sample has exactly one terminal failure category or a PASS | Schema validation |
| D1-4 | Capability status and execution outcome are reported **separately** in all reports | Report inspection |
| D1-5 | `REAL`/`SIMULATED`/`UNEXECUTED` origin labelling present; metrics use `REAL` only | Report inspection + negative test |

## 3. Data Quality

| # | Criterion | Evidence |
|---|---|---|
| D2-1 | ≥3 independent runs completed, across ≥2 time windows | Run manifests |
| D2-2 | ≥30 samples per provider per mode (or a documented shortfall with reason) | Sample census |
| D2-3 | No silently excluded samples; every exclusion matches pre-declared criteria | Exclusion audit |
| D2-4 | Every percentage carries an explicit denominator | Report checklist |
| D2-5 | Aggregates recomputed from sample JSON match published aggregates exactly | Recomputation diff (empty) |
| D2-6 | No secret appears in any log, artifact, or report | Automated secret-scan (clean) |
| D2-7 | Poll interval, timeouts, concurrency, and n are published with every latency figure | Report checklist |

## 4. Statistical Rigour

| # | Criterion | Evidence |
|---|---|---|
| D3-1 | Detection rate reported with Wilson confidence intervals | Statistics section |
| D3-2 | Latency conditioned on detection is **always** adjacent to detection rate | Report inspection |
| D3-3 | P99 **not** published unless n ≥ 100 for the cell | Report inspection |
| D3-4 | Run-to-run consistency reported; unstable providers flagged | Consistency table |
| D3-5 | Winner declarations satisfy all four rules in [02 §5](./02-statistics-and-reporting.md#5-declaring-a-winner) | Decision rationale section |

## 5. Reporting

| # | Criterion | Evidence |
|---|---|---|
| D4-1 | Executive report contains all 10 required sections | Report checklist |
| D4-2 | Technical report contains all 12 required sections | Report checklist |
| D4-3 | HTML, JSON, and CSV outputs generated from a single source of truth | Regeneration test |
| D4-4 | Segment winners (or "insufficient evidence") presented; no forced single ranking | Decision section |
| D4-5 | Every factual provider claim cites an official source + verification date | Citation audit |
| D4-6 | Confidence and evidence limitations stated plainly for a non-technical reader | Readability review |

## 6. Reproducibility

| # | Criterion | Evidence |
|---|---|---|
| D5-1 | Run manifest records config hash, code commit, seeds, provider order, environment | Manifests |
| D5-2 | Re-executing a manifest produces structurally identical output | Structural diff (empty) |
| D5-3 | Capability snapshot embedded per run; drift highlighted | Manifest inspection |
| D5-4 | Exact reproduction commands documented | Technical handoff / runbook |

## 7. Governance & Sign-off

| # | Criterion | Owner |
|---|---|---|
| D6-1 | Security review of credential handling, log sanitization, and public-inbox usage | Security |
| D6-2 | Legal review of ToS compliance for each provider | Legal |
| D6-3 | QA Manager approves methodology **before** Phase 1 and approves findings **after** | QA Manager |
| D6-4 | Engineering validates that sample-level evidence supports the aggregates | Engineering |
| D6-5 | Residual risks documented in the executive report | QA Manager |
| D6-6 | Open questions either resolved or carried forward with owners | QA Manager |

## 8. Explicit Non-Goals (do not block Done)

- No provider-internal delivery-time claims.
- No CAPTCHA circumvention.
- No undocumented API as a basis for published metrics.
- No single overall ranking when evidence supports segment winners.

---

*Next: [06-technical-handoff.md](./06-technical-handoff.md).*
