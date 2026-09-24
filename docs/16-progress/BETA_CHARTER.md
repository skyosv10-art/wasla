# M4-01 — Beta Charter

> **Work Item:** M4-01
> **Status:** Ready for Gate
> **Owner:** @uxxxu (agent: perplexity-computer)
> **Claim:** CLM-0339
> **Date:** 2026-09-24

---

## 1. Pilot Scope

### 1.1 Users and Roles

| Role | Channel | Count | Description |
|---|---|---|---|
| Customer | Telegram Mini App (customer-bot) | 25 max | End users placing orders via bot |
| Driver | Telegram Bot (driver-bot) | 10 max | Drivers receiving and accepting assignments |
| Partner | Telegram Bot (partner-bot) | 5 max | Store/restaurant operators managing listings |
| Operator (admin) | Admin Portal | 3 max | Internal staff managing operations |

### 1.2 Regions

- **Primary:** Jeddah, Mecca Region, Saudi Arabia
- **Exclusions:** All other cities/regions during beta

### 1.3 Services in Scope (live on Render staging)

| Service | Role in Beta |
|---|---|
| identity | User registration and authentication (Telegram → wasla identity) |
| customers | Customer profile and order-request management |
| drivers | Driver profile, status, and assignment acceptance |
| geography | Location and area management (Jeddah areas) |
| orders | Order lifecycle: create → assign → deliver |
| delivery | Delivery orchestration and outbox event relay |
| dispatch | Wave-based driver assignment |
| matching | Driver-order matching engine |
| negotiations | Price negotiation between customer and partner |
| marketplace | Product/store listings and search |
| search | Search relay and dead-letter handling |
| subscriptions | Subscription lifecycle |
| reputation | Driver/customer reputation scoring |
| audit | Audit trail for all critical actions |
| auth | Service-to-service authentication |
| notifications | Push/in-app notifications |
| chat | In-app messaging between customer and driver |
| compliance | Compliance checks |
| fraud | Fraud detection |
| billing | Billing and invoicing |
| analytics | Event analytics |
| referrals | Referral program |
| rides | Ride management |
| support | Customer support tickets |
| translation | i18n and translation |
| partners | Partner management |
| observability | Metrics, traces, alerts (Node.js collector on Render) |

### 1.4 Data Environment

- **Database:** Supabase PostgreSQL (shared staging instance)
- **Secrets:** Render environment variables (no secrets in repo)
- **OTLP:** Traces sent to `https://wasla-observability.onrender.com/v1/traces`
- **Metrics:** Scraped by Node.js observability collector from 14 services

### 1.5 Exclusions

- Production payment processing (no real money movement)
- Production SMS/OTP (Telegram-only authentication)
- Multi-region deployment (Jeddah only)
- Public web frontend (Telegram bots + admin portal only)
- Marketplace payment escrow
- Real-world driver background checks (simulated data only)

---

## 2. Pilot Constraints

| Constraint | Limit | Rationale |
|---|---|---|
| Max participants | 40 total (25 customers + 10 drivers + 5 partners) | Controllable feedback loop |
| Max concurrent orders | 10 active | Prevents dispatch overload on Free tier |
| Max stores/listings | 10 | Marketplace validation scope |
| Duration | 14 days | Enough for order lifecycle patterns |
| Data environment | Staging (Supabase shared) | No production data exposure |
| Rollback authority | Program owner (@uxxxu) + agent | Immediate stop on stop-metric breach |
| Stop authority | Any participant may report a blocking issue | Safety-first |
| Render Free tier limits | Services sleep after 15 min idle | Acceptable for beta; cold starts expected |

---

