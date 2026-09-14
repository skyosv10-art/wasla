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
    RUNS_JSON="$(gh api "repos/$REPO/actions/runs?head_sha=$FULL&per_page=100" 2>/dev/null)" || RUNS_JSON=''
    if [[ -z "$RUNS_JSON" ]]; then
      fail "تعذَّرَ قراءةُ تشغيلاتِ $sha — وتعذُّرُ القياسِ إخفاقٌ لا تخطٍّ"
      ERRORS=$((ERRORS+1)); continue
    fi
    RUN_ID="$(python3 "$LIB/audit_runs.py" run-id <<< "$RUNS_JSON")"
    if [[ -z "$RUN_ID" ]]; then
      MEASURED='no_verdict'
    else
      JOBS_JSON="$(gh api "repos/$REPO/actions/runs/$RUN_ID/jobs?per_page=100" 2>/dev/null)" || JOBS_JSON=''
      if [[ -z "$JOBS_JSON" ]]; then
        fail "تعذَّرَ قراءةُ وظائفِ السيرِ $RUN_ID للبصمةِ $sha — إخفاقٌ لا تخطٍّ"
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
      fail "$sha: السجلُّ يقولُ «$cls» والقياسُ الحيُّ «$MEASURED» — دعوى لم تُراجَعْ بعدَ أن صارَ العلمُ متاحاً"
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
