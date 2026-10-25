#!/usr/bin/env bash
# validate-baseline.sh — «أساسٌ يُقارَن به، لا رقمٌ يُصدَّق»: أربعةُ أبوابٍ. (M0-08)
#
# ── لماذا يوجد هذا الملف ───────────────────────────────────────────────
# قِيسَ قبلَ العمل: أرتفاكتُ `M0-04` (`artifacts/verify/verify-report.json`) ستّةُ
# حقولٍ **بلا حقلِ بيئةٍ واحدٍ وبلا عدَّادٍ واحدٍ**، و`artifacts/` مُستثنىً في
# `.gitignore` فلا أساسَ مُلتزَمٌ في المستودعِ أصلاً. فالخانةُ تطلب «artifacts قابلة
# للتكرار» — وقابليّةُ التكرارِ **دعوى لا تُصدَّق إلّا ببرهانٍ**: أساسٌ مُلتزَمٌ،
# وبصمةٌ تُحسَب بقانونٍ واحدٍ، وحارسٌ يقيس الحيَّ ويقارنه به.
#
# ── الأبوابُ الأربعة ──────────────────────────────────────────────────
# 1) **الصيغةُ والاتّساقُ الذاتيُّ:** الأساسُ المُلتزَمُ موجودٌ، JSON صالحٌ، مُعرِّفُ
#    الصيغةِ مطابقٌ، وكلُّ حقلٍ إلزاميٍّ موجودٌ ومن نوعِه، **والبصمةُ المكتوبةُ فيه
#    تساوي البصمةَ المُعادَ حسابُها من محتوياتِه**. فمن حرَّر عدَّاداً بيدِه ونسيَ
#    البصمةَ سقطَ هنا — وهذا وحدَه يمنع «تحديثَ الأساسِ» بالتمنّي.
# 2) **لا انحدارَ صامتاً:** تُقاس العدَّاداتُ الساكنةُ **حيّاً** من الشجرةِ الآنَ
#    وتُقارَن بالأساس. أيُّ فرقٍ يُسقِط البوّابةَ بدلتا مفصَّلةٍ — لا لأنّ التغييرَ
#    حرامٌ، بل لأنّه **يُعلَن بقرارٍ**: يُعاد توليدُ الأساسِ ويُدفَع مع سببِه.
# 3) **التكرارُ يُثبَت لا يُدَّعى:** يُبرهَن داخلَ الحارسِ أنّ البصمةَ **لا تتغيَّر**
#    بتغيُّرِ الوقتِ والبيئةِ والعدَّاداتِ الحركيّةِ، و**تتغيَّر** بتغيُّرِ عدَّادٍ
#    ساكنٍ واحدٍ. فلو أُدخِلَ الوقتُ في البصمةِ يوماً لسقطَ هذا البابُ فوراً، ولو
#    أُخرِجَ عدَّادٌ منها لسقطَ أيضاً.
# 4) **لا أساسَ يتيماً ولا مُجمِّلاً:** صيغتُه موثَّقةٌ في `BASELINE_FORMAT.md`،
#    ومُحالٌ إليه من اللوحةِ ومن `VERIFY_COMMAND.md`، وعدَّاداتُه الحركيّةُ
#    **مقيسةٌ** (أساسٌ بلا أرقامِ اختباراتٍ ليس أساساً)، وشجرةٌ مُعدَّلةٌ عندَ
#    التوليدِ تقتضي سبباً مكتوباً لا صمتاً.
#
# ── الحدُّ المُعلَن ────────────────────────────────────────────────────
# البابُ الثاني يقارن **الساكنَ وحدَه** (ما يُقاس بلا تشغيلِ شيءٍ). والعدَّاداتُ
# الحركيّةُ (3379 اختباراً · 203 ملفَّ تنفيذٍ · 120 حالةَ حوكمةٍ) تُقاس بـ
# `scripts/verify.sh` ثمَّ تُودَع بـ`--log`؛ فهذا الحارسُ يتحقَّق من **وجودِها
# وصدقِ بصمتِها** لا من إعادةِ إنتاجِها — إعادةُ إنتاجِها تحتاج ستَّ دقائقَ
# وبيئةً باعتمادياتٍ، وحارسٌ يفعل ذلك في كلِّ دفعةٍ يُعطَّل بعدَ أسبوعٍ.
# ولا يحكم على **صوابِ** الأرقامِ (هل 3379 كافٍ؟) ولا على تغطيةٍ (`RISK-0005`).
# ولا يشترط أن يكون الأساسُ مُثبَّتاً على تشغيلٍ **أخضرَ**: ذلك شرطٌ يُنشئ حلقةً
# مفرغةً (لا أساسَ إلّا من أخضرَ ولا أخضرَ إلّا بأساسٍ)، فالمشروطُ **تسجيلُ**
# الحكمِ لا لونُه؛ ولونُه يحكم به `scripts/verify.sh` وحدَه.
#
#   bash scripts/checks/validate-baseline.sh            # المستودعُ نفسُه
#   bash scripts/checks/validate-baseline.sh /tmp/root   # جذرٌ صريحٌ (للاختبار)
#
# المرجع: docs/12-testing/BASELINE_FORMAT.md · scripts/baseline.sh · M0-08

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF_ROOT="$(cd "$HERE/../.." && pwd)"
ROOT="${1:-$SELF_ROOT}"
ROOT="$(cd "$ROOT" && pwd)" || exit 1

