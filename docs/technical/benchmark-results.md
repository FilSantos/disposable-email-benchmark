# Benchmark Results — Consolidated (API + UI)

**Runs:** `final-matrix`, `guerrilla-ui`, `yopmail-ui`, `all-flows` · **Date:** 2026-10-15 · **Framework:** 0.1.0
**Transport:** `relay` (Brevo, port 587) · **Sender:** `filipe@foodsistema.com.br`
**Channels:** API **and** UI · **Scenario:** ascii · **Validation:** normalized · **Polling:** 3 000 ms

---

## 1. Bottom line

**16/16 real samples passed** for every provider whose inbound path accepted our mail.

| Provider | Channel | Samples | Detection | Validation | Median latency | Min | Max |
|---|---|---|---|---|---|---|---|
| **Maildrop** | **API** | 4 | **4/4 (100%)** | **4/4 (100%)** | **21.7 s** | 14.8 s | 28.7 s |
| **Maildrop** | **UI** | 4 | **4/4 (100%)** | **4/4 (100%)** | **19.7 s** | 12.0 s | 28.1 s |
| **Guerrilla Mail** | **API** | 4 | **4/4 (100%)** | **4/4 (100%)** | **29.3 s** | 23.5 s | 34.5 s |
| **Guerrilla Mail** | **UI** | 4 | **4/4 (100%)** | **4/4 (100%)** | **27.4 s** | 18.9 s | 40.5 s |
| Mailinator | UI | 4 | 0/4 — **rejected by provider** | — | n/a | — | — |
| Mailinator | API | — | `CONFIGURATION_REQUIRED` (no token) | — | — | — | — |
| YOPmail | UI | 4 | 0/4 — **blocked by provider CAPTCHA** | — | n/a | — | — |
| YOPmail | API | — | `NOT_SUPPORTED` (no documented API) | — | — | — | — |
| 10 Minute Mail | — | — | `BLOCKED_BY_PROVIDER` (bot challenge) | — | — | — | — |

> **No overall winner is declared.** n = 4 per cell. See §7.

---

## 2. Clear statement of results by provider and channel

The consolidated position across **5 providers × 2 channels**:

| # | Provider | API channel | UI channel | Overall verdict |
|---|---|---|---|---|
| 1 | **Maildrop** | ✅ Measured — 4/4, median **21.7 s** | ✅ Measured — 4/4, median **19.7 s** | **Fastest overall on both channels** |
| 2 | **Guerrilla Mail** | ✅ Measured — 4/4, median **29.3 s** | ✅ Measured — 4/4, median **27.4 s** | **Measurable on both channels**; no CAPTCHA |
| 3 | **Mailinator** | 🔑 Not measured — API token required | ⛔ **Inbound mail rejected** (`500 flagged for abuse`) | **Not usable via this relay** |
| 4 | **YOPmail** | ⛔ No documented API | ⛔ **CAPTCHA blocks reading** (message delivered) | **Not automatable within policy** |
| 5 | **10 Minute Mail** | ⛔ No documented API | ⛔ Bot challenge (HTTP 403) | **Not automatable within policy** |

### Reading the table

- ✅ **Measured** — real samples, real latency.
- 🔑 `CONFIGURATION_REQUIRED` — capability exists but needs a credential we do not hold.
- ⛔ **Excluded** — a documented absence or an active provider-side block. **Not** a delivery failure, and never ranked.
- ➖ **Not tested** — deliberately out of scope (policy), pending a decision.

**2 of 5 providers are measurable on both channels** (Maildrop and Guerrilla Mail). The other
three are blocked by provider-side controls, not by our harness.

---

## 3. Performance detail

| Metric | Maildrop API | Maildrop UI | Guerrilla Mail API | Guerrilla Mail UI |
|---|---|---|---|---|
| Detection latency — median | **21.7 s** | **19.7 s** | 29.3 s | 27.4 s |
| Detection latency — mean | 21.7 s | 19.8 s | 29.2 s | 28.6 s |
| Detection latency — p90 | 26.7 s | 26.7 s | 33.5 s | 37.9 s |
| Detection latency — min / max | 14.8 / 28.7 s | 12.0 / 28.1 s | 23.5 / 34.5 s | 18.9 / 40.5 s |
| Std deviation | 4.9 s | 6.3 s | 4.1 s | 8.4 s |
| Content latency — median | 22.3 s | 19.9 s | 30.1 s | 28.1 s |
| **Content access duration — median** | **524 ms** | **211 ms** | **752 ms** | **627 ms** |
| Polls to detection (median) | 7 | 6 | 8 | 6.5 |

### Four findings that matter

