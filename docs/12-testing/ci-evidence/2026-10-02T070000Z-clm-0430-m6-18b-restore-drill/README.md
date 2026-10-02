# M6-18B — restore drill from the stored backup artifact + measured RPO/RTO (CLM-0430)

**Date:** 2026-10-02 · **Claim:** CLM-0430 · **Production:** `ppixaauyqoykrogwdxtv` · base main `0ecb62f`.
تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE".
Nothing in this work connected to production, Render, migrations or connection settings. No secret values appear here.

## 1. Scheduled encrypted backups (the free mitigation in force)
- `db-backup.yml`, cron `0 0/6 * * *` on main. Each run does: snapshot dump → GPG AES256 → decrypt of the uploaded ciphertext (byte-identical) → `pg_restore --exit-on-error --single-transaction` into postgres:17 → exact per-table compare. Every step is fail-closed, and a failure opens or updates an issue.
- First scheduled runs after the cutover (secret `SUPABASE_DB_URL` → new project at 20:41 UTC):
  - [36933484578](https://github.com/skyosv10-art/wasla/actions/runs/36933484578) 2026-10-01 22:11 UTC: PASS, 120/120 tables, 38 rows, restore_all_match.
  - [36959972983](https://github.com/skyosv10-art/wasla/actions/runs/36959972983) 2026-10-02 03:23 UTC: PASS, 120/120 tables, 38 rows, restore_all_match.
  - 120 public tables is the shape of the new project (the retired one has 111), so these runs back up `ppixaauyqoykrogwdxtv`. Scheduled runs carry no `expect_project_ref` pin; only `workflow_call` does.
- Fail-closed behaviour seen in practice: [36859874667](https://github.com/skyosv10-art/wasla/actions/runs/36859874667) (2026-10-01 12:09 UTC) failed with `ENETUNREACH` (IPv6 to the direct host, before the secret moved to the pooler). It produced no artifact and opened issue #570. Later runs passed. #570 is still open.

## 2. Restore drill from the STORED artifact — `dr-restore-drill.yml`
The drill downloads the artifact that db-backup.yml uploaded; that is the input a real recovery would have. It then:
1. Checks the manifest (one manifest, one ciphertext, restore_all_match=true).
2. Checks that sha256(ciphertext) equals the manifest value.
3. Decrypts and checks that sha256(dump) equals the manifest value.
4. Restores into an isolated postgres:17 with `--exit-on-error --single-transaction`.
5. Compares: the restored table set equals the dump TOC and the manifest table count, and the total row count equals the manifest.

| run | backup used | result | timings (s) |
|---|---|---|---|
| [36975622775](https://github.com/skyosv10-art/wasla/actions/runs/36975622775) | 36959972983 · `db-backup-20261002T032407Z` | PASS · 120/120 tables · 38/38 rows | download+integrity 2.0 · decrypt 0.2 · restore 4.0 · compare 1.7 · **total 7.9** |
| [36975855980](https://github.com/skyosv10-art/wasla/actions/runs/36975855980) | same | PASS · 120/120 · 38/38 · **negative control PASS** (tampered ciphertext refused at `stage=cipher`) | 1.6 · 0.1 · 4.0 · 1.6 · **total 7.3** |

The drill runs weekly (`30 4 * * 1`) and on manual dispatch. Its results (totals and timings only) are kept for 90 days.

## 3. RPO — measured, not assumed
Source: the db-backup.yml run history on main over 7 days (`rpo-from-history.py`, measured 2026-10-02 06:52 UTC). Recovery point = start of a successful run.

| metric | value |
|---|---|
| completed runs / successful | 16 / 12 |
| failed runs | 36634639267, 36639759044, 36641632258 (2026-09-29, during the backup workflow fixes) · 36859874667 (2026-10-01, IPv6) |
| GitHub start delay of scheduled runs vs the cron slot | 0.15 h – **5.67 h** |
| **worst gap between successful backups** | **10.21 h** |
| median gap | 5.21 h |
| open gap at measurement | 3.48 h |
| ADR-052 T1 target | **5 min — NOT MET** |

The real RPO of this mechanism is not "about 6 h". GitHub's schedule delays plus failed runs make the worst case 10.21 h in this window. The 7-day window includes the period before the cutover; that measures the mechanism, which is unchanged.

## 4. RTO — measured parts and unmeasured parts
| component | measured | source |
|---|---|---|
| data restore from the stored artifact (download → verify → decrypt → restore → compare), schema `public` | **7.3–7.9 s** | §2 |
| repoint 17 services to a database + redeploy + live verification | **97 s** (21:19:18 → 21:20:55 UTC) | cutover run [36927646063](https://github.com/skyosv10-art/wasla/actions/runs/36927646063), job "Render cutover" |
| service crash / outage recovery | 37.6 s (orders) / 36.2 s (marketplace) | M6-18B live drill 2026-09-29 (`2026-09-29T130000Z-m6-18b-dr-drill-live`) |
| restore into a REAL replacement Supabase project (create project, restore including `auth`/`storage`/`vault`, rotate secrets) | **not measured** | needs a second production-grade project or a destructive test on production → owner decision |

The measured parts total about 105 s, against T1's 15 min. End-to-end RTO for losing the database is not proven, because the restore into a real Supabase target was not exercised. Non-public schemas are in the dump but not restore-tested (recorded in the manifest's `not_verified`).

## 5. Verdict
- **PASS:** scheduled encrypted backups of the new production are running; backup and restore are fail-closed (including a negative control); the stored artifact restores exactly; RPO and RTO parts are measured.
- **BLOCKED (owner gate):**
  - (a) RPO 10.21 h worst case against the ADR-052 T1 target of 5 min. Options: accept a longer RPO formally (ADR amendment), or provide PITR (paid, so outside the zero budget).
  - (b) DR scenarios 2 and 5 (fault injection on the only live DB) and an end-to-end restore into a real replacement project: both need an owner decision.
- **RISK-0055 stays `mitigating`.** It is not closed: the RPO condition is unmet. **M6-18B stays `Blocked`.**
- **Separate operational debt (not RISK-0056):** RISK-0057, the 3 bots have no `IDENTITY_SERVICE_URL` (`/health` `degraded`). Not changed in this work.
