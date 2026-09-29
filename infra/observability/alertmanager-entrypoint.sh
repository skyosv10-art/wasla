#!/bin/sh
# Renders alertmanager.yml + web.yml from env (Render) and starts Alertmanager.
# Fails closed on any missing variable. M6-18C · CLM-0403.
set -eu
: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN is not set — refusing to start without an alert destination}"
: "${TELEGRAM_CHAT_ID:?TELEGRAM_CHAT_ID is not set — refusing to start without an alert destination}"
: "${AM_BASIC_AUTH_USER:?AM_BASIC_AUTH_USER is not set — refusing to expose an unauthenticated Alertmanager}"
: "${AM_BASIC_AUTH_HASH:?AM_BASIC_AUTH_HASH (bcrypt) is not set — refusing to expose an unauthenticated Alertmanager}"
case "$TELEGRAM_CHAT_ID" in ''|*[!0-9-]*) echo "TELEGRAM_CHAT_ID must be an integer" >&2; exit 1;; esac
mkdir -p /tmp/alertmanager
umask 077
printf '%s' "$TELEGRAM_BOT_TOKEN" > /tmp/alertmanager/telegram_token
sed "s/__TELEGRAM_CHAT_ID__/$TELEGRAM_CHAT_ID/" /etc/alertmanager/alertmanager.yml > /tmp/alertmanager/alertmanager.yml
printf 'basic_auth_users:\n  %s: %s\n' "$AM_BASIC_AUTH_USER" "$AM_BASIC_AUTH_HASH" > /tmp/alertmanager/web.yml
# Single instance: HA gossip is disabled. It finds no private IP on Render and aborts.
exec /bin/alertmanager \
  --web.listen-address=":${PORT:-9093}" \
  --web.config.file=/tmp/alertmanager/web.yml \
  --config.file=/tmp/alertmanager/alertmanager.yml \
  --storage.path=/tmp/alertmanager/data \
  --cluster.listen-address= \
  --log.level=debug