1. **Content access is fast and stable.** Once a message is visible, reading it takes
   211–752 ms. **Almost all latency is delivery, not observation.** True on both channels.

2. **Maildrop is faster than Guerrilla Mail** on every statistic (median 21.7 s vs 29.3 s on API) and
   has a much lower floor (14.8 s vs 23.5 s).

3. **Maildrop's UI matched its own API** this run (19.7 s vs 21.7 s) — within noise at n = 4. Earlier
   runs showed the UI ~1.8× slower. **The two channels must not be ranked against each other**; this
   convergence is a small-sample artefact, not a finding.

4. **Guerrilla Mail's UI is slightly faster than its own API** (median 27.4 s vs 29.3 s) and adds a
   page-load step, yet stays competitive. Its UI spread is wider (σ 8.4 s vs 4.1 s), so it is less
   predictable than its API.

5. **Absolute latencies vary between runs** (Maildrop API was 5.8 s median in an earlier run, 21.7 s
   here). This is **relay/network variability**, not provider change — a key reason no winner is declared.

---

## 4. Incident 1 — Mailinator: inbound mail rejected

**Status:** Confirmed, destination-specific, reproduced · **Severity:** Medium

### 4.1 What happened

Sending from `filipe@foodsistema.com.br` through Brevo, **every** message to `@mailinator.com` was
accepted by the relay and then rejected during delivery to Mailinator's MX:

```
500 This Email is flagged for abuse. Please contact support@manybrain.com mailinator
```

The inbox stayed empty (`{"msgs":[]}`) on every attempt.

### 4.2 Why the harness saw a timeout, not an error

Brevo accepts before it knows the outcome, so the SMTP client sees success:

```
RESULT accepted: ["<inbox>@mailinator.com"]
RESULT response: 250 2.0.0 OK: queued as <...@foodsistema.com.br>
```

The rejection happens **asynchronously** during onward delivery. The Brevo panel is authoritative:

| Time | Subject | Outcome |
|---|---|---|
| 08:00 | `EBM-all-flows-mailinator-ui-3-78b51110` | Sent → **Soft bounce** |
| 08:04 | `EBM-all-flows-mailinator-ui-4-357e8a1b` | Sent → **Soft bounce** |
| 08:04 | `EBM relay check EBM-1792062245415` (Maildrop) | Sent → **Delivered** |

The same batch delivered to Maildrop and bounced at Mailinator — a clean, isolated signal.

### 4.3 Root cause

Mailinator (ManyBrain) applies aggressive inbound anti-abuse filtering. The `500 ... flagged for
abuse` indicates either the destination **inbox name** is flagged, or the **shared Brevo sending IP**
is greylisted. Because *every* Mailinator address failed while Maildrop succeeded, **relay IP
reputation** is the most probable cause.

### 4.4 Impact on the sender domain

**`foodsistema.com.br` is not globally blacklisted** — Maildrop delivered the same messages from the
same domain seconds apart. **Risk:** repeatedly retrying a hard-bouncing destination degrades Brevo
sender reputation and can trigger account suspension, so a broken destination must not be retried.

### 4.5 Framework behaviour — correct by design

| Field | Value | Why it is right |
|---|---|---|
| `failureCategory` | `MESSAGE_NOT_DETECTED` | The message never arrived |
| `attribution` | `PROVIDER` | Mailinator's MX rejected it |
| `smtpStatus` | `ACCEPTED` | Brevo genuinely accepted the message |
| `detectionLatencyMs` | `null` | **No latency fabricated for a non-detection** |

`scripts/brevo-delivery-check.ts` was added to query Brevo's event log so asynchronous bounces can be
classified (requires a Brevo **API key**, not the SMTP key).

---

## 5. Incident 2 — YOPmail: message delivered, reading blocked by CAPTCHA

**Status:** Confirmed, reproduced, persistent · **Severity:** Medium

Subtle, and worth documenting precisely — the naive reading is wrong in **both** directions.

### 5.1 What we observed

| Evidence | Reading |
|---|---|
| Brevo panel: **`Entregue`** (delivered) for all 4 samples | Delivery to YOPmail's MX **succeeded** |
| YOPmail inbox counter: **"1 mail"** | The message **is in the inbox** |
| YOPmail prompt: *"Please confirm you're human to continue"* (Cloudflare Turnstile) | Automated reading is **blocked** |
| Harness output: `MESSAGE_NOT_DETECTED` / `PROVIDER`, latency `null` | The honest observed outcome |

### 5.2 Why "delivery failed" would be wrong

Brevo reported **delivered**, and YOPmail's own counter showed **1 mail**. The message arrived.
Reporting this as a delivery failure would have been a **false claim**.

