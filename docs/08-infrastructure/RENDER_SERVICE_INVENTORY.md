# WASLA Render Service Inventory

**Last Updated:** 2026-09-18
**Related:** ADR-039, ADR-038, M2-02

## Overview

13 HTTP services + 3 HTTP bots = 16 deployable units. All are Web Services on Render. The monorepo Dockerfile builds a single image; `SERVICE_NAME` env var selects the entry point.

## Service Mapping

| # | Service | Start Command | Port Env | Render Type | Free? | Inter-service Dependencies | Notes |
|---|---|---|---|---|---|---|---|
| 1 | customers | `node --import tsx src/http/server.ts` | PORT | Web Service | Yes | → geography, identity, orders | Calls 3 services |
| 2 | delivery | `node --import tsx src/http/server.ts` | PORT | Web Service | Yes | → marketplace | Calls 1 service |
| 3 | dispatch | `node --import tsx src/http/server.ts` | DISPATCH_SERVICE_PORT | Web Service | Yes | → matching, orders | Calls 2 services |
| 4 | drivers | `node --import tsx src/http/server.ts` | DRIVER_SERVICE_PORT | Web Service | Yes | — | No inter-service calls |
| 5 | geography | `node --import tsx src/http/server.ts` | PORT | Web Service | Yes | → identity | Receives calls from customers, matching |
| 6 | identity | `node --import tsx src/http/server.ts` | PORT | Web Service | Yes | — | Receives calls from customers, geography |
| 7 | marketplace | `node --import tsx src/http/server.ts` | MARKETPLACE_SERVICE_PORT | Web Service | Yes | — | Receives calls from delivery |
| 8 | matching | `node --import tsx src/http/server.ts` | MATCHING_SERVICE_PORT | Web Service | Yes | → geography | Receives calls from dispatch |
| 9 | negotiations | `node --import tsx src/http/server.ts` | NEGOTIATION_SERVICE_PORT | Web Service | Yes | — | No inter-service calls |
| 10 | orders | `node --import tsx src/http/server.ts` | ORDER_SERVICE_PORT | Web Service | Yes | — | Receives calls from customers, dispatch |
| 11 | reputation | `node --import tsx src/http/server.ts` | PORT | Web Service | Yes | — | No inter-service calls |
| 12 | search | `node --import tsx src/http/server.ts` | PORT | Web Service | Yes | — | No inter-service calls |
| 13 | subscriptions | `node --import tsx src/http/server.ts` | SUBSCRIPTION_SERVICE_PORT | Web Service | Yes | — | No inter-service calls |
| 14 | customer-bot | `node --import tsx src/main.ts` | CUSTOMER_BOT_PORT (8083) | Web Service | Yes | — | Needs BOT_TOKEN (secret) |
| 15 | driver-bot | `node --import tsx src/main.ts` | DRIVER_BOT_PORT (8084) | Web Service | Yes | — | Needs BOT_TOKEN (secret) |
| 16 | partner-bot | `node --import tsx src/main.ts` | PARTNER_BOT_PORT (8085) | Web Service | Yes | — | Needs BOT_TOKEN (secret) |

## Render Free Tier Limitations

| Limitation | Impact on WASLA |
|---|---|
| Free Web Services cannot receive private network traffic | Inter-service calls use public URLs (security concern for PoC) |
| Sleep after 15 min idle | First request after idle takes ~1 min |
| 750 instance hours/month | 16 services × ~47 hours each = 752 — exceeds Free quota |
| Single instance | No horizontal scaling |
| No persistent disks | Stateless only |
| No SSH/shell access | Debugging via logs only |
| No outbound SMTP (25, 465, 587) | Bots cannot send email directly |
| Render may restart at any time | Services must be stateless and handle restarts |

## Topology Analysis

### What works on Render Free
- All 16 services as Web Services
- Supabase PostgreSQL as external database (via DATABASE_URL)
- Docker image build from monorepo
- Public HTTP endpoints for all services

### What requires Render Paid
- **Private networking:** Services that receive inter-service calls (geography, identity, marketplace, matching, orders) should be Private Services on paid plans
- **750 hour limit:** 16 Free services exceed the monthly Free instance hour quota
- **No idle sleep:** Production services need to stay warm (Starter plan $7/month)
- **Persistent disks:** If any service needs local state (none currently do)

### What can be simulated locally
- Docker Compose with all 16 services
- Inter-service communication via Docker network
- CI pipeline builds and tests
