-- WASLA Billing & Fees — Database Schema (Phase 17 · ADR-050)
-- Port 8096. No FK crossing service boundary. No PII columns.

-- Invoice lifecycle table (stateful — current state)
CREATE TABLE IF NOT EXISTS billing_invoices (
  invoice_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_public_id    TEXT NOT NULL,  -- WS-########## — no FK to marketplace
  period             TEXT NOT NULL,  -- e.g. "2026-09"
  state              TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'issued', 'paid', 'partially_paid', 'closed', 'void')),
  fee_type           TEXT NOT NULL CHECK (fee_type IN ('store_fixed', 'store_variable', 'subscription', 'payout')),
  amount_cents       BIGINT NOT NULL CHECK (amount_cents > 0),
  paid_amount_cents  BIGINT NOT NULL DEFAULT 0 CHECK (paid_amount_cents >= 0),
  payment_ref        TEXT,  -- external Tap reference
  settlement_id      UUID,  -- FK to billing_settlements (same service)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_at          TIMESTAMPTZ,
  paid_at            TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  voided_at          TIMESTAMPTZ,

  -- Payment only allowed in issued or partially_paid
  CONSTRAINT billing_payment_gate CHECK (
    state NOT IN ('issued', 'partially_paid') OR paid_amount_cents <= amount_cents
  ),

  -- Void only from draft, issued, partially_paid, paid
  CONSTRAINT billing_void_gate CHECK (
    state != 'void' OR voided_at IS NOT NULL
  ),

  -- Closed requires paid_at
  CONSTRAINT billing_close_gate CHECK (
    state != 'closed' OR paid_at IS NOT NULL
  )
);

-- Settlement table (fee settlement records)
CREATE TABLE IF NOT EXISTS billing_settlements (
  settlement_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id         UUID NOT NULL REFERENCES billing_invoices(invoice_id),
  fee_type           TEXT NOT NULL CHECK (fee_type IN ('store_fixed', 'store_variable', 'subscription', 'payout')),
  amount_cents       BIGINT NOT NULL CHECK (amount_cents > 0),
  period             TEXT NOT NULL,
  state              TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'settled', 'failed')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at         TIMESTAMPTZ
);

-- Outbox for transactional event publishing (ADR-050 §5)
CREATE TABLE IF NOT EXISTS billing_outbox (
  event_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type         TEXT NOT NULL CHECK (event_type IN ('billing.invoice_issued', 'billing.fee_settled', 'billing.payout_requested')),
  event_version      TEXT NOT NULL DEFAULT 'v1',
  aggregate_id       UUID NOT NULL,
  payload            JSONB NOT NULL,
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at       TIMESTAMPTZ,
  publish_attempts   INTEGER NOT NULL DEFAULT 0
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_billing_invoices_store ON billing_invoices (store_public_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_state ON billing_invoices (state);
CREATE INDEX IF NOT EXISTS idx_billing_settlements_invoice ON billing_settlements (invoice_id);
CREATE INDEX IF NOT EXISTS idx_billing_outbox_unpublished ON billing_outbox (published_at) WHERE published_at IS NULL;
