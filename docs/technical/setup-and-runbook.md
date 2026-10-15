# Setup, Execution & CI/CD Guide

**Project:** Email Provider Benchmark Framework · **Date:** 2026-10-14

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 20–22** (22 LTS recommended) | `package.json` `engines` allows `>=20 <24`. Node 23 works locally but is not an LTS line; CI pins 22. |
| npm 10+ | Uses `legacy-peer-deps` via `.npmrc` (see §6). |
| No provider credentials | Required only for the API channel of credentialed providers. |
| Outbound **port 25** | Required only for real external delivery. **Blocked in many networks (including the discovery environment)** — see §5. |

## 2. Install

```bash
npm ci            # reproducible install from the lockfile
npm run typecheck # TypeScript strict, no emit
npm run lint
npm test          # 107 unit + integration tests, no network, no credentials
```

All three commands must pass. They require no credentials and no outbound SMTP.

## 3. Configuration

```bash
cp .env.example .env
```

Every setting is documented in [`.env.example`](../../.env.example). The critical ones:

| Variable | Default | Meaning |
|---|---|---|
| `EBM_TRANSPORT` | `loopback` | `loopback` \| `direct-mx` \| `relay` |
| `EBM_SMTP_HOST` / `EBM_SMTP_PORT` | `127.0.0.1` / `2525` | Local SMTP bind. **Loopback only** — a public address is rejected at startup. |
| `EBM_DETECTION_TIMEOUT_MS` | `180000` | Per-sample detection timeout (the observed-timeout value is never used as a latency) |
| `EBM_POLL_INTERVAL_MS` | `2000` | Poll cadence. Detection latency cannot be finer than this. |
| `EBM_SAMPLES_PER_PROVIDER` | `3` | Samples per provider per channel |
| `EBM_MAILINATOR_TOKEN` | *(empty)* | Required for the Mailinator API channel |
| `EBM_RELAY_*` | *(empty)* | Required when `EBM_TRANSPORT=relay` |

**Never commit `.env`.** It is gitignored; only `.env.example` is tracked.

## 4. Running the benchmark

```bash
# Capability matrix (text)
npm run capabilities
npm run capabilities -- --json

# A run (defaults: loopback transport, API channel, 3 samples/provider)
npm run bench

# Explicit, small, safe run
npm run bench -- --providers=maildrop,guerrillamail --samples=2 --scenario=ascii --channel=API --out=runs --label=my-run

# Regenerate HTML + CSV from a stored JSON report (single source of truth)
npm run report -- --in=runs/benchmark-my-run.json
```

### CLI flags

| Flag | Values | Default |
|---|---|---|
| `--providers` | comma-separated ids | all registered |
| `--samples` | integer | `EBM_SAMPLES_PER_PROVIDER` |
| `--scenario` | `ascii` \| `utf8` \| `long` \| `html` | `ascii` |
| `--channel` | `API` \| `UI` (comma-separated) | `API` |
| `--out` | directory | `runs` |
| `--label` | run id / filename suffix | generated |

### Outputs

| File | Content |
|---|---|
| `runs/benchmark-<label>.json` | **Source of truth.** Manifest, capability snapshot, per-sample records, aggregates |
| `runs/benchmark-<label>.html` | Executive + technical report |
| `runs/benchmark-<label>-samples.csv` | Flat sample table for spreadsheets |

`runs/` is gitignored — artefacts may contain provider responses.

## 4b. UI channel

Playwright is required only for `--channel=UI`:

```bash
npx playwright install chromium        # once
npm run bench -- --providers=maildrop --samples=3 --channel=UI --out=runs --label=real-ui
EBM_E2E=1 npx playwright test          # opt-in UI test against the live site
```

Implemented for **Maildrop** only. Its selectors were derived from the live DOM (2026-10-15):

