#!/usr/bin/env bash
# validate-request-binding.sh — حارسُ ربطِ الطلبِ بسلسلةِ الاستعلامِ (M1-03 · فحصُ 21).
#
# السّؤالُ الذي يُجيبُ عنهُ هذا الفحصُ واحدٌ ومحدودٌ:
#
#   **هل عادَ أحدٌ يقطعُ سلسلةَ الاستعلامِ قبلَ التوقيعِ أو قبلَ التحقُّقِ؟**
#
# ولِمَ يلزمُ حارسٌ وقد أُغلِقَ `RISK-0026` مرّةً: لأنَّ القطعَ **سطرٌ واحدٌ بريءُ
# المنظرِ** (`url.split("?")[0]`) يُكتَبُ في أيِّ مساعدٍ أو مُوقِّعٍ بحُسنِ نيّةٍ —
# «كي يُطابِقَ المسارَ المُسجَّلَ». وقد وُجِدَ منهُ **ثلاثةٌ وعشرونَ موضعاً** يومَ
# الإغلاقِ، ولا `tsc` يراهُ ولا اختبارٌ يعضُّ عليهِ: الاختبارُ الذي يقطعُ عندَ
# التوقيعِ **يمرُّ أخضرَ** لأنَّهُ يقطعُ عندَ الطرفَينِ معاً، فيُصادِقُ على
# انفصالٍ عن الإنتاجِ بدَلَ أن يكشفَهُ.
#
# فالحارسُ يحرسُ **اتّجاهاً لا حرفاً**: التطبيعُ في دالّةٍ واحدةٍ
# (`canonicalRequestBinding`)، والحدُّ يُسلِّمُ الهدفَ كما وصلَ، والبادئةُ لا
# تعودُ إلى صيغةٍ مُبطَلةٍ.
#
# الأبوابُ الخمسةُ:
#   1) `canonicalRequestBinding` تضمُّ الاستعلامَ فعلاً (لا تقطعُهُ وتنتهي).
#   2) التطبيعُ مُرتَّبٌ — وإلّا فأوّلُ وسيطٍ يُعيدُ الترتيبَ يُنتِجُ رفضاً كاذباً.
#   3) هدفُ الربطِ عندَ حدِّ `fastify` هوَ `request.url` كاملاً، لا مقطوعاً.
#   4) البادئةُ الحاليّةُ ليست في المُبطَلاتِ، والمُبطَلاتُ مُعلَنةٌ لا صامتةٌ.
#   5) لا مساعدَ توقيعٍ في المستودعِ يقطعُ الاستعلامَ قبلَ أن يُوقِّعَ.
#
# وما **لا** يُدَّعى هنا: أنَّ الربطَ يعملُ. عملُهُ — رفضُ هدفٍ لم يُوقَّعْ لهُ
# وقبولُ مُعادِ الترتيبِ — يُقاسُ في `packages/service-auth/src/__tests__/`
# (`token` · `fastify` · `http-server.e2e`)، وأخضرُ هذا الحارسِ لا يُعوِّضُهُ.
#
# المرجع: docs/15-decisions/ADR-036-request-binding-includes-query.md
#         docs/15-decisions/ADR-021-service-token-replay-policy.md §4
#         docs/07-security/RISK_REGISTER.md · RISK-0026
#
#   bash scripts/checks/validate-request-binding.sh
#
# لا شبكةَ ولا git: قراءةُ قرصٍ محضةٌ — فلا تخطّيَ لهُ، مرورٌ أو إخفاقٌ.
set -uo pipefail

cd "$(dirname "$0")/../.." || { echo "تعذّر الوصول إلى جذر المستودع" >&2; exit 1; }

RED=$'\033[31m'; GRN=$'\033[32m'; RST=$'\033[0m'

TOKEN="packages/service-auth/src/token.ts"
EDGE="packages/service-auth/src/fastify.ts"
FAIL=0

