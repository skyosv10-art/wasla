#!/usr/bin/env bash
# validate-tick-scheduler.sh — حارسُ مُجدوِلِ النبضاتِ (G8 · CLM-0328 · أُعيدَ بناؤهُ CLM-0330)
#
# ── لماذا أُعيدَ بناؤهُ ──────────────────────────────────────────────────────
# النسخةُ الأولى (CLM-0328) فحصتْ **وجودَ نصوصٍ** (`grep mintServiceToken`
# · `grep 503` · `grep AbortController`) في `scripts/tick-scheduler.mjs` فمرّتْ
# 14/14 بينما الملفُّ لا يُقلِعُ أصلًا (`SyntaxError: Unexpected identifier 'as'`).
# وجودُ الكلمةِ ليسَ إثباتًا. فصارَ الحارسُ يقيسُ ما يُنفَّذُ فعلًا:
#   1. الحزمةُ `@wasla/tick-scheduler` يحلُّها مدخلُ الصورةِ نفسُهُ
#      (`scripts/container/resolve-package.mjs`) إلى أمرِ `start` — لا مسارَ مكتوبًا.
#   2. Terraform يُقلِعُها بـ`WASLA_SERVICE` وحدَهُ ولا يطغى على المدخلِ بـ
#      `start_command` (الطغيانُ يُسقِطُ الحلَّ ويُعيدُ عيبَ السلفِ).
#   3. كلُّ مساراتِ النبضةِ الخمسةِ مغطّاةٌ في Terraform بمتغيّراتِها.
#   4. لا بقايا للسلفِ غيرِ القابلِ للتشغيلِ.
# واختبارُ السلوكِ (الرمزُ · 503 · المهلةُ · القفلُ) في اختباراتِ الحزمةِ نفسِها
# التي تستوردُ الشيفرةَ وتتحقّقُ من الرمزِ بـ`verifyServiceToken` — لا هنا.
#
# المرجع: docs/08-infrastructure/M2-07_OUTBOX_TICK_DLQ_INVENTORY.md §4 (G8)
#          docs/12-testing/M2-07_GATE.md البندُ 9

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 1

BOLD=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; RST=$'\033[0m'
TF="infra/terraform/cron/main.tf"
PKG="packages/tick-scheduler"

fail=0
check() {
  local name="$1"; local result="$2"
  if [ "$result" = "0" ]; then
    printf '  %s✓%s %s\n' "$GRN" "$RST" "$name"
  else
    printf '  %s✗%s %s\n' "$RED" "$RST" "$name"
    fail=$((fail + 1))
  fi
}

printf '%s── حارسُ مُجدوِلِ النبضاتِ (G8 · CLM-0330) ──%s\n' "$BOLD" "$RST"

# 1) مدخلُ الصورةِ يحلُّ الحزمةَ إلى أمرِ start
RESOLVED="$(node scripts/container/resolve-package.mjs @wasla/tick-scheduler 2>&1)"
rc=$?
[ "$rc" = "0" ] && [ "${RESOLVED%%$'\t'*}" = "$ROOT/$PKG" ]
check "مدخلُ الصورةِ يحلُّ @wasla/tick-scheduler إلى $PKG (rc=$rc)" "$?"

START="${RESOLVED#*$'\t'}"
[ "$START" = "node --import tsx src/main.ts" ]
check "أمرُ start هوَ «node --import tsx src/main.ts» (وُجِد: ${START})" "$?"

[ -f "$PKG/src/main.ts" ] && [ -f "$PKG/src/scheduler.ts" ]
check "ملفّا المدخلِ والمنطقِ موجودانِ" "$?"

ls "$PKG"/src/__tests__/*.test.ts >/dev/null 2>&1
check "للحزمةِ اختباراتٌ داخلَها (يجريها pnpm -r test)" "$?"

# 2) Terraform يُقلِعُ بالمدخلِ لا بطغيانٍ عليه
[ -f "$TF" ]
check "إعدادُ Terraform موجودٌ ($TF)" "$?"

grep -Eq 'WASLA_SERVICE[[:space:]]*=[[:space:]]*\{[[:space:]]*value[[:space:]]*=[[:space:]]*"@wasla/tick-scheduler"' "$TF"
check "Terraform يضبطُ WASLA_SERVICE=@wasla/tick-scheduler" "$?"

! grep -Eq '^[[:space:]]*(start_command|docker_command)[[:space:]]*=' "$TF"
check "Terraform لا يطغى على مدخلِ الصورةِ (لا start_command/docker_command)" "$?"

# 3) كلُّ مساراتِ النبضةِ مغطّاةٌ بمتغيّراتِها
EXPECTED_SERVICES="dispatch negotiations reputation subscriptions drivers"
for svc in $EXPECTED_SERVICES; do
  grep -Eq "service[[:space:]]*=[[:space:]]*\"${svc}\"" "$TF"
  check "وظيفةُ cron لـ${svc} مُعرَّفةٌ" "$?"
  upper=$(printf '%s' "$svc" | tr '[:lower:]' '[:upper:]')
  grep -q "WASLA_TICK_BASE_URL_${upper}" "$TF"
  check "WASLA_TICK_BASE_URL_${upper} مُعرَّفٌ" "$?"
done

grep -q "WASLA_SERVICE_AUTH_KEYS" "$TF" && grep -q "WASLA_SERVICE_AUTH_ACTIVE_KID" "$TF"
check "مفاتيحُ هويّةِ الخدمةِ مُمرَّرةٌ" "$?"

# 4) لا بقايا للسلفِ
[ ! -e scripts/tick-scheduler.mjs ] && [ ! -e scripts/__tests__/tick-scheduler.test.ts ]
check "لا بقايا لـscripts/tick-scheduler.mjs واختباراتِه غيرِ المُشغَّلةِ" "$?"

printf '%s── الخلاصة: %s%d فحصاً فاشلاً.%s\n' "$BOLD" "$([ "$fail" -eq 0 ] && echo "$GRN" || echo "$RED")" "$fail" "$RST"

exit $fail
