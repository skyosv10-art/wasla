#!/usr/bin/env bash
# audit-ci-verdicts.sh — دعوى «حكمُ CI مجهولٌ» لا تبقى بلا تدقيقٍ ولا تُخالِفُ القياسَ.
#
# ── العطبُ الذي وُلِدَ لأجلِهِ (M0-40) ───────────────────────────────────────
# خلالَ حجبِ الحسابِ (`RISK-0039`) دُمِجَت بنودٌ وكُتِبَ في دليلِ إغلاقِها
# «NOT VERIFIED · account_billing_blocked» أو «JOB DID NOT START». وهيَ جملةٌ
# **صادقةٌ يومَ كُتِبَت**. ثمَّ ارتفعَ الحجبُ في 2026-09-14، فصارَ في المستودعِ
# صفوفٌ تقولُ «لا نعلمُ» في زمنٍ صارَ العلمُ فيهِ متاحاً — **ولا شيءَ يُلزِمُ
# بمراجعتِها**. ولو أصبحَ حكمٌ حقيقيٌّ مقروءاً لبصمةٍ منها لبقيَ النصُّ القديمُ
# في مكانِهِ بلا إنذارٍ.
#
# ولا يُصلَحُ ذلكَ بمحوِ الجملِ القديمةِ — ذلكَ محوُ دليلٍ. يُصلَحُ بتدقيقٍ:
#   ١) كلُّ سطرٍ على اللوحةِ يحملُ **دعوى جهلٍ بحكمِ CI** يجبُ أن يُشيرَ إلى
#      `docs/12-testing/CI_VERDICT_AUDIT.md`.
#   ٢) وكلُّ صفٍّ في ذلكَ السجلِّ **يُقابَلُ حيّاً** بواجهةِ GitHub:
#        `real`       = سيرٌ بدأَ فعلاً (خطواتٌ أو عاملٌ حقيقيٌّ) ⇒ الحكمُ مقروءٌ،
#                       فيجبُ أن يحملَ الصفُّ نتيجتَهُ (success/failure/…).
#        `blackout`   = سيرٌ موجودٌ ولم تبدأْ وظيفةٌ واحدةٌ ⇒ «مجهولٌ» صادقةٌ وتبقى.
#        `no_verdict` = لا سيرَ لهذه البصمةِ ⇒ صادقةٌ وتبقى.
#   ٣) وأيُّ تفاوتٍ بينَ المُسجَّلِ والمقيسِ = **إخفاقٌ**.
#
# والدقّةُ مقصودةٌ: «NOT VERIFIED» على اللوحةِ ليست جنساً واحداً — منها ما هوَ عن
# طبقةِ **الإنتاجِ** (لا نشرَ يُقاسُ عليهِ · صفُّ M0-15) ومنها عن **سلطةِ الدمجِ**
# (جوابُ 200 على دمجٍ فعليٍّ · صفُّ M0-22A)، وهذانِ لا يُقابَلانِ بواجهةِ
# الأعمالِ. فالمُلزَمُ دعوى الجهلِ بحكمِ CI وحدَها، وعلامتُها صريحةٌ في السطرِ.
#
# fail-closed: غيابُ اللوحةِ أو السجلِّ أو مكتبةِ القراءةِ = رفضٌ لا تخطٍّ.
# وتعذُّرُ سؤالِ الواجهةِ (لا `gh` أو لا شبكةَ أو لا صلاحيةَ) = **جزئيٌّ مُعلَنٌ**:
# يُدقَّقُ ما يُقرأُ من القرصِ ويُعلَنُ أنَّ المقابلةَ الحيّةَ لم تُجرَ.
# وتُحلُّ البصماتُ المختصرةُ إلى كاملةٍ بـ`git rev-parse` — فواجهةُ الأعمالِ
# **لا تُطابِقُ بصمةً مختصرةً** وتُجيبُ بصفرِ تشغيلاتٍ، وهوَ جوابٌ يُقرأُ خطأً
# «لا حكمَ» فيُخضِرُ دعوى جهلٍ باطلةً. مقيسٌ 2026-09-14.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

cd "$(dirname "$0")/../.." || { echo "تعذّر الوصول إلى جذر المستودع" >&2; exit 1; }

