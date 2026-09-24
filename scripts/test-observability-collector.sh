#!/bin/bash
# Smoke test for @wasla/observability-collector
# Starts the collector, hits /healthz and /metrics, verifies 200.
set -eu

echo "=== Observability Collector smoke test ==="

# Start collector on port 3099
PORT=3099 WASLA_SERVICE=@wasla/observability-collector node --import tsx services/observability/src/index.ts &
COLLECTOR_PID=$!
sleep 3

# Test /healthz
echo "--- /healthz ---"
HEALTHZ=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3099/healthz)
echo "  HTTP $HEALTHZ"

# Test /metrics
echo "--- /metrics ---"
METRICS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3099/metrics)
echo "  HTTP $METRICS"

# Test /api/v1/targets
echo "--- /api/v1/targets ---"
TARGETS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3099/api/v1/targets)
echo "  HTTP $TARGETS"

# Test /api/v1/alerts
echo "--- /api/v1/alerts ---"
ALERTS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3099/api/v1/alerts)
echo "  HTTP $ALERTS"

# Test / (dashboard)
echo "--- / (dashboard) ---"
DASHBOARD=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3099/)
echo "  HTTP $DASHBOARD"

# Test POST /v1/traces
echo "--- POST /v1/traces ---"
TRACE_RESP=$(curl -s -X POST http://localhost:3099/v1/traces \
  -H "Content-Type: application/json" \
  -d '{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"test-svc"}}]},"scopeSpans":[{"spans":[{"traceId":"abcdef0123456789abcdef0123456789","spanId":"abcdef0123456789","name":"GET /test","startTimeUnixNano":"1696000000000000000","endTimeUnixNano":"1696000000500000000","attributes":[{"key":"http.method","value":{"stringValue":"GET"}}]}]}]}]}')
echo "  Response: $TRACE_RESP"

# Cleanup
kill $COLLECTOR_PID 2>/dev/null || true

echo ""
echo "=== Results ==="
ALL_PASS=true
for code in $HEALTHZ $METRICS $TARGETS $ALERTS $DASHBOARD; do
  if [ "$code" != "200" ]; then
    ALL_PASS=false
    echo "  FAIL: HTTP $code"
  fi
done
if $ALL_PASS; then
  echo "  All endpoints returned 200 — PASS"
  exit 0
else
  echo "  Some endpoints failed — FAIL"
  exit 1
fi
