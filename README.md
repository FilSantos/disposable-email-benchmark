# disposable-email-benchmark

Benchmark framework for evaluating temporary/disposable email receiving providers for automated QA email-verification.

**Providers under evaluation:** 10 Minute Mail · Maildrop · Guerrilla Mail · Mailinator · YOPmail
**Stack:** Playwright Test · TypeScript (strict) · Node.js LTS · local SMTP server · HTML/JSON/CSV reporting.

## Status

| Stage | State |
|---|---|
| Prompt 1 — Business analysis & methodology | ✅ Complete — [package](./docs/business-analysis/00-overview.md) |
| Prompt 2 — Discovery, feasibility & implementation | ✅ Framework delivered & verified — [status report](./docs/technical/implementation-status.md) |
| Real benchmark results | ✅ **Real runs complete** — API (Maildrop, Guerrilla Mail) + **UI (Maildrop)** — [results](./docs/technical/benchmark-results.md) |

> **Preliminary real results are published** via the Brevo relay on port 587 (port 25 is blocked).
> n = 4 per provider, so **no winner is declared**. Producing those results exposed six harness
> defects, all fixed — see [benchmark results](./docs/technical/benchmark-results.md). Outside a relay,
> the harness also runs in `loopback` mode, which validates the pipeline but delivers nothing.

## Quick start

```bash
npm ci
npm run typecheck && npm run lint && npm test   # 140 tests, no credentials, no network
npm run capabilities                            # capability matrix with sources
npm run bench -- --providers=maildrop --samples=1
npm run report  -- --in=runs/benchmark-<label>.json
```

See the [setup and runbook](./docs/technical/setup-and-runbook.md) for configuration, transport modes
and result-interpretation guidance.

## Documentation

### Technical (implementation)

| Document | Contents |
|---|---|
| [implementation-status.md](./docs/technical/implementation-status.md) | **Start here** — phase reports, verification evidence, what is and is not claimed |
| [discovery-report.md](./docs/technical/discovery-report.md) | Repository assessment, provider feasibility, SMTP feasibility, architecture, plan |
| [architecture.md](./docs/technical/architecture.md) | Layers, design decisions, invariants, extension points, testing strategy |
| [traceability-matrix.md](./docs/technical/traceability-matrix.md) | Requirement → component → test → evidence → status |
| [setup-and-runbook.md](./docs/technical/setup-and-runbook.md) | Install, configure, run, CI/CD, result interpretation |
| [security-and-retention.md](./docs/technical/security-and-retention.md) | Synthetic data, credentials, redaction, retention, ToS alignment |
| [known-limitations.md](./docs/technical/known-limitations.md) | Honest limitations and unresolved questions |
| [relay-findings.md](./docs/technical/relay-findings.md) | Brevo relay credential verification and the IP-allowlist blocker |
| [benchmark-results.md](./docs/technical/benchmark-results.md) | **First real results**, the six harness defects found producing them, and their limitations |

### Business analysis (methodology — source of truth)

| Document | Contents |
|---|---|
| [00-overview.md](./docs/business-analysis/00-overview.md) | Executive summary, scope, stakeholders, requirements, capability matrix |
| [01-methodology.md](./docs/business-analysis/01-methodology.md) | Dimensions, metrics & formulas, UI/API strategy, failure taxonomy |
| [02-statistics-and-reporting.md](./docs/business-analysis/02-statistics-and-reporting.md) | Statistical strategy, reporting, security |
| [03-requirements-and-acceptance.md](./docs/business-analysis/03-requirements-and-acceptance.md) | BR-001…BR-028 with MoSCoW priorities |
| [04-risk-register.md](./docs/business-analysis/04-risk-register.md) | Risks, open questions, assumptions |
| [05-definition-of-done.md](./docs/business-analysis/05-definition-of-done.md) | Definition of Done |
| [06-technical-handoff.md](./docs/business-analysis/06-technical-handoff.md) | Technical handoff |

## Guardrails (non-negotiable)

- Latency is measured from **local SMTP acceptance** — never presented as provider-internal delivery.
- An undetected message has **no latency value**; the timeout is never substituted as an observation.
- Only **REAL** samples back published metrics; simulated samples are labelled and excluded.
- `NOT_SUPPORTED` and `BLOCKED_BY_PROVIDER` are **findings**, not failures.
- CAPTCHA/bot challenges are **never** bypassed; undocumented APIs are never used.
- No secret reaches a log, report, or artefact.

## License

See [LICENSE](./LICENSE).