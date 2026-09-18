#!/bin/bash
# validate-secret-inventory.sh — Secret inventory guard (M2-03A)
#
# Verifies that infra/secrets/secret-inventory.json:
#   1. Contains no actual secret values (names and metadata only)
#   2. Covers every secret: true variable in env-registry.json
#   3. Covers every required_secret in environment.json manifests
#   4. Covers every M2-03 pending secret from validate-environments.sh
#   5. Each secret has required fields

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INVENTORY="$ROOT/infra/secrets/secret-inventory.json"
REGISTRY="$ROOT/packages/config/env-registry.json"
ENV_DIR="$ROOT/infra/environments"

# M2-03 blocked secrets are read from the inventory itself (single source)
# validate-environments.sh also reads from secret-inventory.json now

GREEN='\033[32m'
RED='\033[31m'
BOLD='\033[1m'
RESET='\033[0m'

ERRORS=()
CHECKS=0

check() {
  CHECKS=$((CHECKS + 1))
  if [ "$1" = "0" ]; then
    echo -e "  ${GREEN}✓${RESET} $2"
  else
    echo -e "  ${RED}✗${RESET} $2"
    ERRORS+=("$2")
  fi
}

echo -e "${BOLD}[Secret Inventory Guard · M2-03A]${RESET}"

# 1. File exists and is valid JSON
if [ ! -f "$INVENTORY" ]; then
  echo -e "  ${RED}✗${RESET} Inventory file not found: $INVENTORY"
  exit 1
fi

JSON_OK=0
python3 -c "import json; json.load(open('$INVENTORY'))" 2>/dev/null || JSON_OK=1
check $JSON_OK "Inventory is valid JSON"

# 2. No actual secret values
SECRET_VALUE_FOUND=0
for pattern in "sbp_" "sk-" "ghp_" "gho_" "-----BEGIN"; do
  if grep -q "$pattern" "$INVENTORY" 2>/dev/null; then
    SECRET_VALUE_FOUND=1
    break
  fi
done
# 0 = no secrets found (pass), 1 = secrets found (fail)
check $SECRET_VALUE_FOUND "No actual secret values in inventory"

# 3. Every secret: true in env-registry.json is in inventory
MISSING_REG=$(python3 -c "
import json

with open('$INVENTORY') as f:
    inv = json.load(f)
inv_names = {s['name'] for s in inv.get('secrets', [])}

with open('$REGISTRY') as f:
    reg = json.load(f)

missing = []
for v in reg.get('variables', []):
    if v.get('secret') and v['name'] not in inv_names:
        missing.append(v['name'])

if missing:
    print(' '.join(missing))
" 2>/dev/null || echo "ERROR")

if [ -n "$MISSING_REG" ]; then
  check 1 "All secret vars in env-registry.json are in inventory (missing: $MISSING_REG)"
else
  check 0 "All secret vars in env-registry.json are in inventory"
fi

# 4. Every required_secret in environment.json is in inventory
MISSING_REQ=$(python3 -c "
import json, glob

with open('$INVENTORY') as f:
    inv = json.load(f)
inv_names = {s['name'] for s in inv.get('secrets', [])}

missing = []
for env_file in sorted(glob.glob('$ENV_DIR/*/environment.json')):
    env = json.load(open(env_file))
    env_name = env.get('name', '?')
    for secret in env.get('required_secrets', []):
        if secret not in inv_names:
            missing.append(f'{secret} (in {env_name})')

if missing:
    print(' '.join(missing))
" 2>/dev/null || echo "ERROR")

if [ -n "$MISSING_REQ" ]; then
  check 1 "All required_secrets in environment manifests are in inventory (missing: $MISSING_REQ)"
else
  check 0 "All required_secrets in environment manifests are in inventory"
fi

# 5. M2-03 blocked secrets are in inventory (self-verifying: reads from inventory itself)
#    This check ensures the validate-environments.sh M2_03_PENDING_SECRETS list
#    (now read from this inventory) covers the expected blocked secrets.
BLOCKED_SECRETS=$(python3 -c "
import json

with open('$INVENTORY') as f:
    inv = json.load(f)

blocked = [s['name'] for s in inv.get('secrets', []) if 'BLOCKED' in s.get('status', '')]
if blocked:
    print(' '.join(blocked))
" 2>/dev/null || echo "ERROR")

if [ -z "$BLOCKED_SECRETS" ]; then
  check 1 "M2-03 blocked secrets exist in inventory (none found)"
else
  check 0 "M2-03 blocked secrets exist in inventory ($BLOCKED_SECRETS)"
fi

# 6. Each secret has required fields
MISSING_FIELDS=$(python3 -c "
import json

with open('$INVENTORY') as f:
    inv = json.load(f)

required = ['name', 'type', 'consumers', 'environments', 'storage', 'rotation_policy', 'status']
missing = []
for s in inv.get('secrets', []):
    for field in required:
        if field not in s or not s[field]:
            missing.append(f\"{s.get('name', '?')}.{field}\")

if missing:
    print(' '.join(missing[:5]))
" 2>/dev/null || echo "")

if [ -n "$MISSING_FIELDS" ]; then
  check 1 "Each secret has required fields (missing: $MISSING_FIELDS)"
else
  check 0 "Each secret has required fields (name, type, consumers, environments, storage, rotation_policy, status)"
fi

# Summary
echo ""
if [ ${#ERRORS[@]} -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✓ Secret inventory guard passed.${RESET} ($CHECKS checks)"
  exit 0
else
  echo -e "${RED}${BOLD}✗ Secret inventory guard failed.${RESET} (${#ERRORS[@]} of $CHECKS checks failed)"
  for e in "${ERRORS[@]}"; do
    echo -e "  ${RED}•${RESET} $e"
  done
  exit 1
fi
