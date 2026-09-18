#!/usr/bin/env bash
# validate-render-config.sh — Guard for Render Terraform configuration (M2-02 · ADR-039).
#
# Checks:
#   1. No RENDER_API_KEY or RENDER_OWNER_ID values in tracked files
#   2. Render provider is pinned with a version
#   3. All services with start scripts have Terraform resources
#   4. No Render Postgres resources (Supabase remains the DB per ADR-038)
#
# Usage: ./scripts/checks/validate-render-config.sh
# Exit: 0 on success, 1 on failure.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

FAIL=0
RED='\033[31m'
GREEN='\033[32m'
NC='\033[0m'

fail() { printf "  ${RED}✗${NC} %s\n" "$1"; FAIL=1; }
pass() { printf "  ${GREEN}✓${NC} %s\n" "$1"; }

printf '\033[1m[Render Config Guard · ADR-039]\033[0m\n'

# ── 1) No Render secrets in tracked files ──────────────────────────────
# RENDER_API_KEY starts with "rnd_" (32+ chars). RENDER_OWNER_ID starts
# with "usr-" or "tea-".
RENDER_SECRETS=$(grep -rn --include='*.tf' --include='*.sh' --include='*.json' --include='*.yaml' --include='*.yml' \
    -E '(rnd_[a-zA-Z0-9]{30,}|RENDER_API_KEY\s*=\s*["\x27][^"\x27]{10,})' \
    infra/ scripts/ 2>/dev/null | grep -v '\.gitkeep' || true)
if [ -n "$RENDER_SECRETS" ]; then
  fail 'Render API key value found in tracked files'
else
  pass 'No Render API key values in tracked files'
fi

RENDER_OWNERS=$(grep -rn --include='*.tf' --include='*.sh' --include='*.json' \
    -E '(RENDER_OWNER_ID\s*=\s*["\x27](usr-|tea-)[a-zA-Z0-9]+)' \
    infra/ 2>/dev/null || true)
if [ -n "$RENDER_OWNERS" ]; then
  fail 'Render owner ID value found in tracked files'
else
  pass 'No Render owner ID values in tracked files'
fi

# ── 2) Provider pinned with version ────────────────────────────────────
if grep -q 'render-oss/render' infra/terraform/versions.tf 2>/dev/null \
  && grep -qE 'version\s*=\s*"[0-9]+\.' infra/terraform/versions.tf 2>/dev/null; then
  pass 'Render provider is pinned with a version'
else
  fail 'Render provider not found or not version-pinned in versions.tf'
fi

# ── 3) Service inventory coverage ─────────────────────────────────────
# Every service with a start script must have a render_web_service resource.
SERVICES=$(for d in services/*/; do
  name=$(basename "$d")
  if [ -f "$d/package.json" ]; then
    start=$(python3 -c "import json; d=json.load(open('${d}package.json')); print(d.get('scripts',{}).get('start',''))" 2>/dev/null)
    if [ -n "$start" ]; then echo "$name"; fi
  fi
done)

BOTS=$(for d in bots/*/; do
  name=$(basename "$d")
  if [ -f "$d/package.json" ]; then
    start=$(python3 -c "import json; d=json.load(open('${d}package.json')); print(d.get('scripts',{}).get('start',''))" 2>/dev/null)
    if [ -n "$start" ]; then echo "$name"; fi
  fi
done)

MISSING=0
for svc in $SERVICES; do
  if ! grep -q "wasla_${svc}\|wasla-${svc}" infra/terraform/render.tf 2>/dev/null; then
    fail "Service '$svc' has start script but no Terraform resource"
    MISSING=1
  fi
done
for bot in $BOTS; do
  if ! grep -q "wasla_${bot}\|wasla-${bot}" infra/terraform/render.tf 2>/dev/null; then
    fail "Bot '$bot' has start script but no Terraform resource"
    MISSING=1
  fi
done
if [ "$MISSING" = "0" ]; then
  pass "All services and bots with start scripts have Terraform resources"
fi

# ── 4) No Render Postgres (Supabase remains DB per ADR-038) ────────────
if grep -q 'render_postgres' infra/terraform/render.tf 2>/dev/null; then
  fail 'Render Postgres resource found — ADR-038 decides Supabase as DB'
else
  pass 'No Render Postgres resources (Supabase remains the DB)'
fi

if [ "$FAIL" = "0" ]; then
  printf "\n${GREEN}✓ Render config guard passed.${NC}\n"
  exit 0
else
  printf "\n${RED}✗ Render config guard failed.${NC}\n"
  exit 1
fi
