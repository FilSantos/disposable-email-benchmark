# 02 — Statistical Analysis Strategy, Reporting & Security/Compliance

**Parent:** [00-overview.md](./00-overview.md) · **Status:** Draft for QA Manager review · **Date:** 2026-10-14

---

## 1. Statistical Methodology

### 1.1 Design parameters (recommended defaults)

| Parameter | Recommended default | Justification |
|---|---|---|
| **Samples per provider per mode** | **30** for pilot; **50** for the confirmatory run | n=30 gives a coarse CI; n=50 tightens it. Both are feasible within free tiers. |
| **Independent runs** | **≥3**, on different days and different times of day | Needed to observe time-of-day and stability effects |
| **Execution windows** | ≥2 windows: e.g. business hours + off-hours | Detects provider load patterns |
| **Polling interval** | **2 s** (UI and API) | Sub-2s is wasteful; ≥5s adds unacceptable measurement error |
| **Detection timeout** | **180 s** per sample | Covers Maildrop greylisting in a *separate* labelled cohort; typical deliveries are far faster |
| **Transport timeout** | **15 s** per HTTP request / UI action | Distinguishes slow from hung |
| **Concurrency** | **1 sample at a time per provider** | Avoids self-inflicted rate limiting and cross-sample interference |
| **Execution order** | Randomized per run, then **fixed** and recorded | Reduces systematic order bias; keeps runs reproducible |
| **Retry policy** | **No retry on detection timeout** (that is a failure); **≤2 retries** on transport errors, each logged | Preserves honest timeout rate while tolerating transient network faults |
| **Inclusion criteria** | Sample attempted with valid config and a successful `SMTP_ACCEPTED_AT` | Defines the eligibility denominator |
| **Exclusion criteria** | Only: provider capability is `NOT_SUPPORTED`/`BLOCKED_BY_PROVIDER` for that mode; or harness config provably broken before the sample | Exclusions must be declared **before** the run, never after seeing results |

### 1.2 Treatment of awkward outcomes — never silently excluded

| Outcome | Treatment |
|---|---|
| **Failed SMTP attempt** | Counted as `SMTP_SEND_FAILED`; **excluded from detection-rate denominator** (no message was sent) but **reported** as its own rate against *attempted* samples. Both denominators must be printed. |
| **Timeout / missing observation** | Counted as a failure in **detection rate** and **timeout rate**. **Never** dropped. It simply has no latency value. |
| **Invalid/aborted sample** | Only excluded if the exclusion criteria were met *before* execution; otherwise counted as a failure. |
| **Censored latency** | A timeout is right-censored data. Report it as censored; do **not** substitute the timeout value as if it were a latency. |

### 1.3 Denominators (state the denominator for every percentage)

| Metric | Numerator | Denominator |
|---|---|---|
| Detection rate | samples detected | samples with successful `SMTP_ACCEPTED_AT` |
| Content availability rate | samples with required content | samples detected |
| Content validation pass rate | samples matching expected content | samples with content available |
| Timeout rate | samples timed out | samples with successful `SMTP_ACCEPTED_AT` |
| Duplicate rate | duplicate detections | samples detected |
| Wrong-message rate | wrong-ID detections | samples detected |
| Successful execution rate | samples completing end-to-end | samples with successful `SMTP_ACCEPTED_AT` |
| SMTP failure rate | `SMTP_SEND_FAILED` samples | samples attempted |

**[RECOMMENDATION]** Always show **funnel** denominators (attempted → accepted → detected → content → validated) so reviewers can see where samples drop out.

### 1.4 Statistics to report

| Statistic | When | Notes |
|---|---|---|
| Mean | Always | Sensitive to outliers; never report alone |
| Median (P50) | Always | Primary central tendency for latency |
| P90, P95 | Always (n≥30) | Tail behaviour that affects SLAs |
| **P99** | **Only when n ≥ 100 per cell** | Below that it is noise; report as "insufficient n" |
| Min / Max | Always | Reveals greylisting / cold-start outliers |
| IQR, std-dev | Always | Variability |
| Per-run values | Always | Exposes run-to-run instability |
| Detection / timeout / validation rates | Always | With denominators |
| Failure-category distribution | Always | Sums to 100% of non-passes |