BASE="$ROOT/docs/12-testing/BASELINE.json"
FMT="$ROOT/docs/12-testing/BASELINE_FORMAT.md"
BOARD="$ROOT/docs/16-progress/LAUNCH_EXECUTION_BOARD.md"
VC="$ROOT/docs/00-rules/VERIFY_COMMAND.md"
GEN="$SELF_ROOT/scripts/baseline.sh"
LIB="$SELF_ROOT/scripts/checks/lib"

GRN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RST=$'\033[0m'
PROBLEMS=()

# ── البابُ 1: الصيغةُ والاتّساقُ الذاتيُّ ──────────────────────────────────
if [[ ! -f "$BASE" ]]; then
  printf '%s✗ الأساسُ المرجعيُّ مفقود:%s docs/12-testing/BASELINE.json\n' "$RED" "$RST"
  printf '  %sيُولَّد بـ: bash scripts/baseline.sh --log <سجلُّ تحقّقٍ> ثمَّ يُنسَخ إلى docs/12-testing/BASELINE.json%s\n' "$DIM" "$RST"
  printf '  %sالمرجع: docs/12-testing/BASELINE_FORMAT.md · العنصر M0-08%s\n' "$DIM" "$RST"
  exit 1
fi

DOOR1="$(python3 - "$BASE" "$LIB" <<'PY'
import json, sys
sys.path.insert(0, sys.argv[2])
import baseline_canon as canon

problems = []
try:
    doc = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception as exc:
    print("FATAL|الأساسُ ليس JSON صالحاً: %s" % exc)
    raise SystemExit(0)

if not isinstance(doc, dict):
    print("FATAL|الأساسُ ليس كائناً (object) في جذرِه.")
    raise SystemExit(0)

if doc.get("schema") != canon.SCHEMA:
    problems.append("البابُ 1: مُعرِّفُ الصيغةِ «%s» لا يطابق «%s» — صيغةٌ بلا إصدارٍ لا يحكم عليها حارسٌ."
                    % (doc.get("schema"), canon.SCHEMA))

for key in canon.REQUIRED_TOP:
    if key not in doc:
        problems.append("البابُ 1: حقلٌ إلزاميٌّ مفقودٌ في الجذر — «%s»." % key)

static = doc.get("static")
if not isinstance(static, dict):
    problems.append("البابُ 1: `static` ليس كائناً — لا عدَّاداتَ تُبصَّم.")
else:
    for key in canon.REQUIRED_STATIC:
        if key not in static:
            problems.append("البابُ 1: عدَّادٌ ساكنٌ مفقودٌ — «static.%s»." % key)
        elif not isinstance(static[key], int) or isinstance(static[key], bool) or static[key] < 0:
            problems.append("البابُ 1: «static.%s» ليس عدداً صحيحاً غيرَ سالبٍ — «%r»." % (key, static[key]))