### 5.3 Why "automation works" would also be wrong

Feasibility was initially proven: an early probe read a full message
(`ifinbox` list → `ifmail` body; 8/8 consecutive polls succeeded; a delivered message rendered
end to end). But after sustained automated access, YOPmail began presenting a **Cloudflare Turnstile**
challenge that **persists across reloads**, and the inbox now reads empty to any automated client.

**A successful first attempt is not evidence that automation is viable.** That is the lesson.

### 5.4 What the framework did

- **Did not defeat the CAPTCHA** (prohibited by the methodology, BR-008).
- Classified the outcome as `MESSAGE_NOT_DETECTED` / `PROVIDER` with `detectionLatencyMs: null` —
  correct for what was *observable*.
- Updated the capability matrix to **`BLOCKED_BY_PROVIDER`** (observed, evidence recorded), because
  automated reading is prevented by the provider.
- Kept the adapter **opt-in** (`--yopmail-ui=true`) so it is never run by default.

### 5.5 Reproduce the classification

```bash
npx tsx scripts/ui-yopmail-debug.ts <inbox>   # counter + challenge text + screenshot
```

The script writes a screenshot showing the delivered-message counter **and** the Turnstile challenge
together — the clearest possible evidence of this failure mode.

---

## 5b. Guerrilla Mail UI — evaluated successfully

**Status:** ✅ Feasible and measured · **Result:** 4/4 detection and validation

Guerrilla Mail's UI was previously `NOT_TESTED` because its Terms of Service prohibits *over-use*.
On inspection that clause forbids **"repeatedly making many requests"**, not automation, and the site
has **no CAPTCHA**.

### 5b.1 Evidence of feasibility

| Check | Result |
|---|---|
| CAPTCHA / bot challenge | **None** (no Cloudflare Turnstile, unlike YOPmail) |
| Automation hooks | `#inbox-id`, `#email_table` (`td1`…`td4`), `#display_email` |
| Delivery via relay | ✅ accepted and delivered |
| Detection + content read | ✅ verified end to end |

### 5b.2 ToS position

| ToS clause | Our behaviour |
|---|---|
| "Over-use our resources by repeatedly making many requests" | Polling is **rate-limited** (the same limiter as the API channel) and reads only; a poll every few seconds is comparable to a person checking their inbox |
| "Reverse engineer, circumvent or attack our website" | We circumvent **nothing** — no challenge to defeat, no private endpoints |
| "Use of our service for purposes other than intended" | Reading a received message is the intended purpose of a disposable inbox |

**Conclusion:** compliant with a conservative interpretation. Unlike YOPmail (active CAPTCHA) and
10 Minute Mail (bot challenge), there is **no provider-side barrier** here.

### 5b.3 Results (n = 4, UI channel)

| Metric | Guerrilla Mail UI |
|---|---|
| Detection | **4/4 (100%)**, CI95 = 51–100% |
| Validation | **4/4 (100%)** |
| Detection latency — median | **27.4 s** |
| Detection latency — min / max | 18.9 / 40.5 s |
| Std deviation | 8.4 s |
| Content access duration — median | **627 ms** |

### 5b.4 Harness defects found and fixed while evaluating this channel

Producing these results exposed **three** of my own bugs. Each would have produced a **false provider
failure** — the same class of error as the Mailinator/YOPmail cases, but self-inflicted.

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | `SUBJECT_MISMATCH` | `td.td3` contains **both** the subject anchor *and* a `span.email-excerpt` body preview; reading the cell pulled the body into the subject | Read `td.td3 a.masked_links` |
| 2 | `MESSAGE_CONTENT_UNAVAILABLE` | A fixed 1.5 s sleep after clicking raced the message render | Poll `#display_email` until it has content (20 s budget) |
| 3 | `MESSAGE_CONTENT_UNAVAILABLE` on later samples | Opening a message **hides `#email_table`**, so subsequent row clicks failed with *"element is not visible"* | `returnToInbox()` restores the inbox before each poll |

**Lesson:** a first sample passing is not proof the adapter works. Bug 3 only appeared from the
**second** sample onward — which is exactly why sequential runs matter.

---

## 6. Provider alternatives evaluation for QA testing