fail() { printf '  %s·%s %s\n' "$RED" "$RST" "$1"; FAIL=1; }

printf '\n%sحارسُ ربطِ الطلبِ بسلسلةِ الاستعلامِ (M1-03 · RISK-0026)%s\n\n' "$GRN" "$RST"

# ── 1) الدالّةُ تضمُّ الاستعلامَ ────────────────────────────────────────────
if [[ ! -f "$TOKEN" ]]; then
  fail "1) مصدرُ الربطِ مفقودٌ: ${TOKEN}"
else
  grep -q "export function canonicalRequestBinding" "$TOKEN" \
    || fail "1) ${TOKEN}: canonicalRequestBinding غيرُ مُصدَّرةٍ — الحارسُ يحرسُ عدماً"
  grep -q "function canonicalQuery" "$TOKEN" \
    || fail "1) ${TOKEN}: لا تطبيعَ لسلسلةِ الاستعلامِ — القطعُ عادَ (RISK-0026)"
  # ولا أنبوبَ يُغذّي `grep -q` في هذا الحارسِ ولا في أخيهِ (`RISK-0037`): كلُّ
  # مقارنةٍ إمّا على ملفٍّ مباشرةً أو بـ`<<<` على نصٍّ جاهزٍ — فسباقُ `SIGPIPE`
  # لا يصيرُ حكماً على عملِ مُطوِّرٍ.
  if ! grep -qE '\$\{normalized\}\?\$\{query\}' "$TOKEN"; then
    fail "1) ${TOKEN}: الربطُ المُنتَجُ لا يضمُّ الاستعلامَ"
  fi
fi

# ── 2) التطبيعُ مُرتَّبٌ ──────────────────────────────────────────────────
# ولِمَ بابٌ لهُ وحدَهُ: ضمُّ الاستعلامِ بلا ترتيبٍ يُغلِقُ الخطرَ ويفتحُ رفضاً
# كاذباً على وسيطٍ يُعيدُ الترتيبَ — وهوَ عينُ سببِ استثناءِ `ADR-021 §4`.
if [[ -f "$TOKEN" ]]; then
  grep -q "pairs.sort" "$TOKEN" \
    || fail "2) ${TOKEN}: التطبيعُ بلا ترتيبٍ — إعادةُ ترتيبِ وسيطٍ ستُنتِجُ رفضاً كاذباً"
  grep -q "URLSearchParams" "$TOKEN" \
    || fail "2) ${TOKEN}: لا تفكيكَ مُعتمَداً لسلسلةِ الاستعلامِ"
fi

# ── 3) الحدُّ يُسلِّمُ الهدفَ كما وصلَ ────────────────────────────────────────
if [[ ! -f "$EDGE" ]]; then
  fail "3) حدُّ الفرضِ مفقودٌ: ${EDGE}"
else
  grep -qE 'function bindingTargetOf' "$EDGE" \
    || fail "3) ${EDGE}: لا دالّةَ هدفٍ مُسمّاةً — من أينَ يأتي المُقارَنُ؟"
  BODY="$(awk '/function bindingTargetOf/,/^}/' "$EDGE")"
  grep -q 'return request.url;' <<< "$BODY" \
    || fail "3) ${EDGE}: bindingTargetOf لا تُسلِّمُ request.url كاملاً — مصدرُ حقيقةٍ ثانٍ"
  if grep -qE 'split\("\?"\)|indexOf\("\?"\)' <<< "$BODY"; then
    fail "3) ${EDGE}: bindingTargetOf تقطعُ الاستعلامَ — القطعُ عادَ إلى الحدِّ"
  fi
fi

