#!/usr/bin/env bash
# validate-integration-isolation.sh — يحرس **عزلَ DDL** في اختباراتِ التكامل. (M0-03)
#
#   bash scripts/checks/validate-integration-isolation.sh [SERVICES_DIR]
#
# ── لماذا يوجد هذا الفحص ──────────────────────────────────────────────────
# اختباراتُ التكاملِ في هذا المستودعِ تعزلُ حالتَها بنمطٍ واحد: كلُّ ملفٍّ يملك
# مخطّطَ **القاعدةِ نفسِها** في `beforeAll` (`DROP TABLE ... CASCADE` ثمّ إعادةُ
# تشغيلِ `contracts/schema.sql`). وهذا النمطُ سليمٌ **بشرطٍ واحدٍ لا يُرى في الملفّ**:
# ألّا يجري ملفّان معاً. فإن جريا في عاملَين متوازيَين أسقطَ أحدُهما جداولَ الآخرِ
# وهو يعمل — لا لخطأٍ في الاختبارِ، بل لسطرٍ **غائبٍ من الإعداد**.
#
# وقد وقع فعلاً: `services/identity` كانت الخدمةَ الوحيدةَ من إحدى عشرةَ التي لا
# تضبط `fileParallelism: false`، ولها ملفّانِ يُسقطان الجداولَ. وعلى Postgres
# حقيقيّةٍ فشلت حزمتُها **10 من 10** تشغيلاتٍ بأربعةِ عوامل (`duplicate key value`)،
# ونجحت **10 من 10** بعدَ السطرِ الواحد. (M0-03 — القياسُ في `TASK_LOG.md`.)
#
# ── لماذا لا يكفي أن يُصلَح إعدادٌ واحد ────────────────────────────────────
# العيبُ **غيابُ سطرٍ**، وغيابُ السطرِ لا يُسقط اختباراً في مراجعةِ الكود: الحزمةُ
# تنجح على آلةٍ بنواتَين لأنّ vitest يجعل حدَّ العواملِ `availableParallelism - 1`،
# فيتسلسل الملفّان **عرَضاً**. فما نجاحُها دليلَ عزلٍ، وما كان كذلك لزِمه حارسٌ
# يقرأ الإعداداتِ من القرصِ لا ثقةٌ في مراجع.
#
# ── البابانِ المحروسان ────────────────────────────────────────────────────
#   1. `vitest.integration.config.ts` — يجب أن يُسلسِل الملفّات.
#   2. `vitest.config.ts` الافتراضيُّ — يجب أن **يستثني** ملفّاتِ التكاملِ، وإلّا
#      جرَت في `pnpm -r test` بتوازٍ كامل، فيعود العيبُ من البابِ الآخر.
#
# ── البديلُ المشروعُ ولماذا يُقبَل ─────────────────────────────────────────
# خارطةُ الطريقِ تُجيز `schema-per-worker` بدلاً من التسلسل. فمَن اختاره كتبَ في
# إعدادِه الوسمَ `GOV-ISOLATION: schema-per-worker` فيُقبَل ويُطبَع وسمُه — كي لا
# يصير الحارسُ سجناً لخيارٍ أجازته الخارطة. ولا يُقبَل وسمٌ بلا تسلسلٍ في خدمةٍ
# ملفّاتُها تُسقط الجداولَ إلّا بهذا التصريحِ المكتوب.
#
# ── حدُّ هذا الفحصِ المُعلَن ────────────────────────────────────────────────
# يقرأ **الإعداداتَ** لا يشغّل قاعدةً: يحكم على وجودِ شرطِ العزلِ لا على خلوِّ
# الاختباراتِ من كلِّ سباق. وسباقٌ داخلَ ملفٍّ واحدٍ (`it.concurrent` على جداولَ
# مشتركة) خارجَ مداه ولا يُدَّعى أنّه مأخوذ. وخدمةٌ بملفٍّ تكامليٍّ واحدٍ لا
# تُطالَب بالتسلسلِ: ملفٌّ لا يُسابق نفسَه — ويُطبَع ذلك صريحاً لا يُسكَت عنه.
set -uo pipefail

cd "$(dirname "$0")/../.." || { echo "تعذّر الوصول إلى جذر المستودع" >&2; exit 1; }

SERVICES_DIR="${1:-services}"
RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'

[[ -d "$SERVICES_DIR" ]] || {
  printf '%s✗%s مجلَّدُ الخدماتِ غيرُ موجود: %s\n' "$RED" "$RST" "$SERVICES_DIR" >&2
  exit 1
}

VIOLATIONS=()
GUARDED=0
SINGLE=0
ALT=0