lock = doc.get("lock") or {}
if not isinstance(lock, dict) or len(str(lock.get("sha256", ""))) != 64:
    problems.append("البابُ 1: `lock.sha256` ليس بصمةً من 64 محرفاً — هويّةُ شجرةِ الاعتمادياتِ مفقودةٌ.")

repo = doc.get("repo") or {}
if not isinstance(repo, dict) or len(str(repo.get("commit", ""))) != 40:
    problems.append("البابُ 1: `repo.commit` ليس التزاماً من 40 محرفاً.")

env = doc.get("env") or {}
for key in ("node", "pnpm", "os", "arch"):
    if not str(env.get(key, "")).strip() or env.get(key) == "unknown":
        problems.append("البابُ 1: `env.%s` فارغٌ أو مجهولٌ — أساسٌ بلا بيئةٍ لا يُعاد إنتاجُه." % key)

recomputed = canon.fingerprint(doc)
written = doc.get("fingerprint")
if written != recomputed:
    problems.append("البابُ 1: البصمةُ المكتوبةُ لا تساوي المُعادَ حسابُها — مكتوبةٌ «%s» والصحيحةُ «%s». "
                    "عُدِّل عدَّادٌ بيدٍ بلا إعادةِ توليدٍ." % (written, recomputed))

for p in problems:
    print("P|" + p)
print("FP|" + recomputed)
PY
)"

if [[ "$DOOR1" == FATAL\|* ]]; then
  printf '%s✗ %s%s\n' "$RED" "${DOOR1#FATAL|}" "$RST"
  exit 1
fi
while IFS= read -r line; do
  [[ "$line" == P\|* ]] && PROBLEMS+=("${line#P|}")
done <<< "$DOOR1"

