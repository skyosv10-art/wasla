-- WASLA Support & Escalation — Database Schema (Phase 16 · ADR-049)
-- Port 8095. No FK crossing service boundary. No PII columns.

-- Ticket lifecycle table (stateful — current state)
CREATE TABLE IF NOT EXISTS support_tickets (
  ticket_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type        TEXT NOT NULL CHECK (ticket_type IN ('order_issue', 'behavior_complaint', 'payment_dispute', 'service_quality')),
  state              TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'investigating', 'escalated', 'resolved', 'closed')),
  escalation_level   TEXT CHECK (escalation_level IN ('support_agent', 'support_supervisor', 'admin')),
  reporter_public_id TEXT NOT NULL,  -- WS-########## — no FK to customers table
  subject_public_id  TEXT,           -- WS-########## or NULL
  order_public_id    TEXT,           -- ORD-########## or NULL — no FK to orders table
  resolution_reason  TEXT CHECK (resolution_reason IN ('refund_issued', 'warning_sent', 'no_action_needed', 'escalated_to_admin')),
  evidence_id        UUID,           -- FK to support_evidence (same service)
  opened_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  investigating_at   TIMESTAMPTZ,
  escalated_at       TIMESTAMPTZ,
  resolved_at        TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Evidence gate: cannot enter investigating without evidence
  CONSTRAINT support_evidence_gate CHECK (
    state = 'open' OR evidence_id IS NOT NULL
  ),

  -- Resolution requires a reason
  CONSTRAINT support_resolution_gate CHECK (
    state NOT IN ('resolved', 'closed') OR resolution_reason IS NOT NULL
  ),

  -- Closed requires resolved first
  CONSTRAINT support_no_skip_closed CHECK (
    state != 'closed' OR resolved_at IS NOT NULL
  )
);

-- Evidence table (append-only metadata — no binary blobs)
CREATE TABLE IF NOT EXISTS support_evidence (
  evidence_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      UUID NOT NULL REFERENCES support_tickets(ticket_id),
  evidence_type  TEXT NOT NULL CHECK (evidence_type IN ('photo', 'message', 'order_log')),
  content_hash   TEXT NOT NULL,  -- sha256 of the content
  storage_ref    TEXT NOT NULL,  -- external storage reference
  attached_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Outbox for transactional event publishing (ADR-049 §6)
CREATE TABLE IF NOT EXISTS support_outbox (
  event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT NOT NULL CHECK (event_type IN ('support.ticket_opened', 'support.ticket_escalated', 'support.ticket_resolved')),
  event_version   TEXT NOT NULL DEFAULT 'v1',
  aggregate_id    UUID NOT NULL,
  payload         JSONB NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at    TIMESTAMPTZ,
  publish_attempts INTEGER NOT NULL DEFAULT 0
);

-- Index for unpublished events (relay consumer)
CREATE INDEX IF NOT EXISTS idx_support_outbox_unpublished
  ON support_outbox (occurred_at)
  WHERE published_at IS NULL;
