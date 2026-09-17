#!/usr/bin/env bash
# validate-replay-store.sh — حارسُ مخزنِ آثارِ رموزِ الخدمةِ (M1-03 · فحصُ 20).
#
# السّؤالُ الذي يُجيبُ عنهُ هذا الفحصُ واحدٌ ومحدودٌ:
#
#   **هل يختارُ جذرُ إقلاعٍ إنتاجيٌّ مخزنَ آثارٍ في الذاكرةِ بنفسِهِ؟**
#
# ولِمَ يلزمُ حارسٌ وقد أُغلِقَ `RISK-0015` مرّةً: لأنَّ ما أُغلِقَ لم يكنْ عطبَ
# صنفٍ بل **عطبَ قرارٍ موزَّعٍ**. أربعةَ عشرَ ملفّاً كانت تكتبُ سطراً واحداً
# (`new InMemoryServiceTokenReplayGuard()`) فتختارُ لنفسِها مخزناً لا يتجاوزُ
# العمليّةَ، فرمزٌ التُقِطَ من نسخةٍ يُقبَلُ على أختِها. وإصلاحُ الأربعةَ عشرَ
# **لا يمنعُ الخامسَ عشرَ**: خدمةٌ جديدةٌ تنسخُ جذراً قديماً من تاريخِ المستودعِ،
# أو تصحيحٌ يعيدُ السطرَ «مؤقّتاً»، يمرُّ من `tsc` سليماً ومن كلِّ اختبارٍ أخضرَ
# لأنَّ الاختبارَ يبني تبعيّاتِهِ بنفسِهِ ولا يرى جذرَ الإنتاجِ.
#
# فالحارسُ يحرسُ **اتّجاهاً لا حالةً**: القرارُ في مِغلافٍ واحدٍ
# (`@wasla/service-auth/replay-store`)، ولا يعودُ إلى الجذورِ بصمتٍ.
#
# الأبوابُ الأربعةُ:
#   1) لا جذرَ إقلاعٍ إنتاجيٍّ يبني `InMemoryServiceTokenReplayGuard`.
#   2) كلُّ جذرٍ يُركِّبُ هويّةَ خدمةٍ يبني حارسَهُ من المِغلافِ المُعتمَدِ.
#   3) المِغلافُ نفسُهُ موجودٌ ويُصدَّرُ من الحزمةِ (وإلّا فالبابانِ فوقَهُ يحرسانِ عدماً).
#   4) القرارُ الافتراضيُّ `postgres` ونمطُ الذاكرةِ مرفوضٌ في `production` —
#      مقروءاً من المِغلافِ حرفاً، فتخفيفُهُ تغييرٌ يُرى لا سهوٌ يمرُّ.
#
# وما **لا** يُدَّعى هنا: أنَّ المخزنَ يعملُ. عملُهُ — الاشتراكُ بينَ النسخِ
# والذَّرِّيّةُ تحتَ التوازي — يُقاسُ على PostgreSQL حقيقيٍّ في وظيفةِ
# `db-integration` · ساقِ `service-auth`، وأخضرُ هذا الحارسِ لا يُعوِّضُهُ.
#
# المرجع: docs/15-decisions/ADR-035-distributed-service-token-replay-store.md
#         docs/07-security/RISK_REGISTER.md · RISK-0015
#
#   bash scripts/checks/validate-replay-store.sh
#
# لا شبكةَ ولا git: قراءةُ قرصٍ محضةٌ — فلا تخطّيَ لهُ، مرورٌ أو إخفاقٌ.
set -uo pipefail

cd "$(dirname "$0")/../.." || { echo "تعذّر الوصول إلى جذر المستودع" >&2; exit 1; }

RED=$'\033[31m'; GRN=$'\033[32m'; RST=$'\033[0m'

WRAPPER="packages/service-auth/src/replay-store.ts"
GUARD_CLASS="InMemoryServiceTokenReplayGuard"
FACTORY="createServiceTokenReplayGuardFromEnv"
FAIL=0

fail() { printf '  %s·%s %s\n' "$RED" "$RST" "$1"; FAIL=1; }

