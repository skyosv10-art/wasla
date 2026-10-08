# Render plan decision pack — 2026-10-08 (CLM-0508)

**Status:** decision pack, **waiting for owner approval before any billing change**. The executor has not made, and will not make, any plan or billing change.
**Workspace:** Render Singapore `tea-db0vtkpsrm7s739dm5c0`. **Risk:** RISK-0066.

## 1. Owner operational decision (recorded 2026-10-08)

> **The free plan is NOT approved for a field trial or for real operation of critical webhook-driven services.**

This decision sets the policy and leaves the current state unchanged. All 21 web services are on `free`, measured 2026-10-08T18:45Z. The 3 static sites are free by design, and that is correct for them.

## 2. Measured facts

| Fact | Value | Source |
|---|---|---|
| Web services | 21, all `plan=free` | Render API, 2026-10-08T18:45Z |
| Free spin-down | after 15 min with no inbound traffic; about 1 min cold start | [Render docs: Free instances](https://render.com/docs/free) |
| Free instance hours | **750 per workspace per calendar month**; when they run out, **every free web service in the workspace is suspended until the 1st of the next month** | [Render docs: Free instances](https://render.com/docs/free) |
| Render's own guidance | "Do not use [Free instances] for production applications" | [Render docs: Free instances](https://render.com/docs/free) |
| Prometheus scrape | 15 targets every 30 s (`infra/observability/prometheus.yml`). Scraped targets never go idle, so they never spin down | repo |
| Paid compute | 512 MB / <1 CPU = **$7/month**; 2 GB / 1 CPU = $25/month; Hobby workspace $0 + compute | [Render pricing](https://render.com/pricing) |

**Consequence (estimated, not measured; the Render API does not expose free-hour usage):**
- About 17 services stay permanently awake: the 15 scraped targets plus Prometheus and Alertmanager. That uses about 17 free-hours per hour, so 750 hours last about 44 hours of wall time.
- Once the hours run out, **every free service, including the 3 bots, Prometheus and Alertmanager, is suspended for the rest of the month.** That means no bot traffic and no paging.
- How many hours have been used so far this month is **unknown**. The owner can see it in the Render dashboard → Billing → Free usage.

## 3. Critical services

| Tier | Services | Why |
|---|---|---|
| C1: webhook ingress | wasla-partner-bot, wasla-driver-bot, wasla-customer-bot | Telegram delivers webhooks. A cold start of about 1 min risks Telegram delivery timeouts, which leads to retries and backlog, and a suspension means a total outage |
| C1: bot request path | wasla-identity, wasla-observability | read from every bot's env (measured) |
| C1: paging | wasla-prometheus, wasla-alertmanager | if they go down, nobody is paged during the outage |
| C2: domain backends | orders, dispatch, matching, delivery, drivers, customers, marketplace, negotiations, geography, search, reputation, subscriptions, audit | reached through the business flows. Cold starts add up along the call chain |
| C3: collector | wasla-otel-collector | telemetry only |

## 4. Options (monthly compute; prices from Render pricing, 2026-10-08)

| Option | Footprint | Monthly cost | Availability consequence |
|---|---|---|---|
| A: stay free (status quo) | 0 paid | $0 | **Rejected by the owner's decision (§1).** The hours run out in about 2 days at the current scrape rate, and then everything is suspended |
| **B: minimum paid (recommended for the field trial)** | C1 (7 services) + C2 (13) on $7 instances = 20; the otel-collector stays free or is stopped | **20 × $7 = $140** | No spin-down on the critical path. The free-hour pool only covers the collector |
| C: full paid | all 21 on $7 | 21 × $7 = $147 | Same as B, and the collector is always on too |
| D: C1 only | 7 × $7 | $49 | Bots and paging stay up. The C2 backends still spin down and use free hours, so they can be suspended. **Not sufficient** for real business flows |

The recommended minimum paid footprint is **option B ($140/month)**. A Pro workspace ($25/month) is **not** required for the instance upgrade; it is a separate choice about seats and features.

## 5. What happens after approval (not before)

1. The owner approves an option in writing and adds a payment method in Render.
2. The executor changes each instance type with the Render API, one service at a time, C1 first, under a new claim. Each change is followed by a health check and `render-deploy` parity.
3. RISK-0066 closes once all C1 and C2 services in the approved option are measured on a paid plan.

**No billing change happens until §5.1 is done.**
