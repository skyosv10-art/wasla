# CLM-0514 — RISK-0060 closed: the deliberate plaintext-rejection verdict (measured)

- **Work Item(s):** M6-18B
- **Author/Owner:** @skyosv10-art (agent:perplexity-computer)
- **Date:** 2026-10-09
- **Risk:** RISK-0060 (sev:high) → **closed** (this PR, per the register's own written condition)

## 1. The register's closure condition, verbatim

*"Closes when production connections are measured TLS-verified and plaintext is refused by the server."*

| Half | Evidence | Measured |
|---|---|---|
| TLS-verified | CLM-0495: `WASLA_PG_SSL_MODE=verify-full` + pinned Supabase CA (1366 bytes) on the DB-backed Render services, read back via the Render API; host `aws-0-ap-south-1.pooler.supabase.com`; project `ppixaauyqoykrogwdxtv` | 2026-10-08 |
| Plaintext refused | **This claim**: the deliberate probe (CLM-0497 §7 prepared, CLM-0512 workflow, CLM-0513 step-boundary fix) | 2026-10-09 |

## 2. The measured verdict

Run [37879172647](https://github.com/skyosv10-art/wasla/actions/runs/37879172647) — `risk-0060-plaintext-probe.yml` on main `7be06f6b`, 2026-10-09T03:25:02Z, **success (19 s)**:

- **Target** (parsed from the existing Actions secret `SUPABASE_DB_URL`; only ref+host ever printed): ref `ppixaauyqoykrogwdxtv` (production, fail-closed enforced), host `aws-0-ap-south-1.pooler.supabase.com`.
- **Probe A (must fail):** `psql "<url> sslmode=disable" -c 'select 1'` → exit 2, server message class **`ESSLREQUIRED`** — the server refused plaintext, deliberately probed.
- **Probe B (control, must succeed):** `sslmode=require` → `select 1` = 1 — PASS.
- **Verdict artifact:** `PLAINTEXT_REFUSED_DELIBERATE` (JSON uploaded, run 37879172647, 90-day retention).

Read-only: `select 1` only, both probes; no write; the connection string never printed and never written to an artifact.

## 3. The failed first dispatch, kept readable

Run [37877806604](https://github.com/skyosv10-art/wasla/actions/runs/37877806604) (2026-10-09T03:07Z, 9 s) failed on `PROBE_TARGET_REF: unbound variable` — a workflow step-boundary defect (GITHUB_ENV reaches only the NEXT steps), fixed in CLM-0513 (Parse + Probe steps split). **No database connection was attempted in that run — it is not a probe verdict**, and it stays recorded, not erased.

## 4. What this changes

- RISK-0060: `mitigating` → **`closed`** — both halves of its closure condition are now measured, not assumed.
- M6-18B blockers: RISK-0058 / RISK-0066 / RISK-0067 remain (RISK-0060 removed).
- BASELINE.json/txt regenerated per M0-08's written-decision rule (risks_not_closed 24 → 23).

## 5. Not claimed

- No Supabase setting was changed by this claim — the server was already refusing plaintext (CLM-0488 measured the refusal on db-backup; this claim made the probe deliberate).
- RISK-0058 (production partition drill), RISK-0066 (free-hour exhaustion — owner plan decision), RISK-0067 (load measurement) stay open; M6-18B stays Blocked.
