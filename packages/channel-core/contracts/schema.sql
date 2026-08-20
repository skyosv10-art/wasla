-- WASLA Channel Layer — Data Contract (PostgreSQL DDL)
-- Phase 03 — Telegram Channel Foundation
--
-- المبدأ الجوهري (ADR-007):
--   - الجداول **محايدة للقناة**: العمود channel يُفرّق بين telegram/web/mobile/whatsapp.
--     لا يوجد أي عمود أو جدول باسم telegram_* — تفاصيل القناة تبقى داخل المُهيّئ.
--   - Idempotency للمدخل: (channel, bot, channel_update_id) فريد → التحديث المكرر
--     لا يُعالَج مرتين ولا يُصدر حدثاً.
--   - Idempotency للمخرج: (channel, idempotency_key) فريد → لا إرسال مزدوج عند
--     إعادة المحاولة.
--   - **لا FK إلى identity_users**: chat_ref مرجع opaque. ربط chat_ref ↔ wasla_public_id
--     ملك خدمة Identity (ADR-001) — طبقة القنوات لا تُخزّنه.
--   - Domain Events عبر Outbox من البداية (channel_outbox) — لا نشر مباشر.
--
-- ملاحظة تنفيذية: MR [1] يوثّق العقد فقط. مُهيّئات Postgres تُنفّذ في MR [5]
--   من خطة المرحلة 03؛ حتى ذلك الحين تعمل المنافذ بمُهيّئات in-memory (موثّق في ADR-007).
-- الترقيم: أي ترحيل (migration) يجب أن يكون عكوساً (reversible) وموثّقاً في TASK_LOG.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) channel_updates — سجل التحديثات الواردة (Update Intake + De-duplication)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channel_updates (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    channel            TEXT         NOT NULL
                       CHECK (channel IN ('telegram','web','mobile','whatsapp')),
    bot                TEXT         NOT NULL
                       CHECK (bot IN ('customer','driver','partner')),
    channel_update_id  TEXT         NOT NULL,                     -- معرّف التحديث كما وردت من القناة (نصّي)
    chat_ref           TEXT         NOT NULL,                     -- مرجع المحادثة (opaque) — لا FK
    kind               TEXT         NOT NULL
                       CHECK (kind IN ('command','text_message','callback','contact','location','group_event','unsupported')),
    command            TEXT,                                      -- اسم الأمر بدون '/' عند kind='command'
    status             TEXT         NOT NULL DEFAULT 'processed'
                       CHECK (status IN ('processed','skipped','failed')),
    received_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    processed_at       TIMESTAMPTZ,
    trace_id           TEXT
);

-- Idempotency: نفس التحديث من نفس البوت لا يُسجَّل مرتين
CREATE UNIQUE INDEX IF NOT EXISTS ux_channel_updates_dedup
    ON channel_updates (channel, bot, channel_update_id);

CREATE INDEX IF NOT EXISTS ix_channel_updates_chat
    ON channel_updates (channel, chat_ref, received_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 2) channel_deliveries — سجل الرسائل الصادرة (Message Delivery + Retry)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channel_deliveries (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    channel            TEXT         NOT NULL
                       CHECK (channel IN ('telegram','web','mobile','whatsapp')),
    chat_ref           TEXT         NOT NULL,                     -- مرجع opaque — لا FK
    idempotency_key    TEXT         NOT NULL,
    kind               TEXT         NOT NULL
                       CHECK (kind IN ('text','text_with_buttons')),
    -- جسم الرسالة كما قُبل (نص + نوايا أزرار محيّدة). أُضيف في MR 2 بعد أن
    -- أثبتت النواة أن إعادة المحاولة تُرسل *نفس* الرسالة، فلا يمكن إعادة بنائها
    -- من المُنادي لاحقاً. لا يحتوي أي حقل خاص بقناة.
    body               JSONB        NOT NULL,
    -- البوت المالك — يُستخدم فقط لعزو حدث channel.mini_app.launched عند النجاح.
    bot                TEXT
                       CHECK (bot IS NULL OR bot IN ('customer','driver','partner')),
    priority           TEXT         NOT NULL DEFAULT 'normal'
                       CHECK (priority IN ('critical','high','normal','low')),
    status             TEXT         NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued','sent','failed')),
    attempts           INTEGER      NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts       INTEGER      NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
    next_attempt_at    TIMESTAMPTZ,                               -- backoff أسّي (يُحسب في الـCore)
    last_error_code    TEXT,                                      -- كود من كتالوج errors.md
    last_error_at      TIMESTAMPTZ,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    sent_at            TIMESTAMPTZ,
    trace_id           TEXT,
    version            INTEGER      NOT NULL DEFAULT 1            -- optimistic concurrency
);

-- Idempotency: نفس المفتاح لا يُرسل مرتين على نفس القناة
CREATE UNIQUE INDEX IF NOT EXISTS ux_channel_deliveries_idempotency
    ON channel_deliveries (channel, idempotency_key);

-- طابور إعادة المحاولة: الأولوية أولاً ثم وقت المحاولة القادمة
CREATE INDEX IF NOT EXISTS ix_channel_deliveries_retry_queue
    ON channel_deliveries (status, next_attempt_at)
    WHERE status = 'queued';

-- ─────────────────────────────────────────────────────────────────────
-- 3) channel_outbox — أحداث المجال (Outbox Pattern)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channel_outbox (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type TEXT         NOT NULL DEFAULT 'channel_chat'
                   CHECK (aggregate_type = 'channel_chat'),
    aggregate_id   TEXT         NOT NULL,                          -- chat_ref
    event_type     TEXT         NOT NULL,                          -- channel.update.received | channel.message.delivered | ...
    event_version  TEXT         NOT NULL DEFAULT 'v1'
                   CHECK (event_version ~ '^v[0-9]+$'),
    payload        JSONB        NOT NULL,
    occurred_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ,
    trace_id       TEXT
);

CREATE INDEX IF NOT EXISTS ix_channel_outbox_unpublished
    ON channel_outbox (occurred_at)
    WHERE published_at IS NULL;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- مؤجّل صراحة (خارج نطاق المرحلة 03) — يُنفّذ بعقد + ADR لاحقين:
--   - channel_deep_link_tokens: روابط عميقة معتمة/منتهية الصلاحية (Phase 03 يستخدم
--     ترميزاً stateless بـbase64url بحد 64 حرفاً — لا حالة مخزّنة).
--   - channel_group_bindings: ربط مجموعات الدعم/التصعيد بسياق الطلب (يحتاج خدمة
--     support — Phase 08).
--   - channel_rate_budgets: حدود المعدّل لكل chat/bot إن احتجنا حالة مشتركة بين
--     أكثر من نسخة تشغيل (Phase 03 يستخدم عدّاداً in-process).
-- ─────────────────────────────────────────────────────────────────────
