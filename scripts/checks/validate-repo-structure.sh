#!/usr/bin/env bash
# validate-repo-structure.sh — بنيةُ المستودعِ الإلزاميّة، أمرٌ واحدٌ يُشغَّل
# محلّياً وفي CI من **مصدرٍ واحدٍ** لا من كتلةٍ مضمَّنةٍ في YAML. (M0-04)
#
# ما يفحص: ملفّاتُ الجذرِ · الأدلّةُ الأساسيّةُ · الوثائقُ الحاكمةُ —
# كلُّها من `lib/required-artifacts.sh`. أضِف عنصراً هناك يُفحَص في الموضعَين.
#
#   bash scripts/checks/validate-repo-structure.sh            # المستودعُ نفسُه
#   bash scripts/checks/validate-repo-structure.sh /tmp/root  # جذرٌ صريحٌ (للاختبار)
#
# الخروج 0 إن وُجد كلُّ شيءٍ، و1 مع بيانِ الناقصِ كلِّه (لا أوّلِ ناقصٍ فقط:
# مَن يُصلح واحداً ثمّ يعيد التشغيلَ عشرَ مرّاتٍ يكره الحارسَ فيُعطِّله).
#
# المرجع: docs/00-rules/VERIFY_COMMAND.md §2 · M0-04

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-$(cd "$HERE/../.." && pwd)}"
# shellcheck source=lib/required-artifacts.sh
source "$HERE/lib/required-artifacts.sh"

cd "$ROOT" || exit 1

GRN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RST=$'\033[0m'
MISSING=()

for f in "${REQUIRED_ROOT_FILES[@]}"; do
  [[ -f "$f" ]] || MISSING+=("ملفُّ جذرٍ: $f")
done

for d in "${REQUIRED_DIRS[@]}"; do
  [[ -d "$d" ]] || MISSING+=("دليلٌ: $d/")
done

for f in "${REQUIRED_DOCS[@]}"; do
  [[ -f "$f" ]] || MISSING+=("وثيقةٌ حاكمةٌ: $f")
done

if ((${#MISSING[@]})); then
  printf '%s✗ بنيةُ المستودعِ ناقصةٌ — %d عنصراً:%s\n' "$RED" "${#MISSING[@]}" "$RST"
  for m in "${MISSING[@]}"; do printf '  ✗ %s\n' "$m"; done
  printf '%s  القائمةُ تُحرَّر في scripts/checks/lib/required-artifacts.sh — موضعٌ واحدٌ للمحلّيِّ وCI.%s\n' \
    "$DIM" "$RST"
  exit 1
fi

printf '%s✓ بنيةُ المستودعِ كاملةٌ:%s %d ملفَّ جذرٍ · %d دليلاً · %d وثيقةً حاكمةً.\n' \
  "$GRN" "$RST" "${#REQUIRED_ROOT_FILES[@]}" "${#REQUIRED_DIRS[@]}" "${#REQUIRED_DOCS[@]}"
printf '%s  المصدرُ: scripts/checks/lib/required-artifacts.sh (M0-04)%s\n' "$DIM" "$RST"
exit 0