**[RECOMMENDATION]** Report **confidence intervals** for detection rate using the **Wilson score interval** (better than normal approximation for small n and rates near 0/1). For latency, report a **bootstrap 95% CI of the median** when n ≥ 30. Do not present a mean latency without dispersion.

### 1.5 Sample-size limitations (stated openly)

- With n=30–50, differences under ~10–15 percentage points in detection rate are **not** statistically distinguishable. Do not rank on them.
- Provider cells split by run and by mode shrink n further; avoid over-stratifying.
- P99 is explicitly out of reach at these sample sizes; do not publish it.
- **[RECOMMENDATION]** If a decision hinges on a small difference, run a targeted follow-up with n≥100 for the two contenders only.

### 1.6 Why latency-only rankings lie

> If Provider A detects 95% of messages with a 4 s median latency, and Provider B detects 60% with a 3 s median, a "lowest latency" ranking names **B** the winner — because B's 40% of failed samples have **no latency and vanish from the calculation**. The failures are the story.

Therefore:
- **Never** rank on latency without detection rate beside it.
- Publish latency for **detected samples only**, clearly labelled, and pair it with the detection rate.
- **[RECOMMENDATION]** Prefer a composite view that treats non-detection as a penalty (e.g., a "successful verification time" using the timeout value as a worst-case placeholder for failures), disclosed explicitly as a modelling choice — not hidden.

### 1.7 Run-level consistency

Report per-run detection rate, median latency, and failure mix, plus a simple consistency measure (e.g., range and std-dev across runs). Flag any provider whose run-to-run detection rate varies by more than ~15 percentage points as **unstable**, regardless of its mean.

---

## 2. Reporting Requirements

### 2.1 Executive report (for QA leadership / managers)

Must contain, in this order:

1. **Business objective** and the decision requested.
2. **Tested providers and their capabilities** (capability matrix summary, with `NOT_SUPPORTED`/`BLOCKED` clearly marked).
3. **Overall findings** — one paragraph per provider.
4. **Reliability comparison** (detection / validation / timeout rates, with denominators).
5. **Latency comparison** (observed latency from local SMTP acceptance; UI and API separated; poll interval stated).
6. **Operational limitations** (retention, expiry, rate limits, ToS restrictions).
7. **Cost / plan considerations**, where verified (cite pricing source + date).
8. **Confidence and evidence limitations** (n, windows, known distortions, open questions).
9. **Risks and recommendations.**
10. **Decision rationale** — segment winners, not a forced single winner.

Constraints: no unexplained jargon; no number without its denominator/context; every claim traceable to the technical report.

### 2.2 Technical report (for engineering / QA engineers / reviewers)

Must contain:

