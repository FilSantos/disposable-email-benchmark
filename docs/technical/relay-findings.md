# Relay Credential Findings (Brevo)

**Date:** 2026-10-14
**Credential:** `8089f6003@smtp-brevo.com` @ `smtp-relay.brevo.com:587`

## Result: credential is VALID; the relay is blocked by an IP allowlist

| Test | Response | Meaning |
|---|---|---|
| Correct user + correct password | `525 5.7.1 Unauthorized IP address` | Credentials **accepted**; the **source IP** is not on Brevo's allowlist |
| Correct user + **wrong** password (control) | `535 5.7.8 Authentication failed` | Confirms the 525 is not an auth failure — it is an authorisation (IP) failure |

The control test is decisive: a bad password produces a **different** code (535) than the one we
receive with the real password (525). Therefore the password is correct and the sole blocker is the
allowlist.

**TCP reachability:** `smtp-relay.brevo.com:587` → OPEN (verified).
This is the improvement over the raw environment, where **port 25 is blocked to every MX**.

## The source IPs that must be authorised in Brevo

Add these in Brevo → **Settings → SMTP & API → Authorised IPs**:

| Type | Address |
|---|---|
| IPv4 | `189.37.7.209` |
| IPv6 | `2804:1e68:8401:e75f:cdb7:23b8:934d:e5c1` |

> **This machine's egress IP is dynamic** (residential connection). It may change between sessions.
> For a stable setup, run the benchmark from a fixed-IP host (CI runner or a server) and allowlist
> that address instead. Re-check with: `curl -s https://api.ipify.org`

## Verified transport behaviour (already working)

| Capability | State |
|---|---|
| Relay reachable on 587 | ✅ OPEN |
| TLS/STARTTLS negotiation | ✅ (verified — the session reached authentication) |
| Credential acceptance | ✅ (535 vs 525 control proves it) |
| IP authorisation | ❌ **blocked — action needed in the Brevo console** |
| Error classification | ✅ reported as `[AUTH_FAILED]` with the raw 525 preserved |

## What happens the moment the IP is allowlisted

No code change is required. The existing pipeline will begin producing real samples:

```bash
npm run bench -- --providers=maildrop,guerrillamail --samples=3 --out=runs --label=real-1
```

Both providers will then be measured over a genuine delivery path, and their `MESSAGE_NOT_DETECTED`
(classifiable as provider-side) will finally mean something — unlike under `loopback`, where the
message never leaves the machine and the harness takes the blame.

## Security handling

- The credential is stored **only** in `.env`, which is **gitignored** (verified with `git check-ignore`).
- It is registered with the redaction layer at startup, so it cannot reach logs, JSON, CSV or HTML.
- The CI secret-scan step (`.github/workflows/ci.yml`) fails the build if a credential value appears in `runs/`.
- `.env.example` documents the variable names with **empty** values.
