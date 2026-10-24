#!/usr/bin/env python3
"""CLM-0671 — فحصٌ بنيويٌّ لـ .github/workflows/ci.yml على الرأسِ مقابلَ قاعدة (قراءةٌ فقط).
الاستعمال من جذرِ المستودع: python3 <this> [BASE_REV]   (BASE_REV افتراضيًّا origin/main)
يخرجُ 1 عندَ أيِّ مخالفة."""
import subprocess, sys, yaml
base = sys.argv[1] if len(sys.argv) > 1 else "origin/main"
TARGET = {"customer-mini-app-e2e", "driver-mini-app-e2e", "admin-portal-e2e"}
TEST, SWITCH = "bash scripts/ci/test-apt-mirror-archive-ubuntu.sh", "bash scripts/ci/apt-mirror-archive-ubuntu.sh"
head = yaml.safe_load(open(".github/workflows/ci.yml", encoding="utf-8"))["jobs"]
old = yaml.safe_load(subprocess.check_output(["git", "show", f"{base}:.github/workflows/ci.yml"]))["jobs"]
bad = []
def chk(c, msg): print(("  ✓ " if c else "  ✗ ") + msg); c or bad.append(msg)
using = {j for j, v in head.items() for s in v.get("steps", []) if s.get("run", "").strip() in (TEST, SWITCH)}
chk(using == TARGET, f"mirror steps only in the 3 e2e jobs: {sorted(using)}")
chk(set(head) == set(old), "same job set as base")
for j in sorted(set(head) - TARGET):
    chk(head[j] == old[j], f"{j}: identical to base") if head[j] != old[j] else None
chk(all(head[j] == old[j] for j in set(head) - TARGET), f"all {len(set(head) - TARGET)} non-target jobs identical to base")
for j in sorted(TARGET):
    h, o = head[j], old[j]
    chk(h.get("timeout-minutes") == 10 == o.get("timeout-minutes"), f"{j}: timeout-minutes 10 on base and head")
    chk({k: v for k, v in h.items() if k != "steps"} == {k: v for k, v in o.items() if k != "steps"}, f"{j}: job-level keys unchanged")
    hs = h["steps"]; runs = [s.get("run", "").strip() for s in hs]
    extra = [s for s in hs if s not in o["steps"]]
    chk([s.get("run", "").strip() for s in extra] == [TEST, SWITCH], f"{j}: only added steps are Test + Switch")
    chk([s for s in hs if s not in extra] == o["steps"], f"{j}: all base steps kept, unchanged, same order")
    inst = next(i for i, s in enumerate(hs) if "playwright install" in s.get("run", ""))
    chk(runs.index(TEST) < runs.index(SWITCH) < inst, f"{j}: Test < Switch < Install Playwright")
    chk(all(set(s) <= {"name", "run"} for s in extra), f"{j}: added steps have no if/continue-on-error/timeout/env")
    chk(not any("continue-on-error" in s for s in hs), f"{j}: no continue-on-error in any step")
    chk(not any("apt-mirror-probe" in s.get("run", "") for s in hs), f"{j}: no probe step")
print("VIOLATIONS:", len(bad)); sys.exit(1 if bad else 0)
