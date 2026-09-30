#!/usr/bin/env bash
# RISK-0056 · CLM-0420 — N3: a held ACCESS EXCLUSIVE lock makes apply.sh STOP.
# Holds the lock on public.search_product_index (the search migration alters it)
# from a separate session, runs apply.sh with lock_timeout=2s, and requires:
#   · apply.sh exits non-zero, and the search migration itself ends within 20 s
#     of starting (lock_timeout=2s — no indefinite wait behind the held lock);
#   · the search migration log shows SQLSTATE 55P03 (lock_not_available);
#   · apply.jsonl ends at `search` with pass=false, and `subscriptions` (after
#     search in the fixed order) was NOT attempted.
# Needs a database where the search schema already exists (run after P1).
# The migration log stays in $OUT/run/m-search.log (apply.sh keeps logs on failure).
set -euo pipefail
: "${RISK0056_DB_URL:?}"
OUT="${RISK0056_OUT_N3:-out/n3}"
rm -rf "$OUT"; mkdir -p "$OUT"
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"
cd "$ROOT"
cat > "$OUT/holder.cjs" <<'JS'
const pg = require(require.resolve("pg", { paths: [process.cwd() + "/services/search"] }));
(async () => {
  const c = new pg.Client({ connectionString: process.env.RISK0056_DB_URL });
  await c.connect();
  await c.query("SET idle_in_transaction_session_timeout = '120s'");
  await c.query("BEGIN");
  await c.query("LOCK TABLE public.search_product_index IN ACCESS EXCLUSIVE MODE");
  console.log("locked");
  await new Promise((r) => setTimeout(r, 90000));
  await c.query("ROLLBACK"); await c.end();
})().catch((e) => { console.error(e.code || e.message); process.exit(1); });
JS
node "$OUT/holder.cjs" > "$OUT/holder.log" 2>&1 &
HOLDER=$!
for _ in $(seq 1 100); do grep -q locked "$OUT/holder.log" 2>/dev/null && break; sleep 0.1; done
grep -q locked "$OUT/holder.log" || { echo "::error::could not take the lock"; kill $HOLDER || true; exit 1; }
start=$(date +%s)
set +e
RISK0056_OUT="$OUT/run" RISK0056_LOCK_TIMEOUT=2s timeout 300 bash scripts/ops/risk-0056/apply.sh > "$OUT/apply.out" 2>&1
rc=$?
set -e
elapsed=$(( $(date +%s) - start ))
kill $HOLDER 2>/dev/null || true
last="$(tail -1 "$OUT/run/apply.jsonl" 2>/dev/null || true)"
echo "apply.sh rc=$rc after ${elapsed}s · last record: $last"
[ "$rc" -ne 0 ] && [ "$rc" -ne 124 ] || { echo "::error::apply.sh did not fail (rc=$rc) — or waited until timeout"; exit 1; }
printf '%s' "$last" | grep -q '"service": "search"' && printf '%s' "$last" | grep -q '"pass": false' \
  || { echo "::error::apply did not stop at search"; exit 1; }
python3 -c "import json,sys; r=json.loads(sys.argv[1]); sys.exit(0 if r['ms'] < 20000 else 1)" "$last" \
  || { echo "::error::the search migration waited too long behind the lock"; exit 1; }
! grep -q '"service": "subscriptions"' "$OUT/run/apply.jsonl" || { echo "::error::a later service was attempted"; exit 1; }
grep -Eq "55P03|canceling statement due to lock timeout" "$OUT/run/m-search.log" \
  || { echo "::error::no 55P03 / lock timeout in the migration output"; grep -viE 'postgres(ql)?://' "$OUT/run/m-search.log" | tail -20; exit 1; }
echo "N3: PASS — stopped at search with lock timeout after ${elapsed}s; later services not attempted"
