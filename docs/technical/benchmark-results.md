# Benchmark Results — Real Runs

**Date:** 2026-10-15 · **Transport:** `relay` (Brevo, 587) · **Sender:** `filipe@foodsistema.com.br`
**Channels:** API and UI (see §7) · **Scenario:** ascii · **Validation:** normalized

> ⚠️ **These are preliminary results, not a verdict.** n = 4 per provider, one execution window, one
> network location. Confidence intervals are wide (51–100%). See §4 before drawing conclusions.

---

## 1. Run summary

| Provider | Detection | Content available | Validation | Timeouts | Median latency | Min | Max |
|---|---|---|---|---|---|---|---|
| **Maildrop** | 4/4 (100%) | 4/4 | **4/4 (100%)** | 0 | **17.0 s** | 6.8 s | 23.1 s |
| **Guerrilla Mail** | 4/4 (100%) | 4/4 | **4/4 (100%)** | 0 | **22.8 s** | 8.1 s | 66.6 s |

Wilson 95% CI for both detection rates: **51%–100%** (n = 4).

| Derived metric | Maildrop | Guerrilla Mail |
|---|---|---|
| API detection latency (median) | 16 983 ms | 22 802 ms |
| API content latency (median) | 17 476 ms | 23 480 ms |
| API content access duration (median) | **~288 ms** | **~680 ms** |

**Reading this:** almost all of the elapsed time is *delivery to the provider*, not reading it.
Once a message appears, the API retrieves it in well under a second.

## 2. Providers not executed

| Provider | Reason | Status |
|---|---|---|
| Mailinator | API token not supplied (free Verified Pro or paid required) | `CONFIGURATION_REQUIRED` |
| YOPmail | No documented API | `NOT_SUPPORTED` — excluded, not ranked |
| 10 Minute Mail | Cloudflare bot challenge (observed 403); no documented API | `BLOCKED_BY_PROVIDER` — excluded, not ranked |

## 3. Defects found and fixed while producing these results

Producing real data exposed **six** harness defects. Each one, before it was fixed, would have
produced a **false provider failure** — which is precisely what the methodology warns about.

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | `MESSAGE_NOT_DETECTED` for everything | Sender was `8089f6003@smtp-brevo.com`; Brevo accepted (250 queued) but never delivered | Use an authorised sender (`EBM_SEND_FROM`) |
| 2 | `BODY_MISMATCH` on Maildrop | Relay converted plain text to HTML + quoted-printable + tracking pixels; raw substring check failed | MIME decode (`=3D`, soft breaks), HTML→text, then compare (`src/validation/mime.ts`) |
| 3 | `BODY_MISMATCH` persisted | Whitespace collapsing ran **before** MIME decoding, destroying `=\r\n` soft breaks | Decode first, then normalize |
| 4 | `html body not available` on Guerrilla Mail | `expectHtml` came from capability alone, so a **plain-text scenario** demanded HTML that was never sent | Require `expected.html` to exist *and* capability to support it |
| 5 | Guerrilla Mail never returned HTML | Adapter hard-coded `htmlBody: null` while the capability matrix said `SUPPORTED` | Adapter now detects and returns HTML when present |
| 6 | Misleading relay error `UNKNOWN` | IP-allowlist rejection (`525`) wasn't classified | Added `AUTH_FAILED` classification |

**None of these were provider faults.** All six are recorded because misattributing them would have
wrongly condemned a working provider.

## 4. Limitations — read before quoting any number

1. **n = 3–4.** The confidence interval on detection rate spans 51–100%. No difference between the two
   providers is statistically distinguishable.
2. **One window, one location.** No time-of-day or geographic coverage.
3. **Latency is from local SMTP acceptance**, not the provider's internal delivery time.
4. **Polling quantises latency** to the 3000 ms interval; real values are up to one interval lower.
5. **Maildrop greylisting is visible** — the first samples are slower (6.8 s → 23.1 s). With 4 samples
   the effect is not separable from noise.
