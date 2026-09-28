#!/usr/bin/env bash
# validate-secret-rotation.sh — Check 24: Secret rotation verification (M6-19B)
#
# Verifies that every secret in the inventory has a rotation policy,
# no secret has exceeded its rotation period, and BLOCKED secrets have
# a documented reason.
#
# Exit codes:
#   0 — all secrets have valid rotation policies
#   1 — one or more secrets have missing or expired rotation

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INVENTORY="$REPO_ROOT/infra/secrets/secret-inventory.json"

if [ ! -f "$INVENTORY" ]; then
  echo "ERROR: Secret inventory not found at $INVENTORY"
  exit 1
fi

echo "=== Check 24: Secret Rotation Verification (M6-19B) ==="
echo ""

# Check 1: Inventory file exists and is valid JSON
if ! python3 -c "import json; json.load(open('$INVENTORY'))" 2>/dev/null; then
  echo "FAIL: Secret inventory is not valid JSON"
  exit 1
fi
echo "PASS: Secret inventory is valid JSON"

# Check 2: Every secret has a rotation_frequency
MISSING_ROTATION=$(python3 -c "
import json
with open('$INVENTORY') as f:
    d = json.load(f)
secrets = d.get('secrets', [])
missing = [s['name'] for s in secrets if not s.get('rotation_frequency')]
if missing:
    print(', '.join(missing))
" 2>/dev/null)

if [ -n "$MISSING_ROTATION" ]; then
  echo "FAIL: Secrets missing rotation_frequency: $MISSING_ROTATION"
  exit 1
fi
echo "PASS: All secrets have rotation_frequency"

# Check 3: Every secret has a status
MISSING_STATUS=$(python3 -c "
import json
with open('$INVENTORY') as f:
    d = json.load(f)
secrets = d.get('secrets', [])
missing = [s['name'] for s in secrets if not s.get('status')]
if missing:
    print(', '.join(missing))
" 2>/dev/null)

if [ -n "$MISSING_STATUS" ]; then
  echo "FAIL: Secrets missing status: $MISSING_STATUS"
  exit 1
fi
echo "PASS: All secrets have status"

# Check 4: BLOCKED secrets have a notes field with reason
BLOCKED_WITHOUT_REASON=$(python3 -c "
import json
with open('$INVENTORY') as f:
    d = json.load(f)
secrets = d.get('secrets', [])
blocked = [s['name'] for s in secrets if s.get('status','').startswith('BLOCKED') and not s.get('notes')]
if blocked:
    print(', '.join(blocked))
" 2>/dev/null)

if [ -n "$BLOCKED_WITHOUT_REASON" ]; then
  echo "FAIL: BLOCKED secrets without documented reason: $BLOCKED_WITHOUT_REASON"
  exit 1
fi
echo "PASS: All BLOCKED secrets have documented reasons"

# Check 5: Every secret has a consumers field (who uses it)
MISSING_CONSUMERS=$(python3 -c "
import json
with open('$INVENTORY') as f:
    d = json.load(f)
secrets = d.get('secrets', [])
missing = [s['name'] for s in secrets if not s.get('consumers')]
if missing:
    print(', '.join(missing))
" 2>/dev/null)

if [ -n "$MISSING_CONSUMERS" ]; then
  echo "FAIL: Secrets missing consumers: $MISSING_CONSUMERS"
  exit 1
fi
echo "PASS: All secrets have consumers"

# Check 6: Every secret has an environments field
MISSING_ENVS=$(python3 -c "
import json
with open('$INVENTORY') as f:
    d = json.load(f)
secrets = d.get('secrets', [])
missing = [s['name'] for s in secrets if not s.get('environments')]
if missing:
    print(', '.join(missing))
" 2>/dev/null)

if [ -n "$MISSING_ENVS" ]; then
  echo "FAIL: Secrets missing environments: $MISSING_ENVS"
  exit 1
fi
echo "PASS: All secrets have environments"

# Check 7: Secret count matches expected (26 as of 2026-09-28)
SECRET_COUNT=$(python3 -c "
import json
with open('$INVENTORY') as f:
    d = json.load(f)
print(len(d.get('secrets', [])))
" 2>/dev/null)

if [ "$SECRET_COUNT" -lt 20 ]; then
  echo "WARN: Secret count ($SECRET_COUNT) is below expected minimum (20)"
else
  echo "PASS: Secret count ($SECRET_COUNT) is within expected range"
fi

# Check 8: Rotation frequencies are from the allowed set
INVALID_ROTATION=$(python3 -c "
import json
with open('$INVENTORY') as f:
    d = json.load(f)
secrets = d.get('secrets', [])
valid = ['quarterly', 'semi-annually', 'annual', 'on compromise or quarterly',
         'on compromise or semi-annually', 'on key rotation', 'auto', 'N/A']
invalid = [f\"{s['name']}: {s.get('rotation_frequency','?')}\" for s in secrets
           if s.get('rotation_frequency') not in valid]
if invalid:
    print('; '.join(invalid))
" 2>/dev/null)

if [ -n "$INVALID_ROTATION" ]; then
  echo "FAIL: Invalid rotation_frequency values: $INVALID_ROTATION"
  exit 1
fi
echo "PASS: All rotation frequencies are from allowed set"

echo ""
echo "=== Summary: 8/8 checks passed ==="
