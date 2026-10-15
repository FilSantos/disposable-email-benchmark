# Known Limitations & Unresolved Issues

**Project:** Email Provider Benchmark Framework · **Date:** 2026-10-14

Honest inventory of what this framework does not do, cannot do here, or has not yet proved.
Nothing below is a surprise to a reader of the reports; the reports state the same caveats.

---

## 1. Blocking limitations (no external delivery in this environment)

### L-01 — Outbound SMTP port 25 is blocked 🔴 → **WORKAROUND FOUND**
**Evidence:** every provider MX timed out on port 25; ports 587/443 succeeded (discovery report §4).
**Mitigation:** an authenticated **Brevo relay on port 587 is reachable and its credential is valid**
(verified 2026-10-14). Relay transport is therefore implemented and functional.
**Remaining blocker:** Brevo enforces an **IP allowlist**; this machine's egress IP is not on it
(`525 5.7.1 Unauthorized IP address`). A control test with a wrong password returned a *different*
code (`535`), proving the credential is correct and the sole blocker is the allowlist.
See [relay-findings.md](./relay-findings.md) for the exact IPs to authorise.

### L-02 — No real end-to-end provider delivery has been executed 🔴
**Consequence:** no benchmark result, ranking, or reliability figure can be published from this work.
**What *is* proved:** the test suite (114 tests) and a live probe against Maildrop and Guerrilla Mail
confirm the adapters reach the real APIs and poll correctly; the relay credential authenticates.
**This is reported, not worked around.**

## 2. Deliberately absent functionality

### L-03 — UI implemented for Maildrop and Mailinator 🟡
Both documented `SUPPORTED` UI channels are implemented. Maildrop UI measured 4/4; Mailinator UI
executed but **its inbound mail was rejected by the provider** (see L-02a), so no latency was measured.
Guerrilla Mail UI is also implemented and measured (4/4) — it has no CAPTCHA and its ToS restricts
over-use rather than automation. YOPmail and 10 Minute Mail have no usable UI automation.

### L-02a — Brevo→Mailinator delivery is blocked by an abuse flag 🔴
Mailinator's MX rejects our relay traffic with `500 This Email is flagged for abuse... mailinator`.
Brevo accepts the message (`250 queued`) and reports the bounce **asynchronously**, so an SMTP-only
harness sees a timeout. Maildrop delivers the same messages from the same sender.
**Impact:** Mailinator cannot be measured over this relay. **Sender domain is not blacklisted** — the
block is destination-specific. See [benchmark-results.md §4](./benchmark-results.md#4-incident-1--mailinator-inbound-mail-rejected).

### L-04 — YOPmail: message delivered, reading blocked by CAPTCHA 🔴
No official API exists. A UI adapter was built and feasibility was **initially proven** (a delivered
message rendered end to end). After sustained automated access, YOPmail presented a **Cloudflare
Turnstile** challenge that persists — Brevo reports `Entregue` (delivered) and YOPmail's counter shows
"1 mail", yet the inbox is unreadable to an automated client.
Recorded as `BLOCKED_BY_PROVIDER` (observed). The challenge is **not** defeated. The adapter is
opt-in. See [benchmark-results.md §5](./benchmark-results.md#5-incident-2--yopmail-message-delivered-reading-blocked-by-captcha).

### L-05 — 10 Minute Mail is not automatable within policy 🟡
An active Cloudflare challenge returned HTTP 403 to non-browser clients. Recorded as
`BLOCKED_BY_PROVIDER` and **not circumvented**. It will never appear in a comparative denominator.

### L-06 — Mailinator API is unexercised 🟠
The adapter is implemented and capability-correct, but requires an API token (**DQ-2**). Without it, the
provider has no executable channel: `CONFIGURATION_REQUIRED`, not a failure.

## 3. Methodological limitations (must accompany any result)

### L-07 — Latency is from local SMTP acceptance, not provider delivery
Stated in every report. It is an observed end-to-end time, not the provider's internal timestamp.

### L-08 — Detection latency is quantised by the polling interval
At the default 2000 ms cadence, latency cannot be measured finer than the poll gap. The interval is
published with every latency figure.

### L-09 — Sample sizes are small
n = 1–3 per provider in this phase. Wilson intervals are correspondingly wide, and P99 is withheld.
Differences under ~10–15 percentage points are not statistically distinguishable.

### L-10 — Loopback runs are not provider evidence
They exercise the harness. They say nothing about a provider's reliability.

### L-11 — Single execution host/region
Results are valid only for this network location; no geographic comparison is implemented (BR-027).

### L-12 — Greylisting is not yet modelled in the sample plan
Maildrop greylists first contact from a new sender. The framework will record the resulting delay, but
the run plan does not yet separate a "cold" cohort from a "warm" one.

## 4. Implementation limitations

### L-13 — HTML sanitization is surfaced, not normalised
Guerrilla Mail sanitizes HTML. The adapter returns `htmlBody: null` and the raw text rather than
pretending sanitized HTML is faithful. A consumer expecting HTML parity will see a difference.

### L-14 — `Connection: close` costs connection reuse
Chosen deliberately after observing a ~270 s stall on a reused undici socket against
`api.maildrop.cc`. It is correct but slightly less efficient; revisit if the upstream issue is fixed.

### L-15 — Evidence retention is suggested, not enforced
`runs/` and `reports/` are gitignored with a documented 30-day recommendation. Nothing deletes them
automatically.

### L-16 — npm resolver workaround
`.npmrc` sets `legacy-peer-deps=true` because npm 10.9.x crashes on vitest's optional peer set.

## 5. Unresolved questions (carried from discovery)

| ID | Question | Blocks | Owner |
|---|---|---|---|
| DQ-1 | **Relay credential supplied** — awaiting IP allowlisting in the Brevo console | All real runs | QA Manager (console access) |
| DQ-2 | Is a Mailinator token approved (free Verified Pro or paid)? | Mailinator API | QA Manager / Procurement |
| DQ-3 | Confirm the CI Node LTS pin (recommend 22) | CI config | Engineering |
| DQ-4 | Evidence retention period | Cleanup policy | Security |
| DQ-5 | YOPmail automation — **resolved by observation: blocked by CAPTCHA** | — | Closed |
| DQ-7 | Request the Mailinator abuse flag be cleared (`support@manybrain.com`)? | Mailinator measurement | QA Manager |
| DQ-6 | Implement Mailinator UI automation (documented `SUPPORTED`)? | Mailinator UI comparison | QA Engineering |
| Q-03 | Mailinator HTTP request-rate limits (unpublished) | Mailinator throughput | QA Engineering |
| Q-04 | Exact Mailinator public-inbox TTL ("a few hours") | Retention modelling | QA Engineering |
| Q-08 | Guerrilla Mail rate limits (explicitly unpublished) | Throughput | QA Engineering |
| Q-15 | Budget approval for a paid tier | Mailinator depth | QA Manager |

## 6. What would change the conclusions

1. **A relay credential** → real end-to-end samples become possible; all latency/reliability metrics
   become publishable.
1b. **The egress IP is allowlisted in Brevo** → no code change; real samples begin immediately.
2. **A larger sample (n ≥ 30–50, ≥ 3 runs)** → confidence intervals narrow; segment winners become
   defensible. Until then, **no winner is declared**.
3. **UI adapters** → the UI channel becomes comparable to the API channel, on separate axes.
4. **A YOPmail policy decision** → either UI automation is permitted (and tested) or it stays excluded.
