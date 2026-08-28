#!/usr/bin/env bash
# baseline.sh — أساسٌ آليٌّ للبيئةِ والاختبارات: أرتفاكتٌ قابلٌ للتكرارِ بصيغةٍ مُعلَنة. (M0-08)
#
# ── لماذا يوجد هذا الملف ───────────────────────────────────────────────
# قِيسَ قبلَ العمل على `artifacts/verify/verify-report.json` (مُخرَجُ `M0-04`):
#   • ستّةُ حقولٍ فقط: `generated_at` · `commit` · `branch` · `overall` · `checks`
#     · `reference` — **ولا حقلَ بيئةٍ واحدٌ**: لا إصدارَ node ولا pnpm ولا نظامَ
#     تشغيلٍ ولا بصمةَ لملفِّ القفل. فتقريرٌ يقول «نجح» ولا يقول **في أيِّ بيئةٍ**
#     لا يُعاد إنتاجُه، وإنّما يُصدَّق.
#   • ولا عدَّادَ واحدٌ: يقول `"الاختبارات": "passed"` ولا يقول **3379 اختباراً**.
#     فلو حُذفَ مئةُ اختبارٍ لبقيَ التقريرُ أخضرَ **ومتطابقاً حرفيّاً** — أي أنّ
#     «قابلٌ للتكرار» كان يتحقَّق بأسوأِ معناه: يتكرَّر لأنّه لا يقيس شيئاً.
#   • و`artifacts/` مُستثنىً في `.gitignore` (السطر 113) و`git ls-files artifacts`
#     خاوٍ — فلا أساسَ مرجعيٌّ مُلتزَمٌ في المستودعِ يُقارَن به شيءٌ أصلاً.
#   • والملفُّ الموجودُ في الشجرةِ كان بائتاً: التزامُه `aa53d07` لا `bfa806c7`.
#
# فهذا المولِّدُ يقيس **البيئةَ والعدَّاداتِ** ويُخرِج أرتفاكتاً بصيغةٍ مُعلَنةٍ
# (`docs/12-testing/BASELINE_FORMAT.md`) وببصمةٍ تُحسَب على ما يجب أن يتكرَّر
# وحدَه: `schema` + بصمةُ القفلِ + العدَّاداتُ الساكنةُ. والوقتُ والبيئةُ يُسجَّلان
# **ولا يُبصَّمان** — وإلّا استحالَ التكرارُ بالتعريف.
#
#   bash scripts/baseline.sh                              # يقيس ويكتب artifacts/baseline/
#   bash scripts/baseline.sh --log /tmp/verify.log        # ويقرأ العدَّاداتِ الحركيّةَ من سجلِّ تحقّقٍ
#   BASELINE_OUT=/tmp/b bash scripts/baseline.sh          # مخرجٌ آخرُ (للاختبار)
#   bash scripts/baseline.sh --stdout                     # يطبع JSON بلا كتابةِ ملفّات
#
# ── الحدُّ المُعلَن ────────────────────────────────────────────────────
# هذا المولِّدُ **لا يُشغِّل الاختباراتَ ولا الأنواعَ**: تشغيلُها عملُ
# `scripts/verify.sh`، وهذا يقرأ حصيلتَه. فإن لم يُمرَّر سجلٌّ، سُجِّلت العدَّاداتُ
# الحركيّةُ `null` و`dynamic.measured=false` — **ولا تُلفَّق ولا تُورَّث من تشغيلٍ
# سابقٍ**، لأنّ رقماً موروثاً أسوأُ من رقمٍ مفقودٍ: المفقودُ يُرى والموروثُ يُصدَّق.
#
# المرجع: docs/12-testing/BASELINE_FORMAT.md · docs/00-rules/VERIFY_COMMAND.md · M0-08

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${BASELINE_ROOT:-$(cd "$HERE/.." && pwd)}"
cd "$ROOT" || exit 1

OUT_DIR="${BASELINE_OUT:-artifacts/baseline}"
LOG=""
TO_STDOUT=0
while (($#)); do
  case "$1" in
    --log) LOG="${2:-}"; shift 2 ;;
    --stdout) TO_STDOUT=1; shift ;;
    *) printf 'استعمالٌ خاطئٌ: %s\n' "$1" >&2; exit 2 ;;
  esac
done

DIM=$'\033[2m'; GRN=$'\033[32m'; RST=$'\033[0m'

JSON="$(python3 - "$ROOT" "$LOG" <<'PY'
import glob, json, os, re, subprocess, sys

sys.path.insert(0, os.path.join(sys.argv[1], "scripts/checks/lib"))
import baseline_canon as canon  # noqa: E402

root, log = sys.argv[1], sys.argv[2]
os.chdir(root)


def sh(*cmd, default="unknown"):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=60).stdout.strip() or default
    except Exception:
        return default


# ── البيئةُ (تُسجَّل ولا تُبصَّم: سياقُ القياسِ لا المقيسُ) ───────────────────
env = {
    "node": sh("node", "-v"),
    "pnpm": sh("pnpm", "-v"),
    "os": sh("uname", "-s"),
    "arch": sh("uname", "-m"),
    "python": sys.version.split()[0],
}

# ── المستودعُ ─────────────────────────────────────────────────────────────
dirty_files = [l for l in sh("git", "status", "--porcelain", default="").splitlines() if l.strip()]
repo = {
    "commit": sh("git", "rev-parse", "HEAD"),
    "branch": os.environ.get("CI_COMMIT_REF_NAME") or sh("git", "rev-parse", "--abbrev-ref", "HEAD"),
    "dirty": bool(dirty_files),
    "dirty_files": len(dirty_files),
    "dirty_reason": os.environ.get("BASELINE_DIRTY_REASON", ""),
    "tracked_files": len([l for l in sh("git", "ls-files", default="").splitlines() if l]),
}