| Feature | **Guerrilla Mail** | **Maildrop** | **YOPmail** | *Mailinator* |
|---|---|---|---|---|
| Core functionality | Disposable public inbox | Disposable public inbox | Disposable public inbox | Disposable + paid QA tiers |
| Inbox lifespan | **60 min**, then deleted | Persistent name; logs wiped after inactivity | 8 days | Hours (public) / persistent (paid) |
| Inbound filtering | **Permissive** | **Aggressive** anti-spam; drops bulk relay traffic | Accepts, but challenges the reader | **Aggressive**; rejected our relay |
| API | Documented JSON, **no key** | Documented GraphQL, **no auth** | **None** | REST, token required |
| UI automation | ✅ **Works** (no CAPTCHA) | ✅ **Works** | ⛔ **CAPTCHA-blocked** | ⛔ Challenge + rejected mail |
| Measured median (API) | 29.3 s | **21.7 s** | not measurable | not measurable |
| Measured median (UI) | ✅ **27.4 s** | ✅ **19.7 s** | not measurable | not measurable |
| Detection (API / UI) | 4/4 / 4/4 | 4/4 / 4/4 | 0/4 (blocked) | 0/4 (rejected) |

### 6.1 Recommendation

- **Lowest latency:** **Maildrop** — fastest on **both** channels (21.7 s API / 19.7 s UI).
- **Most permissive inbound, and dual-channel:** **Guerrilla Mail** — accepts automated transactional
  mail where Maildrop's filters may drop it, and its UI is automatable (no CAPTCHA). Slower and more
  variable than Maildrop, and its 60-minute retention limits re-reading.
- **Avoid for automation:** **Mailinator** (relay rejection) and **YOPmail** (CAPTCHA) until resolved
  with each provider.
- **Do not choose on latency alone.** Only 2 of 5 providers were measurable on both channels — the
  binding constraint is *access*, not speed.

### 6.2 Best practice for staging environments

**Move automated system testing off public disposable inboxes.** They are **shared, publicly
readable, uncontrollable, and subject to third-party abuse** — precisely what caused both incidents:
Mailinator failed because of infrastructure reputation we do not own, and YOPmail blocked us with a
challenge we must not defeat.

| Tool | Why |
|---|---|
| **MailHog** | Local; zero external dependencies; deterministic; no reputation or CAPTCHA risk |
| **Mailtrap** | Isolated sandbox inboxes designed for QA/staging traffic |
| **A project-owned domain** | Full control of SPF/DKIM/DMARC and reputation |

Isolating QA traffic **removes blacklisting risk and CAPTCHA barriers entirely**, and eliminates the
network variability that dominates every latency figure here.

---

## 7. Limitations — read before quoting any number

1. **n = 4 per cell.** Wilson 95% CI on each detection rate spans roughly **40–100%**. **No difference
   between providers is statistically distinguishable**, and **no winner is declared**.
2. **Latency is from local SMTP acceptance**, not the provider's internal delivery time.
3. **Polling quantises latency** to the 3 000 ms interval; true values are up to one interval lower.
4. **UI and API must not be ranked against each other** — the UI path adds browser navigation.
5. **Absolute latencies vary substantially between runs** (Maildrop API: 5.8 s → 21.7 s across runs).
   This is relay/network variability. **Do not compare numbers across runs without noting this.**
6. **One execution window, one geographic location.**
7. **Mailinator and YOPmail results are access failures, not performance measurements.** They are
   excluded from comparisons rather than ranked last.
8. **Retention differs** (Guerrilla 1 h, YOPmail 8 d, Maildrop 24 h+). Irrelevant to latency, material
   to operational choice.

---

## 8. Reproduce

```bash
# .env: EBM_TRANSPORT=relay, EBM_RELAY_*, EBM_SEND_FROM=<verified sender>
npm run bench -- --providers=maildrop,guerrillamail --samples=4 --channel=API,UI \
  --maildrop-mailbox=ebm-md-<stamp> --out=runs --label=final-matrix

# Guerrilla Mail UI only
npm run bench -- --providers=guerrillamail --samples=4 --channel=UI \
  --out=runs --label=guerrilla-ui

# YOPmail UI is opt-in (feasibility proven, but CAPTCHA-blocked)
npm run bench -- --providers=yopmail --samples=4 --channel=UI \
  --yopmail-ui=true --yopmail-inbox=ebm-yop-<stamp> --out=runs --label=yopmail-ui

npm run report -- --in=runs/benchmark-final-matrix.json
BREVO_API_KEY=xxx npx tsx scripts/brevo-delivery-check.ts   # classify async bounces
```

---

## 9. What a defensible conclusion needs

| Action | Effect |
|---|---|
| ≥ 30 samples per cell, ≥ 3 runs | Narrows the CI to roughly ±15 points |
| Spread runs across ≥ 2 time windows | Surfaces relay and provider load patterns |
| Separate cold vs. warm cohorts | Isolates greylisting from steady-state latency |
| Mailinator API token, or appeal the abuse flag | Adds a third measurable provider |
| Migrate to a sandbox (MailHog/Mailtrap) | Removes reputation, CAPTCHA and network variability |
