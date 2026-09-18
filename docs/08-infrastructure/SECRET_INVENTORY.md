# WASLA Secret Inventory

**Last Updated:** 2026-09-18
**Related:** M2-03, ADR-038, ADR-039
**Machine-readable source:** [`infra/secrets/secret-inventory.json`](../../infra/secrets/secret-inventory.json)

## Overview

This inventory catalogs every secret used across the WASLA system. It is the first step of M2-03 (secrets/KMS/rotation). The actual rotation drill remains BLOCKED until cloud KMS / compute platform decisions are made.

## Secret Categories

### 1. Database URLs (7 secrets)

| Secret | Consumers | Environments | Storage | Rotation | Status |
|---|---|---|---|---|---|
| `DATABASE_URL` | 13 services | dev, staging, prod | env var | quarterly via Supabase | active |
| `CUSTOMER_DATABASE_URL` | customer-bot (tests) | ci | env var (CI) | quarterly | active |
| `DRIVER_DATABASE_URL` | driver-bot (tests) | ci | env var (CI) | quarterly | active |
| `DISPATCH_DATABASE_URL` | dispatch (tests) | ci | env var (CI) | quarterly | active |
| `NEGOTIATION_DATABASE_URL` | negotiations (tests) | ci | env var (CI) | quarterly | active |
| `ORDER_DATABASE_URL` | orders (tests) | ci | env var (CI) | quarterly | active |
| `WASLA_SERVICE_TOKEN_REPLAY_URL` | all services | dev, staging, prod | env var | quarterly | active |

### 2. Telegram Bot Tokens (3 secrets)

| Secret | Consumers | Environments | Storage | Rotation | Status |
|---|---|---|---|---|---|
| `CUSTOMER_BOT_TOKEN` | customer-bot | dev, staging, prod | env var (Render) | on compromise / quarterly | active |
| `DRIVER_BOT_TOKEN` | driver-bot | dev, staging, prod | env var (Render) | on compromise / quarterly | active |
| `PARTNER_BOT_TOKEN` | partner-bot | dev, staging, prod | env var (Render) | on compromise / quarterly | active |

### 3. Webhook Secrets (3 secrets)

| Secret | Consumers | Environments | Storage | Rotation | Status |
|---|---|---|---|---|---|
| `CUSTOMER_BOT_WEBHOOK_SECRET` | customer-bot | dev, staging, prod | env var (Render) | semi-annually | active |
| `DRIVER_BOT_WEBHOOK_SECRET` | driver-bot | dev, staging, prod | env var (Render) | semi-annually | active |
| `PARTNER_BOT_WEBHOOK_SECRET` | partner-bot | dev, staging, prod | env var (Render) | semi-annually | active |

### 4. Service Auth Keys (2 secrets)

| Secret | Consumers | Environments | Storage | Rotation | Status |
|---|---|---|---|---|---|
| `WASLA_SERVICE_AUTH_KEYS` | all services | dev, staging, prod | env var | quarterly (add → deploy → activate → revoke) | active |
| `WASLA_SERVICE_AUTH_ACTIVE_KID` | all services | dev, staging, prod | env var | on key rotation | active |

### 5. Infrastructure Credentials (7 secrets — all BLOCKED)

| Secret | Consumers | Environments | Storage | Status |
|---|---|---|---|---|
| `RENDER_API_KEY` | Terraform provider | ci, dev, staging, prod | env only | BLOCKED — EXTERNAL CREDENTIAL REQUIRED |
| `RENDER_OWNER_ID` | Terraform provider | ci, dev, staging, prod | env only | BLOCKED — EXTERNAL CREDENTIAL REQUIRED |
| `KMS_KEY_ID` | secrets mgmt (future) | staging, prod | cloud KMS | BLOCKED — EXTERNAL/PAID FEATURE REQUIRED |
| `KMS_KEY_ARN` | secrets mgmt (future) | staging, prod | cloud KMS | BLOCKED — EXTERNAL/PAID FEATURE REQUIRED |
| `TLS_CERTIFICATE_ARN` | TLS termination | staging, prod | cloud cert mgr | BLOCKED — EXTERNAL/PAID FEATURE REQUIRED |
| `TLS_PRIVATE_KEY_ARN` | TLS termination | staging, prod | cloud cert mgr | BLOCKED — EXTERNAL/PAID FEATURE REQUIRED |
| `DNS_API_TOKEN` | DNS automation | staging, prod | env only | BLOCKED — EXTERNAL/PAID FEATURE REQUIRED |

## Summary

- **15 active secrets** (database URLs, bot tokens, webhook secrets, auth keys)
- **7 blocked secrets** (infrastructure credentials pending cloud/KMS/TLS decisions)
- **22 total secrets** in the inventory
- **0 secrets stored in Git** (all via environment variables or cloud KMS)
- **0 secret values in this inventory** (names and metadata only)

## What is proven

- Every `secret: true` variable in `env-registry.json` is cataloged here
- Every `required_secret` in environment manifests is cataloged here
- Every M2-03 pending secret from `validate-environments.sh` is cataloged here
- Every sensitive env var referenced in `render.tf` is cataloged here

## What remains BLOCKED

- **Rotation drill:** requires cloud KMS / secrets manager decision
- **KMS integration:** requires cloud provider decision (AWS/GCP/Render Paid)
- **TLS automation:** requires compute platform + DNS provider decisions
- **Render credentials:** `RENDER_API_KEY`/`RENDER_OWNER_ID` not available in sandbox
