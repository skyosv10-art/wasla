#!/usr/bin/env bash
# validate-migrations.sh — حارسُ الترحيلاتِ المولَّدةِ العكوسةِ (M0-23 · فحصُ 13).
#
# السّؤالُ الذي يجيبُ عنه هذا الفحصُ واحدٌ ومحدودٌ:
#
#   **هل دخلَ المستودعَ تغييرُ مخطَّطٍ في خدمةٍ مُنتظِمةٍ بلا ترحيلٍ مقابلٍ، أو
#   ترحيلٌ بلا رفيقِ ترجعٍ — بلا إعلانِ عدمِ عكسيّةٍ صريحٍ؟**
#
# وليسَ السّؤالُ: «هل الخدماتُ كلُّها مُنتظِمةٌ في الترحيلات؟» — فليستْ كذلك،
# وهذا مُعلَنٌ في ADR-024 §2.4 لا مُداوى بالصمت: التطبيقُ **تدريجيٌّ**، والخدمةُ
# تُنتظِمُ حينَ تُولِّدُ أساسَها (فتنشأُ لها drizzle/meta/_journal.json). فالحارسُ
# يقيسُ على **المنتظِمين** وحدَهم، ويعلنُ قائمةَ غيرِ المنتظِمينَ إعلاناً لا
# رفضاً — فبقيّةُ الموجاتِ (2 و3) عناصرُ عملٍ قائمةٌ بحجزِها.
#
# فهو إذن حارسُ **انضباطِ المُنتظِمين**، لا شهادةُ اكتمالِ التغطية. وبرهانُ
# العكسيّةِ **فعلاً** (تطبيقٌ فترجعٌ فنظافةٌ) يقيسُهُ اختبارُ الدورةِ التكامليُّ
# (`services/*/src/__tests__/migrations.integration.test.ts`) على PostgreSQL حقيقيٍّ
# في وظيفةِ db-integration القائمةِ — وهذا الحارسُ نصفُ الإلزامِ وذاكَ نصفُهُ.
#
# الأبوابُ:
#   1) كلُّ خدمةٍ مُنتظِمةٍ: journal صالحٌ — كلُّ tag له ملفُّهُ الأماميُّ ورفيقُهُ
#      `.down.sql`، ولا ملفَّ يتيماً خارجَ الـjournal.
#   2) [بمرجعَي git] كلُّ تغييرٍ على `contracts/schema.sql` أو `drizzle/schema.ts`
#      أو `src/db/schema.ts` في خدمةٍ مُنتظِمةٍ يُلازِمُهُ ترحيلٌ جديدٌ في الدفعةِ.
#   3) الترجعُ المُزوَّرُ ممنوعٌ: رفيقُ الترجعِ لا يكونُ فارغاً ولا تعليقاً خالصاً؛
#      ومن لا تراجعَ له يُعلِنُهُ بعلامةِ «-- غير عكوس» في رأسِ ملفِّهِ لا أن
#      يُخفاهُ.
#
# المرجع: docs/15-decisions/ADR-024 · M0-23 · RISK-0020
#
#   bash scripts/checks/validate-migrations.sh              # بنيويٌّ وحدَه
#   bash scripts/checks/validate-migrations.sh OLD NEW      # + فحصُ الدفعةِ
#
# لا شبكةَ: قراءةُ قرصٍ محضةٌ (+ git diff حينَ تُمرَّرُ المراجعُ).
set -uo pipefail

cd "$(dirname "$0")/../.." || { echo "تعذّر الوصول إلى جذر المستودع" >&2; exit 1; }

RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RST=$'\033[0m'

FAIL=0
ok()  { printf '  %s✓%s %s\n' "$GRN" "$RST" "$1"; }
bad() { printf '  %s✗%s %s\n' "$RED" "$RST" "$1"; FAIL=1; }
note(){ printf '  %s⊘%s %s\n' "$YLW" "$RST" "$1"; }

