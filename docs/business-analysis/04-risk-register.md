# 04 — Risk Register, Open Questions & Assumptions

**Parent:** [00-overview.md](./00-overview.md) · **Status:** Draft for QA Manager review · **Date:** 2026-10-14

---

## 1. Risk Register

Likelihood (L) and Impact (I): **Low / Medium / High**. Exposure = L×I. Every risk has a mitigation and a **residual risk** after mitigation.

| ID | Risk | L | I | Mitigation | Residual |
|---|---|---|---|---|---|
| R-01 | **External SMTP delivery restrictions** — egress blocked, port 25 blocked, provider MX rejects our sender, IP not warmed/blacklisted | Med | High | Test egress in Phase 0; use provider-accepted headers; allow Message-ID/SPF alignment; document failures as environment, not provider | Med — some provider MX may still reject; benchmark may be partial |
| R-02 | **Unsupported APIs** — providers lack documented APIs (YOPmail, 10 Minute Mail) | High | Med | Treat as `NOT_SUPPORTED`; exclude from API denominators; report as a capability finding | Low — already handled by design |
| R-03 | **Provider terms & automation restrictions** — ToS prohibits automated or high-volume access | Med | High | Read ToS; honour rate limits; no flooding (Guerrilla Mail explicit); no CAPTCHA bypass | Med — YOPmail/Maildrop ToS wording unclear **[OPEN]** |
| R-04 | **Public inbox interference** — other parties' mail in the same inbox; wrong-message matches | High | Med | Unique correlation IDs; unique mailbox names; per-inbox verification | Low — unique IDs mitigate strongly |
| R-05 | **Message expiration** — message expires before read (Guerrilla 1h, 10MM 10m) | Med | Med | Read promptly; classify expiry-caused misses (`MESSAGE_NOT_DETECTED`) explicitly; retention-aware scheduling | Low |
| R-06 | **Rate limiting** — self-inflicted or provider-imposed 429 | Med | Med | Serial execution; exponential back-off; honour published limits; log self-inflicted 429 as harness defect | Low–Med — unpublished limits (Guerrilla, Mailinator HTTP) **[OPEN]** |
| R-07 | **UI changes** — selectors break mid-benchmark | High | Med | Resilient selectors; screenshots/traces on failure; re-run affected cohort; version-capability snapshot | Med — inherent to UI automation |
| R-08 | **Network variability** — latency noise unrelated to the provider | High | Med | Single stable network; record RTT baseline; report dispersion; repeat across windows | Med — cannot fully isolate |
| R-09 | **Inconsistent polling** — poll interval drift distorts latency | Med | High | Fixed 2 s interval; measure actual interval; report it with latency; abort run on drift | Low |
| R-10 | **Insufficient sample size** — wide CIs; weak conclusions | Med | Med | n=30 pilot → n=50 confirmatory; targeted n≥100 for close decisions; publish n everywhere | Med — small differences undecidable |
| R-11 | **Caching effects** — first read warms a cache; observation order biases results | Med | Med | Independent UI/API samples; randomized-then-fixed order; warm-up documented or excluded pre-run | Low |
| R-12 | **Misleading statistical comparisons** — latency-only rankings; unknown denominators | Med | High | Mandatory detection-rate-adjacent reporting; denominators required; winner rules ([02 §5](./02-statistics-and-reporting.md#5-declaring-a-winner)) | Low — enforced by report checklist |
| R-13 | **Missing credentials** — no Mailinator token / plan | Med | Med | Config-driven; missing secret ⇒ `CONFIGURATION_ERROR`; obtain Verified Pro/paid before run | Low — Mailinator API path may be `NOT_TESTED` if unfunded |
| R-14 | **CI/CD environmental differences** — headless vs headed; CI egress; browser version | Med | Med | Headless-first design; CI egress test; pin browser version; report environment metadata | Med — CI policies vary |
| R-15 | **Bot challenges / CAPTCHA** (10 Minute Mail Cloudflare 403) | High | High | **Do not circumvent**; report `BLOCKED_BY_PROVIDER`; attempt only policy-permitted access | High — 10MM may be unevaluable; documented as a finding |
| R-16 | **Provider behavior drift** — capability change between runs | Med | Med | Re-verify capability matrix per run; snapshot in manifest; flag changes | Low |
| R-17 | **Greylisting** (Maildrop, ~15 min first-send delay) | Med | Med | Separate labelled cohort; extended timeout; do not treat as provider failure | Low |
| R-18 | **Secret leakage into artifacts** | Low | High | Redaction by default; automated secret-scan of logs/reports/artifacts; retention limits | Low |
| R-19 | **Misclassification of our own defects as provider failures** | Med | High | Attribution decision tree; failure-injection tests; reviewer sign-off on failure classes | Low–Med |
| R-20 | **Over-fitting conclusions to one run/window** | Med | High | ≥3 runs, ≥2 windows; run-level consistency reported; no single-run winners | Low |

---

## 2. Open Questions

Resolve in **Phase 0 (capability verification spike)** before the full benchmark. Each has an owner and a resolution method.

| ID | Open question | Resolution method | Owner |
|---|---|---|---|
| Q-01 | Is outbound SMTP (port 25/587) permitted from the run environment to provider MX hosts? | Egress test | Infrastructure |
| Q-02 | Does Mailinator expose a **free Verified Pro** token capable of reading **public** `@mailinator.com` inboxes via API? | Hands-on with a token | QA Eng |
| Q-03 | What are Mailinator's **HTTP request-rate** limits? (only email quotas published) | Empirical probe within policy | QA Eng |
| Q-04 | What is the exact **Mailinator public-inbox TTL**? ("a few hours"/"several hours") | Empirical measurement | QA Eng |
| Q-05 | Does **YOPmail** have any official or semi-official API? | Docs search + XHR inspection | QA Eng |
| Q-06 | Are YOPmail subject/body/metadata **programmatically retrievable** at all? | Hands-on XHR capture | QA Eng |
| Q-07 | Does YOPmail have a **ToS** and does it prohibit automation? (only `robots.txt Disallow: /*?` found) | Legal/docs review | Legal + QA |
| Q-08 | What rate limits apply to **Guerrilla Mail**? (explicitly unpublished) | Conservative probing; monitor for blocks | QA Eng |
| Q-09 | Does Guerrilla Mail `fetch_email` return **raw MIME** or only sanitized HTML? | Hands-on | QA Eng |
| Q-10 | Does **10 Minute Mail** have *any* official API or accessible ToS? | Docs/archive search | QA Eng |
| Q-11 | Is **automated access** to 10 Minute Mail permitted at all (Cloudflare challenge)? | Policy review; if unclear, do not automate | Legal + QA |
| Q-12 | Are `10minutemail.com` and `10minutemail.net` the same service with the same behavior? | Hands-on comparison | QA Eng |
| Q-13 | Does **Maildrop** have a ToS prohibiting automation? (only a Privacy Policy found) | Legal review | Legal |
| Q-14 | What is the real-world **Maildrop greylisting** delay, and does it apply per sender IP? | Empirical (first vs. warmed send) | QA Eng |
| Q-15 | Is a **paid tier** budget acceptable if it changes conclusions (e.g., Mailinator Business)? | Stakeholder decision | QA Manager |
| Q-16 | What **secret store** will CI use for provider credentials? | Platform decision | Infrastructure |
| Q-17 | What is the acceptable **evidence retention** period? | Security policy | Security |
| Q-18 | Is a single execution region sufficient, or is multi-region required? | Stakeholder decision | QA Manager |
| Q-19 | Should providers run sequentially or in parallel? | Design decision (recommend sequential) | QA Eng |
| Q-20 | What concurrency level is acceptable without ToS risk? | Policy + testing | Legal + QA |

---

## 3. Assumptions Register

| ID | Assumption | Rationale | Impact if wrong |
|---|---|---|---|
| A-01 | Outbound SMTP to provider MX is permitted | Required for the sending model | Benchmark blocked; pivot to provider-side injection |
| A-02 | A paid/verified Mailinator tier is acceptable if justified | Needed for full API coverage | Mailinator API path becomes `NOT_TESTED` |
| A-03 | Public inboxes are acceptable for **synthetic, non-confidential** data only | Matches provider design | Security veto; redesign |
| A-04 | Provider UIs remain stable over the benchmark window | Necessity for UI automation | Higher `UI_AUTOMATION_FAILED`; re-runs |
| A-05 | The run network is representative of CI | Latency must be actionable | Results not CI-representative |
| A-06 | 30–50 samples/provider/mode is an acceptable initial size | Feasible within free tiers | Wide CIs; weak conclusions |
| A-07 | A single execution host/region is acceptable | Scope control | Results valid for one region only |
| A-08 | CAPTCHA/bot challenges are documented, not circumvented | Policy compliance | Some providers partially unevaluable (expected) |
| A-09 | Synthetic content is sufficient to exercise validation | No real data allowed | Reduced realism; acceptable |
| A-10 | Providers accept mail from an unauthenticated local SMTP relay for benchmark purposes | Common for disposable providers | Some MX reject; `SMTP_SEND_FAILED` cohort grows |
| A-11 | Playwright headless is sufficient for the UI paths that are not blocked | CI suitability | Headed mode or manual step needed |
| A-12 | The five-provider list is fixed for this release | Prompt scope | Scope creep |

---

## 4. Risk Review Cadence

- **Before Phase 0:** confirm A-01, A-03, A-08 with stakeholders.
- **Before each run:** re-verify capability matrix (BR-019); re-check ToS for changes; confirm credentials.
- **After each run:** review new risks and failure classifications; update the register.
- **Before final report:** ensure all residual risks are documented in the executive report's risk section.

---

*Next: [05-definition-of-done.md](./05-definition-of-done.md).*