1. **Sample-level results** (per sample: correlation ID, timestamps, outcome, failure code).
2. **Timestamps** — all five, raw, plus derived metrics.
3. **Metric definitions** and formulas (copy from [01-methodology.md §2](./01-methodology.md#2-measurement-methodology--timestamps)).
4. **Polling intervals**, timeouts, concurrency, execution order.
5. **Request durations** (API response-time distributions).
6. **Failure classifications** — full distribution with counts.
7. **Timeout census** — how many, how long, which category.
8. **Configuration details** — endpoints, plans, keys *redacted*, adapter versions.
9. **Provider capability matrix** with sources and verification date.
10. **Evidence and execution metadata** — run ID, host, OS, network baseline, browser version, timestamps of run start/end.
11. **Statistical methodology** — samples, runs, windows, CI method, exclusions.
12. **Reproducibility information** — code commit, config hash, seeds, exact commands.

### 2.3 Output formats

| Format | Audience | Content |
|---|---|---|
| **HTML** | Executive + technical | Rendered reports; charts (latency distribution, funnel, failure mix) |
| **JSON** | Tooling / archival | Machine-readable run manifest + all sample records + aggregates |
| **CSV** | Analysts / spreadsheets | Flat sample table + flat aggregate table; one row per sample/metric |

**[RECOMMENDATION]** JSON is the source of truth; HTML and CSV are generated from it. This guarantees the reports cannot disagree.

### 2.4 Real vs. simulated vs. unexecuted samples — MANDATORY distinction

Every sample carries `sample_origin`:

| Value | Meaning | Reporting rule |
|---|---|---|
| `REAL` | Actually executed against the provider | Only these may back published metrics |
| `SIMULATED` | Synthetic data used for tooling/report development | **Never** in executive metrics; watermarked; excluded from aggregates |
| `UNEXECUTED` | Planned but not run (e.g., capability blocked) | Shown as an explicit gap with a reason |

Reports must display counts per origin and refuse to compute headline metrics over anything but `REAL`. A run containing zero `REAL` samples must be labelled "no benchmark data".

---

## 3. Security & Responsible Use

### 3.1 Requirements

| Area | Requirement |
|---|---|
| **Synthetic test data** | Only synthetic, non-confidential content. **Never** send real PII, credentials, tokens, or business data to a public inbox. |
| **Credential management** | API keys/tokens from environment variables or a secret store. **Never** committed; **never** in logs, traces, screenshots, or reports. |
| **Log sanitization** | Redact tokens, cookies, auth headers, and full message bodies in logs by default. Provide a debug mode that still redacts secrets. |
| **Screenshot / trace retention** | Capture on failure; redact any visible token; apply a retention limit (e.g., 30 days) and store outside the repo. |
| **Public inbox risks** | Mailinator public, Maildrop, Guerrilla Mail, YOPmail, and 10 Minute Mail inboxes are **not private**. Treat all content as public. |
| **Provider Terms of Service** | Read and honour ToS. Guerrilla Mail explicitly prohibits request flooding **[FACT]**; Mailinator prohibits overburdening **[FACT]**. Respect Maildrop's published 50 queries/10s **[FACT]**; if a 429 occurs, back off — do not hammer. |
| **Rate limits** | Adapters implement per-provider limits and exponential back-off; a self-inflicted 429 is a **harness defect**, not a provider finding. |
| **Access restrictions** | Do not circumvent CAPTCHA, Cloudflare challenges, or access controls. **10 Minute Mail's bot challenge is a finding to report**, not an obstacle to defeat. |
| **Undocumented APIs** | Not used by default. Any exploratory use requires explicit approval, is labelled, and is never the basis of a published metric. |
| **Data retention & cleanup** | Delete synthetic messages where the provider allows it (e.g., Maildrop `delete` mutation); purge local evidence per retention policy. |
| **Responsible disclosure** | If a provider-side vulnerability is suspected, report privately to the provider; do not publish exploits. |

### 3.2 Prohibited actions (hard rules)

1. No bypassing security controls, CAPTCHA, or bot challenges.
2. No sending confidential or personal data to public inboxes.
3. No committing secrets or storing them in artifacts.
4. No undocumented APIs as the basis of published results.
5. No request volumes exceeding published limits or reasonable-use expectations.
6. No treating a provider's deliberate access control as a "failure to deliver."

---

## 4. Why Latency-Only Rankings Lie

*(Cross-reference: §1.6. Repeated here as a reporting rule.)*

Every comparison table showing latency **must** also show the detection rate for the same cell, and must state that the latency is conditioned on detection. A table lacking either is non-compliant with this methodology.

---

## 5. Declaring a Winner

A provider may be named a **segment winner** only if **all** hold:

1. It leads its segment on the **primary metric** for that segment (e.g., detection rate for reliability; median latency for performance).
2. The lead is **larger than measurement noise** — supported by non-overlapping confidence intervals, or a difference the QA Manager explicitly accepts as practically significant with the uncertainty stated.
3. It has **no disqualifying** `BLOCKED_BY_PROVIDER` status, disqualifying ToS restriction, or unaddressed security concern.
4. It has been observed in **at least 3 independent runs**.

If no provider satisfies these, the correct output is **"no reliable winner; evidence insufficient"** — an acceptable, reportable result. Segment winners may differ (e.g., Mailinator for API, Maildrop for zero-cost UI). Ties are reported as ties.

---

*Next: [03-requirements-and-acceptance.md](./03-requirements-and-acceptance.md).*