BOARD="${1:-docs/16-progress/LAUNCH_EXECUTION_BOARD.md}"
AUDIT="${2:-docs/12-testing/CI_VERDICT_AUDIT.md}"
REPO="${WASLA_REPO:-skyosv10-art/wasla}"
LIB="$(cd "$(dirname "$0")" && pwd)/lib"

RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RST=$'\033[0m'
fail() { printf '%s✗%s %s\n' "$RED" "$RST" "$1" >&2; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$RST" "$1"; }

[[ -f "$BOARD" ]] || { fail "لوحةُ التنفيذِ غيرُ موجودةٍ: $BOARD"; exit 1; }
[[ -f "$AUDIT" ]] || { fail "سجلُّ تدقيقِ أحكامِ CI غيرُ موجودٍ: $AUDIT — وغيابُهُ لا يُبرِّرُ تخطّياً"; exit 1; }
for l in claim_lines.py audit_rows.py; do
  [[ -f "$LIB/$l" ]] || { fail "مكتبةُ القراءةِ غائبةٌ: $LIB/$l — وحارسٌ بلا قارئِهِ يُرفَضُ ولا يُخضَرُّ"; exit 1; }
done
command -v python3 > /dev/null 2>&1 || { fail 'python3 غيرُ موجودٍ — وتعذُّرُ القراءةِ إخفاقٌ لا تخطٍّ'; exit 1; }

ERRORS=0

# ── ١) كلُّ دعوى جهلٍ بحكمِ CI تُشيرُ إلى سجلِّ التدقيقِ ────────────────────
CLAIM_LINES="$(python3 "$LIB/claim_lines.py" "$BOARD")" || {
  fail 'تعذَّرَ قراءةُ دعاوى اللوحةِ'; exit 1; }

CLAIMS_N=0
while IFS=$'\t' read -r ln item linked; do
  [[ -z "$ln" ]] && continue
  CLAIMS_N=$((CLAIMS_N+1))
  if [[ "$linked" == 'linked' ]]; then
    ok "دعوى «حكمُ CI مجهولٌ» في السطرِ $ln ($item) تُشيرُ إلى سجلِّ التدقيقِ"
  else
    fail "دعوى «حكمُ CI مجهولٌ» في السطرِ $ln ($item) بلا إشارةٍ إلى CI_VERDICT_AUDIT.md — دعوى جهلٍ بلا تدقيقٍ"
    ERRORS=$((ERRORS+1))
  fi
done <<< "$CLAIM_LINES"
printf '  دعاوى «حكمُ CI مجهولٌ» على اللوحةِ: %d\n' "$CLAIMS_N"

AUDIT_ROWS="$(python3 "$LIB/audit_rows.py" "$AUDIT" rows)" || { fail 'تعذَّرَ قراءةُ سجلِّ التدقيقِ'; exit 1; }
REAL_WITH_CONCLUSION="$(python3 "$LIB/audit_rows.py" "$AUDIT" real-with-conclusion)" || { fail 'تعذَّرَ قراءةُ نتائجِ الصفوفِ'; exit 1; }

if (( CLAIMS_N > 0 )) && [[ -z "$AUDIT_ROWS" ]]; then
  fail "على اللوحةِ $CLAIMS_N دعوى جهلٍ بحكمِ CI وسجلُّ التدقيقِ بلا صفٍّ واحدٍ"
  ERRORS=$((ERRORS+1))
fi
printf '  صفوفُ سجلِّ التدقيقِ: %d\n' "$( [[ -z "$AUDIT_ROWS" ]] && echo 0 || wc -l <<< "$AUDIT_ROWS" | tr -d ' ')"

# ── ٢) كلُّ بصمةٍ مُسجَّلةٍ التزامٌ حقيقيٌّ ────────────────────────────────────
# ولمَ بابٌ خاصٌّ؟ لأنَّ على اللوحةِ رموزاً عشريّةً من إحدَ عشرَ خانةً
# (`34065473979`) هيَ **معرِّفاتُ سيرٍ** لا بصماتُ التزامٍ، وكلُّ خاناتِها في مجالِ
# السّتَّ عشريِّ فتمرُّ على أيِّ نمطٍ. ولو مُرِّرَت إلى الواجهةِ كبصمةٍ لَأجابَت
# بصفرِ تشغيلاتٍ، فقُرِئَ الجوابُ «لا حكمَ» — وهوَ **تخضيرُ دعوى جهلٍ باطلةٍ
# بجوابٍ عن سؤالٍ آخرَ**.
#
# والتعذُّرُ هنا يُفرَزُ ولا يُوحَّدُ، لأنَّ «git لا يعرفُها» يحتملُ أمرَينِ:
#   • ليستْ التزاماً — وهذا **إخفاقٌ**.
#   • أو الشجرةُ الحاضرةُ لا تحملُها (نسخةٌ ضحلةٌ · مستودعُ حزمةِ الاختبارِ ذو
#     التزامٍ واحدٍ) — وهذا **جهلٌ يُعلَنُ** لا كذبٌ يُقالُ.
# فيُسألُ git، ثمَّ تُسألُ الواجهةُ (`/commits/<sha>` جوابٌ قاطعٌ)، وإنْ تعذَّرَ
# الاثنانِ أُعلِنَ الجزئيُّ. fail-closed حيثُ يُمكِنُ الحكمُ، وإعلانٌ حيثُ لا يُمكِنُ.
HAVE_GIT=0; git rev-parse --git-dir > /dev/null 2>&1 && HAVE_GIT=1
LIVE=1; LIVE_WHY=''
if ! command -v gh > /dev/null 2>&1; then
  LIVE=0; LIVE_WHY='لا أداةَ gh'
elif ! gh api "repos/$REPO" --jq '.full_name' > /dev/null 2>&1; then
  LIVE=0; LIVE_WHY='تعذَّرَ سؤالُ الواجهةِ (لا شبكةَ أو لا صلاحيةَ)'
fi

# ── قراءةُ الواجهةِ بمحاولاتٍ محدودة (CLM-0560) ─────────────────────────────
# سجلُّ الحادثة: 2026-10-14T15:49:36Z في السيرِ 38592494784 (PR #712)، رجعَ نداءٌ
# واحدٌ على `actions/runs/35026500780/jobs` بإخفاقٍ عابر، فسقطَ الفحصُ 15 مع أنّ
# المحتوى المُدقَّقَ لم يتغيّر. وكانت رسالةُ `gh` نفسُها تُرمى في `2>/dev/null`،
# فلم يكنْ في السجلّ ما يُعرَفُ به السبب. وهذا نمطُ العطلِ الموثّقُ في
# SINGLE_REVIEWER_DEPENDENCY_REVIEW §4.
# الإصلاح: AUDIT_GH_ATTEMPTS محاولاتٍ (5 افتراضًا) بانتظارٍ مضاعَف
# (AUDIT_GH_BACKOFF ثانيةً للأولى ثمّ ضعفُها: 3 ⇒ 3+6+12+24 = 45 ث)، ثمّ يبقى الإخفاقُ
# **إخفاقًا** ومعه أولُ سطرٍ من خطأِ `gh`. لا تخطّيَ ولا تحويلَ إلى «جزئي».
# قِيسَ بعدَ الإصلاحِ الأوّل (4 محاولاتٍ، 14 ث): `gh: Server Error (HTTP 502)` على
# السيرِ نفسِه دامَ أطولَ من 14 ث ثمّ أجابَ بعدَ دقائق (31 وظيفة) — فاتّسعَ الحدّ.
GH_ERR_FILE="$(mktemp)"; trap 'rm -f "$GH_ERR_FILE"' EXIT
# `$(...)` قشرةٌ فرعيّة: المتغيّرُ لا يعبرُ منها، فالرسالةُ تُنقَلُ في ملفّ.
_gh_err() { cat "$GH_ERR_FILE" 2>/dev/null; }
_gh_read() { # _gh_read <api-path> — يطبعُ الجواب؛ يرجعُ ≠0 بعدَ استنفادِ المحاولات
  local GH_LAST_ERR='' attempts="${AUDIT_GH_ATTEMPTS:-5}" wait="${AUDIT_GH_BACKOFF:-3}" i out errf
  [[ "$attempts" =~ ^[1-9][0-9]*$ ]] || attempts=5
  [[ "$wait" =~ ^[0-9]+$ ]] || wait=3
  errf="$(mktemp)"
  for (( i=1; i<=attempts; i++ )); do
    if out="$(gh api "$1" 2>"$errf")" && [[ -n "$out" ]]; then
      rm -f "$errf"; printf '%s' "$out"; return 0
    fi
    GH_LAST_ERR="$(head -n1 "$errf" | cut -c1-200)"; [[ -n "$GH_LAST_ERR" ]] || GH_LAST_ERR='جوابٌ فارغ'
    (( i < attempts )) && sleep "$wait" && wait=$(( wait * 2 ))
  done
  rm -f "$errf"; printf 'بعدَ %s محاولاتٍ: %s' "$attempts" "$GH_LAST_ERR" > "$GH_ERR_FILE"; return 1
}

# ── قائمةُ التشغيلاتِ: الجوابُ الفارغُ لقطةٌ لا حكمٌ (CLM-0663) ───────────────
# المقيسُ 2026-10-22T15:51Z: `actions/runs?head_sha=<FULL>` أجابَ HTTP 200 وJSON صالحًا
# **بلا** سيرِ WASLA CI في 4 من 50 نداءً على عشرةِ التزاماتٍ لكلٍّ منها سيرٌ موجود،
# فقرأَ الحارسُ أوّلَ لقطةٍ فارغةٍ «no_verdict» قاطعًا وأسقطَ CI على #809 (السيرُ
# 39805730912) والمحتوى ثابت. `_gh_read` لا يُعيدُ هذا الجوابَ لأنّه ناجحٌ غيرُ فارغِ النصّ.
#
# القاعدة: AUDIT_EMPTY_ATTEMPTS محاولةً (4 افتراضًا) بانتظارٍ مضاعَف (AUDIT_EMPTY_WAIT
# ثانيةً للأولى، 2 ⇒ 2+4+8 = 14 ث أقصى لكلِّ صفٍّ no_verdict حقيقيٍّ). وكلُّ محاولةٍ تُصنَّفُ:
#   found   — سيرُ WASLA CI للبصمةِ الكاملةِ نفسِها ⇒ يُعتمَدُ معرِّفُهُ فورًا، فلا تمحوهُ لقطةٌ لاحقة.
#   empty   — JSON صالحٌ بقائمةٍ لا سيرَ فيها لـWASLA CI ⇒ تُعادُ المحاولة.
#   invalid — ليسَ JSON · لا قائمةَ · سيرٌ لبصمةٍ أخرى ⇒ تُعادُ، ولا يُقبَلُ بعدَها no_verdict.
#   خطأُ واجهةٍ بعدَ استنفادِ `_gh_read` محاولاتِه ⇒ توقُّفٌ فوريٌّ «غيرُ محسوم» (لا تُضاعَفُ
#   مهلةُ الـ45 ث في كلِّ محاولةٍ خارجيّة؛ والحدُّ الكلّيُّ للصفِّ يبقى مقيَّدًا).
# فـno_verdict يُقبَلُ **فقط** إن كانت المحاولاتُ كلُّها مكتملةً وصالحةً وفارغة (رمزُ 3)؛
# وأيُّ محاولةٍ غيرِ صالحةٍ أو متعذِّرةٍ بلا دليلٍ إيجابيٍّ ⇒ إخفاقٌ معلَنٌ (رمزُ 1).
# ولمَ 4؟ إن كانت اللقطةُ الفارغةُ مستقلّةً باحتمالِ p ≈ 0.08 (4/50 المقيسة) فخطأُ
# «no_verdict» الكاذبِ لصفٍّ ≈ p⁴ ≈ 4×10⁻⁵، ولقرابةِ 13 صفًّا ≈ 5×10⁻⁴ للتشغيل؛ وبثلاثٍ
# ≈ 7×10⁻³. والانتظارُ المضاعَفُ يُبعِدُ المحاولاتِ زمنًا فيُضعِفُ ارتباطَها. وإن ارتبطت
# اللقطاتُ فوقَ ذلكَ فالنتيجةُ إخفاقٌ مرئيٌّ (صفٌّ يفارقُ القياس) لا نجاحٌ صامت.
RUNS_DIAG_FILE="$(mktemp)"; trap 'rm -f "$GH_ERR_FILE" "$RUNS_DIAG_FILE"' EXIT
_runs_diag() { cat "$RUNS_DIAG_FILE" 2>/dev/null; }
_runs_lookup() { # _runs_lookup <FULL_SHA> — يطبعُ معرِّفَ السيرِ ويرجعُ 0 | 3 = no_verdict مُستحَقّ | 1 = غيرُ محسوم
  local FULL="$1" attempts="${AUDIT_EMPTY_ATTEMPTS:-4}" wait="${AUDIT_EMPTY_WAIT:-2}" i json verdict
  local empty=0 bad=0 why=''
  [[ "$attempts" =~ ^[1-9][0-9]*$ ]] || attempts=4
  [[ "$wait" =~ ^[0-9]+$ ]] || wait=2
  : > "$RUNS_DIAG_FILE"
  for (( i=1; i<=attempts; i++ )); do
    if ! json="$(_gh_read "repos/$REPO/actions/runs?head_sha=$FULL&per_page=100")"; then
      bad=$((bad+1)); why="$(_gh_err)"
      printf 'بعدَ %s محاولاتٍ: فارغٌ صالحٌ=%d · متعذِّرٌ أو غيرُ صالحٍ=%d · توقّفَ عندَ المحاولةِ %d بخطأِ واجهة (%s)' \
        "$attempts" "$empty" "$bad" "$i" "$why" > "$RUNS_DIAG_FILE"
      return 1
    fi
    verdict="$(python3 "$LIB/audit_runs.py" run-lookup "$FULL" <<< "$json")" || verdict=$'invalid\tتعذَّرَ تشغيلُ القارئ'
    case "$verdict" in
      found$'\t'*)
        printf 'السيرُ %s في المحاولةِ %d من %d (فارغٌ صالحٌ قبلَه=%d · غيرُ صالحٍ=%d)' \
          "${verdict#found$'\t'}" "$i" "$attempts" "$empty" "$bad" > "$RUNS_DIAG_FILE"
        printf '%s' "${verdict#found$'\t'}"; return 0 ;;
      empty) empty=$((empty+1)) ;;
      *) bad=$((bad+1)); why="${verdict#invalid$'\t'}" ;;
    esac
    (( i < attempts )) && { sleep "$wait"; wait=$(( wait * 2 )); }
  done
  if (( bad == 0 )); then
    printf 'no_verdict بعدَ %s محاولاتٍ كلُّها فارغةٌ صالحة (فارغٌ صالحٌ=%d)' "$attempts" "$empty" > "$RUNS_DIAG_FILE"
    return 3
  fi
  printf 'بعدَ %s محاولاتٍ: فارغٌ صالحٌ=%d · متعذِّرٌ أو غيرُ صالحٍ=%d (آخرُ سبب: %s)' \
    "$attempts" "$empty" "$bad" "$why" > "$RUNS_DIAG_FILE"
  return 1
}

