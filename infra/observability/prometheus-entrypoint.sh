#!/bin/sh
# Renders prometheus.yml for ONE environment and starts Prometheus.
# Fails closed on a missing/unknown environment or a missing variable.
# M6-18C · CLM-0403 · per-environment targets CLM-0499 · ADR-068.
#
#   WASLA_OBS_ENVIRONMENT   required — selects targets/<name>.targets (no default:
#                           an old hostname set can never return by omission)
#   AM_BASIC_AUTH_PASSWORD  required only when that environment owns paging
#   WASLA_OBS_CONFIG_DIR    default /etc/prometheus (the guard points it at the repo)
#   WASLA_OBS_RENDER_ONLY=1 print the rendered config to stdout and exit (guard/CI)
set -eu
CONF="${WASLA_OBS_CONFIG_DIR:-/etc/prometheus}"
: "${WASLA_OBS_ENVIRONMENT:?WASLA_OBS_ENVIRONMENT is not set — refusing to guess which environment to scrape}"
case "$WASLA_OBS_ENVIRONMENT" in ''|*[!a-z0-9-]*) echo "WASLA_OBS_ENVIRONMENT must match [a-z0-9-]+" >&2; exit 1;; esac
TF="$CONF/targets/$WASLA_OBS_ENVIRONMENT.targets"
[ -f "$TF" ] || { echo "no targets file for environment '$WASLA_OBS_ENVIRONMENT' ($TF)" >&2; exit 1; }
DECL=$(awk '$1=="environment"{print $2}' "$TF")
[ "$DECL" = "$WASLA_OBS_ENVIRONMENT" ] || { echo "targets file declares environment '$DECL', expected '$WASLA_OBS_ENVIRONMENT'" >&2; exit 1; }
AM=$(awk '$1=="alertmanager"{print $2}' "$TF")
[ -n "$AM" ] || { echo "targets file has no 'alertmanager' line (use 'alertmanager none')" >&2; exit 1; }
N=$(awk '$1=="service"' "$TF" | wc -l)
[ "$N" -gt 0 ] || { echo "targets file lists no services" >&2; exit 1; }

OUT=/tmp/prometheus
[ "${WASLA_OBS_RENDER_ONLY:-0}" = "1" ] && OUT=$(mktemp -d)
mkdir -p "$OUT"
umask 077
if [ "$AM" = "none" ]; then
  # Shadow mode: rules are evaluated and visible on /alerts, nothing is sent.
  printf '  alertmanagers: []\n' > "$OUT/alerting.block"
else
  if [ "${WASLA_OBS_RENDER_ONLY:-0}" != "1" ]; then
    : "${AM_BASIC_AUTH_PASSWORD:?AM_BASIC_AUTH_PASSWORD is not set — Prometheus cannot reach the authenticated Alertmanager}"
    printf '%s' "$AM_BASIC_AUTH_PASSWORD" > /tmp/prometheus/am_password
  fi
  printf '  alertmanagers:\n    - scheme: https\n      api_version: v2\n      basic_auth:\n        username: wasla-prometheus\n        password_file: /tmp/prometheus/am_password\n      static_configs:\n        - targets:\n            - "%s"\n' "$AM" > "$OUT/alerting.block"
fi
awk '$1=="service"{h=$3; sub(/^https:\/\//,"",h); sub(/\/.*$/,"",h); printf "          - \"%s\"\n", h}' "$TF" > "$OUT/targets.block"
awk -v port="${PORT:-9090}" -v env="$WASLA_OBS_ENVIRONMENT" -v ab="$OUT/alerting.block" -v tb="$OUT/targets.block" '
  /^__ALERTING__$/        { while ((getline l < ab) > 0) print l; next }
  /^__SERVICE_TARGETS__$/ { while ((getline l < tb) > 0) print l; next }
  { gsub(/__ENVIRONMENT__/, env); gsub(/__PORT__/, port); print }
' "$CONF/prometheus.yml" > "$OUT/prometheus.yml"
if [ "${WASLA_OBS_RENDER_ONLY:-0}" = "1" ]; then cat "$OUT/prometheus.yml"; rm -rf "$OUT"; exit 0; fi
cp "$CONF/alert-rules.yml" /tmp/prometheus/alert-rules.yml
exec /bin/prometheus \
  --web.listen-address=":${PORT:-9090}" \
  --config.file=/tmp/prometheus/prometheus.yml \
  --storage.tsdb.path=/prometheus