# ── الخدماتُ المُنتظِمةُ: مَن لها journal ─────────────────────────────────
# الانتظامُ **مقصودٌ أن يكونَ اكتشافاً لا قائمةً يدويّةً**: قائمةٌ ثابتةٌ هنا
# كانت ستنحرفَ عن الواقعِ عندَ أوّلِ موجةٍ تُنفَّذُ ولا يُحدَّثُ الحارسُ معها.
mapfile -t ENROLLED < <(ls -d services/*/drizzle/meta 2>/dev/null | sed 's|/drizzle/meta||' | sort)
if (( ${#ENROLLED[@]} == 0 )); then
  note "لا خدماتَ مُنتظِمةً بعدُ (لا journal لأيِّ خدمةٍ) — البوّابةُ 1 تُتخطّى."
else
  ok "الخدماتُ المُنتظِمةُ في الترحيلاتِ: ${ENROLLED[*]#$'services/'}"
fi

# ── البابُ 1) سلامةُ journal ورفاقِ الترجعِ ───────────────────────────────
for svc in "${ENROLLED[@]:-}"; do
  [[ -n "$svc" ]] || continue
  journal="$svc/drizzle/meta/_journal.json"
  [[ -f "$journal" ]] || { bad "$svc: journal مفقودٌ (وهو شرطُ الانتظامِ)"; continue; }

  # كلُّ tag في الـjournal: ملفٌّ أماميٌّ + رفيقُ ترجعٍ (أو علامةُ عدمِ عكسيّةٍ)
  mapfile -t tags < <(grep -oP '"tag"\s*:\s*"\K[^"]+' "$journal")
  if (( ${#tags[@]} == 0 )); then
    bad "$svc: journal بلا أيةِ ترحيلاتٍ — إمّا journal زائفٌ أو خطأُ توليدٍ."
  fi
  for tag in "${tags[@]:-}"; do
    [[ -n "$tag" ]] || continue
    up="$svc/drizzle/$tag.sql"
    if [[ ! -f "$up" ]]; then
      bad "$svc: الترحيلُ $tag في الـjournal بلا ملفٍّ ($tag.sql)."
      continue
    fi
    down="$svc/drizzle/$tag.down.sql"
    # علامةُ عدمِ العكسيّةِ: تُقرأُ من رأسِ الملفِّ الأماميِّ (أوّلُ 5 أسطرٍ) —
    # إعلانٌ صريحٌ لا down زائفٌ (ADR-024 §2.2)، ويُعلَنُ بصوتٍ عالٍ لا يمرُّ صامتاً.
    # لا أنبوبَ قبلَ `grep -q` (`RISK-0037`): خروجُ `grep` عندَ أوّلِ تطابقٍ يقتلُ
    # `head` بـ`SIGPIPE` فتصيرُ حالةُ الأنبوبِ 141 تحتَ `pipefail` فتُقرأُ «لا
    # تطابق» — فتُهمَلُ علامةُ «غير عكوس» الموجودةُ فعلاً ويُطلَبُ `down` لا
    # معنى لهُ. والرقعةُ: لا أنبوبَ — `head` يكتملُ أوّلاً ثمَّ يُبحَثُ في نصِّه.
    if grep -q "غير عكوس" <<< "$(head -5 "$up")"; then
      note "$svc: الترحيلُ $tag مُعلَنٌ غيرَ عكوسٍ (بقرارٍ مُسجَّلٍ) — لا down مطلوباً."
      continue
    fi
    if [[ ! -f "$down" ]]; then
      bad "$svc: الترحيلُ $tag بلا رفيقِ ترجعٍ ($tag.down.sql) — ADR-024 §2.2."
      continue
    fi
    # البابُ 3) الترجعُ المُزوَّرُ: ملفٌّ لا يحوي عبارةً واحدةً لا تعليقاً
    # وكذلكَ هنا (`RISK-0037`): لو ماتَ `grep -v` بـ`SIGPIPE` لصارَ رفيقُ ترجُعٍ
    # **سليمٌ** مُتَّهَماً بالتزويرِ باحتمالٍ.
    if ! grep -q '[[:alnum:]]' <<< "$(grep -v '^[[:space:]]*--' "$down")"; then
      bad "$svc: رفيقُ ترجعِ $tag فارغٌ أو تعليقاتٌ خالصةٌ — ترجعٌ مُزوَّرٌ لا يُقبل."
    fi
  done

  # لا يتاما: كلُّ ملفِّ ترحيلٍ على القرصِ يجبُ أن يكونَ في الـjournal
  for f in "$svc"/drizzle/*.sql; do
    [[ -e "$f" ]] || continue
    base="$(basename "$f")"
    tag="${base%.down.sql}"; tag="${tag%.sql}"
    grep -q "\"$tag\"" "$journal" || bad "$svc: الملفُّ $base يتيماً خارجَ الـjournal."
  done
done
(( ${#ENROLLED[@]} )) && ok "كلُّ الخدماتِ المُنتظِمةِ: journal سليمٌ ورفاقُ الترجعِ حاضرون (أو مُعلَنونَ غيرَ عكوسين)."

# ── الخدماتُ غيرُ المنتظِمةِ: إعلانٌ لا رفضٌ (الموجاتُ 2 و3 عناصرُ عملٍ) ──
mapfile -t ALL_SVCS < <(ls -d services/*/ 2>/dev/null | sed 's|/$||' | sort)
NOT_ENROLLED=""
for s in "${ALL_SVCS[@]:-}"; do
  [[ -n "$s" ]] || continue
  skip=0
  for e in "${ENROLLED[@]:-}"; do [[ "$e" == "$s" ]] && { skip=1; break; }; done
  (( skip )) || NOT_ENROLLED="${NOT_ENROLLED:+$NOT_ENROLLED }${s#services/}"
