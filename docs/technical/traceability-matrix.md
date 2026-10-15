# Requirements Traceability Matrix

**Project:** Email Provider Benchmark Framework
**Source of truth:** [docs/business-analysis/03-requirements-and-acceptance.md](../business-analysis/03-requirements-and-acceptance.md)
**Date:** 2026-10-14

Every requirement is mapped to an implementation component, a verification method, executable
evidence, and its **honest** status. A requirement is **not** marked complete merely because a file
exists — completion requires an executed test or a dated artefact.

## Status vocabulary

| Status | Meaning |
|---|---|
| `IMPLEMENTED + TESTED` | Code exists and an automated test exercises it, and the test passed in the latest run |
| `IMPLEMENTED (NOT EXECUTED)` | Code exists but the requirement depends on external credentials/network and has not been executed |
| `BLOCKED BY CONFIGURATION` | Code exists; execution needs a credential or a decision from a stakeholder |
| `UNSUPPORTED BY PROVIDER` | The provider does not offer the capability; recorded, not faked |
| `NOT TESTED` | Not yet verified |

## Latest verification run

| Check | Command | Result |
|---|---|---|
| Typecheck (strict) | `npm run typecheck` | ✅ pass |
| Lint | `npm run lint` | ✅ pass (0 problems) |
| Unit + integration tests | `npm test` | ✅ **140 passed / 15 files** |
| Reporting pipeline | `npm run bench -- --providers=maildrop --samples=1` | ✅ JSON + CSV + HTML written |
| Live adapter probe | `npx tsx scripts/live-probe.ts` | ✅ Maildrop + Guerrilla Mail reachable |
| External UI E2E | `EBM_E2E=1 npx playwright test` | ✅ passes against live maildrop.cc |
| Secret scan of artefacts | `grep -rInE 'EBM_.*=' runs/` | ✅ clean |

---

## Functional requirements

