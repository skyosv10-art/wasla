#!/bin/bash
# validate-migration-owners.sh — Migration owner inventory guard (M2-05A)
#
# Verifies that infra/migrations/migration-owners.json:
#   1. Is valid JSON
#   2. Every services/*/contracts/schema.sql has an entry in the inventory
#   3. Every entry references an existing service and schema file
#   4. Each entry has required fields (service, schema_owner, migration_owner, status)
#   5. has_migrate_runner matches actual presence of src/db/migrate.ts
#   6. has_journal matches actual presence of drizzle/meta/_journal.json
#
# This guard proves OWNERSHIP. validate-migrations.sh proves DISCIPLINE.
# They are complementary, not redundant.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INVENTORY="$ROOT/infra/migrations/migration-owners.json"

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

echo -e "${BOLD}[Migration Owner Guard · M2-05A]${RESET}"

# 1. File exists and is valid JSON
if [ ! -f "$INVENTORY" ]; then
  echo -e "  ${RED}✗${RESET} Inventory file not found: $INVENTORY"
  exit 1
fi

JSON_OK=0
python3 -c "import json; json.load(open('$INVENTORY'))" 2>/dev/null || JSON_OK=1
check $JSON_OK "Inventory is valid JSON"

# 2-6. Comprehensive verification via Python
RESULT=$(python3 -c "
import json, os, glob

ROOT = '$ROOT'
with open('$INVENTORY') as f:
    inv = json.load(f)

errors = []

# Build inventory service map
inv_services = {}
for s in inv.get('services', []):
    inv_services[s['service']] = s

# 2. Every services/*/contracts/schema.sql has an entry
actual_schemas = set()
for schema_path in sorted(glob.glob(f'{ROOT}/services/*/contracts/schema.sql')):
    svc = schema_path.split('/')[-3]
    actual_schemas.add(svc)
    if svc not in inv_services:
        errors.append(f'schema.sql for {svc} not in inventory')

inv_schema_services = set(inv_services.keys())

# 3. Every entry references existing service and schema file
for svc, entry in inv_services.items():
    schema_path = os.path.join(ROOT, entry.get('schema_path', ''))
    if not os.path.exists(schema_path):
        errors.append(f'{svc}: schema_path does not exist: {entry.get(\"schema_path\")}')

# 4. Required fields
required_fields = ['service', 'schema_owner', 'migration_owner', 'status', 'has_migrate_runner', 'has_journal']
for svc, entry in inv_services.items():
    for field in required_fields:
        if field not in entry:
            errors.append(f'{svc}: missing field {field}')

# 5. has_migrate_runner matches actual presence
for svc, entry in inv_services.items():
    actual_migrate = os.path.exists(f'{ROOT}/services/{svc}/src/db/migrate.ts')
    if entry.get('has_migrate_runner') != actual_migrate:
        errors.append(f'{svc}: has_migrate_runner={entry.get(\"has_migrate_runner\")} but migrate.ts exists={actual_migrate}')

# 6. has_journal matches actual presence
for svc, entry in inv_services.items():
    actual_journal = os.path.exists(f'{ROOT}/services/{svc}/drizzle/meta/_journal.json')
    if entry.get('has_journal') != actual_journal:
        errors.append(f'{svc}: has_journal={entry.get(\"has_journal\")} but _journal.json exists={actual_journal}')

# 7. No extra services in inventory that don't have schema.sql
for svc in inv_schema_services - actual_schemas:
    errors.append(f'{svc}: in inventory but no contracts/schema.sql found')

if errors:
    print('ERRORS: ' + ' | '.join(errors[:5]))
else:
    print('OK')
" 2>/dev/null || echo "ERROR: Python check failed")

if [ "$RESULT" = "OK" ]; then
  check 0 "All schemas have owners, fields present, runner/journal status matches disk"
else
  check 1 "Inventory verification: $RESULT"
fi

# Summary
echo ""
if [ ${#ERRORS[@]} -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✓ Migration owner guard passed.${RESET} ($CHECKS checks)"
  exit 0
else
  echo -e "${RED}${BOLD}✗ Migration owner guard failed.${RESET} (${#ERRORS[@]} of $CHECKS checks failed)"
  for e in "${ERRORS[@]}"; do
    echo -e "  ${RED}•${RESET} $e"
  done
  exit 1
fi
