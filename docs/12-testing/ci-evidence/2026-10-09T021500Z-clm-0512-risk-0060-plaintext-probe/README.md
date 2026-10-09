# CLM-0512 — RISK-0060: plaintext-rejection probe workflow (prepared; execution post-merge)

- **Work Item(s):** M6-18B
- **Author/Owner:** @skyosv10-art (agent:perplexity-computer)
- **Date:** 2026-10-09
- **Risk:** RISK-0060 (sev:high) — status stays `mitigating` in this PR

## 1. What this is

RISK-0060's closure condition, verbatim: *"production connections are measured TLS-verified and
plaintext is refused by the server."* TLS-verified is measured (CLM-0495: verify-full + pinned CA on
Render, read back via the API). Plaintext-refusal has only **incidental** evidence (db-backup run
[37199256304](https://github.com/skyosv10-art/wasla/actions/runs/37199256304), 2026-10-04:
`ESSLREQUIRED` on a plaintext connection). CLM-0497 §7 prepared the deliberate probe and recorded
why it was not executed then (it requires a new workflow file — its own claim — and the owner's
instruction at the time was "prepare"). This claim creates the workflow; the deliberate measurement
runs **after the merge** (workflow_dispatch, main-only, typed-commit), and the next claim records
its verdict.

## 2. The workflow

`.github/workflows/risk-0060-plaintext-probe.yml` — `workflow_dispatch` only:

1. **Typed-commit guard** (the same pattern as `risk-0060-render-tls.yml`): main-only, and the
   caller must type the full 40-char SHA of the run's commit.
2. **Target parsing:** ref + host parsed from the existing Actions secret `SUPABASE_DB_URL`
   (the same secret `db-backup.yml` already uses; no URL requested from the owner); **only ref and
   host printed**; fail-closed unless ref = `ppixaauyqoykrogwdxtv` (production). Probe URLs built
   with proper query-string merging (an existing `sslmode` on the secret is replaced, not
   duplicated).
3. **Probe A (must FAIL):** `psql "<url> sslmode=disable" -c 'select 1'` — PASS only if non-zero
   exit **and** the server message is SSL-required (`ESSLREQUIRED` / "SSL connection is
   required"). A connection that succeeds is a hard failure; a failure for any non-SSL reason is
   not accepted as proof.
4. **Probe B (control, must succeed):** `sslmode=require` → `select 1` = 1.
5. **Verdict artifact:** JSON (ref, host, classes, timestamp) — no secret, no connection string.
   `select 1` only; no write.

## 3. Security

Read-only (`select 1` both probes); the connection string is never printed and never written to an
artifact; the secret is the repository's own existing one; no owner credential requested.

## 4. Local verification

- YAML parsed (`yaml.safe_load`) — one job, steps typed.
- Both embedded python heredocs compile (`ast.parse`) in the exact post-dedent form the runner sees.
- Target parsing + query-merge logic verified against both URL shapes (pooler `postgres.<ref>@…`
   and direct `<ref>.supabase.co`).
- Governance suite: `verify-governance.sh` all executed checks pass; `validate-state-sync.sh`
  PASS for the PR range.

## 4-bis. Supply-chain guard registration (the first CI run caught this)

The first CI run on this PR failed `governance-guard` + `verify` on `validate-workflow-supply-chain.sh`
(M0-31): every workflow must be DECLARED with its purpose, secrets and permissions — an undeclared
workflow is refused. Root cause fixed by addition: `risk-0060-plaintext-probe.yml` is now declared
(secrets=yes [SUPABASE_DB_URL — the existing secret], write=no, purpose recorded); the claim scope
gained the guard file. The guard's own output after the fix: *15 workflows declared · none
undeclared · no orphan declarations*.

## 5. Execution plan (post-merge)

`gh workflow run risk-0060-plaintext-probe.yml -f confirm_sha=<merged main SHA>` → read the run
verdict from the API → the next claim records it (and closes RISK-0060 only if the probe passes:
plainText refused deliberately + TLS already measured).

## 6. What this does NOT claim

- The probe has not run in this PR — RISK-0060 stays `mitigating` until the deliberate verdict is
  recorded (local green is never the CI verdict, and CI green is never the probe verdict).
- No production change; no Supabase setting touched ("Enforce SSL" was already active server-side,
  measured CLM-0495).
