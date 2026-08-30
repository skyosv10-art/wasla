-- WASLA Identity Service — Data Contract (PostgreSQL DDL)
-- Phase 01 — Identity Foundation
--
-- المبدأ الجوهري (ADR-001): Wasla User ID هو الهوية الأساسية.
--   - internal_uuid : داخلي فقط، لا يُعرض للمستخدم النهائي.
--   - wasla_public_id : رقم الهوية المرئي والدائم (WS-XXXXXXXXXX).
--   - Telegram IDs / الهاتف : روابط Identity (Identity Links) مع History، وليست المفتاح الأساسي.
--
-- المصدر: PostgreSQL (source of truth). تُبنى Domain Events عبر Outbox من البداية.
-- الترقيم: أي ترحيل (migration) يجب أن يكون عكوساً (reversible) وموثّقاً في TASK_LOG.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) users — المستخدم الأساسي (Wasla identity)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS identity_users (
    internal_uuid      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    wasla_public_id    TEXT         NOT NULL UNIQUE,            -- WS-0000010427
    status             TEXT         NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','suspended','deleted','recovery_in_progress')),
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    version            INTEGER      NOT NULL DEFAULT 1          -- optimistic concurrency
);

-- تسلسل مُولّد لـ wasla_public_id (WS + 10 أرقام)
-- ملاحظة: التوليد الفعلي يُترك للتنفيذ؛ العقد يحدّد الصيغة فقط.
CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_users_public_id ON identity_users (wasla_public_id);

-- ─────────────────────────────────────────────────────────────────────
-- 2) identity_links — روابط الهوية الخارجية (Telegram / Phone / ...)
--    المفتاح الفريد هو (provider, external_id) — لا تكرار لنفس الرابط.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS identity_links (
    id                 BIGSERIAL    PRIMARY KEY,
    user_internal_uuid UUID         NOT NULL REFERENCES identity_users(internal_uuid) ON DELETE RESTRICT,
    provider           TEXT         NOT NULL
                       CHECK (provider IN ('telegram','phone','email','web','mobile')),
    external_id        TEXT         NOT NULL,                   -- telegram_user_id / phone normalized / ...
    verified           BOOLEAN      NOT NULL DEFAULT FALSE,
    linked_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (provider, external_id)                              -- منع ربط نفس المعرّف بمستخدمين مختلفين
);

CREATE INDEX IF NOT EXISTS ix_identity_links_user ON identity_links (user_internal_uuid, provider);

-- ─────────────────────────────────────────────────────────────────────
-- 3) identity_history — سجل تغييرات الهوية (Username / روابط)
--    تغيير Username لا يُنشئ مستخدمًا جديدًا — يُسجَّل هنا.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS identity_history (
    id                 BIGSERIAL    PRIMARY KEY,
    user_internal_uuid UUID         NOT NULL REFERENCES identity_users(internal_uuid) ON DELETE RESTRICT,
    field              TEXT         NOT NULL
                       CHECK (field IN ('telegram_username','phone','link','status')),
    old_value          TEXT,
    new_value          TEXT         NOT NULL,
    effective_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    source             TEXT         NOT NULL
                       CHECK (source IN ('customer_bot','driver_bot','partner_bot','recovery','admin','system'))
);

