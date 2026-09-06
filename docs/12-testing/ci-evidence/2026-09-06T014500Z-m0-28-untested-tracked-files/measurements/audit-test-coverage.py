#!/usr/bin/env python3
"""أداةُ قياسٍ لا حارسٌ — تُجيب سؤالاً واحداً:

كلُّ ملفِّ اختبارٍ متعقَّبٍ لا يُنفِّذُه `pnpm -r test` — أيُنفَّذُ في CI أم لا يُنفَّذُ
في مكانٍ أصلاً؟ فالفرقُ بين «مستثنًى بقصدٍ» و«ميْتٍ» هو الفرقُ كلُّه.

على طورَينِ: الأوّلُ يستنتج التغطيةَ من الإعداداتِ ومصفوفاتِ CI — **وهو استنتاجٌ**؛
والثاني يقرأ **سجلّاتِ وظائفِ CI الفعليّةَ** فيرى الملفَّ يركض أو لا يراه. والثاني
هو الحجّةُ، والأوّلُ تمهيدٌ له.

  python3 audit-test-coverage.py <verify.log> [--ci-logs <dir>] > raw.json

و`<dir>` مجلَّدُ سجلّاتٍ خامٍّ فيه `jobs.json` و`<job_id>.log` لكلِّ وظيفةٍ،
يُجلَب بـ`gh api repos/<repo>/actions/jobs/<id>/logs`. **ولا يُحفَظ خامّاً في
الشجرةِ** (نحوُ ميغابايتٍ) بل يُقطَّر إلى `api-responses/` بهذه الأداةِ نفسِها.

لا تُسلَك في scripts/checks/: هذا قياسُ دفعةٍ لا بوّابةٌ دائمةٌ.
"""
import json, os, re, subprocess, sys, collections, fnmatch, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[5]

def sh(cmd):
    return subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True).stdout

TESTRE = re.compile(r'\.(test|spec)\.[cm]?tsx?$')
tracked = sorted(p for p in sh("git ls-files").splitlines() if TESTRE.search(p))

# ── الملفّاتُ التي نفَّذها `pnpm -r test` فعلاً (من سجلِّ تحقّقٍ أخضرَ) ──────────
log_path = sys.argv[1]
CI_DIR = sys.argv[sys.argv.index("--ci-logs") + 1] if "--ci-logs" in sys.argv else None
ANSI = re.compile(r"\x1b\[[0-9;]*m")
log = open(log_path, encoding="utf-8", errors="replace").read()
executed = set()
for ln in log.splitlines():
    m = re.match(r'^\s*([\w@./-]+) test:\s*(.*)$', ln)
    if not m:
        continue
    f = re.match(r'^[✓✗×]\s+(\S+\.(?:test|spec)\.[cm]?tsx?)', m.group(2).strip())
    if f:
        executed.add(f"{m.group(1)}/{f.group(1)}")

missing = sorted(set(tracked) - executed)

# ── خرائطُ CI ────────────────────────────────────────────────────────────────
ci = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
def legs(after):
    seg = ci[ci.index(after):]
    seg = seg[:seg.index("\n    services:")] if "\n    services:" in seg else seg
    return set(re.findall(r'pkg:\s*"([^"]+)"', seg))
db_legs = legs("\n  db-integration:")
e2e_legs = legs("\n  exit-gate-e2e:")
shared = set(re.findall(r'"[a-z]+\|(@wasla/[a-z-]+)"',
                        (ROOT / "scripts/ci/run-shared-db-integration.sh").read_text(encoding="utf-8")))

# ── اسمُ الحزمةِ ومسارُها ─────────────────────────────────────────────────────
pkgname, pkgdirs = {}, []
for pj in sh("git ls-files '*/package.json'").splitlines():
    d = os.path.dirname(pj)
    if "node_modules" in d:
        continue
    try:
        n = json.loads((ROOT / pj).read_text(encoding="utf-8")).get("name")
    except Exception:
        continue
    if n:
        pkgname[d] = n
        pkgdirs.append(d)
pkgdirs.sort(key=len, reverse=True)

def owner(path):
    for d in pkgdirs:
        if path.startswith(d + "/"):
            return d
    return None

def includes(cfg_path, rel):
    if not (ROOT / cfg_path).exists():
        return None
    t = (ROOT / cfg_path).read_text(encoding="utf-8")
    m = re.search(r'include:\s*\[([^\]]*)\]', t)
    if not m:
        return None
    for pat in re.findall(r'"([^"]+)"', m.group(1)):
        for exp in ([pat] if "{" not in pat else
                    [re.sub(r'\{[^}]*\}', a, pat, count=1)
                     for a in re.search(r'\{([^}]*)\}', pat).group(1).split(",")]):
            if fnmatch.fnmatch(rel, exp):
                return True
    return False

