#!/usr/bin/env bash
# validate-state-sync.sh — STATE-SYNC guard (check 26 · CLM-0467 · M0-52 · ADR-061).
#
# Invariant: NO STATE-SYNC → NO PUSH/MERGE.
#   IMPLEMENTATION + TESTS + EVIDENCE + PROJECT-STATE = ONE COMPLETE CHANGE.
#
# Run it yourself before pushing or opening a PR:
#   bash scripts/checks/validate-state-sync.sh                 # origin/main..HEAD
#   bash scripts/checks/validate-state-sync.sh OLD NEW         # explicit range (CI)
# Verdict: "PASS — project state synchronized" (exit 0) or
#          "BLOCKED — project state synchronization required" (exit 1) with the records to update.
#
# It runs in: scripts/hooks/pre-push · verify-governance.sh (check 26), and through it the required
# CI jobs `governance-guard` and `verify`. The mapping lives in lib/state-sync-map.json, the logic
# in lib/state_sync.py. Rule: docs/00-rules/STATE_SYNC_RULE.md.
set -uo pipefail
cd "$(dirname "$0")/../.." || { echo "cannot reach the repository root" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "BLOCKED — project state synchronization required"; echo "  reason: python3 missing (fail-closed)"; exit 1; }
OLD="${1:-origin/main}"
NEW="${2:-HEAD}"
python3 scripts/checks/lib/state_sync.py "$OLD" "$NEW"
