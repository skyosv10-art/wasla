#!/usr/bin/env bash
# RISK-0056 · CLM-0420 — apply the 14 contracts/schema.sql migrations to ONE target
# database, fail-closed. The single implementation used by:
#   · .github/workflows/risk-0056-apply.yml       (production; workflow_dispatch only)
#   · .github/workflows/risk-0056-apply-proof.yml (TEST DB + fresh PG17; never production)
#
# Input (environment):
#   RISK0056_DB_URL        connection string. Never printed.
#   RISK0056_TARGET        local | test | production — selects the guard, nothing else.
#   RISK0056_OUT           output directory (default ./risk0056-apply-out)
#   RISK0056_LOCK_TIMEOUT  lock_timeout set and verified on the migration's only session (default 5s)
#   RISK0056_MODE          apply (default) | preflight — preflight is read-only and stops after step 3.
#
# Steps, each one stops the run on failure:
#   1. target guard (project ref / host) and session-pooler check (6543 refused);
#   2. source guard: the 14 schema.sql files hash exactly as schema-sha256.txt;
#   3. read-only preflight inventory (default_transaction_read_only = on);
#   4. the 14 REAL migrate-cli.ts, one at a time, each on ONE session whose
#      lock_timeout is set and read back at start and end (lock-timeout-preload.mjs);
#      the first failure stops the loop — no later service is attempted;
#   5. postflight: every table created by the 14 schema.sql files exists.
# Evidence: $RISK0056_OUT/*.json|jsonl — no URL, no user, no password, no SQL text.
set -euo pipefail

: "${RISK0056_DB_URL:?RISK0056_DB_URL is required}"
: "${RISK0056_TARGET:?RISK0056_TARGET is required (local|test|production)}"
OUT="${RISK0056_OUT:-./risk0056-apply-out}"
LT="${RISK0056_LOCK_TIMEOUT:-5s}"
MODE="${RISK0056_MODE:-apply}"
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"
SERVICES="audit customers delivery dispatch drivers geography identity marketplace matching negotiations orders reputation search subscriptions"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"   # absolute: migrations run from each service directory
cd "$ROOT"

step() { printf '\n== %s\n' "$1"; }

step "1. target guard ($RISK0056_TARGET)"
case "$RISK0056_TARGET" in
  local)      python3 "$DIR/guard-target.py" local ;;
  test)       python3 "$DIR/guard-test-db.py"; python3 "$DIR/guard-target.py" test ;;
  production) python3 "$DIR/guard-target.py" production ;;
  *) echo "::error::unknown RISK0056_TARGET=$RISK0056_TARGET"; exit 2 ;;
esac

step "2. source guard: schema.sql sha256"
grep -v '^#' "$DIR/schema-sha256.txt" | sha256sum -c --quiet
echo "schema.sql sha256: $(grep -vc '^#' "$DIR/schema-sha256.txt")/14 identical to schema-sha256.txt at $(git rev-parse HEAD)"

step "3. read-only preflight inventory"
node "$DIR/inventory.mjs" "$OUT/preflight-inventory.json"
python3 - "$OUT/preflight-inventory.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
print(f"server {r['server_version']} · public tables {len(r['public_tables'])} · extensions {len(r['extensions'])}")
PY
if [[ "$MODE" == preflight ]]; then echo "mode=preflight — nothing written"; exit 0; fi

step "4. migrations (lock_timeout=$LT, one session each, stop at first failure)"
: > "$OUT/apply.jsonl"
for s in $SERVICES; do
  ev="$OUT/lt-${s}.jsonl"; rm -f "$ev"
  start=${EPOCHREALTIME/./}
  if DATABASE_URL="$RISK0056_DB_URL" RISK0056_LOCK_TIMEOUT="$LT" RISK0056_LT_EVIDENCE="$ev" RISK0056_SERVICE="$s" \
       pnpm --silent --filter "@wasla/${s}-service" exec \
         node --import "$DIR/lock-timeout-preload.mjs" --import tsx src/db/migrate-cli.ts \
       > "$OUT/m-${s}.log" 2>&1; then rc=0; else rc=$?; fi
  ms=$(( (${EPOCHREALTIME/./} - start) / 1000 ))
  python3 - "$ev" "$s" "$rc" "$ms" "$LT" <<'PY' | tee -a "$OUT/apply.jsonl"
import json, os, sys
ev, svc, rc, ms, lt = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
e = [json.loads(l) for l in open(ev)] if os.path.exists(ev) else []
ready = [x for x in e if x["event"] == "session_ready"]
final = [x for x in e if x["event"] == "session_final"]
ok = (rc == 0 and len(ready) == 1 and len(final) == 1
      and ready[0]["lock_timeout"] == lt and final[0]["lock_timeout"] == lt
      and ready[0]["pid"] == final[0]["pid"])
print(json.dumps({"service": svc, "exit": rc, "ms": ms, "sessions_opened": len(ready),
                  "lock_timeout_start": ready[0]["lock_timeout"] if ready else None,
                  "lock_timeout_end": final[0]["lock_timeout"] if final else None,
                  "same_pid_start_end": bool(ready and final and ready[0]["pid"] == final[0]["pid"]),
                  "pass": ok}))
PY
  last_rec="$(tail -1 "$OUT/apply.jsonl")"
  if ! grep -q '"pass": true' <<< "$last_rec"; then
    echo "::error::migration for ${s} failed or its session evidence is incomplete — stopping; later services NOT attempted"
    grep -viE 'postgres(ql)?://' "$OUT/m-${s}.log" | tail -15 || true
    exit 1
  fi
done
rm -f "$OUT"/m-*.log
echo "migrations: 14/14 pass"

step "5. postflight: every table declared by the 14 schema.sql exists"
node "$DIR/inventory.mjs" "$OUT/postflight-inventory.json"
python3 - "$OUT/postflight-inventory.json" $SERVICES <<'PY'
import json, re, sys
inv = json.load(open(sys.argv[1]))
have = {t["table"] for t in inv["public_tables"]}
want = {}
for svc in sys.argv[2:]:
    sql = open(f"services/{svc}/contracts/schema.sql", encoding="utf-8").read()
    sql = re.sub(r"--[^\n]*", "", sql)
    for m in re.finditer(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?\"?([a-z_][a-z0-9_]*)\"?", sql, re.I):
        want.setdefault(m.group(1), svc)
missing = sorted(t for t in want if t not in have)
print(f"declared tables {len(want)} · present {len(want) - len(missing)} · missing {len(missing)}")
json.dump({"declared": len(want), "missing": missing}, open(sys.argv[1].replace("inventory", "check"), "w"))
if missing:
    print("::error::missing after apply: " + ", ".join(f"{t} ({want[t]})" for t in missing))
    sys.exit(1)
PY
echo "RISK-0056 apply: PASS on target=$RISK0056_TARGET at $(git rev-parse HEAD)"
