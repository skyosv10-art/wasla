#!/usr/bin/env bash
# run-integration-local.sh — run every Postgres-backed CI leg locally (RISK-0007).
#
# The legs are read from `.github/workflows/ci.yml` itself: the `db-integration`
# matrix, then the `exit-gate-e2e` matrix, then `db-integration-shared`. So this
# runner cannot silently drift from CI. Each leg gets a fresh database, created
# on the server named by the admin URL.
#
# Usage:
#   WASLA_LOCAL_PG_URL=postgresql://postgres:postgres@127.0.0.1:5432 \
#     bash scripts/ci/run-integration-local.sh [leg-regex]
#
# The exit code is non-zero if any leg fails, or if no leg ran at all: zero legs
# is not success. WASLA_LOCAL_PG_URL is the server URL with no database path,
# and the user in it must be allowed to CREATE and DROP databases. NEVER point
# it at a shared or production server: every leg drops its database first.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 1

PG="${WASLA_LOCAL_PG_URL:-}"
if [[ -z "$PG" ]]; then
  echo "error: WASLA_LOCAL_PG_URL is not set — nothing measured (skipping is not success)." >&2
  exit 2
fi
case "$PG" in
  *supabase.co*|*supabase.com*|*pooler.supabase*)
    echo "error: WASLA_LOCAL_PG_URL points at Supabase — this runner drops databases; refusing." >&2
    exit 2 ;;
esac
PG="${PG%/}"
FILTER="${1:-}"
LOGDIR="${WASLA_LOCAL_PG_LOGDIR:-$(mktemp -d)}"

mapfile -t LEGS < <(python3 - <<'PY'
import yaml
y = yaml.safe_load(open(".github/workflows/ci.yml", encoding="utf-8"))
for i in y["jobs"]["db-integration"]["strategy"]["matrix"]["include"]:
    print("int", i["leg"], i["pkg"], i["db"], "DATABASE_URL")
for i in y["jobs"]["exit-gate-e2e"]["strategy"]["matrix"]["include"]:
    print("e2e", i["leg"], i["pkg"], i["db"], i["var"])
print("shared", "shared", "-", "wasla_shared_local", "DATABASE_URL")
PY
)

RAN=0; FAILED=()
for entry in "${LEGS[@]}"; do
  read -r kind leg pkg db var <<< "$entry"
  if [[ -n "$FILTER" && ! "$kind:$leg" =~ $FILTER ]]; then continue; fi
  psql "$PG/postgres" -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS $db WITH (FORCE)" -qc "CREATE DATABASE $db" >/dev/null || {
    echo "✗ $kind $leg: cannot create database $db"; FAILED+=("$kind:$leg"); continue; }
  case "$kind" in
    int)    cmd=(pnpm --filter "$pkg" test:integration) ;;
    e2e)    cmd=(pnpm --filter "$pkg" test) ;;
    shared) cmd=(bash scripts/ci/run-shared-db-integration.sh) ;;
  esac
  log="$LOGDIR/$kind-$leg.log"
  env "$var=$PG/$db" "${cmd[@]}" > "$log" 2>&1; rc=$?
  RAN=$((RAN + 1))
  tests="$(grep -E 'Tests +[0-9]' "$log" | tail -1 | sed 's/\x1b\[[0-9;]*m//g' | xargs)"
  if [[ $rc -eq 0 ]]; then echo "✓ $kind $leg · ${tests:-rc=0}"; else echo "✗ $kind $leg · rc=$rc · ${tests} · log: $log"; FAILED+=("$kind:$leg"); fi
done

server="$(psql "$PG/postgres" -Atc 'show server_version' 2>/dev/null)"
echo "server: PostgreSQL ${server:-?} · legs run: $RAN · failed: ${#FAILED[@]} · logs: $LOGDIR"
if [[ $RAN -eq 0 ]]; then echo "error: zero legs ran — not success." >&2; exit 1; fi
[[ ${#FAILED[@]} -eq 0 ]]