declare -A FULLSHA=()
UNRESOLVED=0
while IFS=$'\t' read -r sha cls; do
  [[ -z "$sha" ]] && continue
  if (( HAVE_GIT )) && F="$(git rev-parse -q --verify "${sha}^{commit}" 2>/dev/null)" && [[ -n "$F" ]]; then
    FULLSHA["$sha"]="$F"; continue
  fi
  if (( LIVE )); then
    if F="$(gh api "repos/$REPO/commits/$sha" --jq '.sha' 2>/dev/null)" && [[ -n "$F" ]]; then
      FULLSHA["$sha"]="$F"
    else
      fail "$sha: ليستْ بصمةَ التزامٍ في $REPO (معرِّفُ سيرٍ؟) — لا يُقابَلُ صفٌّ لا يُشيرُ إلى التزامٍ"
      ERRORS=$((ERRORS+1))
    fi
  else
    UNRESOLVED=$((UNRESOLVED+1))
  fi
done <<< "$AUDIT_ROWS"

# ── ٣) المقابلةُ الحيّةُ لكلِّ صفٍّ ──────────────────────────────────────────
if (( LIVE == 0 )); then
  printf '%s⚠%s جزئيٌّ: %s — دُقِّقَت الإشاراتُ ووجودُ الصفوفِ من القرصِ، ولم تُقابَلِ التصنيفاتُ حيّاً.\n' \
    "$YLW" "$RST" "$LIVE_WHY"
  (( UNRESOLVED > 0 )) && printf '%s⚠%s جزئيٌّ: %d بصمةً لم تُحلَّ في الشجرةِ الحاضرةِ ولا سبيلَ لسؤالِ الواجهةِ — جهلٌ مُعلَنٌ لا براءةٌ.\n' \
    "$YLW" "$RST" "$UNRESOLVED"
