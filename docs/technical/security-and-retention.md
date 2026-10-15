# Security, Responsible Use & Data Retention

**Project:** Email Provider Benchmark Framework · **Date:** 2026-10-14

---

## 1. Data policy

| Rule | Implementation |
|---|---|
| **Synthetic data only** | `smtp/message.ts` generates fixed synthetic content; there is no code path that ingests real data. |
| **No confidential data in public inboxes** | Every benchmarked provider's inbox is publicly readable. The generator emits only synthetic strings and a UUID — never PII, tokens, or credentials. |
| **No real credentials in messages** | The generator has no access to secrets; it takes only an address and a scenario name. |

## 2. Credential handling

| Control | Where |
|---|---|
| **Environment/secret store only** | `config/config.ts` reads `EBM_*` from `process.env`; the repo has no credential file. |
| **`.env` never committed** | `.gitignore` excludes `.env` and `.env.*`; only `.env.example` is tracked. |
| **Registered for redaction immediately** | `loadConfig` calls `registerSecret()` for the relay password/user and the Mailinator token at startup. |
| **Missing secret is a configuration error** | A credentialed provider with no credential yields `CONFIGURATION_ERROR` attributed to `HARNESS` — never a provider failure, and never a mocked substitute. |

## 3. Redaction boundary

Every string that reaches a log, a JSON report, a CSV cell or an HTML page passes through
`observability/redact.ts`:

- all registered secret values are replaced with `[REDACTED]` (literal match, regex-escaped);
- defensive patterns cover `Authorization:` headers, `X-Api-Key:`, `token=` query parameters, and
  `PHPSESSID=` cookies — these are redacted even if never registered.

The JSON writer uses a `stringify` replacer; the CSV writer redacts inside `csvCell`; the logger
redacts every message and field. A unit test asserts that a registered secret never appears on stdout.

## 4. Prohibited actions (enforced by design, not convention)

| Prohibition | How the code respects it |
|---|---|
| No CAPTCHA / bot-challenge bypass | There is no bypass code. 10 Minute Mail is recorded `BLOCKED_BY_PROVIDER` and given no executable channel. |
| No undocumented/private APIs | Only the documented endpoints (Maildrop GraphQL, Guerrilla Mail JSON, Mailinator REST v2) are called. YOPmail and 10 Minute Mail have no adapter. |
| No authentication circumvention | The Mailinator adapter reports `CONFIGURATION_ERROR` on 401/403 rather than retrying or working around it. |
| No rate-limit evasion | `rate-limit.ts` refuses to exceed a published limit; 429 triggers exponential back-off, then reports exhaustion. Self-inflicted throttling is a harness defect. |
| No public exposure of the SMTP server | `assertLoopbackBind` rejects any bind address that is not `127.0.0.1`, `localhost` or `::1`. |
| No fabricated capability or result | Missing integrations are capability states; non-detected messages have `null` latency; `SIMULATED` samples are excluded from headline metrics. |

## 5. Terms-of-service alignment

| Provider | Documented restriction | Our behaviour |
|---|---|---|
| **Mailinator** | ToS prohibits overburdening servers; API use is sanctioned | Token-gated; conservative limiter (10 req/10 s default) |
| **Guerrilla Mail** | ToS explicitly prohibits over-use / repeated requests | Conservative limiter (5 req/10 s); `sid_token` reuse; no flooding |
| **Maildrop** | Published limit: 50 queries / 10 s | Limiter honours it exactly |

Rate limits that a provider has not published are handled with conservative defaults, because an
unpublished limit is not a licence to hammer.

## 6. Network behaviour

The framework **never** falls back silently between transports. If the configured mode fails, the
sample is recorded as a classified transport failure. Direct-MX and relay results are never merged
unlabelled, and local SMTP acceptance is never reported as external delivery.

## 7. Data retention & cleanup

| Data | Default | Where configured |
|---|---|---|
| Sample JSON / CSV / HTML | suggested 30 days | delete `runs/` |
| Playwright traces & screenshots | suggested 30 days | delete `reports/playwright-artifacts/` |
| CI artefacts | 7 days (smoke) / 14 days (real run) | `.github/workflows/ci.yml` `retention-days` |
| Local SMTP server | process lifetime | stopped in `finally` |
| Provider-side messages | provider-controlled | delete via API where supported |

**Before archiving any run**, confirm no credential leaked:

```bash
grep -rInE 'EBM_(MAILINATOR_TOKEN|RELAY_PASS)=[^[:space:]]+' runs/ && echo LEAK || echo clean
```

This exact check runs in CI and fails the build if it matches.

## 8. Residual risks

| Risk | Residual | Note |
|---|---|---|
| Public inboxes are readable by anyone | Accepted | Synthetic data only, by policy. |
| Provider behaviour/ToS can change | Medium | Capability matrix carries `verifiedAt`; re-verify per run (BR-019). |
| Unpublished rate limits | Low–Medium | Conservative defaults + back-off. |
| Relay credential compromise | Low | Secrets never logged or committed; scope to a dedicated sending identity. |
| A future contributor adds a bypass | Low | The methodology and tests document the prohibitions, but this is a review concern. |
