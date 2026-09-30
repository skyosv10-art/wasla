#!/usr/bin/env bash
# RISK-0056 · CLM-0410 — boot each DB-backed service against a NON-production
# database and record what its open health/readiness routes answer.
#
# Input (environment):
#   RISK0056_DB_URL   connection string of the TEST database. Never printed.
#   RISK0056_OUT      output directory for JSON results (default: ./risk0056-out)
#   RISK0056_SERVICES space-separated service list (default: the 14 below)
#
# The connection string is passed to child processes via environment only. The
# service log files stay on the runner; only a filtered tail (lines that do not
# contain "postgres://" / "postgresql://") is echoed on failure.
set -euo pipefail

: "${RISK0056_DB_URL:?RISK0056_DB_URL is required}"
OUT="${RISK0056_OUT:-./risk0056-out}"
mkdir -p "$OUT/logs"
SERVICES="${RISK0056_SERVICES:-audit customers delivery dispatch drivers geography identity marketplace matching negotiations orders reputation search subscriptions}"

# Ephemeral, per-run service-auth key. It never leaves this process tree and
# authorises nothing outside this runner.
EPHEMERAL_SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '\n=+/')"
if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::add-mask::${EPHEMERAL_SECRET}"; fi

port=19100
results="$OUT/health.jsonl"
: > "$results"

probe() { # $1=url → prints "<code> <body>"
  local body code
  body="$(curl -s -m 10 -o - -w '\n%{http_code}' "$1" || true)"
  code="${body##*$'\n'}"; body="${body%$'\n'*}"
  printf '%s %s' "$code" "$(printf '%s' "$body" | head -c 600 | tr '\n' ' ')"
}

for svc in $SERVICES; do
  port=$((port + 1))
  log="$OUT/logs/$svc.log"
  # A process left on this port would answer for the wrong database — refuse.
  if curl -s -m 2 -o /dev/null "http://127.0.0.1:${port}/health"; then
    echo "port ${port} already answers before ${svc} started — aborting" >&2; exit 3
  fi
  setsid env -i PATH="$PATH" HOME="$HOME" \
    DATABASE_URL="$RISK0056_DB_URL" \
    BILLING_DATABASE_URL="$RISK0056_DB_URL" \
    PORT="$port" \
    WASLA_SERVICE_AUTH_KEYS="ci-risk0056:active:${EPHEMERAL_SECRET}" \
    WASLA_SERVICE_AUTH_ACTIVE_KID="ci-risk0056" \
    MARKETPLACE_SERVICE_URL="http://127.0.0.1:1" \
    GEOGRAPHY_SERVICE_URL="http://127.0.0.1:1" IDENTITY_SERVICE_URL="http://127.0.0.1:1" \
    ORDER_SERVICE_URL="http://127.0.0.1:1" MATCHING_BASE_URL="http://127.0.0.1:1" \
    ORDERS_BASE_URL="http://127.0.0.1:1" GEOGRAPHY_BASE_URL="http://127.0.0.1:1" \
    pnpm --silent --filter "@wasla/${svc}-service" start > "$log" 2>&1 &
  pid=$!

  up=no
  for _ in $(seq 1 60); do
    if curl -s -m 2 -o /dev/null "http://127.0.0.1:${port}/health"; then up=yes; break; fi
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 1
  done

  health="n/a"; ready="n/a"
  if [[ "$up" == yes ]]; then
    health="$(probe "http://127.0.0.1:${port}/health")"
    case "$svc" in
      delivery) ready="$(probe "http://127.0.0.1:${port}/delivery/ready")" ;;
    esac
  fi

  python3 - "$svc" "$up" "$health" "$ready" >> "$results" <<'PY'
import json, sys
svc, up, health, ready = sys.argv[1:5]
def split(v):
    if v == "n/a": return None
    code, _, body = v.partition(" ")
    try: parsed = json.loads(body)
    except Exception: parsed = body[:300]
    return {"code": int(code) if code.isdigit() else code, "body": parsed}
print(json.dumps({"service": svc, "booted": up == "yes", "health": split(health), "ready": split(ready)}, ensure_ascii=False))
PY
  echo "[$svc] booted=$up health=${health:0:200} ready=${ready:0:260}"
  if [[ "$up" != yes ]]; then
    echo "  --- filtered log tail ($svc) ---"
    grep -viE 'postgres(ql)?://' "$log" | tail -15 | sed 's/^/  /' || true
  fi

  # setsid made $pid a process-group leader: kill the whole group (pnpm → node).
  kill -TERM -- "-$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  kill -KILL -- "-$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do curl -s -m 1 -o /dev/null "http://127.0.0.1:${port}/health" || break; sleep 0.5; done
done