# ── 4) البادئةُ ليست مُبطَلةً، والمُبطَلاتُ مُعلَنةٌ ───────────────────────────
if [[ -f "$TOKEN" ]]; then
  SCHEME="$(grep -oP '(?<=SERVICE_TOKEN_SCHEME = ")[^"]+' "$TOKEN" | head -1)"
  if [[ -z "$SCHEME" ]]; then
    fail "4) ${TOKEN}: تعذّرَ قراءةُ SERVICE_TOKEN_SCHEME"
  else
    grep -q "SUPERSEDED_TOKEN_SCHEMES" "$TOKEN" \
      || fail "4) ${TOKEN}: لا قائمةَ بادئاتٍ مُبطَلةٍ — الصيغةُ القديمةُ تُرفَضُ بلا اسمٍ"
    SUPERSEDED="$(awk '/SUPERSEDED_TOKEN_SCHEMES/,/\]/' "$TOKEN")"
    if grep -q "\"${SCHEME}\"" <<< "$SUPERSEDED"; then
      fail "4) ${TOKEN}: البادئةُ الحاليّةُ ${SCHEME} مُدرَجةٌ في المُبطَلاتِ — كلُّ رمزٍ يُرفَضُ"
    fi
  fi
fi

# ── 5) لا مساعدَ توقيعٍ يقطعُ قبلَ أن يُوقِّعَ ─────────────────────────────────
# ويُقاسُ **السطرُ لا الملفُّ**: أوّلُ صياغةٍ لهذا البابِ أدانت كلَّ ملفٍّ يُوقِّعُ
# ويقطعُ، فعضَّت على ثلاثةِ مساعداتٍ تقطعُ **لتُقارِنَ مساراً بمسارٍ** قبلَ أن
# تستخرجَ المُنتَفِعَ من الجسمِ — وهوَ استعمالٌ مشروعٌ لا علاقةَ لهُ بالهدفِ
# المُوقَّعِ. وحارسٌ يُدينُ المشروعَ يُشترى صمتُهُ بتعطيلِهِ، فضُيِّقَ إلى ما يضرُّ:
#   · القطعُ في **مقارنةٍ** (`===` · `!==` · `startsWith` · `case`) مشروعٌ.
#   · وغيرُ ذلكَ يُدانُ، إلّا بعلامةٍ مكتوبةٍ في السطرِ نفسِهِ
#     (`binding-cut-ok:` معَ سببٍ) — فالاستثناءُ يُرى في المراجعةِ لا يُسكَتُ.
mapfile -t HITS < <(
  grep -rnE 'split\("\?"\)\[0\]' --include=*.ts \
    packages services bots 2>/dev/null \
    | grep -v node_modules \
    | grep -v "^packages/service-auth/src/token.ts:" \
    | grep -v "^packages/service-auth/src/fastify.ts:" \
    | grep -v "^packages/channel-core/src/domain/deep-link.ts:"
)
for hit in "${HITS[@]:-}"; do
  [[ -z "$hit" ]] && continue
  file="${hit%%:*}"; rest="${hit#*:}"; line="${rest#*:}"
  grep -qE 'serviceAuthHeaders|signServiceToken|canonicalRequestBinding|signFor|signGateRequest' "$file" \
    || continue
  grep -qE '===|!==|startsWith|case ' <<< "$line" && continue
  grep -q 'binding-cut-ok:' <<< "$line" && continue
  fail "5) ${file}:${rest%%:*}: يقطعُ الاستعلامَ ثمَّ يُوقِّعُ — الهدفُ المُوقَّعُ غيرُ الهدفِ المُرسَلِ"
done

printf '\n'
if (( FAIL )); then
  printf '%s✗ ربطُ الطلبِ: الحارسُ عضَّ.%s\n' "$RED" "$RST"
  printf '  المرجعُ: docs/15-decisions/ADR-036-request-binding-includes-query.md\n\n'
  exit 1
fi

printf '%s✓ ربطُ الطلبِ: الاستعلامُ مضمومٌ مُرتَّباً، ولا حدَّ يقطعُ قبلَ المقارنةِ.%s\n' "$GRN" "$RST"
printf '  ولا يُدَّعى هنا أنَّ الربطَ يعملُ: ذاكَ برهانُ اختباراتِ service-auth ووظيفةِ verify.\n\n'
