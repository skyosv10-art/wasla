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
#   4) **برهانُ الترقيةِ** (M0-34 · RISK-0020): كلُّ ترحيلٍ **غيرِ أساسٍ** (tag لا
#      يبدأُ بـ`0000_`) يعيشُ في خدمةٍ لها برهانُ ترقيةٍ على قاعدةٍ **مأهولةٍ**، لا
#      برهانُ دورةٍ على قاعدةٍ فارغةٍ وحدَه. ويُرفَضُ في ملفِّ الترحيلِ نمطُ
#      `ADD COLUMN … NOT NULL` بلا `DEFAULT` في عبارةٍ واحدةٍ.
#
#      ولمَ بابٌ رابعٌ أصلاً؟ لأنَّ العطبَ **مقيسٌ لا متخيَّلٌ**: رأسُ
#      `services/delivery/drizzle/0001_idempotency_key_lifetime.sql` يشهدُ أنَّ
#      `drizzle-kit` أصدرَ تلكَ العبارةَ بعينِها، وأنّها تسقطُ بـ`23502` في كلِّ
#      قاعدةٍ فيها صفٌّ واحدٌ. فنجا المستودعُ **بمراجعةٍ يدويّةٍ وحدَها**، والمراجعةُ
#      اليدويّةُ ليست حارساً. والبابانِ 1 و3 لا يريانِ هذا: كلاهما يقيسُ **وجودَ**
#      ملفٍّ لا **سلامةَ ترقيةٍ**.
#
#      وحدُّ البابِ مُعلَنٌ: يقيسُ **الإعلانَ والنمطَ** (قراءةُ قرصٍ محضةٌ)، وأمّا
#      التنفيذُ الفعليُّ على PostgreSQL فيقيسُهُ البرهانُ نفسُهُ في وظيفةِ
#      db-integration. فهذا البابُ يمنعُ **غيابَ** البرهانِ، ولا يدَّعي تشغيلَهُ.
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

