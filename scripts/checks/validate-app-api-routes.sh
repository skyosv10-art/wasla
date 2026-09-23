#!/usr/bin/env bash
# validate-app-api-routes.sh — عقدُ المسارِ بين التطبيقِ والخدمةِ (M3-08 · الفحصُ 24).
#
# كلُّ مسارِ API يناديه تطبيقٌ في `apps/*/src` يجب أن يكونَ له مسارٌ بالطريقةِ
# نفسِها في خدمةٍ من `services/*/src`، أو صفٌّ في سجلِّ الفجواتِ يملكه بندٌ
# **غيرُ مكتملٍ** في اللوحة. ولِمَ: اختباراتُ الواجهاتِ كلُّها تعترض النداءَ
# بمحاكاةٍ، فلا شيءَ فيها يشهد أنّ المسارَ موجودٌ — وقياسُ 2026-09-23 وجد
# عشرةَ نداءاتٍ بلا مسارٍ في بندَين مُعلَنَين Completed.
#
# المرجع: docs/12-testing/APP_API_ROUTES.md · M3-08
#
#   bash scripts/checks/validate-app-api-routes.sh
#
# لا شبكةَ ولا git: قراءةُ قرصٍ محضةٌ — فلا تخطّيَ لهُ، مرورٌ أو إخفاقٌ.
set -uo pipefail

cd "$(dirname "$0")/../.." || { echo "تعذّر الوصول إلى جذر المستودع" >&2; exit 1; }

exec python3 scripts/checks/lib/app_api_routes.py "docs/12-testing/APP_API_ROUTES.md"
