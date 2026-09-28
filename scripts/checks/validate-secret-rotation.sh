#!/usr/bin/env bash
# validate-secret-rotation.sh — M6-19B: secret rotation guard.
#
# What it enforces (fail-closed, structural, offline):
#   every secret in infra/secrets/secret-inventory.json declares a rotation
#   frequency from the allowed set, a status from the allowed vocabulary, at
#   least one consumer and one environment, a unique name; every BLOCKED secret
#   carries a written reason; every active secret has a `last_rotated` date and
#   the rotation age is within the frequency window.
#
# What it does NOT claim: that any secret was actually rotated on time in a
#   live environment. The `last_rotated` field is a declared date; the guard
#   checks structural completeness and declared rotation age, not live evidence.
#
# History: the first version (PR #528) swallowed interpreter errors with
#   `2>/dev/null`, so a malformed entry (e.g. a missing `name`) made a gate print
#   PASS. Corrected under CLM-0391; mutation cases live in test-governance.sh.
#   CLM-0394: added `last_rotated` field and rotation age enforcement.
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

# Gate: rotation age — every active secret must have last_rotated and be within window
from datetime import datetime, timedelta

def parse_date(val):
    if not isinstance(val, str):
        return None
    try:
        return datetime.fromisoformat(val)
    except ValueError:
        return None

FREQ_DAYS = {
    "quarterly": 90,
    "semi-annually": 180,
    "annual": 365,
    "on compromise or quarterly": 90,
    "on compromise or semi-annually": 180,
    "on key rotation": None,  # event-driven, no fixed window
    "auto": None,  # auto-managed by cloud provider
    "N/A": None,  # not a secret
}

now = datetime(2026, 9, 28)  # baseline measurement date

missing_rotated = []
overdue = []
for i, s in dicts:
    if s.get("status") != "active":
        continue
    freq = s.get("rotation_frequency")
    if freq not in FREQ_DAYS:
        continue
    max_days = FREQ_DAYS[freq]
    if max_days is None:
        continue  # event-driven or N/A — skip age check
    lr = s.get("last_rotated")
    if lr is None:
        missing_rotated.append(name(i, s))
        continue
    dt = parse_date(lr)
    if dt is None:
        missing_rotated.append(f"{name(i, s)} (invalid date: {lr!r})")
        continue
    age_days = (now - dt).days
    if age_days > max_days:
        overdue.append(f"{name(i, s)} (age={age_days}d, max={max_days}d, last={lr})")

gate("every active secret has a valid last_rotated date", missing_rotated)
gate("no active secret exceeds its rotation frequency window", overdue)

print(f"INFO: {len(secrets)} secrets · "
      f"{sum(1 for _, s in dicts if s.get('status') == 'active')} active · "
      f"{sum(1 for _, s in dicts if str(s.get('status','')).startswith('BLOCKED'))} BLOCKED · "
      f"{sum(1 for _, s in dicts if s.get('last_rotated') and s.get('status') == 'active')} with last_rotated")

if failures:
    print("\n".join(failures))
    sys.exit(1)
PY
