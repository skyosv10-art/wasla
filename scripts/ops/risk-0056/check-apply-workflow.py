#!/usr/bin/env python3
"""RISK-0056 · CLM-0420 — static shape of the production apply workflow.
Fails unless ALL hold:
  · the only trigger is workflow_dispatch;
  · inputs confirm_sha and schema_manifest_sha256 are required;
  · the job that runs apply.sh uses Environment production-migration, needs the
    backup job, and its `if` requires the backup to have succeeded for mode=apply;
  · the backup job calls ./.github/workflows/db-backup.yml with pre_migration: true
    and expect_project_ref = the production ref;
  · no TEST secret is referenced, and the DB secret of the apply job is
    PRODUCTION_MIGRATION_DB_URL.
"""
import sys
import yaml

p = sys.argv[1]
text = open(p, encoding="utf-8").read()
y = yaml.safe_load(text)
on = y.get(True, y.get("on"))
problems = []
if not isinstance(on, dict) or set(on) != {"workflow_dispatch"}:
    problems.append(f"triggers must be exactly workflow_dispatch, got {sorted(on) if isinstance(on, dict) else on!r}")
inputs = (on or {}).get("workflow_dispatch", {}).get("inputs", {}) if isinstance(on, dict) else {}
for k in ("confirm_sha", "schema_manifest_sha256"):
    if not inputs.get(k, {}).get("required"):
        problems.append(f"input {k} must be required")
jobs = y.get("jobs", {})
apply = [n for n, j in jobs.items() if "apply.sh" in yaml.safe_dump(j)]
if len(apply) != 1:
    problems.append(f"exactly one job must run apply.sh, found {apply}")
else:
    j = jobs[apply[0]]
    if j.get("environment") != "production-migration":
        problems.append("apply job must use Environment production-migration")
    needs = j.get("needs", [])
    needs = [needs] if isinstance(needs, str) else needs
    if "backup" not in needs or "guard" not in needs:
        problems.append("apply job must need [guard, backup]")
    cond = str(j.get("if", ""))
    if "needs.backup.result == 'success'" not in cond or "needs.guard.result == 'success'" not in cond:
        problems.append("apply job `if` must require guard success and backup success")
    if "secrets.PRODUCTION_MIGRATION_DB_URL" not in str(j.get("env", {})):
        problems.append("apply job must read secrets.PRODUCTION_MIGRATION_DB_URL")
b = jobs.get("backup", {})
if b.get("uses") != "./.github/workflows/db-backup.yml":
    problems.append("backup job must call ./.github/workflows/db-backup.yml")
if (b.get("with") or {}).get("pre_migration") is not True:
    problems.append("backup must be pre_migration: true (90-day retention)")
if (b.get("with") or {}).get("expect_project_ref") != "ppixaauyqoykrogwdxtv":
    problems.append("backup must expect the production project ref")
if "SUPABASE_TEST_DB_URL" in text:
    problems.append("the production workflow must not reference SUPABASE_TEST_DB_URL")
for pr in problems:
    print(f"::error::{pr}")
print(f"check-apply-workflow: {'FAIL' if problems else 'PASS'} ({len(problems)} problems) — {p}")
sys.exit(1 if problems else 0)
