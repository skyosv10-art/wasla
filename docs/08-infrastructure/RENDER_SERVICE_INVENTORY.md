# WASLA Render Service Inventory

**Last Updated:** 2026-09-18
**Related:** ADR-039, ADR-038, M2-02

## Overview

13 HTTP services + 3 HTTP bots = 16 deployable units. All are Web Services on Render. The monorepo Dockerfile builds a single image; `WASLA_SERVICE` env var (format: `@wasla/<name>`) selects the entry point via `scripts/container/entrypoint.sh`.

## Proven on Render Free

- `terraform init`: provider installed successfully
- `terraform validate`: configuration is valid
- `terraform plan` (local, test credentials): 16 resources to create — shape verified, not applied

## BLOCKED — EXTERNAL CREDENTIAL REQUIRED

- `terraform plan` against real Render account: requires `RENDER_API_KEY` and `RENDER_OWNER_ID` from environment — not available in sandbox
- `terraform apply`: same credential requirement

## BLOCKED — CODE CHANGE REQUIRED (Port Compatibility)

Render Web Services automatically set `PORT`. Services must listen on `$PORT`.

| # | Service | Port env var | Reads `PORT`? | Render-compatible? |
|---|---|---|---|---|
| 1 | customers | `PORT` (default 8086) | Yes | Yes |
| 2 | delivery | `PORT` | Yes | Yes |
| 3 | dispatch | `PORT` (via resolveDispatchPort) | Yes | Yes |
| 4 | drivers | `PORT` (default DRIVER_SERVICE_PORT) | Yes | Yes |
| 5 | geography | `PORT` (default 8081) | Yes | Yes |
| 6 | identity | `PORT` (default 8080) | Yes | Yes |
| 7 | marketplace | `MARKETPLACE_SERVICE_PORT` | No | **BLOCKED** |
| 8 | matching | `PORT` (default MATCHING_SERVICE_PORT) | Yes | Yes |
| 9 | negotiations | `PORT` (default NEGOTIATION_SERVICE_PORT) | Yes | Yes |
| 10 | orders | `PORT` (default ORDER_SERVICE_PORT) | Yes | Yes |
| 11 | reputation | `PORT` (default REPUTATION_SERVICE_PORT) | Yes | Yes |
| 12 | search | `PORT` | Yes | Yes |
| 13 | subscriptions | `SUBSCRIPTION_SERVICE_PORT` | No | **BLOCKED** |
| 14 | customer-bot | `CUSTOMER_BOT_PORT` (8083) | No | **BLOCKED** |
| 15 | driver-bot | `DRIVER_BOT_PORT` (8084) | No | **BLOCKED** |
| 16 | partner-bot | `PARTNER_BOT_PORT` (8085) | No | **BLOCKED** |

**5 of 16 units need code changes** to read `PORT` as the primary env var before they work on Render.

## Inter-service Dependencies

| Caller | Calls | Via |
|---|---|---|
| customers | geography, identity, orders | public URLs (Free) |
| delivery | marketplace | public URL (Free) |
| dispatch | matching, orders | public URLs (Free) |
| geography | identity | public URL (Free) |
| matching | geography | public URL (Free) |

## BLOCKED — PAID FEATURE REQUIRED

| Feature | Why | Render Paid Alternative |
|---|---|---|
| Private networking | Free Web Services cannot receive private network traffic | Private Services (Starter+) |
| 750 instance hours/month | 16 services running continuously far exceed Free quota | Starter plan ($7/month/service) |
| No idle sleep | Free Web Services sleep after 15 min | Starter plan |
| Single instance | Free Web Services cannot scale | Standard plan |
| Persistent disks | Not supported on Free | Starter plan |

## What can be simulated locally

- Docker build and run (via `docker build` / `docker run`)
- Inter-service communication (via `docker network` or `docker-compose`)
- CI pipeline (via GitHub Actions)
