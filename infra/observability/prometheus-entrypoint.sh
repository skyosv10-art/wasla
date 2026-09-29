#!/bin/sh
# Writes the Alertmanager basic-auth password from env and starts Prometheus.
# Fails closed on a missing variable. M6-18C · CLM-0403.
set -eu
: "${AM_BASIC_AUTH_PASSWORD:?AM_BASIC_AUTH_PASSWORD is not set — Prometheus cannot reach the authenticated Alertmanager}"
mkdir -p /tmp/prometheus
umask 077
printf '%s' "$AM_BASIC_AUTH_PASSWORD" > /tmp/prometheus/am_password
sed "s/__PORT__/${PORT:-9090}/" /etc/prometheus/prometheus.yml > /tmp/prometheus/prometheus.yml
cp /etc/prometheus/alert-rules.yml /tmp/prometheus/alert-rules.yml
exec /bin/prometheus \
  --web.listen-address=":${PORT:-9090}" \
  --config.file=/tmp/prometheus/prometheus.yml \
  --storage.tsdb.path=/prometheus