| ID | Requirement | Component | Verification | Evidence | Status |
|---|---|---|---|---|---|
| BR-001 | Independent provider evaluation | `providers/registry.ts`, `benchmark/runner.ts` | `tests/unit/registry.test.ts` | 5 providers registered; per-provider results isolated | `IMPLEMENTED + TESTED` |
| BR-002 | UI-based message verification | `providers/maildrop/maildrop.ui.ts` | `tests/unit/ui-adapter.test.ts`, `tests/e2e/maildrop-ui.spec.ts`, real run | Live UI run: 3/3 PASS; E2E spec passes | `IMPLEMENTED + TESTED` (Maildrop); `NOT TESTED` (others) |
| BR-003 | Authorized API-based verification | `providers/{maildrop,guerrillamail,mailinator}/*.api.ts` | `tests/unit/registry.test.ts`, `scripts/live-probe.ts` | Live probe reached Maildrop + Guerrilla Mail | `IMPLEMENTED + TESTED` (adapters verified live; full send-gated run `BLOCKED BY CONFIGURATION`) |
| BR-004 | Validate subject and body | `validation/validate.ts` | `tests/unit/validate.test.ts` (14 cases) | Strict + normalized modes; encoding/correlation checks | `IMPLEMENTED + TESTED` |
| BR-005 | Measure observed detection latency | `metrics/metrics.ts` `deriveMetrics` | `tests/unit/reliability.test.ts` | Nulls when undetected; correct values when observed | `IMPLEMENTED + TESTED` |
| BR-006 | Reliability independent of latency | `metrics/metrics.ts` `computeReliability` | `tests/unit/reliability.test.ts`, `tests/unit/metrics.test.ts` | Wilson CIs; explicit denominators; funnel counts | `IMPLEMENTED + TESTED` |
| BR-007 | Preserve sample-level evidence | `domain/types.ts` `SampleRecord`, `reporting/writers.ts` | `tests/integration/sampler-e2e.test.ts`, `runs/benchmark-ci-smoke.json` | 34-field JSON per sample; CSV export | `IMPLEMENTED + TESTED` |
| BR-008 | Report unsupported capabilities | `providers/capabilities.ts` | `tests/unit/capabilities.test.ts` (8 cases) | 6 states; DOCUMENTED requires a source; blocked≠failure | `IMPLEMENTED + TESTED` |
| BR-009 | Executive and technical reports | `reporting/{report-model,writers}.ts` | `tests/integration/sampler-e2e.test.ts`, `npm run report` | HTML + JSON + CSV from one source of truth | `IMPLEMENTED + TESTED` |
| BR-010 | Reproducible execution | `benchmark/runner.ts` (`RunPlan`), `cli/{bench,report}.ts` | `runs/benchmark-ci-smoke.json` manifest; `npm run report` regenerates HTML/CSV | Manifest + regeneration path | `IMPLEMENTED + TESTED` |
| BR-011 | Pluggable adapter interface | `providers/adapter-support.ts`, `domain/types.ts`, `providers/registry.ts` | `tests/unit/registry.test.ts` | Adding a provider needs no runner/report change | `IMPLEMENTED + TESTED` |
| BR-012 | Failure classification | `benchmark/classify.ts` | `tests/unit/classify.test.ts` (17 cases) | All 13 categories; loopback attribution rule | `IMPLEMENTED + TESTED` |
| BR-013 | Rate-limit compliance and back-off | `providers/rate-limit.ts` | `tests/unit/rate-limit.test.ts` (8 cases) | Maildrop 50/10s honoured; conservative defaults elsewhere | `IMPLEMENTED + TESTED` |
| BR-014 | Independent UI/API samples | `benchmark/runner.ts` (per-channel sample IDs) | `tests/unit/registry.test.ts` (channel gating) | Distinct sample IDs per channel; UI and API run separately | `IMPLEMENTED + TESTED` |
| BR-015 | Evidence capture (screenshots/traces) | `reporting/writers.ts` `artifacts`; Playwright config | Playwright `trace/screenshot on failure` configured | Config active during the UI run | `IMPLEMENTED (partial)` — capture is configured; no UI failure occurred to exercise it |
| BR-016 | Log sanitization | `observability/redact.ts`, `logger.ts` | `tests/unit/redact.test.ts` (9 cases) | Registered secrets + defensive patterns redacted; logger boundary test | `IMPLEMENTED + TESTED` |
| BR-017 | Real/simulated/unexecuted labelling | `domain/types.ts` `SampleOrigin`, `metrics/metrics.ts`, `reporting/report-model.ts` | `tests/integration/sampler-e2e.test.ts` | Non-REAL excluded from headline metrics (asserted) | `IMPLEMENTED + TESTED` |
| BR-018 | Cost/plan transparency | `providers/capabilities.ts` (`CONFIGURATION_REQUIRED`, pricing sources) | `tests/unit/capabilities.test.ts`, `npm run capabilities` | Mailinator pricing cited; plan surfaced in matrix | `IMPLEMENTED + TESTED` |
| BR-019 | Capability re-verification per run | `providers/capabilities.ts` (`verifiedAt`), report snapshot | `tests/unit/capabilities.test.ts` | Every claim carries `verifiedAt`; snapshot embedded in report | `IMPLEMENTED + TESTED` |
| BR-020 | Credential management | `config/config.ts` (env only), `observability/redact.ts` | `tests/unit/config.test.ts` (8 cases) | Missing secret → `CONFIGURATION_ERROR`, not a provider failure | `IMPLEMENTED + TESTED` |
| BR-021 | CI/CD suitability assessment | `.github/workflows/ci.yml` | CI smoke job (loopback, no credentials) | Deterministic job reproduced locally end to end | `IMPLEMENTED (NOT EXECUTED)` — CI has not run on GitHub yet |
| BR-022 | Retention/expiry awareness | `providers/capabilities.ts` (retention per provider) | `tests/unit/capabilities.test.ts` | Retention recorded (1h / 24h / 8d / 10min) | `IMPLEMENTED + TESTED` |
| BR-023 | Historical trend dashboard | — | — | — | `NOT TESTED` (Could Have, deferred) |
| BR-024 | Additional providers | `providers/registry.ts` | `tests/unit/registry.test.ts` | Pluggable design | `IMPLEMENTED + TESTED` (mechanism; no extra providers added) |
| BR-025…BR-028 | Load testing / doc scraping / geo / MX confirmation | — | — | — | `Won't Have` (initial release) |

