# CLM-0507: INC-0006 secret exposure — read-only credential inventory and rotation plan

**Date:** 2026-10-08T18:30Z · **Work item:** M6-18B (the incident came up while M6-18B was being executed) · **main at start:** `28d20c91`
**Incident:** [INC-0006](../../../07-security/INCIDENTS.md) · **Risk:** RISK-0065 (opened in this claim)
**Scope:** read-only inventory and a rotation plan. **Nothing was rotated, no secret value was printed, and no production write happened.**
**Verdict:** `SECURITY_ROTATION_BLOCKED`. The database password rotation needs the owner to act in the Supabase dashboard (§3). The bot webhook rotation (§4) is ready, and its order follows the owner's instruction.

## 0. Owner's classification (2026-10-08)

- **Production database password (`postgres` role, project `ppixaauyqoykrogwdxtv`) = COMPROMISED.** The full connection URL, password included, appeared in the executor's session log.
- **Webhook secrets of the 3 bots = COMPROMISED, must be rotated.** They were stored for a while in a session temp file, which was deleted on 2026-10-08.
- **No secret entered git.** Every PR passed scan-secrets. A search of the repo tree on 2026-10-08T18:20Z found only the public project URL (`https://ppixaauyqoykrogwdxtv.supabase.co`), with no credential in it.

## 1. Inventory: production database credential

Measured on 2026-10-08T18:20Z through the Render API (new key) and by reading the repo. Values were compared in memory and only key names were printed.

**There is one production database credential.** All 18 database URLs on Render use the same user and password: role `postgres` through the Supabase pooler (`*.pooler.supabase.com:5432/postgres`, with no `sslmode` parameter; that last point matters for RISK-0060).

| Consumer | Secret name | Environment | Update mechanism |
|---|---|---|---|
| wasla-audit | `DATABASE_URL` | Render Singapore `tea-db0vtkpsrm7s739dm5c0` (production) | Render API `PUT /services/{id}/env-vars/{key}`, one key per request (never `PUT …/env-vars`, which replaces every key: INC-0002), then a commit-pinned deploy |
| wasla-customers | `DATABASE_URL` | same | same |
| wasla-delivery | `DATABASE_URL` | same | same |
| wasla-dispatch | `DATABASE_URL` | same | same |
| wasla-drivers | `DATABASE_URL` | same | same |
| wasla-geography | `DATABASE_URL` | same | same |
| wasla-identity | `DATABASE_URL` | same | same |
| wasla-marketplace | `DATABASE_URL` | same | same |
| wasla-matching | `DATABASE_URL` | same | same |
| wasla-negotiations | `DATABASE_URL` | same | same |
| wasla-orders | `DATABASE_URL` | same | same |
| wasla-reputation | `DATABASE_URL` | same | same |
| wasla-search | `DATABASE_URL` | same | same |
| wasla-subscriptions | `DATABASE_URL` | same | same |
| wasla-partner-bot | `DATABASE_URL` | same | same |
| wasla-driver-bot | `DATABASE_URL` | same | same |
| wasla-customer-bot | `DATABASE_URL` and `CUSTOMER_DATABASE_URL` | same | same (2 keys) |
| GitHub Actions: `db-backup.yml` (scheduled every 6 h), `risk-0056-apply.yml`, `risk-0056-cutover.yml`, `dr-render-cutover.yml` | repo secret `SUPABASE_DB_URL` (also passed as `BACKUP_SOURCE_DB_URL` to `scripts/ops/db-backup/backup.sh` and `scripts/ops/risk-0056/snapshot-dump.mjs`) | GitHub repo `skyosv10-art/wasla` | `gh secret set SUPABASE_DB_URL` (value read from stdin, never shown on the command line) |
| Terraform `infra/terraform/render.tf` (`var.supabase_database_url`) | taken from the environment when someone runs Terraform | operator workstation | not run here, so it holds no stored value. Any future `terraform apply` must be given the new URL |

**Measured as not consumers:**
- Render env groups: there are none (0).
- `DR_REPLACEMENT_DB_URL` uses a separate role (`dr_restore`) on the DR replacement database, so it is not this credential and is not in scope.
- `ci.yml` has no database secrets.
- `infra/terraform` has no tfstate in the repo.
- No `.env` file or generated deployment output holds the value, inside or outside the repo.
- The only local copy is the agent's own session log. It sits outside the repo and is not part of the project.

**Gap in the inventory file:** `infra/secrets/secret-inventory.json` lists 13 consumers of `DATABASE_URL`. The live system has 17 services: audit and the 3 bots are missing, and `CUSTOMER_DATABASE_URL` is labelled `ci`, although in production it is a runtime key of customer-bot. This gap is recorded here and will be fixed under a separate claim. This claim leaves the file unchanged.

**Repo tooling gap:** the Render tools that change env vars (`risk-0056/render-cutover.py`, `m6-18b-dr/render-dr-cutover.py`, and the `m3-07-*` drills) are LEGACY-ONLY tools. `render_target.legacy_only` refuses to run them (exit 3) because the legacy workspace is frozen. **The repo has no reviewed tool that rotates a key on the new workspace.** The rotation will therefore call the Render API directly, one key per request, under this claim. The steps are recorded here, and verification runs through the existing gates in §5.

## 2. Inventory: bot webhook secrets

