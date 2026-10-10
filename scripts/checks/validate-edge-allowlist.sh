#!/usr/bin/env bash
# validate-edge-allowlist.sh — الحارس 28 · قوائم سماح حدّ القناة (ADR-069 §6-2 · CLM-0521).
#
# لا شبكة ولا git: قراءة قرصٍ محضة — فلا تخطّيَ لهُ، مرورٌ أو إخفاقٌ.
#
#   bash scripts/checks/validate-edge-allowlist.sh
#
# المرجع: docs/12-testing/EDGE_ALLOWLIST.md · docs/15-decisions/ADR-069-human-authentication-edge-for-apps.md §2.8
set -uo pipefail

cd "$(dirname "$0")/../.." || { echo "تعذّر الوصول إلى جذر المستودع" >&2; exit 1; }

exec python3 scripts/checks/lib/edge_allowlist_guard.py
