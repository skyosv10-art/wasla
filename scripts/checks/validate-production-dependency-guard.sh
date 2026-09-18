#!/usr/bin/env bash
# validate-production-dependency-guard.sh — حارسُ استيرادِ الإنتاجِ من devDependencies (M0-43 · الفحصُ 22).
#
# السّؤالُ الذي يجيبُ عنهُ هذا الفحصُ واحدٌ ومحدودٌ:
#
#   هل يستوردُ ملفُّ إنتاجٍ (تحتَ ``src/`` بلا ``__tests__``) حزمةً خارجيّةً أو
#   حزمةَ مساحةِ عملٍ لم تُعلَن في ``dependencies`` ولا في ``peerDependencies``
#   للملفِّ ``package.json`` الذي يحويه؟
#
# وليسَ السّؤالُ «أهيَ التبعيّاتُ كاملةٌ؟» — فليستْ، وذاكَ شأنُ ``tsc``. وهذا
# الحارسُ يمنعُ صنفاً واحداً من العيوبِ لا يراهُ ``tsc``: حزمةٌ يُستورَدُ
# **إنتاجيًّا** (قيمةً، لا نوعاً) من ``devDependencies`` وحدَها، فلا تُركَّبُ في
# جذرِ الإنتاجِ ولا في صورةِ الحاويةِ، فينفجرُ ``Cannot find module`` عندَ
# التشغيلِ لا عندَ البناءِ.
#
# ولِمَ لا يكفي ``tsc``: يُمرِّرُ ``import type`` من أيِّ مكانٍ لأنَّه يُمحى في
# زمنِ التحويلِ، ويُمرِّرُ أيَّ استيرادٍ طالما وُجدَ في ``devDependencies``
# لأنَّه لا يُفرِّقُ الإنتاجَ عنِ التطويرِ. فالحارسُ يُفرِّقُ:
#
#   - حزمُ ``*-e2e`` اختباريّةٌ — استيرادُها من ``devDependencies`` صحيحٌ.
#   - ``import type`` من ``peerDependencies`` الاختياريّةِ صحيحٌ.
#   - استيرادُ القيمةِ من ``devDependencies`` هو العيبُ — وحدَهُ.
#
# المرجع: docs/07-security/RISK_REGISTER.md (RISK-0043).
#
#   bash scripts/checks/validate-production-dependency-guard.sh
#
# لا شبكةَ ولا git: قراءةُ قرصٍ محضةٌ — فلا تخطّيَ له، مرورٌ أو إخفاق.
set -uo pipefail

cd "$(dirname "$0")/../.." || { echo "تعذّر الوصول إلى جذر المستودع" >&2; exit 1; }

RED=$'\033[31m'; GRN=$'\033[32m'; RST=$'\033[0m'

ok()  { printf '  %s✓%s %s\n' "$GRN" "$RST" "$1"; }
bad() { printf '  %s✗%s %s\n' "$RED" "$RST" "$1"; FAIL=1; }

FAIL=0

# ── 1) القياسُ ──────────────────────────────────────────────────────────────
# ولِمَ ``python3`` هنا: القياسُ يقرأُ ملفّاتٍ متعدِّدةً ويُطابِقُ مجموعاتٍ
# ويُفرِّقُ ``import type`` عن ``import``، و``grep`` سطريٌّ بطبعِه. وهوَ
# مُستعملٌ في حرّاسٍ قائمةٍ تعملُ في CI فليسَ تبعيّةً جديدةً.
OUT="$(python3 scripts/checks/lib/prod_deps_guard.py 2>&1)"
RC=$?

printf '%s\n' "$OUT"

if (( RC == 0 )); then
  ok "لا استيرادَ إنتاجيًّا من devDependencies — الشجرةُ نظيفةٌ"
else
  bad "استيرادُ إنتاجٍ من devDependencies — انظر المخالفاتِ أعلاه"
fi

# ── 2) وجودُ القارئِ الموحَّدِ ───────────────────────────────────────────────
# الحارسُ يعتمدُ على ``workspace_packages.py`` (M0-35) لجردِ الحزمِ من
# ``pnpm-workspace.yaml``. فلو حُذِفَ أو عُطِّلَ انكسرَ الحارسُ بصمتٍ.
if [[ -f scripts/checks/lib/workspace_packages.py ]]; then
  ok "قارئُ مساحةِ العملِ موجودٌ: scripts/checks/lib/workspace_packages.py"
else
  bad "قارئُ مساحةِ العملِ مفقودٌ: scripts/checks/lib/workspace_packages.py"
  FAIL=1
fi

if (( FAIL )); then
  printf '\n%s✗ حارسُ استيرادِ الإنتاجِ: إخفاقٌ.%s\n' "$RED" "$RST"
  exit 1
fi

printf '\n%s✓ حارسُ استيرادِ الإنتاجِ: نجاحٌ.%s\n' "$GRN" "$RST"
exit 0
