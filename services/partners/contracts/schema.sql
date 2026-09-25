-- WASLA Partners Service — Data Contract (PostgreSQL DDL)
-- Phase 14 — Partner / Enterprise
--
-- Principles (ADR-048):
--   1. A tenant is a store. No separate tenants table.
--   2. Tenant isolation is enforced at this service boundary.
--   3. API credentials are scoped to a single store.
--   4. Webhooks are event-driven, not polled.
--   5. Usage limits are per-tenant, not per-user.
--   6. Audit trail is append-only.
--   7. Lifecycle is a state machine: pending → approved → active → suspended → offboarded.
--
-- Source: PostgreSQL (source of truth). Domain events via Outbox.
-- Migrations must be reversible (ADR-024).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) partner_api_credentials — hashed API keys scoped to a store
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partner_api_credentials (
  credential_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_store_id UUID NOT NULL,
  issued_by_public_id TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT ck_credential_revoked_pair
    CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE INDEX idx_credentials_tenant ON partner_api_credentials (tenant_store_id)
  WHERE state = 'active';

-- ─────────────────────────────────────────────────────────────────────
-- 2) partner_webhooks — event delivery endpoints per store
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partner_webhooks (
  webhook_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_store_id UUID NOT NULL,
  url TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  event_types TEXT[] NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'paused', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT ck_webhook_deleted_pair
    CHECK ((state = 'deleted') = (deleted_at IS NOT NULL))
);

CREATE INDEX idx_webhooks_tenant ON partner_webhooks (tenant_store_id)
  WHERE state = 'active';

-- ─────────────────────────────────────────────────────────────────────
-- 3) partner_usage_counters — rate limit counters per store
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partner_usage_counters (
  tenant_store_id UUID NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  api_calls BIGINT NOT NULL DEFAULT 0,
  webhook_deliveries BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_store_id, window_start)
);

-- ─────────────────────────────────────────────────────────────────────
-- 4) partner_audit_log — append-only audit trail
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partner_audit_log (
  entry_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_public_id TEXT NOT NULL,
  tenant_store_id UUID NOT NULL,
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 5) partner_lifecycle — onboarding state per store
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partner_lifecycle (
  tenant_store_id UUID PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'approved', 'active', 'suspended', 'offboarded')),
  sla_tier TEXT NOT NULL DEFAULT 'standard'
    CHECK (sla_tier IN ('standard', 'enterprise')),
  suspended_reason TEXT,
  suspended_at TIMESTAMPTZ,
  offboarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_suspended_pair
    CHECK ((state = 'suspended') = (suspended_at IS NOT NULL)),
  CONSTRAINT ck_offboarded_pair
    CHECK ((state = 'offboarded') = (offboarded_at IS NOT NULL))
);

COMMIT;
