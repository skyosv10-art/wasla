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
    if ! printf '%s' "$DOOR2" | grep -q '^OK|'; then
      PROBLEMS+=("البابُ 2: تعذّرت مقارنةُ الحيِّ بالأساسِ (لم يكتمل التحليلُ) — ولا يُقرأ العُطلُ نجاحاً.")
    fi
    DIFFS=()
    while IFS= read -r line; do
      [[ "$line" == D\|* ]] && DIFFS+=("${line#D|}")
    done <<< "$DOOR2"
    if (( ${#DIFFS[@]} > 0 )); then
      PROBLEMS+=("البابُ 2: الحالةُ الحيّةُ تخالف الأساسَ المُلتزَمَ في ${#DIFFS[@]} موضعاً — يُعاد توليدُ الأساسِ بقرارٍ مكتوبٍ لا يُهمَل:")
      for d in "${DIFFS[@]}"; do PROBLEMS+=("          · $d"); done
    elif printf '%s' "$DOOR2" | grep -q '^OK|'; then
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
DOOR4="$(python3 - "$BASE" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1], encoding="utf-8"))
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
if repo.get("dirty") and not str(repo.get("dirty_reason", "")).strip():
    problems.append("البابُ 4: الأساسُ وُلِّد من شجرةٍ مُعدَّلةٍ بلا `repo.dirty_reason` — شجرةٌ مُعدَّلةٌ بلا سببٍ مكتوبٍ تجعل الأساسَ غيرَ قابلٍ للإرجاع.")
for p in problems:
    print("P|" + p)
PY
)"
while IFS= read -r line; do
  if [[ "$line" == P\|* ]]; then PROBLEMS+=("${line#P|}"); ((D4++)); fi
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
