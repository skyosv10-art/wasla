#!/usr/bin/env bash
# run-shared-db-integration.sh — اثنتا عشرةَ مجموعةَ تكاملٍ تِباعاً على قاعدةٍ واحدةٍ. (M0-18)
#
# ── لماذا يوجد هذا الملف ───────────────────────────────────────────────
# وظيفةُ `db-integration` في `.github/workflows/ci.yml` مصفوفةٌ تُعطي كلَّ ساقٍ
# **قاعدةً مستقلّةً**، فتُثبِتُ أنّ كلَّ خدمةٍ تعملُ **وحدَها**. ولا تقولُ شيئاً
# عن عملِها **معاً** على قاعدةٍ واحدةٍ — وهو ما تُعلنُه
# `docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md` §3 آمناً، وما رصدَ `RISK-0014`
# كذبَه بالقياسِ: مجموعةُ المطابقةِ تُخفِقُ إن سبقتها خدماتٌ على القاعدةِ نفسِها،
# لأنّ توكيداً فيها كان يقرأُ **كلَّ** جداولِ القاعدةِ لا جداولَ عقدِه.
#
# فهذا السكربتُ هو **موضعُ القياسِ**: ترتيبٌ ثابتٌ، وقاعدةٌ واحدةٌ، وتراكمٌ
# مقصودٌ — كلُّ خدمةٍ تتركُ جداولَها لمن بعدَها.
#
# ── ما لا يفعلُه عمداً ─────────────────────────────────────────────────
# • **لا يُنظّفُ بينَ السيقانِ**: التنظيفُ يُبطِلُ ما يُقاس.
# • **لا يقفُ عندَ أوّلِ إخفاقٍ**: يُشغِّلُ الاثنتي عشرةَ كلَّها ثمّ يطبعُ خلاصةً،
#   فيُقرأُ **مَن** أخفقَ لا **أنّ** شيئاً أخفق. ولو وقفَ عندَ الأولى لَظهرَ
#   إخفاقٌ واحدٌ وأُخفيَ ما بعدَه.
# • **لا يُعيدُ رصفَ الترتيبِ** ليُسعِفَ مجموعةً: الترتيبُ هو ترتيبُ مصفوفةِ
#   `db-integration` حرفاً، والمطابقةُ سادسةٌ فتسبقُها خمسُ خدماتٍ — وهي الحالةُ
#   التي رُصد فيها الإخفاقُ 2026-08-30.
#
# المرجع: docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md §3 · docs/07-security/RISK_REGISTER.md RISK-0014 · العنصر M0-18

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 1

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "خطأ: DATABASE_URL غيرُ مضبوطٍ — هذه الوظيفةُ بلا قاعدةٍ لا تقيسُ شيئاً، ولا تُعدُّ نجاحاً." >&2
  exit 2
fi

# الترتيبُ حرفاً كما في مصفوفةِ `db-integration`.
LEGS=(
  "identity|@wasla/identity-service"
  "geography|@wasla/geography-service"
  "channel|@wasla/channel-postgres"
  "customer|@wasla/customers-service"
  "order|@wasla/orders-service"
  "matching|@wasla/matching-service"
  "dispatch|@wasla/dispatch-service"
  "drivers|@wasla/drivers-service"
  "negotiations|@wasla/negotiations-service"
  "reputation|@wasla/reputation-service"
  "subscriptions|@wasla/subscriptions-service"
  "marketplace|@wasla/marketplace-service"
)

echo "القاعدةُ المشتركةُ: ${DATABASE_URL%%\?*}"
echo "السيقانُ: ${#LEGS[@]}"
echo

PASSED=()
FAILED=()

for entry in "${LEGS[@]}"; do
  leg="${entry%%|*}"
  pkg="${entry##*|}"
  echo "───────────────────────────────────────────────"
  echo "▶ $leg · $pkg"
  echo "───────────────────────────────────────────────"
  if pnpm --filter "$pkg" test:integration; then
    PASSED+=("$leg")
    echo "✓ $leg"
  else
    FAILED+=("$leg")
    echo "✗ $leg"
  fi
  echo
done

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  خلاصةُ القاعدةِ المشتركةِ                                 ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo "  ناجحةٌ (${#PASSED[@]}): ${PASSED[*]:-—}"
echo "  فاشلةٌ (${#FAILED[@]}): ${FAILED[*]:-—}"

if ((${#FAILED[@]} > 0)); then
  echo
  echo "✗ العزلُ غيرُ محقَّقٍ: ${#FAILED[@]} مجموعةً أخفقت على قاعدةٍ مشتركةٍ بينما تنجحُ على قاعدةٍ نقيّةٍ."
  echo "  وهذا إخفاقُ **عزلٍ** لا إخفاقُ سلوكٍ — المرجع: RISK-0014 · M0-18."
  exit 1
fi

echo
echo "✓ الاثنتا عشرةَ مجموعةً نجحت تِباعاً على قاعدةٍ واحدةٍ."
