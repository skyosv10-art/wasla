#!/usr/bin/env bash
# find-existing-work.sh — إلزامي قبل بدء أي عمل: هل عمل أحدٌ هذا قبلي؟
# راجع docs/00-rules/WORK_CLAIM_RULE.md §4
#
#   bash scripts/checks/find-existing-work.sh "marketplace search"
#   bash scripts/checks/find-existing-work.sh "services/billing"
#
# لا يفشل أبداً — أداة بحث لا بوابة. البوابة هي validate-work-claims.sh.
set -uo pipefail

PROG="docs/16-progress"
CLAIMS="$PROG/WORK_CLAIMS.md"
INDEX="$PROG/WORK_INDEX.md"
BOARD="$PROG/LAUNCH_EXECUTION_BOARD.md"
LOG="$PROG/TASK_LOG.md"
ROADMAP="$PROG/ROADMAP.md"

if [[ $# -lt 1 || -z "${1// }" ]]; then
  cat >&2 <<'USAGE'
الاستخدام: bash scripts/checks/find-existing-work.sh "<مجال أو مسار>"
أمثلة:  "marketplace search"  ·  "services/billing"  ·  "M5-12"  ·  "دفع"
USAGE
  exit 2
fi

Q="$1"
hr() { printf '\033[2m%s\033[0m\n' "────────────────────────────────────────────────────────"; }
sec() { printf '\n\033[1m%s\033[0m\n' "$1"; }
none() { printf '  \033[2m(لا نتائج)\033[0m\n'; }

printf '\n\033[1m=== البحث عن عمل قائم: «%s» ===\033[0m\n' "$Q"

sec "1) الحجوزات النشطة — من يعمل الآن؟  [$CLAIMS]"
if [[ -f "$CLAIMS" ]]; then
  R="$(grep -inE "^\| *CLM-[0-9]+ .*($Q)" "$CLAIMS" | grep -i 'Active' || true)"
  [[ -n "$R" ]] && { printf '%s\n' "$R"; printf '\n  \033[31m⚠ يوجد حجز نشط يطابق طلبك. لا تبدأ عملاً موازياً — نسّق مع المالك.\033[0m\n'; } || none
else
  printf '  \033[31m✗ %s غير موجود\033[0m\n' "$CLAIMS"
fi

sec "2) خريطة الملكية — هل المنطقة مملوكة أو placeholder بقرار؟  [$INDEX]"
if [[ -f "$INDEX" ]]; then
  R="$(grep -inE "$Q" "$INDEX" || true)"
  [[ -n "$R" ]] && printf '%s\n' "$R" || none
else
  printf '  \033[31m✗ %s غير موجود\033[0m\n' "$INDEX"
fi

sec "3) لوحة التنفيذ — هل هناك عنصر عمل قائم؟  [$BOARD]"
if [[ -f "$BOARD" ]]; then
  R="$(grep -inE "^\| *M[0-9]+-[0-9A-Za-z]+ .*($Q)" "$BOARD" || true)"
  [[ -n "$R" ]] && printf '%s\n' "$R" || none
else
  printf '  \033[31m✗ %s غير موجود\033[0m\n' "$BOARD"
fi

sec "4) سجل المهام — آخر 15 إشارة تاريخية  [$LOG]"
if [[ -f "$LOG" ]]; then
  R="$(grep -inE "$Q" "$LOG" | tail -15 || true)"
  [[ -n "$R" ]] && printf '%s\n' "$R" | cut -c1-200 || none
else
  printf '  \033[2m(%s غير موجود)\033[0m\n' "$LOG"
fi

sec "5) خارطة المراحل — أي مرحلة تملك هذا النطاق؟  [$ROADMAP]"
if [[ -f "$ROADMAP" ]]; then
  R="$(grep -inE "$Q" "$ROADMAP" | head -5 || true)"
  [[ -n "$R" ]] && printf '%s\n' "$R" | cut -c1-200 || none
else
  printf '  \033[2m(%s غير موجود)\033[0m\n' "$ROADMAP"
fi

sec "6) الكود الفعلي — هل الملفات موجودة أصلاً؟"
FOUND=0
for d in services packages apps bots infra; do
  [[ -d "$d" ]] || continue
  M="$(find "$d" -maxdepth 2 -iname "*${Q}*" 2>/dev/null | head -10 || true)"
  if [[ -n "$M" ]]; then
    FOUND=1
    while IFS= read -r p; do
      if [[ -d "$p" ]]; then
        n="$(find "$p" -type f ! -name '.gitkeep' 2>/dev/null | wc -l | tr -d ' ')"
        if [[ "$n" == "0" ]]; then printf '  %-45s \033[33mplaceholder (0 ملف)\033[0m\n' "$p/"
        else printf '  %-45s \033[32m%s ملف — مكتوب فعلاً\033[0m\n' "$p/" "$n"; fi
      else
        printf '  %s\n' "$p"
      fi
    done <<< "$M"
  fi
done
(( FOUND )) || none

sec "7) قرارات معمارية ذات صلة  [docs/15-decisions/]"
if [[ -d docs/15-decisions ]]; then
  R="$(grep -rilE "$Q" docs/15-decisions/ 2>/dev/null | head -5 || true)"
  [[ -n "$R" ]] && printf '  %s\n' $R || none
fi

hr
cat <<'NEXT'
الخطوة التالية:
  • وُجد حجز نشط مطابق؟  → لا تبدأ. نسّق مع المالك أو أنشئ عنصراً تابعاً.
  • وُجد كود مكتوب فعلاً؟ → عدّله، لا تُنشئ نسخة موازية.
  • وُجد placeholder؟     → تحقّق من docs/15-decisions/ أولاً: قد يكون فارغاً بقرار لا بإغفال.
  • لا شيء؟              → أضف صفاً في اللوحة، ثم سطر حجز في WORK_CLAIMS.md، ثم ابدأ.

القاعدة الكاملة: docs/00-rules/WORK_CLAIM_RULE.md
NEXT
