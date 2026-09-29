# M6-18C — observability stack: why it never ran, and the fix (pre-live-fire)

**Claim:** CLM-0403 · **Date:** 2026-09-29 · **Status:** fixed in code, proven locally with the same image versions. **Live-fire has NOT happened yet** (§3).

## 1. Root causes (from the Render deploy logs of 2026-09-24, raw here)

| Service | Render status | Root cause (log line) | Raw |
|---|---|---|---|
| wasla-alertmanager | `build_failed` | `docker.io/prom/alertmanager:v0.27.1: not found`. The tag was never published (Docker Hub: v0.27.1 → 404, v0.27.0 → 200) | [`render-log-alertmanager-2026-09-24.txt`](render-log-alertmanager-2026-09-24.txt) |
| wasla-prometheus | `update_failed` | `prometheus: error: unexpected sh`. The image ENTRYPOINT is `/bin/prometheus`, so `CMD ["sh","-c",…]` reached it as arguments. No port was ever bound (port-scan timeout) | [`render-log-prometheus-2026-09-24.txt`](render-log-prometheus-2026-09-24.txt) |
| wasla-otel-collector | `update_failed` | `environment variable "PORT:-4318" has invalid name`. The collector has no `${env:X:-default}` syntax, and the `env` "extension" it declared does not exist | [`render-log-otel-collector-2026-09-24.txt`](render-log-otel-collector-2026-09-24.txt) |

Defects found in the configuration that would have blocked live-fire even with the builds green:

- `prometheus.yml` sent alerts to `localhost:9093`. Alertmanager is a separate Render service, so no alert could ever leave Prometheus.
- Scrape targets had no scheme (http :80). Render serves HTTPS on 443.
- `alertmanager.yml` had a receiver with **no integration**. Every alert would have been dropped, although the gate requires Telegram.
- Alertmanager was public and unauthenticated (anyone could silence alerts). Prometheus ran with `--web.enable-lifecycle` on a public URL (anyone could `POST /-/quit`).
- Alertmanager HA gossip aborts when no private IP is found. It is disabled because this is a single instance.

## 2. Fix (infra/observability/, infra/terraform/observability/)

- `prom/alertmanager:v0.27.0`. Explicit `ENTRYPOINT` shell scripts for Alertmanager and Prometheus.
- Alertmanager → Telegram receiver (`telegram_configs`, token via `bot_token_file`, `send_resolved`). Destination = primary on-call driver bot, per OBSERVABILITY_OPERATING_MODEL §4.
- Basic auth on Alertmanager (`web.yml`, bcrypt). Prometheus authenticates with `password_file`.
- **Fail closed:** the container refuses to start if `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `AM_BASIC_AUTH_USER`, `AM_BASIC_AUTH_HASH` (Alertmanager) or `AM_BASIC_AUTH_PASSWORD` (Prometheus) is missing. No secret is in the repository.
- Terraform declares these as `sensitive` variables. The previous `env_vars = {}` would have wiped them on apply.

## 3. Local proof (same versions: alertmanager 0.27.0, prometheus 2.54.1)

- `amtool check-config` SUCCESS · `promtool check config` SUCCESS (4 rules).
- Alertmanager: no credentials → **401**, credentials → **200**. With an empty env the entrypoint exits with `TELEGRAM_BOT_TOKEN is not set`.
- Posting an alert reached the Telegram API through the real integration. The test chat id `1` gave `telegram: chat not found (400)`, which proves the path works and that a real chat id is needed. Raw: [`local-alertmanager-e2e.log`](local-alertmanager-e2e.log).
- Prometheus: HTTPS targets `up` (orders, identity, delivery, audit), Alertmanager discovered as `https://wasla-alertmanager.onrender.com/api/v2/alerts`, `POST /-/quit` → **403**. Raw: [`local-prometheus-e2e.log`](local-prometheus-e2e.log).

## 4. Remaining for live-fire

1. Merge. Deploy the three services at the merge commit (`render-sync.py`).
2. Set the env vars on Render. The **Telegram chat id of the on-call recipient** is an owner input: the driver bot `@ODD_DR_BOT` has no webhook and no pending updates, so no chat id can be discovered.
3. Live-fire: suspend a scraped service → `WASLAServiceDown` (`for: 2m`) → Alertmanager → Telegram. Record timings from suspend to firing, to notify success, and to the message being received.