| Element | Selector |
|---|---|
| Inbox URL | `https://maildrop.cc/inbox/?mailbox=<name>` |
| Message row | `div.message` |
| Subject cell | `div.truncate:not(.font-bold):not(.text-sm)` |
| Message body | `<iframe>` (read after clicking the row) |

**Browsers are released in a `finally` block**, so a failed run cannot leave an orphaned Chromium
process. Verify with `pgrep -fl chromium` after a run.

**Do not compare UI latency with API latency.** The UI path includes page navigation and rendering;
the API path does not.

## 5. Transport modes — read this before interpreting results

| Mode | What it proves | Availability |
|---|---|---|
| **`loopback`** | The harness works end to end. **No external delivery occurs.** | Always |
| **`direct-mx`** | The provider MX accepted the message on port 25 | Only where port 25 egress is permitted |
| **`relay`** | An authenticated relay accepted the message for onward delivery | Requires relay credentials |

> **Port 25 was blocked in the discovery environment** (every MX timed out; 587/443 open). Under
> `loopback`, a non-detection is attributed to **`HARNESS`**, never to the provider — the message
> never left the machine. Do not present loopback runs as provider reliability evidence.

The mode is recorded on every sample and in the report header.

## 6. npm install note

`.npmrc` sets `legacy-peer-deps=true`. npm 10.9.x crashes resolving vitest's large optional peer set
(`Cannot read properties of null (reading 'edgesOut')`). This is an npm resolver bug, not a package
problem; the lockfile still pins the full tree. Remove the setting once npm resolves correctly.

## 7. Interpreting the report

1. **Check the transport mode first.** `loopback` results are harness evidence only.
2. **Read the sample-origin banner.** Only `REAL` samples back the metrics.
3. **Never read latency without the detection rate.** A provider that fails often looks fast if
   failures are dropped.
4. **Detection latency ≥ the polling interval.** It cannot be finer than the poll gap.
5. **Percentages show their fraction** (numerator/denominator). P99 is withheld below n = 100.
6. **`NOT_SUPPORTED` / `BLOCKED_BY_PROVIDER` are findings**, not failures.
7. **Confidence intervals matter more than point estimates** at our sample sizes.

## 8. Adding a provider

1. Add a `ProviderCapabilityEntry` to [`src/providers/capabilities.ts`](../../src/providers/capabilities.ts) with **source URLs** for every `DOCUMENTED` claim.
2. Implement an adapter that satisfies `ApiChannel` and/or `UiChannel` (`src/domain/types.ts`).
   Do **not** create an empty adapter for a capability the provider lacks.
3. Register it in [`src/providers/registry.ts`](../../src/providers/registry.ts) with its executable channels.
4. Add a capability-integrity expectation to `tests/unit/capabilities.test.ts`.
5. If the provider has a published rate limit, add it to `RATE_LIMITS`.

## 9. CI/CD

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) has two jobs:

| Job | Trigger | Credentials | What it does |
|---|---|---|---|
| `verify` | every push / PR | none | typecheck, lint, deterministic tests, reporting smoke run, secret scan, artefact upload |
| `real-provider-run` | **manual**, and only when `vars.ENABLE_REAL_RUN == 'true'` | relay + Mailinator secrets | live provider run; artefacts retained 14 days |

The deterministic job must never require secrets; that property is what keeps the suite green on forks.

## 10. Data retention & cleanup

| Artefact | Retention | Cleanup |
|---|---|---|
| `runs/*.json`, `*.csv`, `*.html` | per policy (recommend 30 days) | delete the `runs/` directory |
| Playwright traces/screenshots | per policy (recommend 30 days) | `reports/playwright-artifacts/` |
| Local SMTP server | process lifetime only | stopped in `finally`, even on failure |
| Provider-side messages | provider-controlled | delete where the API allows (e.g. Maildrop `delete`) |

Always confirm no credential leaked before archiving: `grep -rInE 'EBM_.*=' runs/` must be empty.