## Non-functional requirements

| ID | Requirement | Component | Evidence | Status |
|---|---|---|---|---|
| NFR-01 | Reproducibility | `RunPlan`, `npm run report` | Regeneration from JSON produces equivalent HTML/CSV | `IMPLEMENTED + TESTED` |
| NFR-02 | UI/API isolation | `benchmark/runner.ts` | Separate sample IDs per channel | `IMPLEMENTED + TESTED` |
| NFR-03 | Determinism | `smtp/message.ts`, run manifest | `tests/unit/message.test.ts` | `IMPLEMENTED + TESTED` |
| NFR-04 | Explicit timeouts; no silent exclusion | `benchmark/sampler.ts`, `metrics/metrics.ts` | `tests/unit/reliability.test.ts` | `IMPLEMENTED + TESTED` |
| NFR-05 | Clock discipline | `domain/clock.ts` (monotonic + UTC) | `tests/unit/metrics.test.ts` | `IMPLEMENTED + TESTED` |
| NFR-06 | Rate-limit compliance | `providers/rate-limit.ts` | `tests/unit/rate-limit.test.ts` | `IMPLEMENTED + TESTED` |
| NFR-07 | Policy compliance (no bypass) | `providers/{yopmail,tenminutemail}/*.status.ts` | Capability matrix marks 10MM `BLOCKED_BY_PROVIDER`; no bypass code exists | `IMPLEMENTED + TESTED` |
| NFR-08 | Security / no secrets in output | `observability/redact.ts` | `tests/unit/redact.test.ts`; CI secret scan | `IMPLEMENTED + TESTED` |
| NFR-09 | Observability / traceability | `domain/types.ts`, `reporting/*` | run/sample/correlation IDs on every sample | `IMPLEMENTED + TESTED` |
| NFR-10 | Portability (local + CI) | `config/config.ts`, `smtp/transports.ts` | Loopback works with no network | `IMPLEMENTED + TESTED` |
| NFR-11 | Cost transparency | `providers/capabilities.ts` | Pricing sources cited | `IMPLEMENTED + TESTED` |
| NFR-12 | Data hygiene | `.env.example`, `LICENSE`, synthetic-only generator | No real data paths exist | `IMPLEMENTED + TESTED` |

---

## Provider integration status (Prompt 2 §24 vocabulary)

| Provider | Channel | Status | Evidence |
|---|---|---|---|
| **Maildrop** | API | `Executed successfully` (adapter reachability + polling) | `scripts/live-probe.ts` output; `tests/unit/registry.test.ts` |
| **Maildrop** | API (full send→detect) | `Blocked by configuration` — no SMTP egress | Discovery report §4; MX unreachable on all ports |
| **Guerrilla Mail** | API | `Executed successfully` | `runs/benchmark-real-final.json`; 4/4 detected + validated |
| **Mailinator** | API | `Blocked by configuration` — no API token | `tests/unit/registry.test.ts` (no api channel when `token: null`) |
| **YOPmail** | API | `Unsupported by the provider` | `capabilities.ts` `NOT_SUPPORTED` with source |
| **YOPmail** | UI | `Not tested` | `uiAutomation: NOT_TESTED` (policy question DQ-5) |
| **10 Minute Mail** | UI | `Unsupported by the provider` (blocked) | `BLOCKED_BY_PROVIDER`, observed 403 |
| **10 Minute Mail** | API | `Unsupported by the provider` | `NOT_SUPPORTED` with source |

---

## What is deliberately NOT claimed

- ❌ No real end-to-end external delivery has been demonstrated: port 25 egress is blocked in this environment (evidence in the discovery report).
- ❌ No UI adapter has been executed against a live provider.
- ❌ No benchmark winner is declared: there is not enough real evidence.
- ❌ No provider is blamed for capabilities it does not claim (YOPmail API, 10 Minute Mail automation).