# ── البابُ 4) برهانُ الترقيةِ على قاعدةٍ مأهولةٍ (M0-34 · RISK-0020) ──────
# العلامةُ عقدٌ مقروءٌ آليّاً يكتبُهُ البرهانُ عن نفسِه:
#   @wasla-upgrade-proof: all-non-baseline        ← يُغطّي كلَّ ترحيلٍ غيرِ أساسٍ
#   @wasla-upgrade-proof: tags=0001_a,0002_b      ← يُغطّي المذكورينَ وحدَهم
# والثانيةُ موجودةٌ لأنَّ خدمةً قد تحتاجُ براهينَ مُجزَّأةً؛ ومتى جُزِّئتْ لزمَ أن
# يُغطّى **كلُّ** tag غيرِ أساسٍ، وإلّا فثغرةٌ مُعلَنةٌ لا مستورةٌ.
UPGRADE_MARK='@wasla-upgrade-proof'
for svc in "${ENROLLED[@]:-}"; do
  [[ -n "$svc" ]] || continue
  journal="$svc/drizzle/meta/_journal.json"
  [[ -f "$journal" ]] || continue
  mapfile -t all_tags < <(grep -oP '"tag"\s*:\s*"\K[^"]+' "$journal")
  nonbase=()
  for tag in "${all_tags[@]:-}"; do
    [[ -n "$tag" ]] || continue
    [[ "$tag" == 0000_* ]] && continue
    nonbase+=("$tag")
  done
  (( ${#nonbase[@]} )) || continue

  # 4-أ) نمطُ الخطرِ: عمودٌ جديدٌ NOT NULL بلا DEFAULT في عبارةٍ واحدةٍ.
  # السّطرُ هو وحدةُ القياسِ لأنَّ `drizzle-kit` يُصدِرُ عبارةَ ALTER في سطرٍ واحدٍ؛
  # ومَن كتبَها موزَّعةً على أسطُرٍ فقد كتبَها بيدِهِ وهو يعلمُ، وله البابُ نفسُهُ
  # عبرَ المراجعةِ. والتعليقاتُ تُطرَحُ أوّلاً كيلا يُتَّهَمَ شرحٌ بأنّهُ عبارةٌ.
  for tag in "${nonbase[@]}"; do
    up="$svc/drizzle/$tag.sql"
    [[ -f "$up" ]] || continue
    body="$(grep -v '^[[:space:]]*--' "$up")"
    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      shopt -s nocasematch
      if [[ "$line" == *"ADD COLUMN"* && "$line" == *"NOT NULL"* \
            && "$line" != *"DEFAULT"* && "$line" != *"GENERATED"* ]]; then
        bad "$svc/$tag: «ADD COLUMN … NOT NULL» بلا DEFAULT في عبارةٍ واحدةٍ — تسقطُ بـ23502 على أوّلِ صفٍّ قائمٍ.
     الطريقُ الآمنُ ثلاثُ خطواتٍ (ADR-024): أضِفْهُ قابلاً للفراغِ، ثمَّ عبِّئْهُ رجعيّاً، ثمَّ SET NOT NULL.
     السطرُ: ${line:0:120}"
      fi
      shopt -u nocasematch
    done <<< "$body"
  done

  # 4-ب) وجودُ البرهانِ وتغطيتُهُ.
  proof_files="$(grep -rl -- "$UPGRADE_MARK" "$svc/src" 2>/dev/null || true)"
  if [[ -z "$proof_files" ]]; then
    bad "$svc: فيها ترحيلٌ غيرُ أساسٍ (${nonbase[*]}) بلا برهانِ ترقيةٍ على قاعدةٍ مأهولةٍ.
     اكتبْ برهاناً تحتَ $svc/src/__tests__/ يحملُ العلامةَ «$UPGRADE_MARK: all-non-baseline» — اختبارُ الدورةِ على قاعدةٍ فارغةٍ لا يُغني (M0-34)."
    continue
  fi
  covered_all=0
  declared_tags=""
  while IFS= read -r pf; do
    [[ -n "$pf" ]] || continue
    decl="$(grep -oP "$UPGRADE_MARK:\s*\K\S+" "$pf" | head -1)"
    [[ "$decl" == "all-non-baseline" ]] && covered_all=1
    [[ "$decl" == tags=* ]] && declared_tags="$declared_tags,${decl#tags=}"
  done <<< "$proof_files"
  if (( covered_all )); then
    ok "$svc: برهانُ الترقيةِ حاضرٌ ويُعلِنُ تغطيةَ كلِّ ترحيلٍ غيرِ أساسٍ (${#nonbase[@]})."
    continue
  fi
  if [[ -z "$declared_tags" ]]; then
    bad "$svc: البرهانُ موجودٌ بلا إعلانِ تغطيةٍ صالحٍ — يلزمُ «$UPGRADE_MARK: all-non-baseline» أو «$UPGRADE_MARK: tags=…»."
    continue
  fi
  missing=""
  for tag in "${nonbase[@]}"; do
    [[ ",$declared_tags," == *",$tag,"* ]] || missing="${missing:+$missing }$tag"
  done
  if [[ -n "$missing" ]]; then
    bad "$svc: ترحيلاتٌ غيرُ أساسٍ خارجَ تغطيةِ برهانِ الترقيةِ: $missing"
  else
    ok "$svc: برهانُ الترقيةِ يُغطّي كلَّ ترحيلٍ غيرِ أساسٍ بإعلانٍ صريحٍ."
  fi
done


# ── البابُ 5) خدمةٌ لها قاعدةٌ فعليّةٌ وليست منتظِمةً (M0-23 · الموجةُ 5) ──
# الإعلانُ وحدَهُ كانَ يُخفي: قائمةُ «غيرِ المنتظِمين» كانت تجمعُ في سطرٍ واحدٍ
# أربعةَ عشرَ اسماً، ثلاثةَ عشرَ منها **هياكلُ فارغةٌ** (صفرُ ملفاتِ TypeScript)
# وواحداً لهُ اثنانِ وثلاثونَ ملفاً وعقدٌ من مئتَين وخمسينَ سطراً واختباراتُ
# تكاملٍ على PostgreSQL حقيقيٍّ. فكانَ الحارسُ **يذكرُ** العطبَ الحقيقيَّ بينَ
# ثلاثةَ عشرَ اسماً لا عطبَ فيها — وذاكَ إخفاءٌ بالضجيجِ لا شفافيّةٌ.
#
# ودَينُ خدمةِ البحثِ كانَ **مُعلَناً بالحرفِ** في سجلِّ المهامِّ يومَ مراجعتِها
# التأسيسيّةِ («ترحيلٌ يُولَّدُ لاحقاً عندَ إضافةِ طبقةِ قاعدةِ البياناتِ»)، ثمَّ
# أُضيفتْ طبقةُ القاعدةِ في مراجعاتٍ تالياتٍ ولم يُولَّدِ الترحيلُ. فوجودُ الكودِ
# لم يكن إثباتاً، والوعدُ المكتوبُ في سجلٍّ ليسَ حارساً — وهذا البابُ هوَ الحارسُ.
#
# فالمعيارُ ليسَ «خدمةٌ موجودةٌ» بل **خدمةٌ لها قاعدةُ بياناتٍ فعليّةٌ**، وقياسُهُ
# ثلاثُ علاماتٍ مجتمعةٍ تُقرأُ من القرصِ لا من قائمةٍ يدويّةٍ:
#   1) `contracts/schema.sql` موجودٌ، و2) فيهِ `CREATE TABLE` (لا عقدُ تعليقاتٍ)،
#   و3) في `src/` ملفٌّ يستوردُ `pg` (طبقةُ قاعدةٍ تعملُ لا نموذجٌ مكتوبٌ).
# فالهيكلُ الفارغُ لا يُصيبُ الشرطَ الثالثَ، والخدمةُ التي تعملُ على قاعدةٍ لا
# تُفلِتُ منهُ.
#
# والإعفاءُ مشروعٌ ولكن **مُعلَناً بسببٍ مكتوبٍ** لا صمتاً:
#   -- @wasla-migrations-exempt: <السببُ>
# يُكتَبُ في عقدِ الخدمةِ أو في `src/`، ويُرفَضُ الإعفاءُ بلا سببٍ مفهومٍ —
# فعلامةٌ فارغةٌ ليست قراراً، وإنّما هي البابُ نفسُهُ يُعطَّلُ بكلمةٍ.
#
# والقياسُ **عددُ الكلماتِ لا عددُ المحارفِ** بقصدٍ: `${#var}` في bash يعدُّ
# **بايتاتٍ** حينَ تكونُ اللغةُ C، ووثائقُ هذا المستودعِ عربيّةٌ فكلُّ حرفٍ
# بايتانِ — فحدُّ محارفٍ كانَ يقبلُ «لاحقاً» (كلمةٌ واحدةٌ) ويرفضُ سبباً
# إنجليزيّاً من ثلاثِ كلماتٍ. وقد **قُيسَ** ذلكَ في حالةِ اختبارٍ أخفقتْ أوّلَ
# مرّةٍ: العلامةُ ذاتُ الكلمةِ الواحدةِ مرّت، فالمعيارُ أربعُ كلماتٍ فأكثرَ.
EXEMPT_MARK='@wasla-migrations-exempt'
mapfile -t ALL_SVCS < <(ls -d services/*/ 2>/dev/null | sed 's|/$||' | sort)
NOT_ENROLLED=""
for s in "${ALL_SVCS[@]:-}"; do
  [[ -n "$s" ]] || continue
  skip=0
  for e in "${ENROLLED[@]:-}"; do [[ "$e" == "$s" ]] && { skip=1; break; }; done
  (( skip )) && continue
  NOT_ENROLLED="${NOT_ENROLLED:+$NOT_ENROLLED }${s#services/}"

  contract="$s/contracts/schema.sql"
  [[ -f "$contract" ]] || continue
  # لا أنبوبَ قبلَ `grep -q` (RISK-0037): SIGPIPE يُقرأُ «لا تطابق» فيُفلِتُ عقدٌ حقيقيٌّ.
  grep -q 'CREATE TABLE' "$contract" || continue
  pg_users="$(grep -rlE "(from|require\()[[:space:]]*[\"']pg[\"']" "$s/src" 2>/dev/null || true)"
  [[ -n "$pg_users" ]] || continue

  exempt_reason=""
  for hay in "$contract" "$s/src"; do
    [[ -e "$hay" ]] || continue
    found="$(grep -rhoP "$EXEMPT_MARK:\s*\K.*" "$hay" 2>/dev/null | head -1 || true)"
    [[ -n "$found" ]] && { exempt_reason="$found"; break; }
  done
  if [[ -n "$exempt_reason" ]]; then
    reason_words="$(wc -w <<< "$exempt_reason")"
    if (( reason_words < 4 )); then
      bad "${s#services/}: إعفاءٌ من الترحيلاتِ بلا سببٍ مفهومٍ ($reason_words كلمةً: «$exempt_reason» · والحدُّ أربعٌ) — العلامةُ قرارٌ مُسجَّلٌ لا كلمةٌ تُسكِتُ باباً."
    else
      note "${s#services/}: غيرُ منتظِمةٍ بإعفاءٍ مُعلَنٍ — $exempt_reason"
    fi
    continue
  fi

  bad "${s#services/}: لها قاعدةُ بياناتٍ فعليّةٌ (عقدٌ فيهِ CREATE TABLE + استيرادُ pg في $(wc -l <<< "$pg_users") ملفٍّ) وهي **غيرُ منتظِمةٍ** في الترحيلاتِ.
     الإعلانُ لا يكفي هنا: الهيكلُ الفارغُ يُذكَرُ، وأمّا خدمةٌ تكتبُ في قاعدةٍ فترقيتُها بلا ترحيلٍ مُرقَّمٍ عكوسٍ تعني تطبيقَ العقدِ كاملاً أو لا شيءَ.
     الطريقُ: انتظِمْها (ADR-024 §2.4) — مرآةٌ في src/db/schema.ts ثمَّ drizzle-kit generate ثمَّ رفيقُ ترجعٍ ثمَّ اختبارُ دورةٍ يقيسُ التكافؤَ؛
     أو أعلِنِ الإعفاءَ بسببٍ: -- $EXEMPT_MARK: <السببُ>"
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
