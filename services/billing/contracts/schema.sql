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

-- ─────────────────────────────────────────────────────────────
-- M5-17P (CLM-0375) — استدامةُ المُرحِّل: نقطةُ التفتيشِ ودفترُ الاستهلاك.
-- الدفترُ مفتاحُهُ (consumer_id, event_id): إعادةُ التسليمِ بعدَ فقدِ نقطةِ
-- التفتيشِ no-op لا تسويةٌ ثانية. ويُكتَبُ في معاملةِ التسويةِ نفسِها.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_relay_checkpoint (
  consumer_id        TEXT PRIMARY KEY CHECK (char_length(consumer_id) BETWEEN 1 AND 64),
  last_occurred_at   TIMESTAMPTZ NOT NULL,
  last_event_id      UUID NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_relay_consumed_events (
  consumer_id        TEXT NOT NULL CHECK (char_length(consumer_id) BETWEEN 1 AND 64),
  event_id           UUID NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('settled', 'recorded', 'ignored', 'ignored_foreign', 'poisoned')),
  reason             TEXT,
  settlement_id      UUID REFERENCES billing_settlements(settlement_id),
  consumed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_id, event_id),
  CONSTRAINT billing_relay_settled_has_settlement CHECK ((status = 'settled') = (settlement_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_billing_relay_consumed_poisoned ON billing_relay_consumed_events (consumer_id, consumed_at) WHERE status = 'poisoned';

-- ─────────────────────────────────────────────────────────────
-- M5-17Q (CLM-0376) — مصدرُ الحدثِ الحقيقيُّ: `store_order.*` من `delivery_outbox`.
-- لقطةُ مالِ الطلبِ من `store_order.created` (ADR-026 §2.6) في إسقاطٍ تملكُهُ
-- الفوترةُ وحدَها؛ `settlement_id` الفريدُ يجعلُ التسويةَ مرّةً واحدةً لكلِّ طلب.
-- `store_id` هوَ مرجعُ المتجرِ على الفاتورةِ (UUID السوقِ كما يحملُهُ الحدث).
-- لا حقلَ ماليَّ في `services/orders` (ADR-050 عواقب 3).
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_store_order_snapshots (
  order_id                  UUID PRIMARY KEY,
  order_public_id           TEXT NOT NULL,
  store_id                  UUID NOT NULL,
  store_slug                TEXT NOT NULL,
  currency_code             TEXT NOT NULL CHECK (currency_code = 'SAR'),
  items_total_minor_units   BIGINT NOT NULL CHECK (items_total_minor_units >= 0),
  delivery_fee_minor_units  BIGINT NOT NULL CHECK (delivery_fee_minor_units >= 0),
  source_event_id           UUID NOT NULL,
  settlement_id             UUID UNIQUE REFERENCES billing_settlements(settlement_id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
