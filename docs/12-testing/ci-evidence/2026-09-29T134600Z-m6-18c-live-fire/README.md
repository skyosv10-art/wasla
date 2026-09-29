# M6-18C — live-fire of the alert path on the deployed stack

**Claim:** CLM-0404 · **Measured:** 2026-09-29T13:46:15Z–13:55:30Z · **Live commit (all services):** `871a3b7` · **Raw:** [`livefire.jsonl`](livefire.jsonl) (106 timestamped probes, 5 s interval) · [`alertmanager-notify-log.txt`](alertmanager-notify-log.txt) (Render log of wasla-alertmanager)

Path under test: **service down → Prometheus scrape `up==0` → rule `WASLAServiceDown` (`for: 2m`) → Alertmanager (HTTPS + basic auth) → Telegram `telegram_configs` → on-call chat of the driver bot @ODD_DR_BOT**.
The fault was injected by suspending `wasla-reputation` through the Render API. It is a T2 service with no dependants on the paths under test, and it was resumed afterwards.

## Timeline (UTC, measured)

| Step | Time | Δ from fault |
|---|---|---|
| `wasla-reputation` suspended | 13:46:15.9 | 0 |
| Prometheus: `WASLAServiceDown` pending (`activeAt`) | 13:46:48.2 | +32 s |
| Prometheus: **firing** (after `for: 2m`) | 13:48:48.2 (seen by the probe 13:48:53.8) | +2 m 32 s |
| Alertmanager: alert received (`startsAt`) | 13:48:48.2 | +2 m 32 s |
| Alertmanager → Telegram: **`Notify success` attempts=1 duration=613 ms** | 13:48:59.0 | **+2 m 43 s** |
| `alertmanager_notifications_total{integration="telegram"}` | 0 → 1 (13:48:59.5) | |
| Service resumed | 13:49:09.8 | |
| Prometheus: target `up` again, alert resolved | ≈13:55:0x | |
| Alertmanager → Telegram: **resolved `Notify success`** attempts=1 duration=603 ms | 13:55:29.0 | |
| `alertmanager_notifications_total{integration="telegram"}` | 1 → 2 | |
| `alertmanager_notifications_failed_total{integration="telegram",*}` | **0** throughout | |

"Delivered" here means the Telegram Bot API accepted `sendMessage` to the on-call chat (`Notify success`, HTTP 200), on both the firing and the resolved event. Receipt on the recipient's device is a human observation outside the system. The owner confirms it separately.

## Findings (not hidden)

- Fault → notification in **2 m 43 s**. The rule's 2 min `for:` accounts for most of it. The notification itself added 11 s (`group_wait` 10 s + 0.6 s API).
- Recovery was **slow to resolve**. After the resume at 13:49:10, `/health` answered 200 within about 40 s. Prometheus scrapes of `/metrics` kept timing out (`context deadline exceeded`) until about 13:55, although the same URL answered in 0.14 s from outside. The resolve therefore arrived about 6 min after the service was back. The cause is not verified (candidates: Render edge routing to the resumed instance, or keep-alive connections held by Prometheus). It is recorded, not explained away.
- **Free-plan limit:** Prometheus and Alertmanager run on Render `free`, which sleeps after 15 min without inbound traffic. While asleep, **no rule is evaluated and no alert can fire**. During this live-fire the probes kept both awake. Continuous alerting needs an always-on plan: an owner decision (cost).
- Only `WASLAServiceDown` was live-fired. Error-rate, latency and SLO-burn rules were **not** exercised. Traffic generation against services whose domain schemas are missing (RISK-0056) would not produce meaningful 5xx/latency signals.

## Verdict

The alert path (generation → routing → delivery to the Telegram destination, firing and resolved) is **proven live** for the service-down alert. M6-18C is **not** marked Completed. The other alert classes and always-on evaluation are still open (see the board).