# ── ملفُّ القفلِ (هويّةُ شجرةِ الاعتماديات) ───────────────────────────────────
lock_path = "pnpm-lock.yaml"
lock = {"path": lock_path, "sha256": "", "lines": 0}
if os.path.exists(lock_path):
    lock["sha256"] = canon.sha256_file(lock_path)
    with open(lock_path, encoding="utf-8", errors="replace") as fh:
        lock["lines"] = sum(1 for _ in fh)

# ── العدَّاداتُ الساكنةُ (تُقاس بلا تشغيلِ شيءٍ — فهي المُبصَّمةُ) ──────────────
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

static = {
    "packages": len(pkgs),
    "packages_with_typecheck": with_tc,
    "packages_with_test": with_test,
    "test_files_tracked": len(test_files),
    "ci_jobs": ci_jobs,
    "ci_allow_failure": ci_af,
    "governance_checks": gov_checks,
    "risks_not_closed": risks_open,
}

# ── العدَّاداتُ الحركيّةُ (تُقرأ من سجلِّ تحقّقٍ إن مُرِّر — ولا تُلفَّق) ────────
dynamic = {
    "measured": False,
    "source": log or None,
    "tests_passed": None,
    "test_files_executed": None,
    "governance_suite_cases": None,
    "governance_suite_failed": None,
    "verify_overall": None,
}
if log and os.path.exists(log):
    text = open(log, encoding="utf-8", errors="replace").read()
    tp = [int(m) for m in re.findall(r"Tests\s+(\d+) passed", text)]
    tf = [int(m) for m in re.findall(r"Test Files\s+(\d+) passed", text)]
    suite = re.findall(r"النتيجة: (\d+) ناجح · (\d+) فاشل", text)
    if tp:
        dynamic["tests_passed"] = sum(tp)
    if tf:
        dynamic["test_files_executed"] = sum(tf)
    if suite:
        dynamic["governance_suite_cases"] = int(suite[-1][0])
        dynamic["governance_suite_failed"] = int(suite[-1][1])
    if "التحقّقُ الموحَّد: كلُّ الفحوصِ المُنفَّذةِ نجحت" in text:
        dynamic["verify_overall"] = "passed"
    elif re.search(r"التحقّقُ الموحَّد: \d+ فحصاً أخفق", text):
        dynamic["verify_overall"] = "failed"
    dynamic["measured"] = any(
        dynamic[k] is not None for k in ("tests_passed", "test_files_executed", "governance_suite_cases")
    )

doc = {
    "schema": canon.SCHEMA,
    "generated_at": os.environ.get("BASELINE_STAMP")
    or subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True).stdout.strip(),
    "generator": "scripts/baseline.sh",
    "repo": repo,
    "env": env,
    "lock": lock,
    "static": static,
    "dynamic": dynamic,
    "fingerprint": "",
    "reference": "docs/12-testing/BASELINE_FORMAT.md",
}
doc["fingerprint"] = canon.fingerprint(doc)
print(json.dumps(doc, ensure_ascii=False, indent=2))
PY
)" || { printf 'تعذّر توليدُ الأساس.\n' >&2; exit 1; }

if ((TO_STDOUT)); then
  printf '%s\n' "$JSON"
  exit 0
fi

mkdir -p "$OUT_DIR"
printf '%s\n' "$JSON" > "$OUT_DIR/baseline.json"

python3 - "$OUT_DIR/baseline.json" > "$OUT_DIR/baseline.txt" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
w = sys.stdout.write
w("أساسُ البيئةِ والاختبارات — WASLA\n")
w(f"الصيغةُ: {d['schema']}\nالتاريخ (UTC): {d['generated_at']}\n")
r, e, l = d["repo"], d["env"], d["lock"]
w(f"الالتزام: {r['commit']}  الفرع: {r['branch']}  "
  f"{'شجرةٌ مُعدَّلةٌ (' + str(r['dirty_files']) + ' ملفّاً)' if r['dirty'] else 'شجرةٌ نظيفةٌ'}\n")
w(f"البيئة: node {e['node']} · pnpm {e['pnpm']} · {e['os']}/{e['arch']} · python {e['python']}\n")
w(f"القفل: {l['path']} · {l['lines']} سطراً · sha256 {l['sha256'][:16]}…\n\n")
w("العدَّاداتُ الساكنةُ (مُبصَّمةٌ):\n")
for k, v in d["static"].items():
    w(f"  {k:26} {v}\n")
w("\nالعدَّاداتُ الحركيّةُ (%s):\n" % ("مقيسةٌ من " + str(d["dynamic"]["source"]) if d["dynamic"]["measured"] else "غيرُ مقيسةٍ — لم يُمرَّر سجلُّ تحقّقٍ"))
for k in ("tests_passed", "test_files_executed", "governance_suite_cases",
          "governance_suite_failed", "verify_overall"):
    v = d["dynamic"][k]
    w(f"  {k:26} {'—' if v is None else v}\n")
w(f"\nالبصمة: {d['fingerprint']}\nالمرجع: {d['reference']}\n")
PY

printf '%s✓ الأساس:%s %s/baseline.json · %s/baseline.txt\n' "$GRN" "$RST" "$OUT_DIR" "$OUT_DIR"
printf '  %sالبصمة: %s%s\n' "$DIM" "$(python3 -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf-8'))['fingerprint'])" "$OUT_DIR/baseline.json")" "$RST"
exit 0