for svc in "$SERVICES_DIR"/*/; do
  [[ -d "$svc" ]] || continue
  name="$(basename "$svc")"

  # ملفّاتُ التكاملِ/الطرفِ-إلى-الطرفِ بنفسِ نمطِ `include` المستخدَمِ في الإعدادات.
  files=()
  while IFS= read -r f; do [[ -n "$f" ]] && files+=("$f"); done < <(
    find "$svc/src/__tests__" -maxdepth 1 -type f \
      \( -name '*.integration.test.ts' -o -name '*.e2e.test.ts' \) 2>/dev/null | sort
  )
  count="${#files[@]}"
  (( count > 0 )) || continue

  icfg="$svc/vitest.integration.config.ts"
  dcfg="$svc/vitest.config.ts"

  # ــ البابُ الثاني: الاستثناءُ من الإعدادِ الافتراضيّ ــ
  if [[ -f "$dcfg" ]] && ! grep -q 'integration,e2e\|\.integration\.test\.ts' "$dcfg"; then
    printf '  %s✗%s %-14s الإعدادُ الافتراضيُّ لا يستثني ملفّاتِ التكاملِ — تجري في «pnpm -r test» بتوازٍ كامل\n' \
      "$RED" "$RST" "$name"
    VIOLATIONS+=("$name: vitest.config.ts بلا استثناء")
  fi

  # ــ ملفٌّ واحدٌ لا يُسابق نفسَه ــ
  if (( count < 2 )); then
    printf '  %s○%s %-14s ملفٌّ تكامليٌّ واحدٌ — لا يُطالَب بالتسلسل\n' "$DIM" "$RST" "$name"
    SINGLE=$((SINGLE + 1))
    continue
  fi

  # ــ البابُ الأوّل: التسلسلُ في إعدادِ التكامل ــ
  if [[ ! -f "$icfg" ]]; then
    printf '  %s✗%s %-14s %d ملفّاتِ تكاملٍ ولا «vitest.integration.config.ts» — لا عزلَ مضمون\n' \
      "$RED" "$RST" "$name" "$count"
    VIOLATIONS+=("$name: لا إعدادَ تكامل")
    continue
  fi

  if grep -Eq 'fileParallelism:[[:space:]]*false' "$icfg"; then
    printf '  %s✓%s %-14s %d ملفّاتٍ · متسلسلٌ (fileParallelism: false)\n' "$GRN" "$RST" "$name" "$count"
    GUARDED=$((GUARDED + 1))
  elif grep -q 'GOV-ISOLATION: schema-per-worker' "$icfg"; then
    printf '  %s✓%s %-14s %d ملفّاتٍ · عزلٌ بمخطّطٍ لكلِّ عاملٍ (وسمٌ مُعلَن)\n' "$GRN" "$RST" "$name" "$count"
    ALT=$((ALT + 1))
  else
    printf '  %s✗%s %-14s %d ملفّاتٍ يُسقط كلٌّ منها جداولَ القاعدةِ نفسِها، والإعدادُ بلا «fileParallelism: false»\n' \
      "$RED" "$RST" "$name" "$count"
    VIOLATIONS+=("$name: إعدادُ تكاملٍ بلا تسلسل")
  fi
done

if (( ${#VIOLATIONS[@]} )); then
  printf '\n%s✗ عزلُ DDL مكسورٌ في %d موضعاً:%s\n' "$RED" "${#VIOLATIONS[@]}" "$RST"
  for v in "${VIOLATIONS[@]}"; do printf '    · %s\n' "$v"; done
  printf '  العلاجُ سطرٌ واحدٌ: «fileParallelism: false» في إعدادِ التكامل، أو الوسمُ\n'
  printf '  «GOV-ISOLATION: schema-per-worker» إن اختِيرَ العزلُ بمخطّطٍ لكلِّ عامل.\n'
  printf '  المرجع: docs/00-rules/TESTING_RULES.md §1 · M0-03\n'
  exit 1
fi

if (( GUARDED + ALT == 0 )); then
  printf '\n%s○ لا ينطبق:%s لا خدمةَ لها ملفّانِ تكامليّانِ أو أكثر — لا شيءَ يُسلسَل.\n' "$YLW" "$RST"
  exit 0
fi

printf '\n%s✓ عزلُ DDL مضمونٌ:%s %d خدمةً بالتسلسلِ' "$GRN" "$RST" "$GUARDED"
(( ALT )) && printf '، و%d بمخطّطٍ لكلِّ عامل' "$ALT"
(( SINGLE )) && printf '، و%d بملفٍّ واحدٍ لا يُسابق نفسَه' "$SINGLE"
printf '.\n'
exit 0