6. **Guerrilla Mail retention is 1 hour**, Maildrop's is 24 hours — irrelevant to latency, relevant to
   operational choice.
7. **UI results exist for Maildrop only** (see §7). UI automation is not authorised/tested for the
   other providers.
8. **No winner is declared.** The methodology forbids it at this sample size
   ([business analysis §5](../business-analysis/02-statistics-and-reporting.md#5-declaring-a-winner)).

## 5. What a defensible conclusion needs

| Action | Effect |
|---|---|
| ≥ 30 samples per provider | CI narrows to roughly ±15 points |
| ≥ 3 runs across ≥ 2 time windows | Detects load patterns and instability |
| Separate cold vs. warm cohorts | Isolates greylisting from steady-state latency |
| Mailinator token | Adds the third API provider to the comparison |
| UI adapters | Enables the UI channel comparison |

## 6. Reproduce

```bash
# .env must set: EBM_TRANSPORT=relay, EBM_RELAY_*, EBM_SEND_FROM=<verified sender>
npm run bench -- --providers=maildrop,guerrillamail --samples=4 --channel=API --out=runs --label=real-final
npm run report -- --in=runs/benchmark-real-final.json
```

Artefacts: `runs/benchmark-real-final.json` (source of truth), `.html`, `-samples.csv`.


---

## 7. UI channel — Maildrop

The UI channel was implemented after the API channel was proven (the methodology treats them as
independent channels). Selectors were **derived from the live DOM**, not guessed:

| Element | Selector / mechanism |
|---|---|
| Inbox URL | `https://maildrop.cc/inbox/?mailbox=<name>` |
| Message row | `div.message` |
| Subject cell | `div.truncate` *without* `.font-bold` (sender) or `.text-sm` (date) |
| Message body | rendered inside an **`<iframe>`** after clicking the row |

### UI results (n = 3, API channel for comparison)

| Channel | Detection | Validation | Median detection latency | Min | Max | Content access |
|---|---|---|---|---|---|---|
| **API** | 4/4 (100%) | 4/4 (100%) | **17.0 s** | 6.8 s | 23.1 s | ~288 ms |
| **UI** | 3/3 (100%) | 3/3 (100%) | **41.1 s** | 27.8 s | 51.3 s | ~264 ms |

### What the comparison shows

1. **Both channels detect reliably** — 100% detection and validation on their samples.
2. **UI detection is materially slower** (41.1 s vs 17.0 s median). This is expected and is *not* a
   provider difference: the UI adapter must reload the page and re-render before a new message
   becomes visible, so it effectively adds a full browser round-trip per poll. The API reads a
   structured response directly.
3. **Content access duration is similar** (~264 ms UI vs ~288 ms API) — once the message is present,
   reading it is fast on both channels.
4. **These numbers are NOT directly comparable** and must not be ranked against each other
   ([methodology §5.5](../business-analysis/01-methodology.md)): the UI path includes browser
   navigation and rendering that the API path does not.

### UI automation status per provider

| Provider | UI automation | Note |
|---|---|---|
| **Maildrop** | ✅ Implemented & executed | 3/3 PASS |
| Mailinator | `SUPPORTED` (documented) | Not implemented — adapter is straightforward next step |
| Guerrilla Mail | `NOT_TESTED` | ToS prohibits request flooding; UI automation not established |
| YOPmail | `NOT_TESTED` | `robots.txt` disallows `/*?`; policy decision outstanding (**DQ-5**) |
| 10 Minute Mail | `BLOCKED_BY_PROVIDER` | Cloudflare challenge; **not** circumvented |

### Reproduce

```bash
npm run bench -- --providers=maildrop --samples=3 --channel=UI --out=runs --label=real-ui
EBM_E2E=1 npx playwright test      # opt-in structural UI test against the live site
```