rows = []
for f in missing:
    d = owner(f)
    rel = f[len(d) + 1:] if d else f
    name = pkgname.get(d)
    scripts = json.loads((ROOT / d / "package.json").read_text(encoding="utf-8")).get("scripts", {}) if d else {}
    inc_int = includes(f"{d}/vitest.integration.config.ts", rel) if d else None
    covered_by = []
    if inc_int and "test:integration" in scripts:
        if name in db_legs:
            covered_by.append("db-integration")
        if name in shared:
            covered_by.append("db-integration-shared")
    if name in e2e_legs:
        covered_by.append("exit-gate-e2e")
    rows.append({"file": f, "package_dir": d, "package": name,
                 "matched_integration_include": inc_int,
                 "has_test_integration_script": "test:integration" in scripts,
                 "covered_by_ci_jobs": covered_by,
                 "executed_nowhere": not covered_by})

# ── العكسُ: حزمٌ لها `test:integration` ولا وظيفةَ CI تستدعيها ────────────────
orphan = []
for d in pkgdirs:
    s = json.loads((ROOT / d / "package.json").read_text(encoding="utf-8")).get("scripts", {})
    n = pkgname[d]
    if "test:integration" in s and n not in db_legs and n not in shared:
        orphan.append({"package_dir": d, "package": n})

# ── الطورُ الثاني: سجلّاتُ وظائفِ CI الفعليّةُ — ما رُئيَ يركض لا ما استُنتِج ────
observed = collections.defaultdict(set)
ci_extract, ci_meta = {}, None
if CI_DIR:
    jobs = json.load(open(os.path.join(CI_DIR, "jobs.json"), encoding="utf-8"))
    for j in jobs:
        lp = os.path.join(CI_DIR, f"{j['id']}.log")
        if not os.path.exists(lp):
            continue
        txt = ANSI.sub("", open(lp, encoding="utf-8", errors="replace").read())
        cur, per, tf = None, collections.defaultdict(list), []
        for ln in txt.splitlines():
            ln = re.sub(r"^\S+Z ", "", ln)
            m = re.search(r"RUN\s+v[\d.]+\s+(\S+)", ln)
            if m:
                # `RUN v3.2.7 /__w/wasla/wasla/services/x` ⇒ `services/x`
                cur = m.group(1).split("/__w/wasla/wasla/")[-1].rstrip("/")
            hit = re.match(r"\s*([✓✗×])\s+(\S+\.(?:test|spec)\.[cm]?tsx?)", ln)
            if hit and cur:
                per[cur].append({"mark": hit.group(1), "file": hit.group(2)})
                observed[f"{cur}/{hit.group(2)}"].add(j["name"])
            c = re.search(r"Test Files\s+(\d+) passed", ln)
            if c:
                tf.append(int(c.group(1)))
        ci_extract[j["name"]] = {"job_id": j["id"], "scopes": dict(per), "test_files_passed": tf}
    ci_meta = {"jobs_read": len(ci_extract),
               "attribution": "vitest `RUN v<ver> <cwd>` يُسنِد كلَّ سطرِ ✓ إلى حزمتِه — فلا يُخلَط ملفّانِ متشابهانِ في الاسمِ",
               "files_observed_running": sum(1 for r in rows if observed.get(r["file"])),
               "files_not_observed": [r["file"] for r in rows if not observed.get(r["file"])]}

for r in rows:
    r["observed_in_ci_jobs"] = sorted(observed.get(r["file"], []))
    r["executed_nowhere"] = not r["covered_by_ci_jobs"] and not r["observed_in_ci_jobs"]

out = {
    "measured_at_commit": sh("git rev-parse HEAD").strip(),
    "verify_log": os.path.relpath(log_path, ROOT) if log_path.startswith(str(ROOT)) else log_path,
    "tracked_test_files": len(tracked),
    "executed_by_pnpm_r_test": len(executed),
    "not_executed_locally": len(missing),
    "ci_matrices": {"db_integration": sorted(db_legs),
                    "db_integration_shared": sorted(shared),
                    "exit_gate_e2e": sorted(e2e_legs)},
    "files": rows,
    "executed_nowhere": [r["file"] for r in rows if r["executed_nowhere"]],
    "orphan_integration_scripts": orphan,
    "ci_log_verification": ci_meta,
    "ci_extract_written_to": "api-responses/ci-run-test-files.json" if CI_DIR else None,
}
if CI_DIR:
    dest = pathlib.Path(__file__).resolve().parent.parent / "api-responses"
    dest.mkdir(exist_ok=True)
    json.dump({"source": "GET repos/skyosv10-art/wasla/actions/jobs/<id>/logs", "jobs": ci_extract},
              open(dest / "ci-run-test-files.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False, indent=2))