| Bot (order) | Render service | Secret name | Host (setWebhook URL) | Update mechanism |
|---|---|---|---|---|
| 1. partner `@ZizoGoBot` | wasla-partner-bot | `PARTNER_BOT_WEBHOOK_SECRET` | `https://wasla-partner-bot-tri8.onrender.com/channel/partner/webhook` | Render per-key PUT → deploy → Telegram `setWebhook(secret_token=…)` |
| 2. driver `@ODD_DR_BOT` | wasla-driver-bot | `DRIVER_BOT_WEBHOOK_SECRET` | `https://wasla-driver-bot-d8dv.onrender.com/channel/driver/webhook` | same |
| 3. customer `@ODD_CU_BOT` | wasla-customer-bot | `CUSTOMER_BOT_WEBHOOK_SECRET` | `https://wasla-customer-bot-fw29.onrender.com/channel/customer/webhook` | same |

The bots check the header `x-telegram-bot-api-secret-token` (`packages/contracts/channel` `WEBHOOK_SECRET_HEADER`). GitHub holds no copy of these secrets: no workflow references them.

## 3. Database password rotation plan (B): BLOCKED, waiting for the owner

**Owner actions (in this order):**
1. In the Supabase dashboard → project `ppixaauyqoykrogwdxtv` → Database → Settings, reset the database password for the `postgres` role. Use a fresh password that contains no URL-reserved characters, or URL-encode it.
2. Give the executor the new password through the secure in-session credential form. Do not paste it into chat text and do not put it in the repo.
3. Confirm that no write freeze is needed. From the moment the password is reset until the services are updated, the 17 services will fail to connect. Expected impact: a few minutes of errors, with no end-user traffic (RISK-0042 observe: 0 requests).

**Executor actions after step 1:**
1. Build the new URL in memory: same host, port, user and database; only the password changes.
2. `gh secret set SUPABASE_DB_URL` via stdin.
3. For the 17 services, `PUT /env-vars/DATABASE_URL`, and also `CUSTOMER_DATABASE_URL` on customer-bot. Send one key per request. Read back a hash of the value and confirm it matches, without printing it.
4. Deploy main to the current Singapore services only, through `render-deploy.yml` (`workflow_dispatch`) or `render-sync.py`. The legacy workspace no longer exists.
5. Run the gates in §5.B.

**Prohibited:** business writes, any change to roles or permissions, printing the old or new password, storing it in the repo, any DNS change, and recreating the legacy workspace.

## 4. Bot webhook secret rotation plan (C): READY (approved order partner → driver → customer)

For **one bot at a time**, finishing all its gates before starting the next:
1. Generate the secret in memory with `secrets.token_urlsafe(48)`, keeping only Telegram's allowed characters `[A-Za-z0-9_-]`.
2. `PUT /services/{bot}/env-vars/{KIND}_BOT_WEBHOOK_SECRET`, one key only, then read back and match the hash.
3. Deploy that bot alone, pinned to main's commit, and wait for `live`.
4. Call `setWebhook(url=<host>/channel/<kind>/webhook, secret_token=<new>)` with the same in-memory value.
5. Run the gates in §5.C, then drop the value from memory.

Between steps 2 and 4 Telegram keeps sending the old secret, and the new service answers 401. Telegram retries updates that were not acknowledged, so the backlog should drain to `pending=0` after step 4. Gate C3 measures that.

## 5. Verification gates (exact)

**B: database password**
- B1. Read back the hash of every one of the 18 env values on Render and the 1 GitHub secret: all match the new value, and none matches the old one.
- B2. `render-deploy` verdict PASS, with every service `live` on main's commit.
- B3. `/health` and `/ready` on every service with a database: 200 for 3 rounds in a row (a 503 counts only if it recovers, and the response reason must be recorded).
- B4. Database connection proven by a read-only query (`select 1`) using the new URL from the executor's environment. The old URL is refused (authentication failure).
- B5. Run `db-backup.yml` once by `workflow_dispatch` (backup plus restore test): verdict success on the new secret. This is the backup-configuration check.
- B6. No business writes. The evidence records only key names, hashes truncated to 8 characters, and HTTP status codes.

**C: webhook secrets (per bot)**
- C1. `getWebhookInfo.url` = the new host, `last_error_message` empty.
- C2. Probe with a wrong secret → 401. Probe with no header → 401.
- C3. `pending_update_count = 0` within 120 s.
- C4. The service's `/health` → 200.
- C5. Neither secret is printed, and nothing is written to disk.

## 6. Old Render API key: revocation readiness (read-only)

- GitHub secrets: there is no secret for the old key. `RENDER_API_KEY` was updated to the new key on 2026-10-08T15:19:45Z.
- The repo tree contains no literal of either key.
- **`RENDER_OWNER_ID`**, the GitHub repo secret last updated on 2026-10-06T13:30:34Z, still holds the legacy owner `tea-damm8…`. **No workflow reads it** (`rg secrets.RENDER_OWNER_ID .github/workflows` finds nothing). In the repo it appears only in Terraform comments, `secret-inventory.json`, and the LEGACY-ONLY tools in `render_target`, which are frozen anyway. It is obsolete.
- `infra/render/deploy-target.json` keeps `legacy_owner` and `frozen_owners = [tea-damm8…]` as a guard that blocks the legacy-only tools. That is a deliberate fail-closed reference, not a credential, so it stays.
- **Readiness: READY.** The old key has no consumer.
  - Owner action: revoke the old key in the old Render account (Account Settings → API Keys).
  - Executor action, after the owner confirms: `gh secret delete RENDER_OWNER_ID`, and update the `secret-inventory.json` entry under a separate claim.
  - The new `RENDER_API_KEY` remains the only deploy credential.
