#!/usr/bin/env bash
# validate-claim-freshness.sh — يحرس **بياتَ السجلِّ** لا الدافعَ. (M0-16)
#
#   bash scripts/checks/validate-claim-freshness.sh [WORK_CLAIMS.md]
#
# ── لماذا يوجد هذا الفحص ──────────────────────────────────────────────────
# `validate-work-claims.sh` يحرس **مَن يدفع**: أله حجزٌ نشطٌ يغطّي مساراتِه؟ ولا
# يسأل سؤالاً آخرَ أبداً: **أفرعُ هذا الحجزِ موجودٌ أصلاً؟** فبقيت في 2026-08-27
# أربعةُ حجوزاتٍ `Active` لفروعٍ **محذوفةٍ** أعمالُها مدموجةٌ منذ يوم (`CLM-0002`
# `CLM-0008` `CLM-0009` `CLM-0010`) — والبروتوكول §8.1 يُلزم بتحريرِها بعدَ الدمج.
#
# والسجلُّ **لا يكذب نصّاً**: كلُّ صفٍّ يقول `Active` وكلُّ عمودٍ سليمُ الشكل. الكذبُ
# في **وجودِ الفرعِ** لا في نصِّ الصفّ — فلا تكشفه قراءةٌ ولا مدقِّقُ بنيةٍ، إنّما
# سؤالُ المستودعِ نفسِه. وهذا رابعُ انحرافٍ من هذا الجنس: `M0-12` (قائمةٌ في ثلاثةِ
# مواضعَ تختلف) · `M0-14` (`docs/` خارجَ المرشِّح) · `M0-15` (المرشِّحُ نسختان).
#
# وأثرُ الحجزِ البائتِ ليس تجميليّاً: الحجزُ النشطُ **يمنع غيرَه** من العملِ على
# نطاقِه (الشرطُ 4)، فحجزٌ ميتٌ يُقفل `services/` أو `scripts/` على لا أحد — وقد
# وقع فعلاً: `CLM-0003` مُنع منه `M0-12` فاحتاج قرارَ مالكٍ لتحريرِه.
#
# ── حدُّ هذا الفحصِ المُعلَن ────────────────────────────────────────────────
# يحكم على **وجودِ الفرعِ** فقط. ولا يقول «هذا الفرعُ مدموجٌ فحرِّرْه»: فرعٌ قائمٌ
# ومدموجٌ يحتاج جلبَ مرجعِه ومقارنةَ أسلافٍ، وذلك عملٌ آخر لم يُؤخَذ هنا (لا يُدَّعى
# أنّه مأخوذ). وإن تعذّر سؤالُ المستودعِ — لا مرجعٌ محليٌّ ولا وصولٌ إلى `origin` —
# **يُعلن التخطّي صريحاً ولا يُدَّعى النجاح**: فحصٌ يصمت عندَ الجهلِ أسوأُ من غيابِه.
set -uo pipefail

cd "$(dirname "$0")/../.." || { echo "تعذّر الوصول إلى جذر المستودع" >&2; exit 1; }

CLAIMS="${1:-docs/16-progress/WORK_CLAIMS.md}"
RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RST=$'\033[0m'

[[ -f "$CLAIMS" ]] || { printf '%s✗%s سجلُّ الحجوزاتِ غيرُ موجود: %s\n' "$RED" "$RST" "$CLAIMS" >&2; exit 1; }

# صفوفُ «النشطة» وحدَها: عشرةُ حقولٍ عندَ الفصلِ بـ`|` (ثمانيةُ أعمدةٍ + طرفان)،
# فتُسقَط صفوفُ «المحرَّرة» ذاتُ الستّةِ أعمدةٍ وصفوفُ الترويسةِ والفاصلِ — وهذا
# عينُ ما يفعله `validate-work-claims.sh` كي لا يفترق المدقِّقانِ في قراءةِ السجل.
ROWS="$(awk -F'|' 'NF==10 && $9 ~ /Active/ && $2 ~ /CLM-/ {print $2"\t"$3"\t"$5}' "$CLAIMS" \
        | sed 's/[[:space:]]*\t[[:space:]]*/\t/g; s/^[[:space:]]*//; s/[[:space:]]*$//')"

if [[ -z "$ROWS" ]]; then
  printf '%s✓%s لا حجوزاتٍ نشطةً في السجل — لا شيءَ يُحرَس.\n' "$GRN" "$RST"
  exit 0
fi

# أهناك وصولٌ إلى المستودعِ البعيد؟ يُسأل مرّةً واحدةً لا لكلِّ فرع.
REMOTE_OK=0
if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git remote get-url origin >/dev/null 2>&1; then
  git ls-remote --heads --quiet origin >/dev/null 2>&1 && REMOTE_OK=1
fi

STALE=()
UNKNOWN=()
LIVE=0

while IFS=$'\t' read -r claim item branch; do
  [[ -n "${branch:-}" ]] || continue
  where=""
  if git rev-parse --verify --quiet "refs/heads/$branch" >/dev/null 2>&1; then
    where="مرجعٌ محليّ"
  elif git rev-parse --verify --quiet "refs/remotes/origin/$branch" >/dev/null 2>&1; then
    where="مرجعُ origin محليّاً"
  elif (( REMOTE_OK )); then
    if [[ -n "$(git ls-remote --heads origin "refs/heads/$branch" 2>/dev/null)" ]]; then
      where="المستودعُ البعيد"
    else
      STALE+=("$claim ($item) → $branch")
      continue
    fi
  else
    UNKNOWN+=("$claim ($item) → $branch")
    continue
  fi
  printf '  %s✓%s %-10s %-8s %s  %s(%s)%s\n' "$GRN" "$RST" "$claim" "$item" "$branch" "$YLW" "$where" "$RST"
  (( LIVE++ ))
done <<< "$ROWS"

if (( ${#UNKNOWN[@]} )); then
  printf '\n  %s⊘ تخطٍّ — لم يُسأل المستودعُ عن %d فرعٍ (لا مرجعٌ محليٌّ ولا وصولٌ إلى origin):%s\n' \
    "$YLW" "${#UNKNOWN[@]}" "$RST"
  for u in "${UNKNOWN[@]}"; do printf '      %s\n' "$u"; done
  printf '      لتشغيلٍ كامل: git fetch origin --prune  (وفي CI الوصولُ متاحٌ فيعمل الفحصُ كاملاً).\n'
fi

if (( ${#STALE[@]} )); then
  printf '\n%s✗ حجزٌ بائتٌ — فرعُه غيرُ موجودٍ في المستودع (%d):%s\n' "$RED" "${#STALE[@]}" "$RST" >&2
  for s in "${STALE[@]}"; do printf '    %s\n' "$s" >&2; done
  printf '\n  البروتوكول §8.1: يُحرَّر الحجزُ **بعدَ الدمج** ويُنقل صفُّه إلى «المحرَّرة» مع رابطِ دليل.\n' >&2
  printf '  والحجزُ النشطُ يمنع غيرَه من نطاقِه (الشرطُ 4) — فالبائتُ يُقفل نطاقاً على لا أحد.\n' >&2
  exit 1
fi

if (( ${#UNKNOWN[@]} )); then
  printf '\n%s✓ الحجوزاتُ المفحوصةُ (%d) فروعُها قائمة — والنجاحُ جزئيٌّ لا كامل.%s\n' "$GRN" "$LIVE" "$RST"
else
  printf '\n%s✓ كلُّ حجزٍ نشطٍ (%d) فرعُه قائمٌ في المستودع.%s\n' "$GRN" "$LIVE" "$RST"
fi
