-- WASLA Audit Service — Data Contract (PostgreSQL DDL)
-- M3-04 — Audit (خدمة سجل التدقيق)
--
-- المبدأ الجوهري (ADMIN_MVP_SPEC §6.2):
--   - السجل append-only: لا UPDATE ولا DELETE على audit_events.
--   - retention قابل للضبط (90 يوم افتراضياً، Phase 12).
--   - metadata JSONB لتفاصيل الحدث المرنة.
--
-- الترقيم: أي ترحيل (migration) يجب أن يكون عكوساً (reversible) وموثّقاً في TASK_LOG.

CREATE TABLE IF NOT EXISTS audit_events (
  id            BIGSERIAL    PRIMARY KEY,
  actor_id      TEXT         NOT NULL,
  actor_role    TEXT         NOT NULL,
  action        TEXT         NOT NULL,
  resource_type TEXT         NOT NULL,
  resource_id   TEXT         NOT NULL,
  metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_audit_events_created_at
  ON audit_events (created_at DESC);

CREATE INDEX IF NOT EXISTS ix_audit_events_actor_id
  ON audit_events (actor_id);

CREATE INDEX IF NOT EXISTS ix_audit_events_action
  ON audit_events (action);