done
[[ -n "$NOT_ENROLLED" ]] && note "غيرُ منتظِمةٍ بعدُ (موجاتُ ADR-024 §2.4): $NOT_ENROLLED"

# ── البابُ 2) فحصُ الدفعةِ: لا تغييرَ مخطَّطٍ بلا ترحيلٍ ──────────────────
if [[ $# -lt 2 ]]; then
  note "لم تُمرَّر مراجعُ git — فحصُ الدفعةِ (تغييرُ المخطَّطِ ⇒ ترحيلٌ) مُتخطًّى، والبابُ 1 نافذٌ."
  if (( FAIL )); then
    printf '\n%s✗ حارسُ الترحيلاتِ: إخفاق.%s\n' "$RED" "$RST"
    exit 1
  fi
  printf '\n%s✓ حارسُ الترحيلاتِ: البنيويُّ سليمٌ (فحصُ الدفعةِ مُتخطًّى بلا مراجعَ).%s\n' "$GRN" "$RST"
  exit 0
fi

command -v git >/dev/null 2>&1 || { echo "git غير متاح" >&2; exit 1; }
OLD_REF="$1"; NEW_REF="$2"
CHANGED="$(git diff --name-only "$OLD_REF" "$NEW_REF" -- 2>/dev/null || true)"
[[ -n "$CHANGED" ]] || { ok "لا ملفاتٍ مُعدَّلةٍ بينَ المرجعَين."; exit 0; }

# مصادرُ المخطَّطِ التي يُلازمُها الترحيلُ (القائمةُ على القرصِ لا على نمطٍ واحدٍ)
SCHEMA_RE='^services/[^/]+/(contracts/schema\.sql|src/infrastructure/drizzle/schema\.ts|src/db/schema\.ts)$'
MIG_NEW_RE='^services/[^/]+/drizzle/[^/]+\.sql$'

# الخدماتُ التي استجدَّ لها ترحيلٌ في هذه الدفعةِ
declare -A MIG_IN_DIFF=()
while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  [[ "$f" =~ $MIG_NEW_RE ]] || continue
  svc="$(printf '%s' "$f" | cut -d/ -f1-2)"
  MIG_IN_DIFF["$svc"]=1
done <<< "$CHANGED"

VIOLATIONS=""
while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  [[ "$f" =~ $SCHEMA_RE ]] || continue
  svc="$(printf '%s' "$f" | cut -d/ -f1-2)"
  # غيرُ المنتظِمةِ: الموجاتُ القادمةُ تعالجُها — إعلانٌ لا رفضٌ (§2.4)
  enrolled=0
  for e in "${ENROLLED[@]:-}"; do [[ "$e" == "$svc" ]] && { enrolled=1; break; }; done
  (( enrolled )) || continue
  # منتظِمةٌ: التغييرُ يلزمُهُ ترحيلٌ جديدٌ في الدفعةِ نفسِها
  if [[ -z "${MIG_IN_DIFF[$svc]:-}" ]]; then
    VIOLATIONS="$VIOLATIONS
     - $f (في $svc) بلا ترحيلٍ جديدٍ في الدفعةِ"
  fi
done <<< "$CHANGED"

if [[ -n "$VIOLATIONS" ]]; then
  bad "تغييرُ مخطَّطٍ في خدمةٍ مُنتظِمةٍ بلا ترحيلٍ مقابلٍ:$VIOLATIONS
     ولِّدْهُ بـ: pnpm --filter <pkg> exec drizzle-kit generate — ثمّ اكتبْ رفيقَ الترجعِ (ADR-024 §2.2)"
else
  ok "كلُّ تغييرِ مخطَّطٍ في الدفعةِ مُلازَمٌ بترحيلٍ (أو في خدمةٍ غيرِ منتظِمةٍ بعدُ)."
fi

if (( FAIL )); then
  printf '\n%s✗ حارسُ الترحيلاتِ: إخفاق.%s\n' "$RED" "$RST"
  exit 1
fi
printf '\n%s✓ حارسُ الترحيلاتِ: كلُّ الأبوابِ نافذة.%s\n' "$GRN" "$RST"
exit 0
