#!/usr/bin/env python3
# audit-static-sources.py — يُعيدُ قياسَ عدَّاداتِ `static` الثمانيةِ من شجرةِ العملِ،
# ويُعلِنُ لكلِّ عدَّادٍ **مصدرَه المقيسَ** وهل ذلك المصدرُ حَيٌّ أم مهجورٌ.
#
# ليس حارساً ولا يُشغَّل في CI ولا يُعدِّل شيئاً: أداةُ قياسٍ لدليلِ `M0-26` وحدَه.
# المنطقُ منسوخٌ حرفيّاً من `scripts/baseline.sh` (السطورُ 99-147) — فلو اختلفَ
# رقمٌ هنا عن الأساسِ فالسببُ تغيُّرُ الشجرةِ لا اختلافُ الطريقةِ.
#
#   python3 docs/12-testing/ci-evidence/.../measurements/audit-static-sources.py
#
# المرجع: docs/07-security/RISK_REGISTER.md · RISK-0016 · M0-08

import glob
import json
import os
import re
import subprocess
import sys

ROOT = subprocess.run(
    ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
).stdout.strip()
os.chdir(ROOT)

# ── العدَّاداتُ الثمانيةُ — يُقاسُ كلٌّ بطريقةِ `scripts/baseline.sh` عينِها ──
pkgs = [p for p in glob.glob("**/package.json", recursive=True) if "node_modules" not in p]
with_tc = with_test = 0
for p in pkgs:
    try:
        scripts = (json.load(open(p, encoding="utf-8")).get("scripts") or {})
    except Exception:
        scripts = {}
    with_tc += "typecheck" in scripts
    with_test += "test" in scripts

test_files = [
    p for p in glob.glob("**/*", recursive=True)
    if "node_modules" not in p and re.search(r"\.(test|spec)\.(ts|tsx|js|mjs)$", p)
]

ci_jobs = ci_af = 0
if os.path.exists(".gitlab-ci.yml"):
    ci_text = open(".gitlab-ci.yml", encoding="utf-8", errors="replace").read()
    reserved = ("stages", "variables", "default", "include", "workflow")
    ci_jobs = sum(
        1 for l in ci_text.splitlines()
        if re.match(r"^[A-Za-z0-9_.-]+:\s*$", l) and not l.split(":")[0] in reserved
        and not l.startswith(".")
    )
    ci_af = len(re.findall(r"allow_failure:\s*true", ci_text))

gov_checks = 0
gov_path = "scripts/checks/verify-governance.sh"
if os.path.exists(gov_path):
    nums = re.findall(r"^# ── ([1-9][0-9]*)\)", open(gov_path, encoding="utf-8", errors="replace").read(), re.M)
    gov_checks = len(set(nums))

risks_open = 0
reg = "docs/07-security/RISK_REGISTER.md"
if os.path.exists(reg):
    risks_open = len(re.findall(
        r"^RISK-\d{4} \|.*status:(?:open|mitigating|accepted)\b",
        open(reg, encoding="utf-8", errors="replace").read(), re.M))

measured = {
    "packages": len(pkgs),
    "packages_with_typecheck": with_tc,
    "packages_with_test": with_test,
    "test_files_tracked": len(test_files),
    "ci_jobs": ci_jobs,
    "ci_allow_failure": ci_af,
    "governance_checks": gov_checks,
    "risks_not_closed": risks_open,
}

# ── المصدرُ المقروءُ لكلِّ عدَّادٍ، وهل هو حَيٌّ ────────────────────────────
SOURCES = {
    "packages":                ("**/package.json (شجرةُ العملِ)",              "live"),
    "packages_with_typecheck": ("**/package.json → scripts.typecheck",         "live"),
    "packages_with_test":      ("**/package.json → scripts.test",              "live"),
    "test_files_tracked":      ("**/*.{test,spec}.{ts,tsx,js,mjs}",            "live"),
    "ci_jobs":                 (".gitlab-ci.yml",                              "abandoned"),
    "ci_allow_failure":        (".gitlab-ci.yml",                              "abandoned"),
    "governance_checks":       ("scripts/checks/verify-governance.sh",         "live"),
    "risks_not_closed":        ("docs/07-security/RISK_REGISTER.md",           "live"),
}

# ── الأساسُ المُلتزَمُ للمقارنةِ ─────────────────────────────────────────────
baseline = json.load(open("docs/12-testing/BASELINE.json", encoding="utf-8"))
committed = baseline["static"]

# ── حدُّ «الحيِّ» يُقاسُ لا يُدَّعى: هل الملفُّ مُشغَّلٌ فعلاً؟ ──────────────
gitlab_exists = os.path.exists(".gitlab-ci.yml")
gh_workflows = sorted(glob.glob(".github/workflows/*.yml") + glob.glob(".github/workflows/*.yaml"))
gh_job_keys = []
gh_continue_on_error = 0
for f in gh_workflows:
    t = open(f, encoding="utf-8", errors="replace").read()
    gh_job_keys += re.findall(r"^  ([A-Za-z0-9_-]+):\s*$", t, re.M)
    gh_continue_on_error += len(re.findall(r"continue-on-error:\s*true", t))

# ── هل عدَّادُ ملفّاتِ الاختبارِ يوافقُ اسمَه («tracked» = مُتتبَّعٌ في git)؟ ──
tracked = set(subprocess.run(["git", "ls-files"], capture_output=True, text=True).stdout.splitlines())
untracked_test_files = sorted(p for p in test_files if p not in tracked)

report = {
    "measured_at_commit": subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip(),
    "baseline_commit": baseline["repo"]["commit"],
    "baseline_generated_at": baseline["generated_at"],
    "counters": {},
    "gitlab_ci_present": gitlab_exists,
    "github_workflow_files": gh_workflows,
    "github_job_keys": len(gh_job_keys),
    "github_continue_on_error_true": gh_continue_on_error,
    "test_files_present_but_untracked": untracked_test_files,
}
for name, value in measured.items():
    src, liveness = SOURCES[name]
    report["counters"][name] = {
        "measured_now": value,
        "committed_baseline": committed.get(name),
        "matches_baseline": committed.get(name) == value,
        "source_read": src,
        "source_liveness": liveness,
    }

json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
print()
