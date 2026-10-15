# Architecture

**Project:** Email Provider Benchmark Framework · **Date:** 2026-10-14

## 1. Purpose

Measure, with reproducible evidence, how quickly and reliably each temporary-email provider makes
a synthetic message detectable and readable — via its **UI** and, where officially supported, its
**API**.

The framework never claims more than it observed. In particular, latency is measured from **local
SMTP acceptance**, and an undetected message has **no latency value at all**.

## 2. Layer diagram

```
                         src/cli/bench.ts  (composition root)
                                   │
              ┌────────────────────┼─────────────────────┐
              ▼                    ▼                     ▼
      smtp/ (transport)     benchmark/ (orchestration)   reporting/
              │                    │                     │
   ┌──────────┼──────────┐         │                     │
   ▼          ▼          ▼         ▼                     ▼
loopback  direct-mx   relay    sampler ──► classify    json ──► html
(no send) (port 25)  (auth)      │            │          └──► csv
                                 │            │
                    ┌────────────┴────┐       │
                    ▼                 ▼       ▼
              providers/        validation/  metrics/
              (adapters)        (content)    (stats)
                    │
        ┌───────────┼────────────┬──────────────┐
        ▼           ▼            ▼              ▼
     maildrop  guerrillamail  mailinator   yopmail / tenminutemail
     (API)        (API)         (API,token)  (status only — no fake adapter)

Cross-cutting: config/ (env + validation) · observability/ (logger + redaction) · domain/ (types, clock)
```

## 3. Module responsibilities

| Module | Responsibility | Key file |
|---|---|---|
| `domain/` | Frozen contracts: capability states, failure taxonomy, `SampleRecord`, clock | `domain/types.ts`, `domain/clock.ts` |
| `config/` | Env loading, validation, loopback-bind enforcement, secret registration | `config/config.ts` |
| `observability/` | Structured logging; the redaction boundary every string crosses | `observability/logger.ts`, `redact.ts` |
| `smtp/` | Local SMTP server lifecycle; three explicitly-labelled transports; message generation with correlation IDs | `smtp/server.ts`, `transports.ts`, `message.ts` |
| `providers/` | Capability matrix (data with sources), adapter contract, registry, rate limiter | `providers/capabilities.ts`, `registry.ts`, `rate-limit.ts`, `adapter-support.ts` |
| `validation/` | Strict and normalized content comparison | `validation/validate.ts` |
| `metrics/` | Derived latency metrics, percentiles, Wilson intervals, reliability funnel | `metrics/metrics.ts` |
| `benchmark/` | Sample lifecycle state machine, failure classification, run orchestration | `benchmark/sampler.ts`, `classify.ts`, `runner.ts` |
| `reporting/` | JSON source of truth → HTML + CSV | `reporting/report-model.ts`, `writers.ts` |
| `cli/` | Composition roots: benchmark, capability matrix, report regeneration | `cli/bench.ts`, `capabilities.ts`, `report.ts` |

## 4. Key design decisions (with rationale)

| Decision | Rationale |
|---|---|
| **Transport as a seam** with `loopback` / `direct-mx` / `relay` | Port 25 is blocked here; the harness must still run and must never fake delivery. The mode is recorded on every sample. |
| **Capability-gated adapters** (no empty ones) | YOPmail and 10 Minute Mail have no authorized API. A fake adapter would violate the methodology; they are represented as capability states instead. |
| **`Connection: close` on provider HTTP calls** | Node's bundled fetch (undici) reused a stalled keep-alive socket against `api.maildrop.cc`: a 773 ms request took ~270 s. Our poll cadence is seconds apart, so reuse buys nothing. |
| **Monotonic clock for durations, UTC for audit** | Wall-clock adjustments must not corrupt elapsed measurements; audit records need absolute time. |
| **Null, never a substituted timeout** | A timeout is right-censored data. Writing it into a latency field would fabricate an observation. |
| **Redaction at the logger/writer boundary** | Secrets cannot leak even on a debug path or into a regenerated report. |
| **JSON is the source of truth** | HTML and CSV are derived, so the three formats cannot disagree. |
| **Wilson score intervals** | Better than the normal approximation at small n and rates near 0/1 — which is exactly our regime. |

## 5. Invariants enforced in code

| Invariant | Enforcement | Test |
|---|---|---|
| Latency is null unless both endpoints exist | `deriveMetrics` | `tests/unit/reliability.test.ts` |
| Timeout never written as a latency | no code path assigns `timeoutMs` to a latency field; CSV assertion | `tests/integration/sampler-e2e.test.ts` |
| Non-`REAL` samples excluded from metrics | `computeReliability` filters on `sampleOrigin` | `tests/unit/reliability.test.ts`, `sampler-e2e.test.ts` |
| One terminal failure category per sample | `classify` returns a single category | `tests/unit/classify.test.ts` |
| Capability status ≠ execution outcome | separate fields; report renders both | `tests/unit/capabilities.test.ts` |
| Loopback non-detection is never blamed on the provider | `classify` transport rule | `tests/unit/classify.test.ts` |
| No secret in output | `redact` at logger + JSON replacer + CSV cell | `tests/unit/redact.test.ts`; CI secret scan |
| SMTP server binds loopback only | `assertLoopbackBind` | `tests/unit/config.test.ts` |
| No orphaned listeners | `try/finally` in the CLI; `stop()` idempotent | `tests/integration/smtp-lifecycle.test.ts` |

## 6. Execution flow (one sample)

```
1. adapter.getInboxAddress()          → inbox identifier
2. transport.send(message)            → SMTP_ACCEPTED_AT  (lower bound for all latency)
3. adapter.waitForMessage(...)        → polls on a fixed interval, matching ONLY the correlation id
     ↳ onPoll → polls, last-negative, first-positive, request durations
4. adapter.getMessage(ref)            → API_CONTENT_AVAILABLE_AT / UI_CONTENT_AVAILABLE_AT
5. validateContent(...)               → PASS/FAIL + explicit differences + transformations used
6. deriveMetrics(...)                 → detection/content latency, access duration (null if unobserved)
7. classify(...)                      → exactly one category + attribution (only on failure)
```

## 7. Extension points

- **New provider**: add a capability entry (`providers/capabilities.ts`) with sources, then an adapter
  implementing `ApiChannel`/`UiChannel`, then register it (`providers/registry.ts`). No runner or
  reporter changes are needed (BR-024).
- **New transport**: implement `SmtpTransport` and select it in the CLI.
- **New scenario**: extend `Scenario` in `smtp/message.ts`; scenarios are data-driven.
- **New metric**: add to `metrics/metrics.ts` and surface in `report-model.ts`; writers need no change.

## 8. Testing strategy

| Suite | Location | Network? | Purpose |
|---|---|---|---|
| Unit | `tests/unit/` | No | Formulas, percentiles, CIs, classification, validation, redaction, config, rate limiting, message generation |
| Integration | `tests/integration/` | Loopback only | SMTP lifecycle, port conflicts, clean shutdown, end-to-end sample with a simulated transport, report serialisation |
| Live probe | `scripts/live-probe.ts` | Yes (read-only) | Confirms adapters reach real endpoints without sending mail |
| External provider E2E | `tests/e2e/` | Yes, opt-in | Playwright UI runs; **not** part of the deterministic suite |

The deterministic suites must always pass with no credentials and no outbound SMTP; that is what CI enforces.