(( ${#PROBLEMS[@]} == 0 )) && printf '  %s✓ البابُ 1:%s الصيغةُ كاملةٌ والبصمةُ متّسقةٌ مع محتوياتِها.\n' "$GRN" "$RST"

# ── البابُ 2: لا انحدارَ صامتاً ───────────────────────────────────────────
if [[ ! -x "$GEN" && ! -f "$GEN" ]]; then
  PROBLEMS+=("البابُ 2: مولِّدُ الأساسِ مفقودٌ — scripts/baseline.sh.")
else
  LIVE="$(BASELINE_ROOT="$ROOT" bash "$GEN" --stdout 2>/dev/null)" || LIVE=""
  if [[ -z "$LIVE" ]]; then
    PROBLEMS+=("البابُ 2: تعذّر قياسُ الحالةِ الحيّةِ (فشلَ scripts/baseline.sh --stdout) — لا مقارنةَ ممكنةً.")
  else
    # لا يُمرَّر الحيُّ عبرَ stdin: الـheredoc يشغل stdin أصلاً، فيُقرأ السكربتُ
    # مكانَ البياناتِ ويُخفق التحليلُ **صامتاً فيُقرأ صفرُ فروقٍ نجاحاً**.
    # وقع هذا فعلاً في أوّلِ تشغيلٍ للبابِ: تتبّعُ Python طُبِع والبابُ قال «✓».
    # فأُصلح بملفٍ مؤقّتٍ **وبوسمِ نجاحٍ إلزاميٍّ** (`OK|`): غيابُ الوسمِ إخفاقٌ
    # لا نجاحٌ — فحارسٌ يعُدُّ صمتَ العُطلِ مروراً أسوأُ من لا حارس.
    LIVE_TMP="$(mktemp)"; printf '%s\n' "$LIVE" > "$LIVE_TMP"
    DOOR2="$(python3 - "$BASE" "$LIVE_TMP" <<'PY'
import json, sys
live = json.load(open(sys.argv[2], encoding="utf-8"))
base = json.load(open(sys.argv[1], encoding="utf-8"))
ls, bs = live.get("static") or {}, base.get("static") or {}
diffs = []
for key in sorted(set(ls) | set(bs)):
    if ls.get(key) != bs.get(key):
        diffs.append("«%s»: الأساسُ %r · الحيُّ %r" % (key, bs.get(key), ls.get(key)))
if (live.get("lock") or {}).get("sha256") != (base.get("lock") or {}).get("sha256"):
    diffs.append("بصمةُ pnpm-lock.yaml تغيَّرت (شجرةُ الاعتمادياتِ ليست هي)")
for d in diffs:
    print("D|" + d)
print("OK|اكتمل التحليل")
PY
)"
    rm -f "$LIVE_TMP"
    # لا أنبوبَ قبلَ `grep -q` (`RISK-0037`): يخرجُ `grep` عندَ أوّلِ تطابقٍ فيموتُ
    # `printf` بـ`SIGPIPE` فتصيرُ حالةُ الأنبوبِ 141 تحتَ `pipefail` فتُقرأُ «لا
    # تطابق» — رفضٌ كاذبٌ **احتماليٌّ** (مقيسٌ: 9/300 للمقارنةِ الواحدةِ · 0/300
    # بهذهِ الصيغةِ). وهنا أخطرُ من غيرِه: «لم يكتملِ التحليلُ» تُقالُ عن تحليلٍ
    # **اكتملَ**، فيُتَّهَمُ الأساسُ بعُطلٍ لا وجودَ له.
    if ! grep -q '^OK|' <<< "$DOOR2"; then
      PROBLEMS+=("البابُ 2: تعذّرت مقارنةُ الحيِّ بالأساسِ (لم يكتمل التحليلُ) — ولا يُقرأ العُطلُ نجاحاً.")
    fi
    DIFFS=()
    while IFS= read -r line; do
      [[ "$line" == D\|* ]] && DIFFS+=("${line#D|}")
    done <<< "$DOOR2"
    if (( ${#DIFFS[@]} > 0 )); then
      PROBLEMS+=("البابُ 2: الحالةُ الحيّةُ تخالف الأساسَ المُلتزَمَ في ${#DIFFS[@]} موضعاً — يُعاد توليدُ الأساسِ بقرارٍ مكتوبٍ لا يُهمَل:")
      for d in "${DIFFS[@]}"; do PROBLEMS+=("          · $d"); done
    elif grep -q '^OK|' <<< "$DOOR2"; then
      printf '  %s✓ البابُ 2:%s العدَّاداتُ الساكنةُ الحيّةُ تطابق الأساسَ المُلتزَمَ (لا انحدارَ ولا زحفَ صامتاً).\n' "$GRN" "$RST"
    fi
  fi
fi

# ── البابُ 3: التكرارُ يُثبَت لا يُدَّعى ────────────────────────────────────
DOOR3="$(python3 - "$BASE" "$LIB" <<'PY'
import copy, json, sys
sys.path.insert(0, sys.argv[2])
import baseline_canon as canon

doc = json.load(open(sys.argv[1], encoding="utf-8"))
fp = canon.fingerprint(doc)
problems = []

# (أ) الثباتُ: نفسُ الوثيقةِ → نفسُ البصمةِ (لا عشوائيّةَ ولا ترتيبَ مفاتيحَ يؤثِّر)
shuffled = dict(reversed(list(doc.items())))
if canon.fingerprint(shuffled) != fp:
    problems.append("البابُ 3: البصمةُ تتغيَّر بترتيبِ المفاتيحِ — القانونُ ليس قانونيّاً.")

# (ب) المتغيِّراتُ لا تُبصَّم: تغييرُ الوقتِ والبيئةِ والحركيِّ لا يُغيِّر البصمةَ
for field, mutation in (
    ("generated_at", "1999-01-01T00:00:00Z"),
    ("env", {"node": "v0.0.0", "pnpm": "0.0.0", "os": "X", "arch": "y"}),
    ("dynamic", {"measured": False, "tests_passed": 1}),
    ("repo", {"commit": "0" * 40, "branch": "x", "dirty": False}),
):
    m = copy.deepcopy(doc)
    m[field] = mutation
    if canon.fingerprint(m) != fp:
        problems.append("البابُ 3: «%s» يدخل البصمةَ وهو متغيِّرٌ بطبعِه — فيستحيل التكرارُ بالتعريف." % field)

# (ج) الجوهرُ يُبصَّم: تغييرُ عدَّادٍ ساكنٍ أو بصمةِ القفلِ **يجب** أن يُغيِّرها
for key in canon.REQUIRED_STATIC:
    m = copy.deepcopy(doc)
    m["static"][key] = (m["static"].get(key) or 0) + 1
    if canon.fingerprint(m) == fp:
        problems.append("البابُ 3: «static.%s» لا يدخل البصمةَ — عدَّادٌ يُبدَّل بلا أثرٍ." % key)
m = copy.deepcopy(doc)
m["lock"]["sha256"] = "0" * 64
if canon.fingerprint(m) == fp:
    problems.append("البابُ 3: بصمةُ القفلِ لا تدخل البصمةَ — شجرةُ اعتمادياتٍ تُستبدَل بلا أثرٍ.")

for p in problems:
    print("P|" + p)
PY
)"
D3=0
while IFS= read -r line; do
  if [[ "$line" == P\|* ]]; then PROBLEMS+=("${line#P|}"); ((D3++)); fi
done <<< "$DOOR3"
(( D3 == 0 )) && printf '  %s✓ البابُ 3:%s البصمةُ ثابتةٌ على المتغيِّراتِ ومتغيِّرةٌ على الجوهرِ (8 عدَّاداتٍ + القفل).\n' "$GRN" "$RST"

# ── البابُ 4: لا أساسَ يتيماً ولا مُجمِّلاً ─────────────────────────────────
D4=0
[[ -f "$FMT" ]] || { PROBLEMS+=("البابُ 4: صيغةُ الأساسِ غيرُ موثَّقةٍ — docs/12-testing/BASELINE_FORMAT.md مفقودٌ."); ((D4++)); }
for f in "$BOARD" "$VC"; do
  [[ -f "$f" ]] || continue
  grep -q "BASELINE" "$f" || { PROBLEMS+=("البابُ 4: لا إحالةَ إلى الأساسِ في ${f#$ROOT/} — أساسٌ لا يُحال إليه لا يُحدَّث."); ((D4++)); }
done
DOOR4="$(python3 - "$BASE" "$ROOT" "$LIB" <<'PY'
import json, os, sys
sys.path.insert(0, sys.argv[3])
import baseline_commit
doc = json.load(open(sys.argv[1], encoding="utf-8"))
root = sys.argv[2]
dyn = doc.get("dynamic") or {}
repo = doc.get("repo") or {}
problems = []
if not dyn.get("measured"):
    problems.append("البابُ 4: `dynamic.measured=false` — أساسٌ بلا أرقامِ اختباراتٍ مقيسةٍ ليس أساساً. يُولَّد بـ--log.")
for key in ("tests_passed", "test_files_executed", "governance_suite_cases"):
    v = dyn.get(key)
    if not isinstance(v, int) or v <= 0:
        problems.append("البابُ 4: `dynamic.%s` غيرُ مقيسٍ («%r») — العددُ المفقودُ يُرى، والموروثُ يُصدَّق." % (key, v))
# ولا يُشترط أن يكون الحكمُ «passed»: شرطُ الخُضرةِ يُنشئ **حلقةً مفرغةً** —
# فأوّلُ أساسٍ لا يُولَّد إلّا من تشغيلٍ أخضرَ، والتشغيلُ لا يخضرّ إلّا بأساسٍ
# مُثبَّتٍ. وقعت الحلقةُ فعلاً في M0-08 ولم تُكسَر إلّا بتلفيقٍ أو بهذا القرار:
# **يُشترط أن يكون الحكمُ مُسجَّلاً لا أن يكون أخضرَ** — والخُضرةُ يحكم بها
# `scripts/verify.sh` نفسُه لا الأساسُ.
gsf = dyn.get("governance_suite_failed")
if not isinstance(gsf, int) or isinstance(gsf, bool) or gsf < 0:
    problems.append("البابُ 4: `dynamic.governance_suite_failed` غيرُ مُسجَّلٍ («%r») — عددُ الإخفاقاتِ يُكتب ولو كان صفراً." % gsf)
if dyn.get("verify_overall") not in ("passed", "failed"):
    problems.append("البابُ 4: `dynamic.verify_overall` = %r — حكمُ التحقّقِ يُسجَّل (passed أو failed) ولا يُترك مجهولاً." % dyn.get("verify_overall"))
# RISK-0028 (CLM-0414, 2026-09-30): the dynamic numbers must be traceable.
# (a) `dynamic.source` must be a file inside the tree, not a temporary path or a
#     bare run id that nobody can re-read, and it must contain the recorded
#     `tests_passed` number.
src = str(dyn.get("source", "")).strip()
src_path = os.path.join(root, src) if src and not os.path.isabs(src) else ""
if not src_path or not os.path.isfile(src_path):
    problems.append("البابُ 4: `dynamic.source` = %r ليس ملفّاً داخلَ الشجرةِ — رقمٌ حركيٌّ بلا مصدرٍ يُعاد قراءتُه (RISK-0028)." % src)
else:
    # Recompute from the source with the generator's own rule (scripts/baseline.sh:
    # the sum of every vitest "Tests N passed" line) and require equality. The first
    # version of this gate looked for the literal total in the log; the total is a
    # sum and never appears literally, so the gate rejected every honest baseline.
    import re as _re
    _text = open(src_path, encoding="utf-8", errors="replace").read()
    _tp = [int(m) for m in _re.findall(r"Tests\s+(\d+) passed", _text)]
    if not _tp or sum(_tp) != dyn.get("tests_passed"):
        problems.append("البابُ 4: `dynamic.source` لا يُثبِتُ `tests_passed`=%r — مجموعُ «Tests N passed» فيه %r (RISK-0028)." % (dyn.get("tests_passed"), sum(_tp) if _tp else None))
# (b) `repo.commit` must resolve when the checkout has full history
#     (governance-guard uses fetch-depth: 0). A shallow or non-git root is
#     reported, not silently passed.
#     CLM-0538 (structural fix of the RISK-0028 recurrence): the baseline is
#     measured on a branch, and the squash merge deletes that branch, so the
#     recorded commit vanished from every fetched ref and `main` went red after
#     each PR that touched BASELINE.json (PR #688 -> CLM-0533, PR #691 ->
#     CLM-0536). The commit still exists in the repository of record (GitHub
#     keeps refs/pull/N/head). `baseline_commit.ensure` retrieves exactly that
#     SHA from origin when the local cache lacks it. A SHA that exists nowhere
#     still fails here.
commit = str(repo.get("commit", ""))
status, detail = baseline_commit.ensure(root, commit)
if status == "fetched":
    print("N|البابُ 4: `repo.commit` = %s غائبٌ محلّيّاً فاستُرجِعَ من `origin` بمعرّفِهِ — موجودٌ في المستودعِ المرجعيِّ (CLM-0538)." % commit[:12])
elif status == "shallow":
    print("N|البابُ 4: نسخةٌ ضحلةٌ — حلُّ `repo.commit` غيرُ مقيسٍ هنا (يُقاس في governance-guard بـfetch-depth: 0).")
elif status in ("missing", "invalid"):
    problems.append("البابُ 4: `repo.commit` = %s لا يُحَلُّ في المستودعِ ولا في `origin` — أساسٌ لا يُرجَعُ إلى التزامٍ قائمٍ (RISK-0028) · %s." % (commit[:12], detail))
if repo.get("dirty") and not str(repo.get("dirty_reason", "")).strip():
    problems.append("البابُ 4: الأساسُ وُلِّد من شجرةٍ مُعدَّلةٍ بلا `repo.dirty_reason` — شجرةٌ مُعدَّلةٌ بلا سببٍ مكتوبٍ تجعل الأساسَ غيرَ قابلٍ للإرجاع.")
# (د) CLM-0680 (RISK-0011 — الأجزاءُ غيرَ القراريّةِ): «متى وُلِّدَ الأساسُ؟» لم يكن
#     مقيساً أصلاً — `generated_at` لم يُفحَص لا صيغةً ولا عقلًا. هذا ليسَ سياسةَ
#     قِدَمٍ (حدُّ الأقدميّةِ قرارُ المالكِ — M0-08) بل سلامةٌ واتّساقٌ فقط:
#     طابعٌ زمنيٌّ مفهومٌ · ليسَ في المستقبلِ (هامشُ سماحةٍ 5 دقائق) · لا يسبقُ
#     زمنَ الالتزامِ الذي زعمَ أنّه قاسَهُ (أساسٌ من شجرةٍ لا يُولَّدُ قبلَها).
#     واتّصالُ الالتزامِ بـmain يُقاسُ ويُعلَنُ **إشعاراً** لا يُحكَمُ به هنا —
#     البوّابةُ (انجرافٌ أم حدُّ قِدَمٍ) قرارُ المالكِ المعروضُ في M0-08.
import subprocess as _sp
from datetime import datetime as _dt, timezone as _tz, timedelta as _td
gen = str(doc.get("generated_at", "")).strip()
gen_dt = None
try:
    gen_dt = _dt.fromisoformat(gen.replace("Z", "+00:00"))
    if gen_dt.tzinfo is None:
        gen_dt = gen_dt.replace(tzinfo=_tz.utc)
except (ValueError, AttributeError):
    problems.append("البابُ 4: `generated_at` = %r ليس طابعاً زمنيّاً مفهوماً (RFC 3339) — أساسٌ بلا زمنِ ولادةٍ صالحٍ لا يُعرفُ قِدَمُه (RISK-0011 · CLM-0680)." % gen)
if gen_dt is not None:
    if gen_dt > _dt.now(_tz.utc) + _td(minutes=5):
        problems.append("البابُ 4: `generated_at` = %s في المستقبلِ — طابعٌ لم يحنَ وقتُهُ لا يُقاسُ منه قِدَمٌ صادقٌ (RISK-0011 · CLM-0680)." % gen)
    if commit and status in ("local", "fetched"):
        _r = _sp.run(["git", "-C", root, "show", "-s", "--format=%cI", commit], capture_output=True, text=True)
        _cdate = (_r.stdout or "").strip()
        if _cdate:
            try:
                _cdt = _dt.fromisoformat(_cdate.replace("Z", "+00:00"))
                if _cdt.tzinfo is None:
                    _cdt = _cdt.replace(tzinfo=_tz.utc)
                if gen_dt < _cdt:
                    problems.append("البابُ 4: `generated_at` = %s يسبقُ زمنَ التزامِ الشجرةِ %s — أساسٌ وُلِّدَ قبلَ الشجرةِ التي زعمَ قياسَها (RISK-0011 · CLM-0680)." % (gen, _cdate))
            except ValueError:
                pass
        # الاتّصالُ بـorigin/main: قياسٌ يُعلَنُ لا حكمٌ يُنفَّذُ — القرارُ للمالكِ (M0-08)
        if _sp.run(["git", "-C", root, "rev-parse", "--verify", "-q", "origin/main"], capture_output=True).returncode == 0:
            _anc = _sp.run(["git", "-C", root, "merge-base", "--is-ancestor", commit, "origin/main"], capture_output=True)
            if _anc.returncode == 0:
                print("N|البابُ 4: `repo.commit` متّصلٌ بـorigin/main (سلفٌ له) — الاتّصالُ مقيسٌ.")
            else:
                print("N|البابُ 4: `repo.commit` طافٍ: مُحَلٌّ لكنّه ليسَ سلفاً لـorigin/main (قياسُ فرعٍ/refs/pull)؛ بوّابةُ الانجرافِ (البابُ 2) هي الحكمَ، وحدُّ القِدَمِ قرارُ المالكِ (M0-08).")
# (هـ) M0-08 · CLM-0686 — **قرارُ المالكِ 2026-10-25: «اعتمادُ إنذارِ 96 ساعةً»** (إنذارٌ فقط):
#     قِدَمُ الأساسِ = زمنُ رأسِ origin/main ناقصاً `generated_at` (كم تقدّمَ main بعدَ
#     القياسِ)، وإن غابَ origin/main فالآنَ. فوقَ العتبةِ يُطبَعُ **إنذارٌ لا يُسقِط**:
#     التحويلُ إلى بوّابةِ فشلٍ قرارُ المالكِ وحدَهُ. العتبةُ الافتراضيّةُ 96 ساعةً
#     (أقصى فجوةِ إعادةِ توليدٍ مقيسةٍ على main منذ 2026-09-25: 58.2 س · p90 21.1 س).
#     `BASELINE_VALIDATE_NOW` يثبّتُ الزمنَ المرجعيَّ للاختبارِ فقط.
import os as _os
if gen_dt is not None:
    _raw_h = _os.environ.get("BASELINE_STALENESS_WARN_HOURS", "96")
    try:
        _warn_h = float(_raw_h)
        if not (_warn_h > 0):
            raise ValueError
    except ValueError:
        print("N|البابُ 4: عتبةُ القِدَمِ %r غيرُ صالحةٍ — استُعمِلَ الافتراضيُّ 96 س (M0-08)." % _raw_h)
        _warn_h = 96.0
    _ref, _ref_src = None, "الآن"
    _fixed = _os.environ.get("BASELINE_VALIDATE_NOW", "").strip()
    if _fixed:
        try:
            _ref = _dt.fromisoformat(_fixed.replace("Z", "+00:00")); _ref_src = "BASELINE_VALIDATE_NOW"
        except ValueError:
            _ref = None
    if _ref is None:
        _m = _sp.run(["git", "-C", root, "show", "-s", "--format=%cI", "origin/main"], capture_output=True, text=True)
        _ms = (_m.stdout or "").strip() if _m.returncode == 0 else ""
        if _ms:
            try:
                _ref = _dt.fromisoformat(_ms.replace("Z", "+00:00")); _ref_src = "رأسِ origin/main"
            except ValueError:
                _ref = None
    if _ref is None:
        _ref = _dt.now(_tz.utc)
    if _ref.tzinfo is None:
        _ref = _ref.replace(tzinfo=_tz.utc)
    _age_h = (_ref - gen_dt).total_seconds() / 3600.0
    if _age_h > _warn_h:
        print("N|⚠ إنذارُ قِدَمٍ (لا يُسقِط): عمرُ الأساسِ %.1f س مقابلَ %s > العتبةِ %g س — يُقترَحُ إعادةُ التوليدِ؛ البوّابةُ قرارُ المالكِ (M0-08)." % (_age_h, _ref_src, _warn_h))
    else:
        print("N|البابُ 4: عمرُ الأساسِ %.1f س مقابلَ %s ≤ العتبةِ %g س (M0-08 · إنذارٌ فقط)." % (_age_h, _ref_src, _warn_h))
for p in problems:
    print("P|" + p)
PY
)"
while IFS= read -r line; do
  if [[ "$line" == P\|* ]]; then PROBLEMS+=("${line#P|}"); ((D4++)); fi
  [[ "$line" == N\|* ]] && printf '  ⊘ %s\n' "${line#N|}"
done <<< "$DOOR4"
(( D4 == 0 )) && printf '  %s✓ البابُ 4:%s الصيغةُ موثَّقةٌ · الأساسُ مُحالٌ إليه · أرقامُه الحركيّةُ مقيسةٌ · شجرتُه مُعلَنةٌ.\n' "$GRN" "$RST"

# ── الحكم ────────────────────────────────────────────────────────────────
if (( ${#PROBLEMS[@]} > 0 )); then
  printf '\n%s✗ الأساسُ الآليُّ: %d مشكلةً.%s\n' "$RED" "${#PROBLEMS[@]}" "$RST"
  for p in "${PROBLEMS[@]}"; do printf '  %s- %s%s\n' "$RED" "$p" "$RST"; done
  printf '  %sالمرجع: docs/12-testing/BASELINE_FORMAT.md · scripts/baseline.sh · العنصر M0-08%s\n' "$DIM" "$RST"
  exit 1
fi

FP="$(printf '%s' "$DOOR1" | sed -n 's/^FP|//p')"
printf '%s✓ الأساسُ الآليُّ:%s صيغةٌ متّسقةٌ · لا انحدارَ في العدَّاداتِ الساكنةِ · تكرارٌ مُبرهَنٌ · %s\n' \
  "$GRN" "$RST" "${FP:0:23}…"
exit 0
