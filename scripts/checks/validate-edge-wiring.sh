#!/usr/bin/env bash
# validate-edge-wiring.sh — الحارس 29 · ترطيبُ حدِّ القناةِ في مدخلِ البوتِ (D6 · CLM-0691).
#
# يسقطُ إذا عادَ مدخلُ بوتِ العميلِ إلى بناءِ التطبيقِ من غيرِ الحدِّ
# (عيبُ السلفِ نفسُهُ الذي أصلَحَهُ Phase 05 · MR 5/6: اختباراتٌ خضراءُ وعمليةٌ
# حيّةٌ بلا مساراتِها)، أو إذا حلَّ allowlistUrl إلى ملفٍّ غائبٍ/غيرِ صالحٍ —
# فالحدُّ يفشلُ مغلَقًا عندَ التركيبِ ولا يعودَ «قائمةً لا تُقرأ».
#
# لا شبكةَ ولا git: قراءةُ قرصٍ محضةٌ — مرورٌ أو إخفاقٌ، ولا تخطّيَ له.
# كلُّ إخفاقٍ يُطبعُ برمزٍ ثابتٍ `[EW-…]` تطابقُهُ حالاتُ الطفرةِ بعينِها.
#
#   bash scripts/checks/validate-edge-wiring.sh
#
# المرجع: docs/08-infrastructure/RENDER_TEST_ENVIRONMENT_PLAN.md (T1) ·
#         docs/12-testing/EDGE_ALLOWLIST.md · ADR-069 · CLM-0662 (D6 وحدةٌ لاحقةٌ) · CLM-0691.
set -uo pipefail

cd "$(dirname "$0")/../.." || { echo "تعذّر الوصول إلى جذر المستودع" >&2; exit 1; }

exec python3 scripts/checks/lib/edge_wiring_guard.py