# جذورُ الإقلاعِ الإنتاجيّةُ: خدماتٌ وزمنُ تشغيلِ البوتاتِ. ولا تدخلُ فيها
# المِرقاتُ ولا ملفّاتُ الاختبارِ بقصدٍ — نمطُ الذاكرةِ مشروعٌ هناكَ **بطلبٍ
# صريحٍ**، وهوَ ما يقيسُهُ البابُ 4 في المِغلافِ لا هنا.
mapfile -t ROOTS < <(
  { ls services/*/src/http/server.ts 2>/dev/null
    ls packages/bot-runtime/src/http/server.ts 2>/dev/null
  } | sort -u
)

printf '\n%sحارسُ مخزنِ آثارِ رموزِ الخدمةِ (M1-03 · RISK-0015)%s\n' "$GRN" "$RST"
printf '  جذورُ الإقلاعِ المقيسةُ: %d\n\n' "${#ROOTS[@]}"

if (( ${#ROOTS[@]} == 0 )); then
  fail "لا جذرَ إقلاعٍ واحدٍ وُجِدَ — الحارسُ كانَ سيحرسُ عدماً ويمرُّ أخضرَ"
fi

# ── 1) لا اختيارَ في الجذرِ ──────────────────────────────────────────────
for root in "${ROOTS[@]}"; do
  if grep -qE "new[[:space:]]+${GUARD_CLASS}[[:space:]]*\(" "$root"; then
    fail "1) ${root}: يبني ${GUARD_CLASS} بنفسِهِ — القرارُ عادَ إلى الجذرِ (RISK-0015)"
  fi
done

# ── 2) من يُركِّبُ هويّةً يبني حارسَهُ من المِغلافِ ─────────────────────────
for root in "${ROOTS[@]}"; do
  grep -q "serviceIdentity" "$root" || continue
  if ! grep -q "${FACTORY}" "$root"; then
    fail "2) ${root}: يُركِّبُ هويّةَ خدمةٍ بلا ${FACTORY} — من أينَ جاءَ حارسُهُ؟"
  fi
done

# ── 3) المِغلافُ موجودٌ ومُصدَّرٌ ────────────────────────────────────────
if [[ ! -f "$WRAPPER" ]]; then
  fail "3) المِغلافُ مفقودٌ: ${WRAPPER}"
else
  grep -q "export function ${FACTORY}" "$WRAPPER" \
    || fail "3) ${WRAPPER}: لا يُصدِّرُ ${FACTORY}"
  grep -q '"./replay-store"' packages/service-auth/package.json \
    || fail "3) packages/service-auth/package.json: التصديرُ الفرعيُّ ./replay-store غائبٌ"
fi

# ── 4) الافتراضُ آمنٌ والذاكرةُ مرفوضةٌ في الإنتاجِ ────────────────────────
if [[ -f "$WRAPPER" ]]; then
  grep -q 'return "postgres"' "$WRAPPER" \
    || fail "4) ${WRAPPER}: النمطُ الافتراضيُّ لم يعُدْ postgres — الهبوطُ الصامتُ عادَ"
  grep -q 'NODE_ENV' "$WRAPPER" && grep -q '"production"' "$WRAPPER" \
    || fail "4) ${WRAPPER}: لا رفضَ مقروءاً لنمطِ الذاكرةِ في production"
fi

printf '\n'
if (( FAIL )); then
  printf '%s✗ مخزنُ آثارِ الرموزِ: الحارسُ عضَّ.%s\n' "$RED" "$RST"
  printf '  المرجعُ: docs/15-decisions/ADR-035-distributed-service-token-replay-store.md\n\n'
  exit 1
fi

printf '%s✓ مخزنُ آثارِ الرموزِ: القرارُ في مِغلافٍ واحدٍ، ولا جذرَ يختارُ لنفسِهِ.%s\n' "$GRN" "$RST"
printf '  ولا يُدَّعى هنا أنَّ المخزنَ يعملُ: ذاكَ برهانُ db-integration · ساقِ service-auth.\n\n'