CREATE INDEX IF NOT EXISTS ix_identity_history_user_field ON identity_history (user_internal_uuid, field, effective_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 4) recovery_requests — طلبات استرجاع الحساب
--    Recovery لا يتجاوز الهوية؛ يبدأ خطوات تحقق وفق مستوى الحساب والمخاطر.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS identity_recovery_requests (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_internal_uuid UUID         NOT NULL REFERENCES identity_users(internal_uuid) ON DELETE RESTRICT,
    verification_method TEXT        NOT NULL
                       CHECK (verification_method IN ('phone_otp','email_otp','admin_assisted')),
    status             TEXT         NOT NULL DEFAULT 'verification_pending'
                       CHECK (status IN ('verification_pending','completed','rejected')),
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    resolved_at        TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────────────────
-- 5) outbox — Domain Events Outbox (تُنشر لاحقاً إلى Kafka دون إعادة تصميم)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS identity_outbox (
    id                 BIGSERIAL    PRIMARY KEY,
    event_id           UUID         NOT NULL UNIQUE,
    event_type         TEXT         NOT NULL,
    event_version      TEXT         NOT NULL,
    aggregate_id       UUID         NOT NULL,                    -- internal_uuid
    payload            JSONB        NOT NULL,
    occurred_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_identity_outbox_unpublished ON identity_outbox (occurred_at) WHERE published_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 6) identity_sessions — جلساتُ البشرِ (M1-02 · ADR-019)
--
--    منعُ الإعادةِ (replay) قيدٌ في قاعدةِ البيانات لا ذاكرةٌ في العملية:
--    `uq_identity_sessions_init_data` تجعل ثانيَ استعمالٍ لنفسِ رسالةِ
--    init-data يُخفِق بـ23505 وإن جاء إلى نسخةٍ أخرى من الخدمة. ولا يُمكن
--    لذاكرةٍ محلّيّةٍ أن تُعطيَ هذه الضمانةَ عبرَ النسخ.
--
--    ولا يُخزَّن الرمزُ (token) نفسُه بل sha256 له: تسريبُ قاعدةِ البيانات
--    لا يُسلِّم جلساتٍ قابلةً للاستعمال.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS identity_sessions (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_internal_uuid UUID         NOT NULL REFERENCES identity_users(internal_uuid) ON DELETE RESTRICT,
    actor_type         TEXT         NOT NULL DEFAULT 'customer'
                       CHECK (actor_type IN ('customer','driver','admin','support')),
    channel            TEXT         NOT NULL
                       CHECK (channel IN ('telegram','web','mobile')),
    -- sha256 للرمزِ المُعطَى للعميل (64 محرفَ hex) — الرمزُ نفسُه لا يُخزَّن.
    -- التفرّدُ مفروضٌ بـ`uq_identity_sessions_token` أدناه لا بـUNIQUE سطريّةٍ،
    -- كي لا يُنشأَ فهرسانِ لنفسِ القيد.
    token_hash         TEXT         NOT NULL
                       CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    -- بصمةُ رسالةِ init-data التي أصدرت الجلسةَ؛ NULL لقنواتٍ لا init-data لها.
    init_data_hash     TEXT
                       CHECK (init_data_hash IS NULL OR init_data_hash ~ '^[0-9a-f]{64}$'),
    issued_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at         TIMESTAMPTZ  NOT NULL,
    last_seen_at       TIMESTAMPTZ,
    revoked_at         TIMESTAMPTZ,
    revoked_reason     TEXT,
    CHECK (expires_at > issued_at),
    -- سببٌ بلا وقتٍ يعني سجلّاً يكذب: إمّا الاثنانِ أو لا شيء.
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_sessions_token
    ON identity_sessions (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_sessions_init_data
    ON identity_sessions (init_data_hash) WHERE init_data_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_identity_sessions_user
    ON identity_sessions (user_internal_uuid, issued_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- updated_at trigger
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION identity_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_identity_users_updated_at ON identity_users;
CREATE TRIGGER trg_identity_users_updated_at BEFORE UPDATE ON identity_users
    FOR EACH ROW EXECUTE FUNCTION identity_set_updated_at();

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- التراجع (rollback) — يُحذف بترتيب عكسي للتبعيات.
-- ─────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS identity_sessions;
-- DROP TABLE IF EXISTS identity_outbox;
-- DROP TABLE IF EXISTS identity_recovery_requests;
-- DROP TABLE IF EXISTS identity_history;
-- DROP TABLE IF EXISTS identity_links;
-- DROP TABLE IF EXISTS identity_users;
-- DROP FUNCTION IF EXISTS identity_set_updated_at();