else
  while IFS=$'\t' read -r sha cls; do
    [[ -z "$sha" ]] && continue
    # البصمةُ الكاملةُ أوّلاً: الواجهةُ **لا تُطابِقُ مختصرةً** وتُجيبُ بصفرِ
    # تشغيلاتٍ — جوابٌ يُقرأُ خطأً «لا حكمَ». قِيسَ 2026-09-14 على `3cb44c35`:
    # مختصرةً صفرُ تشغيلاتٍ، وكاملةً السيرُ 34877247715 بحكمِ `success`.
    FULL="${FULLSHA[$sha]:-}"
    [[ -n "$FULL" ]] || continue  # أُنذِرَ عنها في البابِ ٢
    if ! [[ "$FULL" =~ ^[0-9a-f]{40}$ ]]; then
      fail "$sha: لم تُحَلَّ إلى بصمةٍ كاملةٍ (40 خانةً) بل «$FULL» — والواجهةُ لا تُطابِقُ غيرَها فلا تُسأَلُ بها"
      ERRORS=$((ERRORS+1)); continue
    fi
    RUN_ID="$(_runs_lookup "$FULL")"; LOOKUP=$?
    # سطرُ التشخيصِ لكلِّ صفٍّ مقيسٍ: عددُ المحاولاتِ وما أجابت به — فالإعادةُ مرئيّةٌ لا صامتة.
    (( LOOKUP == 1 )) || printf '    %s: %s\n' "$sha" "$(_runs_diag)"
    if (( LOOKUP == 3 )); then
      MEASURED='no_verdict'
    elif (( LOOKUP != 0 )); then
      fail "$sha: قائمةُ التشغيلاتِ غيرُ محسومةٍ — $(_runs_diag) — وتعذُّرُ القياسِ إخفاقٌ لا no_verdict ولا تخطٍّ"
      ERRORS=$((ERRORS+1)); continue
    else
      JOBS_JSON="$(_gh_read "repos/$REPO/actions/runs/$RUN_ID/jobs?per_page=100")" || JOBS_JSON=''
      if [[ -z "$JOBS_JSON" ]]; then
        fail "تعذَّرَ قراءةُ وظائفِ السيرِ $RUN_ID للبصمةِ $sha ($(_gh_err)) — إخفاقٌ لا تخطٍّ"
        ERRORS=$((ERRORS+1)); continue
      fi
      MEASURED="$(python3 "$LIB/audit_runs.py" started <<< "$JOBS_JSON")"
    fi
    if [[ "$MEASURED" == "$cls" ]]; then
      ok "$sha: التصنيفُ المُسجَّلُ يُطابِقُ القياسَ الحيَّ ($cls)"
      if [[ "$cls" == 'real' ]] && ! grep -q "$sha" <<< "$REAL_WITH_CONCLUSION"; then
        fail "$sha: مُصنَّفٌ real ولا نتيجةَ منقولةً في صفِّهِ (success/failure/…) — حكمٌ موجودٌ ولم يُقرَأْ"
        ERRORS=$((ERRORS+1))
      fi
    else
      fail "$sha: السجلُّ يقولُ «$cls» والقياسُ الحيُّ «$MEASURED» — دعوى لم تُراجَعْ بعدَ أن صارَ العلمُ متاحاً · $(_runs_diag)"
      ERRORS=$((ERRORS+1))
    fi
  done <<< "$AUDIT_ROWS"
fi

if (( ERRORS > 0 )); then
  printf '\n%s✗ تدقيقُ أحكامِ CI: %d إخفاقاً.%s\n' "$RED" "$ERRORS" "$RST" >&2
  printf 'الإصلاحُ: أشِرْ من كلِّ دعوى جهلٍ إلى %s، وصحِّحْ كلَّ تصنيفٍ فارقَ القياسَ — بالإضافةِ لا بالمحوِ.\n' "$AUDIT" >&2
  exit 1
fi

printf '\n%s✓ تدقيقُ أحكامِ CI: كلُّ دعوى جهلٍ مُدقَّقةٌ، وكلُّ تصنيفٍ مُطابِقٌ للقياسِ.%s\n' "$GRN" "$RST"
