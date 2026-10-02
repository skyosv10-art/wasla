# CLM-0434: `production-migration` environment, target and protection (no migration run)

**Measured:** 2026-10-02T13:08Z · **Agent:** @skyosv10-art (agent:perplexity-computer) · **Main:** `78ec7d1`
**Scope:** read the secret's metadata, confirm its target without reading its value, and turn on Environment protection. **No migration, no cutover, no workflow dispatch.**

تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE"

## 1. Secret present (name and metadata only)

`GET /repos/skyosv10-art/wasla/environments/production-migration/secrets`:

| name | created_at | updated_at |
|---|---|---|
| `PRODUCTION_MIGRATION_DB_URL` | 2026-10-01T21:10:55Z | 2026-10-01T21:10:55Z |

The value was not read, printed or stored. GitHub's API cannot return secret values.

## 2. Target is `ppixaauyqoykrogwdxtv`, shown without exposing the value

`scripts/ops/risk-0056/guard-target.py production` parses the URL inside the runner and masks the password with `::add-mask::`. It prints only the project ref and port. It fails closed on any ref other than `ppixaauyqoykrogwdxtv`, and on the retired `snlpxywskyqrjattbpgn`.

Both guarded runs started **after** the secret's only write (21:10:55Z). The secret has not been written since, because `updated_at` = `created_at`.

| run | started | job | guard line in the log |
|---|---|---|---|
| [36927089959](https://github.com/skyosv10-art/wasla/actions/runs/36927089959) | 21:12:27Z | preflight: success | `target production · project ref ppixaauyqoykrogwdxtv · port 5432` (×3) |
| [36927646063](https://github.com/skyosv10-art/wasla/actions/runs/36927646063) | 21:17:19Z | preflight, cutover and backup: success | same line (×4) |

So the current value is the one the guard accepted. **Target verified: YES**, by timestamp ordering plus the fail-closed guard, without any new access to the value.

## 3. Environment protection

**Before** (`GET /environments/production-migration`, 2026-10-02T12:5xZ): `protection_rules: []`, `deployment_branch_policy: null`, `can_admins_bypass: true`. That meant no reviewer, any branch, and admin bypass allowed. This contradicted the header comment in `risk-0056-apply.yml` ("main only … Environment branch policy").

**Change**, applied with the owner account's repository-admin permission (`PUT /environments/production-migration`, then `POST …/deployment-branch-policies`):

| setting | after |
|---|---|
| required reviewers | `xuuux-voox` (id 334893315). This is the repository's independent CODEOWNER (GOV-002); a separate person is not proven from the available evidence |
| `prevent_self_review` | `true`: whoever triggers the run cannot approve it |
| deployment branches | custom policy: `main` only (policy id 61745184) |
| `can_admins_bypass` | `false` |
| wait timer | 0 |

**Effect:** only `risk-0056-apply.yml` and `risk-0056-cutover.yml` use this environment, and both run on `workflow_dispatch` only. No scheduled workflow uses it: `db-backup.yml` and `dr-restore-drill.yml` use repository secrets, so backups are not held up for approval. Any future migration or cutover now waits for approval by a second account, from `main` only.

**Protection: ENABLED.**

## 4. Not done

- No migration and no cutover. Neither workflow was dispatched.
- RISK-0056 is unchanged (closed).
- The secret value was not read, rotated or changed.
