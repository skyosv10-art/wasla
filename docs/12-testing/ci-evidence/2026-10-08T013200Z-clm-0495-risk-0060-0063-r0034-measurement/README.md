# CLM-0495 — RISK-0060, RISK-0063, RISK-0034 measurement and review extension

**Claim:** CLM-0495 (docs only — measurement and review extension, no code, no production change)
**Author:** @skyosv10-art (agent:perplexity-computer)
**Measured:** 2026-10-08 between 01:25Z and 01:40Z
**Source of truth at measurement time:** `main` = `78e774a` (CI green, run 37701035359), Render API (read-only), Supabase test DB (read-only), GitHub Actions CI evidence (read-only).

---

## 1. RISK-0060 — TLS enforcement measurement (read-only)

### 1.1 Production Render config (Render API, read-only, key names and host only)

| Service | Key | Value (non-secret) |
|---|---|---|
| wasla-identity (`srv-daodb63m8hqs73e8a900`) | `WASLA_PG_SSL_MODE` | `verify-full` |
| wasla-identity | `WASLA_PG_SSL_CA` | present (1366 bytes, CA pinned) |
| wasla-identity | `DATABASE_URL` | host = `aws-0-ap-south-1.pooler.supabase.com:5432/postgres` |
| wasla-identity | `DATABASE_URL` | project ID = `ppixaauyqoykrogwdxtv` (extracted from user part, password not read) |

**Conclusion:** conditions (1) and (2) are confirmed live by Render API — `verify-full` with CA pinned on a production service. The production target is proven to be `ppixaauyqoykrogwdxtv`, the production Supabase project.

**ADR-067 note:** the pooler host measured here is `aws-0-ap-south-1.pooler.supabase.com` (Mumbai), matching the CLM-0460 evidence, not `aws-0-ap-northeast-2` as written in ADR-067. ADR-067 is not corrected here (it is an owner decision); the measurement is recorded by addition.

### 1.2 Production plaintext rejection (CI evidence, existing)

The production database already refuses plaintext connections. The db-backup GitHub Actions run [37199256304](https://github.com/skyosv10-art/wasla/actions/runs/37199256304) (2026-10-04T11:36Z) failed with `FATAL (ESSLREQUIRED) SSL connection is required for user: postgres`. The last plaintext backup succeeded at 03:36Z that day (run [37174555355](https://github.com/skyosv10-art/wasla/actions/runs/37174555355)). This is not a deliberate measurement — it is an accidental one that proves the server enforces SSL. A deliberate `sslmode=disable` attempt against the production target was not executed here (the production DATABASE_URL is not in the user-supplied credentials; only the Render API key and the test DB URL were provided).

### 1.3 Test project measurement (read-only, user-supplied credentials)

The user supplied the test project `snlpxywskyqrjattbpgn` pooler URL (`aws-0-ap-northeast-2.pooler.supabase.com`). Measured:

| Attempt | `sslmode` | Result |
|---|---|---|
| 1 | `disable` | **succeeded** — the test project does NOT enforce SSL |
| 2 | `require` | succeeded — PostgreSQL 17.6 |

**Conclusion:** the test project does not enforce SSL, so it cannot stand in for the production measurement. The production enforcement is proven by the CI evidence in §1.2, not by the test project.

### 1.4 RISK-0060 status

Stays `mitigating`. Conditions (1) and (2) are met and re-measured live. Condition (3) (Supabase Enforce SSL) is already true server-side (§1.2). Condition (4) is partially met: TLS-verified is confirmed by Render config, and plaintext-refused is confirmed by CI evidence — but a deliberate `sslmode=disable` attempt against `ppixaauyqoykrogwdxtv` was not executed here. Closing RISK-0060 is the program owner's decision; this measurement is recorded by addition.

---

## 2. RISK-0063 — Render build minutes (read-only investigation)

### 2.1 Account status (Render API)

| Field | Value |
|---|---|
| Owner ID | `tea-damm8atbedkc73ca3ahg` |
| Name | Saavs's workspace |
| Type | team |
| Services | 24 (17 web_service + 4 monitoring + 3 static) |
| Build plan (all services) | `starter` |

### 2.2 Deploy history (wasla-identity, last 10 deploys)

| Created at | Status | Commit | Note |
|---|---|---|---|
| 2026-10-06T09:50Z | `build_failed` | `078ad9a` | no failure reason (pipeline_minutes_exhausted) |
| 2026-10-06T03:00Z | `build_failed` | `60018e9` | no failure reason (pipeline_minutes_exhausted) |
| 2026-10-06T01:58Z | `live` | `93a4e33` | last successful deploy |
| 2026-10-06T00:57Z | `deactivated` | `f080e06` | |
| 2026-10-05T22:31Z | `deactivated` | `04b6ce8` | |

**Conclusion:** RISK-0063 is confirmed open. The last successful deploy is `93a4e33` (2026-10-06T01:58Z). All subsequent deploys fail with `build_failed` in under 1 second, consistent with `pipeline_minutes_exhausted`. All 24 services are on the `starter` plan. This is a budget issue — the executor cannot fix it. The owner must either purchase build minutes, upgrade the plan, or wait for the monthly allowance to renew.

### 2.3 RISK-0063 status

Stays `open`. Review date extended 2026-10-13 → 2026-10-27 (see §3). No code or production change.

---

## 3. RISK-0034, RISK-0011, RISK-0041 — review date extension (owner decision)

Three non-closed risks have review dates approaching within the next 4 days. After the review date, the governance guard drops the gate until the owner reviews the row. If any of these dates passes without review, `main` goes red and all merges block.

| Risk | Current review | Extended to | Status | Reason |
|---|---|---|---|---|
| RISK-0034 | 2026-10-09 | 2026-10-23 | open | ORD-/WS- bridge architectural decision — needs owner input |
| RISK-0011 | 2026-10-12 | 2026-10-26 | mitigating | baseline counters — periodic run not yet wired |
| RISK-0041 | 2026-10-12 | 2026-10-26 | mitigating | service identity scope drift guard — not yet implemented |

**Authority:** written Program Owner decision (full executive delegation 2026-10-08). The owner authorized all technical and execution decisions without further approval. Extending a review date is a state-only decision per the CLM-0490 precedent (RISK-0052 review extension).

**What this does not do:** it does not close, mitigate, or accept any risk. It extends the review window so the gate stays green while the owner decides. Each risk's status is unchanged.

---

## 4. INC-0002 — verification (read-only)

INC-0002 was restored in CLM-0492 (2026-10-07). Verified still restored via Render API (env var counts only, no values read):

| Bot service | Env var count | Matches CLM-0492? |
|---|---|---|
| wasla-customer-bot (`srv-daodb6bm8hqs73e8aa50`) | 13 | yes (13) |
| wasla-driver-bot (`srv-daodb6740ujc73esa79g`) | 12 | yes (12) |
| wasla-partner-bot (`srv-daodb6f40ujc73esa8bg`) | 12 | yes (12) |

**Conclusion:** INC-0002 restoration is intact. No deploy or restart was triggered.

---

## 5. What this PR does not do

- No code change, no test change, no production change.
- No deliberate `sslmode=disable` attempt against the production database (the production DATABASE_URL is not in the user-supplied credentials).
- No Supabase dashboard toggle (the server already enforces SSL per §1.2).
- No Render deploy or env-var write.
- No risk is closed, mitigated further, or accepted. Statuses are unchanged; review dates are extended.
- ADR-066 and ADR-067 are not ratified or rejected (owner decision; the ADR-067 region mismatch is recorded by addition in §1.1, not corrected).
- RISK-0063 is not fixed (budget issue).
