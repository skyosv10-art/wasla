# CLM-0509: INC-0006 / RISK-0065 secret rotation executed (database password, pool ceiling, 3 bot webhook secrets)

**Date:** 2026-10-08T21:26Z to 22:31Z · **Work item:** M6-18B · **main during execution:** `28d20c91` (deployed commit) → `cb7ba371` (#664 merged)
**Plan executed:** [CLM-0507](../2026-10-08T183000Z-clm-0507-secret-rotation-inventory/README.md) §3 to §5 · **Owner approvals:** password reset (owner, Supabase dashboard), Supavisor pool size 15 → 40 (owner, written approval 2026-10-08), webhook rotation order partner → driver → customer.
**Verdicts:** `DB_B3 = PASS` · `POOL_HEADROOM = measured` · `B5 = PASS` · `BOT_ROTATION = PASS` · **RISK-0065 → closed**.
No secret value was printed or written to disk. Values were compared in memory, and only 8-character SHA-256 prefixes are recorded.

## 1. Database password: update mechanism (a deviation from plan §3, and why)

Plan §3 called for a Render `PUT` per key on 18 keys. The executor cannot receive the new password: the secure credential form injects values only as HTTP auth headers, not as data. So the owner entered the value once and the executor wired it in:
- **Owner:** reset the `postgres` password in Supabase; created the Render env group `wasla-prod-db` (`evg-db40ojmb7d7c739u51jg`) with `DATABASE_URL` and `CUSTOMER_DATABASE_URL`; updated the GitHub secret `SUPABASE_DB_URL` (21:36:05Z).
- **Executor:** verified the group in memory and linked it to the 17 database services. It then deleted the 18 service-level keys (service-level values override group values; every `DELETE` returned 204; key counts dropped only by the database keys).
- **Result:** one source of truth on Render for the credential. A future rotation is one edit to the group.

## 2. Gates B1 to B6

| Gate | Measured | Verdict |
|---|---|---|
| B1 values | Both group keys share the same value (hash `a56cde2e`), which differs from the old value. User `postgres.ppixaauyqoykrogwdxtv`, host `aws-0-ap-south-1.pooler.supabase.com:5432/postgres`, no placeholder, no whitespace. 17 services linked, 0 service-level database keys left. GitHub `SUPABASE_DB_URL` updated at 21:36:05Z and proven in use by B5 | PASS |
| B2 deploy | [render-deploy 37848153316](https://github.com/skyosv10-art/wasla/actions/runs/37848153316) `verdict: PASS` | PASS |
| B3 health, attempt 1 | 21:42Z and 21:44 to 21:45Z: **14/17** in every round, with the 3 failing services rotating; `/health` 503 `database: down, reason: probe_error` | **BLOCKED** (§3) |
| B3 health, attempt 2 (pool 40) | 22:21:20Z `{200: 17}` · 22:21:43Z `{200: 17}` · 22:22:06Z `{200: 17}`; after rotation, 22:31:20Z `{200: 17}` | **PASS (17/17 × 3)** |
| B4 connection | New URL: `select 1` = 1, `transaction_read_only = on`. Old URL: authentication failure. Supavisor `password authentication failed` events: the last one was at 21:38Z (before the deploy, plus the executor's old-URL probe); none since | PASS |
| B5 backup | [db-backup 37853117838](https://github.com/skyosv10-art/wasla/actions/runs/37853117838) success: `restore_all_match: true`, 120 `public` tables. Restored into the runner's scratch `postgres:17` (an isolated target), not into production | PASS |
| B6 no business writes | All executor queries were read-only (`default_transaction_read_only = on`). The backup only reads. Webhook probes carried `update_id: 1` with a wrong, missing or old secret and were rejected with 401 before parsing | PASS |

## 3. Root cause of B3 attempt 1: Supavisor session-mode ceiling

- Supavisor logs (read through the Supabase connector) contained `ClientHandler: (EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15`.
- Counts per minute: 21:40 → 5, 21:41 → 14, 21:44 → 5, 21:45 → 10.
- 17 services share one user, database and mode combination, but there were only 15 session slots.
- **Fix (owner-approved):** Pool Size 15 → **40**, staying in **session mode on port 5432**. Transaction mode (6543) is deliberately refused because the application depends on session state (`SET`).
- **Read-back** (Management API `GET /v1/projects/ppixaauyqoykrogwdxtv/config/database/pooler`, with the owner's personal access token): `default_pool_size = 40`. The value was already 40 when read (the owner applied it in the dashboard), so **the executor sent no change**.
  - The same response reports `pool_mode: transaction, db_port: 6543`. That describes the pooler's transaction port. The services still connect on 5432 (session), unchanged.
  - No other setting was touched, and `max_connections` was not changed.
- **During attempt 2:** Supavisor logged 191 entries between 22:20 and 22:25Z, the last at 22:22:27Z, and **0** were `EMAXCONNSESSION`.
- **Correction by addition:** the "3 transient cold-start 503" results recorded at S10 (CLM-0505) were most likely this same ceiling. Their cold-start attribution was never proven (as CLM-0506 had already noted).

## 4. Connection headroom (read-only, measured during B3)

| | Value |
|---|---|
| `max_connections` | **60** (not changed) |
| client backends before B3 | 6 |
| observed peak during B3 | **25** client backends (19 of them `postgres` via Supavisor) |
| remaining headroom | **35** |

Raising Supavisor to 40 fixes the immediate ceiling. It does **not** prove that 40 is enough under load: every service builds a `pg.Pool` with the library default `max: 10`, so 17 × 10 = 170 possible demand against 40 slots and 60 server connections. Recorded as **RISK-0067**. An **independent change** to set application-side pool limits is required; it was not made in this claim.

## 5. Bot webhook secret rotation (C), one bot at a time

For every bot:
- The secret was generated in memory (`secrets.token_urlsafe(48)`) and set with one `PUT /env-vars/<KEY>` (200). The read-back hash matched, the value differed from the old one, and the key count was unchanged at 11.
- The bot was deployed alone at `28d20c91` and went `live` in 61 s.
- Then `setWebhook(url, secret_token, drop_pending_updates=false)` was called.

| Bot | New hash | Deploy | C1 url / error since set | C3 pending | C2 wrong / none / old | C4 health | Verdict |
|---|---|---|---|---|---|---|---|
| partner `@ZizoGoBot` | `1edb9a5d` | `dep-db41hjqj9qps73fqa050` | match / none | 0 | 401 / 401 / 401 | 200 | PASS |
| driver `@ODD_DR_BOT` | `4909fcbe` | `dep-db41i6142hec73fdstgg` | match / none | 0 | 401 / 401 / 401 | 200 | PASS |
| customer `@ODD_CU_BOT` | `359b242f` | `dep-db41ioflot8c73ccntp0` | match / none | 0 | 401 / 401 / 401 | 200 | PASS |

C5: no secret was printed or written to disk. The values lived only in the executor process memory and were dropped after each bot.

## 6. Residual owner hygiene (recommendations, not gates)

- **Credentials vault:**
  - The first credential saved for `api.supabase.com` was not a personal access token (`JWT could not be decoded`, 401). It was never used, and the owner may delete it.
  - The personal access token is now in the owner's vault. The owner may revoke it if it is not wanted for future read-backs.
- **Exposed in chat:** the Render API keys (old and new), the 3 bot tokens and the test-project Supabase token were pasted in chat during this session. These are not part of INC-0006's classification. The owner may consider rotating them:
  - bot tokens: BotFather `/revoke`, then update Render and `setWebhook`;
  - new Render key: create a replacement, then `gh secret set RENDER_API_KEY`;
  - old Render key: revoke it (CLM-0507 §6: READY).

## 7. Status after this claim

- **RISK-0065 → closed:** B1 to B6 PASS and all 3 bots rotated.
- **INC-0006 → Resolved.**
- **RISK-0067 opened:** application pool limits.
- **M6-18B stays Blocked** on RISK-0058 and RISK-0060, plus RISK-0066 (free plan) and RISK-0067.
- **M7 not started.**
- Not performed: DNS changes, recreating the legacy environment, transaction mode, `max_connections` changes, billing changes, business writes.
