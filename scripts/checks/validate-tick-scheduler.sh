#!/usr/bin/env bash
# validate-tick-scheduler.sh — حارسُ مُجدوِلِ النبضاتِ (G8 · CLM-0328)
#
# يُثبِتُ أنَّ:
#   1. سكربتُ المُجدوِلِ موجودٌ (scripts/tick-scheduler.mjs)
#   2. إعدادُ Terraform لـ Render Cron Jobs موجودٌ (infra/terraform/cron/main.tf)
#   3. كلُّ مساراتِ النبضةِ الـ5 مغطّاةٌ في الإعدادِ
#   4. متغيّراتُ البيئةِ اللازمةُ مُعرَّفةٌ
#
# المرجع: docs/08-infrastructure/M2-07_OUTBOX_TICK_DLQ_INVENTORY.md §4 (G8)
#          docs/12-testing/M2-07_GATE.md البندُ 9

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 1

BOLD=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; DIM=$'\033[2m'; RST=$'\033[0m'

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

printf '%s── حارسُ مُجدوِلِ النبضاتِ (G8 · CLM-0328) ──%s\n' "$BOLD" "$RST"

# 1) السكربتُ موجودٌ
[ -f scripts/tick-scheduler.mjs ]
check "سكربتُ المُجدوِلِ موجودٌ (scripts/tick-scheduler.mjs)" "$?"

# 2) إعدادُ Terraform موجودٌ
[ -f infra/terraform/cron/main.tf ]
check "إعدادُ Terraform موجودٌ (infra/terraform/cron/main.tf)" "$?"

# 3) كلُّ مساراتِ النبضةِ مغطّاةٌ
# لا نستخدمُ أنبوبًا إلى grep (RISK-0037: سباقُ SIGPIPE) — نطابقُ مباشرةً
EXPECTED_SERVICES="dispatch negotiations reputation subscriptions drivers"
COVERED=$(grep -oE 'service\s*=\s*"[^"]+"' infra/terraform/cron/main.tf 2>/dev/null | sed 's/service\s*=\s*"//;s/"//' | sort -u)
MISSING=""
for svc in $EXPECTED_SERVICES; do
  case "$COVERED" in
    *"$svc"*) ;; # موجودٌ
    *) MISSING="$MISSING $svc" ;;
  esac
done
[ -z "$MISSING" ]
check "كلُّ مساراتِ النبضةِ الـ5 مغطّاةٌ في Terraform${MISSING:+ (ناقصٌ:$MISSING)}" "$?"

# 4) متغيّراتُ البيئةِ اللازمةُ مُعرَّفةٌ في Terraform
grep -q "WASLA_SERVICE_AUTH_KEYS" infra/terraform/cron/main.tf
check "WASLA_SERVICE_AUTH_KEYS مُعرَّفٌ في Terraform" "$?"

grep -q "WASLA_SERVICE_AUTH_ACTIVE_KID" infra/terraform/cron/main.tf
check "WASLA_SERVICE_AUTH_ACTIVE_KID مُعرَّفٌ في Terraform" "$?"

# 5) كلُّ خدمةٍ لها WASLA_TICK_BASE_URL_<SERVICE>
for svc in $EXPECTED_SERVICES; do
  upper=$(echo "$svc" | tr '[:lower:]' '[:upper:]')
  grep -q "WASLA_TICK_BASE_URL_${upper}" infra/terraform/cron/main.tf
  check "WASLA_TICK_BASE_URL_${upper} مُعرَّفٌ في Terraform" "$?"
done

# 6) السكربتُ يستخدمُ mintServiceToken لا ترويسةً ثابتةً
grep -q "mintServiceToken" scripts/tick-scheduler.mjs
check "السكربتُ يستخدمُ mintServiceToken للتوقيعِ" "$?"

# 7) السكربتُ ينظّفُ ملفَّ القفلِ عندَ الخروجِ
grep -q "releaseLock" scripts/tick-scheduler.mjs
check "السكربتُ ينظّفُ ملفَّ القفلِ عندَ الخروجِ" "$?"

# 8) السكربتُ يعالجُ المهلةَ (timeout) ولا يُعلِّقُ
grep -q "AbortController" scripts/tick-scheduler.mjs
check "السكربتُ يعالجُ المهلةَ (AbortController)" "$?"

# 9) السكربتُ يعالجُ 503 كحالةِ «المنفذُ غيرُ جاهزٍ» لا كخطأٍ
grep -q "503" scripts/tick-scheduler.mjs
check "السكربتُ يعالجُ 503 كحالةِ «غيرُ جاهزٍ»" "$?"

printf '%s── الخلاصة: %s%d فحصاً فاشلاً.%s\n' "$BOLD" "$([ "$fail" -eq 0 ] && echo "$GRN" || echo "$RED")" "$fail" "$RST"

exit $fail
