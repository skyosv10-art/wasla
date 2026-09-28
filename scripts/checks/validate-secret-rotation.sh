#!/usr/bin/env bash
# validate-secret-rotation.sh — M6-19B: secret rotation *policy* guard.
#
# What it enforces (fail-closed, structural, offline):
#   every secret in infra/secrets/secret-inventory.json declares a rotation
#   frequency from the allowed set, a status from the allowed vocabulary, at
#   least one consumer and one environment, a unique name; every BLOCKED secret
#   carries a written reason.
#
# What it does NOT claim: that any secret was actually rotated on time. The
#   inventory has no `last_rotated` field, so rotation *age* cannot be measured
#   here. That is printed as NOT VERIFIED on every run (M6-19B_GATE.md).
#
# History: the first version (PR #528) swallowed interpreter errors with
#   `2>/dev/null`, so a malformed entry (e.g. a missing `name`) made a gate print
#   PASS. Corrected under CLM-0391; mutation cases live in test-governance.sh.
#
# Exit: 0 = all gates pass · 1 = a gate failed or the inventory is unreadable.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INVENTORY="$REPO_ROOT/infra/secrets/secret-inventory.json"

echo "=== M6-19B: secret rotation policy guard ==="

if [[ ! -f "$INVENTORY" ]]; then
  echo "FAIL: secret inventory not found at $INVENTORY"
  exit 1
fi

python3 - "$INVENTORY" <<'PY'
import json, sys

path = sys.argv[1]
try:
    data = json.load(open(path, encoding="utf-8"))
except Exception as e:  # unreadable inventory is a failure, never a pass
    print(f"FAIL: inventory is not valid JSON: {e}")
    sys.exit(1)

secrets = data.get("secrets") if isinstance(data, dict) else None
if not isinstance(secrets, list) or not secrets:
    print("FAIL: inventory has no non-empty `secrets` list")
    sys.exit(1)

ALLOWED_FREQ = {
    "quarterly", "semi-annually", "annual",
    "on compromise or quarterly", "on compromise or semi-annually",
    "on key rotation", "auto", "N/A",
}

failures = []
def gate(label, bad):
    if bad:
        failures.append(f"FAIL: {label}: {', '.join(bad)}")
    else:
        print(f"PASS: {label}")

def name(i, s):
    n = s.get("name") if isinstance(s, dict) else None
    return n if isinstance(n, str) and n else f"<entry #{i}>"

entries = list(enumerate(secrets))
gate("every entry is an object with a name",
     [name(i, s) for i, s in entries if not isinstance(s, dict) or not isinstance(s.get("name"), str) or not s.get("name")])
dicts = [(i, s) for i, s in entries if isinstance(s, dict)]
names = [name(i, s) for i, s in dicts]
gate("names are unique", sorted({n for n in names if names.count(n) > 1}))
gate("rotation_frequency present and allowed",
     [f"{name(i, s)}={s.get('rotation_frequency')!r}" for i, s in dicts if s.get("rotation_frequency") not in ALLOWED_FREQ])
gate("status is `active` or `BLOCKED — …`",
     [f"{name(i, s)}={s.get('status')!r}" for i, s in dicts
      if not (s.get("status") == "active" or (isinstance(s.get("status"), str) and s["status"].startswith("BLOCKED")))])
gate("every BLOCKED secret has a written reason (notes)",
     [name(i, s) for i, s in dicts
      if isinstance(s.get("status"), str) and s["status"].startswith("BLOCKED")
      and not (isinstance(s.get("notes"), str) and s["notes"].strip())])
gate("every secret has at least one consumer",
     [name(i, s) for i, s in dicts if not (isinstance(s.get("consumers"), list) and s["consumers"])])
gate("every secret has at least one environment",
     [name(i, s) for i, s in dicts if not (isinstance(s.get("environments"), list) and s["environments"])])

print(f"INFO: {len(secrets)} secrets · "
      f"{sum(1 for _, s in dicts if s.get('status') == 'active')} active · "
      f"{sum(1 for _, s in dicts if str(s.get('status','')).startswith('BLOCKED'))} BLOCKED")
print("NOT VERIFIED: rotation age — the inventory has no `last_rotated` field (M6-19B_GATE.md).")

if failures:
    print("\n".join(failures))
    sys.exit(1)
PY