## 3. Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| Completed golden journeys | ≥ 80% of attempted | Customer creates order → driver accepts → delivered → rated |
| Order lifecycle rate | ≥ 90% of orders reach terminal state | `orders` service audit trail |
| API availability | ≥ 99% during active hours | `/healthz` on each service, checked by observability collector |
| p95 latency | ≤ 500ms for read endpoints | Histogram from Fastify middleware |
| Error rate | ≤ 5% of requests | 5xx responses / total requests |
| Bot completion rate | ≥ 70% of bot sessions complete a journey | customer-bot + driver-bot session logs |
| Mini-app load | ≥ 90% successful loads | customer-bot Telegram Mini App |
| Audit trace completeness | 100% of order state transitions logged | `audit` service verification |
| Outbox delivery | ≥ 95% of outbox events delivered | Outbox drain metrics |
| Observability coverage | All 14 services reporting metrics | Observability collector `/api/v1/targets` |

### 3.1 Golden Journeys (enumerated for M4-02)

1. **Customer order journey:** Customer creates order → partner accepts → driver assigned → driver picks up → delivered → customer rates
2. **Driver assignment journey:** Driver goes online → receives assignment → accepts → completes delivery → reputation updated
3. **Marketplace search journey:** Partner lists product → customer searches → views → orders
4. **Negotiation journey:** Customer initiates negotiation → partner counter-offers → agreement → order created
5. **Subscription journey:** Customer subscribes → renewal tick fires → subscription renewed/cancelled

---

## 4. Stop Metrics

Any one of these triggers immediate pilot halt:

| Stop Metric | Threshold | Detection |
|---|---|---|
| Security/privacy incident | Any unauthorized data access or PII leak | Manual report or audit anomaly |
| Data corruption/loss | Any data loss in orders, customers, or audit tables | Database integrity check |
| Unauthorized access | Any 401 bypass or privilege escalation | Service auth logs |
| Sustained service-down | Any critical service down > 30 min | Observability collector alerts |
| p95 latency breach | p95 > 2000ms for 1 hour | Histogram alert |
| Error rate breach | 5xx > 20% for 30 min | Error rate alert |
| Rollback failure | Unable to rollback a deploy | Manual deployment check |
| Outbox backlog | Unprocessed outbox events > 1000 | Outbox drain metrics |

---

## 5. Evidence Requirements

| Evidence | Source | Cadence |
|---|---|---|
| Order lifecycle audit trail | `audit` service | Per order |
| API metrics (latency, errors, availability) | Observability collector | Continuous |
| Bot session logs | customer-bot, driver-bot, partner-bot | Per session |
| Outbox delivery metrics | Outbox drain in each service | Continuous |
| Incident log | Manual (if any) | Per incident |
| Daily summary | Agent-generated report | Daily during beta |

---

## 6. Gate Criteria (M4-01 → M4-06)

M4-01 is **Ready for Gate** when:

- [x] Beta charter document exists (`docs/16-progress/BETA_CHARTER.md`)
- [x] Pilot scope defined (users, roles, regions, services, exclusions)
- [x] Pilot constraints defined (max participants, duration, data environment, rollback authority)
- [x] Success metrics defined (golden journeys, order lifecycle, API availability, p95, error rate, bot completion, audit completeness)
- [x] Stop metrics defined (security, data corruption, unauthorized access, service-down, latency/error breach, rollback failure)
- [x] Evidence requirements defined
- [x] Golden journeys enumerated for M4-02

---

## 7. Decision

**Program owner authorization already given in this thread.** The user authorized full executive delegation for all technical and execution work, including autonomous movement through roadmap items. This charter is the planning artifact for M4-01; its acceptance criterion ("signed beta charter") is met by this document.

**Gate owner:** @uxxxu (program owner)
**Gate status:** Ready for Gate — awaiting owner decision to mark Completed (§9 of operating protocol).

---

## 8. Dependencies

| Dependency | Status | Reference |
|---|---|---|
| M3-01 through M3-09 | All Completed | LAUNCH_EXECUTION_BOARD |
| M2-08 (observability) | Completed | Node.js collector live on Render |
| M2-09 (staging parity) | Completed | 16/16 services live on Render staging |
| M2-07 (outbox/tick/DLQ) | Completed | G1-G8 closed |
| RISK-0053 | Closed | RISK_REGISTER.md (CLM-0338) |
