-- WASLA Customer Core Service — Data Contract (PostgreSQL DDL)
-- Phase 04 — Customer Core
--
-- المبدأ الجوهري (ADR-009):
--   - ملف العميل ملفُّ **دور**: مفتاحه wasla_public_id كمرجع opaque (CHECK ^WS-[0-9]{10}$)
--     **بلا FK إلى identity_users** — تغليف بين الخدمات، ووجوده لا يمنع ملف سائق للشخص نفسه (§7).
--   - zone_id مرجع opaque إلى هرم الجغرافيا **بلا FK إلى geo_zones**: خدمة أخرى وقاعدة أخرى.
--     التحقّق من وجود المنطقة ونشاطها يمرّ بـGeographyPort لا بقيد قاعدة بيانات.
--   - الإحداثية اختيارية وللعرض/التسليم فقط: لا تُقرّر تغطية ولا مطابقة ولا مسافة في هذه المرحلة.
--   - المال **عدد صحيح بالوحدة الصغرى** (offered_amount_minor) — لا عدد عشري في المال أبداً.
--   - الخدمة لا تملك آلة حالة الطلب (§15 · Phase 06): status هنا حالة **التسليم** لا حالة الطلب،
--     و order_public_id مرجع يملكه محرّك الطلبات ويبقى NULL حتى يُقبل التسليم.
--   - Idempotency شرط كتابة لا رفاهية (§43): مدخل النظام بوت، وضغط الزر مرّتين حالة عادية.
--
-- المصدر: PostgreSQL (source of truth). Domain Events عبر Outbox من البداية.
-- الترقيم: أي ترحيل (migration) يجب أن يكون عكوساً (reversible) وموثّقاً في TASK_LOG.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) customer_profiles — ملف العميل (ملفُّ دور لمستخدم قائم)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_profiles (
    wasla_public_id   TEXT        PRIMARY KEY
                      CHECK (wasla_public_id ~ '^WS-[0-9]{10}$'),
    display_name      TEXT        CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 80),
    preferred_locale  TEXT        NOT NULL DEFAULT 'ar'
                      CHECK (preferred_locale IN ('ar','en','ur')),
    default_zone_id   UUID,                                   -- مرجع opaque إلى الجغرافيا (بلا FK)
    status            TEXT        NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','suspended')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 2) customer_saved_places — الأماكن المحفوظة
--    التسمية فريدة لكل عميل (بلا حساسية حالة الأحرف): «البيت» مرّتين تعني أن المستخدم
--    لا يعرف أيّهما يختار، وهي حالة يجب أن تُرفض لا أن تُحفظ.
--    الحدّ الأقصى للعدد يُطبَّق في طبقة الاستعمال (موثّق في CUSTOMER_CORE.md) لأنه سياسة
--    قابلة للتغيير لكل عميل لاحقاً، لا ثابت مخطّط.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_saved_places (
    id                UUID        PRIMARY KEY,
    wasla_public_id   TEXT        NOT NULL
                      CHECK (wasla_public_id ~ '^WS-[0-9]{10}$'),
    label             TEXT        NOT NULL
                      CHECK (char_length(label) BETWEEN 1 AND 60),
    zone_id           UUID        NOT NULL,                   -- مرجع opaque إلى الجغرافيا (بلا FK)
    address_text      TEXT        CHECK (address_text IS NULL OR char_length(address_text) <= 160),
    latitude          NUMERIC(8,6)  CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
    longitude         NUMERIC(9,6)  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    idempotency_key   TEXT        NOT NULL
                      CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
    last_used_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- إحداثية نصف مكتملة أسوأ من لا إحداثية: تُقبل الاثنتان أو لا شيء.
    CONSTRAINT ck_customer_saved_places_coordinates_complete
        CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_saved_places_label
    ON customer_saved_places (wasla_public_id, lower(label));

CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_saved_places_idempotency
    ON customer_saved_places (wasla_public_id, idempotency_key);

CREATE INDEX IF NOT EXISTS ix_customer_saved_places_owner
    ON customer_saved_places (wasla_public_id, last_used_at DESC NULLS LAST, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 3) customer_order_requests — نيّة طلب العميل بعد التحقّق
--    status = حالة **التسليم إلى المحرّك** لا حالة الطلب (§15 لمحرّك الطلبات).
--    order_public_id يملكه المحرّك: NULL حتى يقبل التسليم (ADR-009 §3).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_order_requests (
    id                    UUID        PRIMARY KEY,
    wasla_public_id       TEXT        NOT NULL
                          CHECK (wasla_public_id ~ '^WS-[0-9]{10}$'),
    idempotency_key       TEXT        NOT NULL
                          CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
    status                TEXT        NOT NULL
                          CHECK (status IN ('submitted','submission_failed')),
    order_type            TEXT        NOT NULL
                          CHECK (order_type IN ('ride','delivery')),
    vehicle_class         TEXT        NOT NULL
                          CHECK (vehicle_class IN ('sedan','suv','van','pickup','motorcycle','truck_small')),
    price_mode            TEXT        NOT NULL
                          CHECK (price_mode IN ('customer_offer','negotiable')),
    offered_amount_minor  BIGINT      CHECK (offered_amount_minor IS NULL OR offered_amount_minor > 0),
    currency              TEXT        CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
    shipment_type         TEXT        CHECK (shipment_type IS NULL OR shipment_type IN ('parcel','documents','food','goods','other')),
    shipment_description  TEXT        CHECK (shipment_description IS NULL OR char_length(shipment_description) <= 300),
    weight_kg             NUMERIC(9,3) CHECK (weight_kg IS NULL OR (weight_kg >= 0 AND weight_kg <= 3000)),
    notes                 TEXT        CHECK (notes IS NULL OR char_length(notes) <= 500),
    order_public_id       TEXT,                               -- مرجع من محرّك الطلبات (مالكه)
    submitted_at          TIMESTAMPTZ,
    failure_reason_code   TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- السعر وضعان صريحان لا حقل اختياري غامض (ADR-009 §6).
    CONSTRAINT ck_customer_order_requests_price_mode CHECK (
        (price_mode = 'customer_offer' AND offered_amount_minor IS NOT NULL AND currency IS NOT NULL)
        OR
        (price_mode = 'negotiable'     AND offered_amount_minor IS NULL     AND currency IS NULL)
    ),
    -- تفاصيل الشحنة تخصّ التوصيل: مشوارٌ يحمل وزن شحنة يعني نموذجاً مكسوراً لا بياناً زائداً.
    CONSTRAINT ck_customer_order_requests_shipment_scope CHECK (
        order_type = 'delivery'
        OR (shipment_type IS NULL AND shipment_description IS NULL AND weight_kg IS NULL)
    ),
    -- التسليم الناجح يحمل وقته، والفاشل يحمل سببه.
    CONSTRAINT ck_customer_order_requests_status_coherence CHECK (
        (status = 'submitted'         AND submitted_at IS NOT NULL AND failure_reason_code IS NULL)
        OR
        (status = 'submission_failed' AND failure_reason_code IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_order_requests_idempotency
    ON customer_order_requests (wasla_public_id, idempotency_key);

CREATE INDEX IF NOT EXISTS ix_customer_order_requests_owner
    ON customer_order_requests (wasla_public_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_order_requests_order_public_id
    ON customer_order_requests (order_public_id) WHERE order_public_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 4) customer_order_request_stops — نقاط الطلب مرتّبة
--    قائمة لا عمودان: قيد المرحلة (نقطتان بالضبط) يُطبَّق في طبقة الاستعمال،
--    فيرفع Multi-stop (§3.2) القيد في مرحلته **بلا هجرة** (ADR-009 §5).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_order_request_stops (
    order_request_id  UUID        NOT NULL
                      REFERENCES customer_order_requests(id) ON DELETE CASCADE,
    sequence          INTEGER     NOT NULL CHECK (sequence >= 1),
    kind              TEXT        NOT NULL CHECK (kind IN ('pickup','dropoff')),
    zone_id           UUID        NOT NULL,                   -- مرجع opaque إلى الجغرافيا (بلا FK)
    label             TEXT        CHECK (label IS NULL OR char_length(label) <= 160),
    latitude          NUMERIC(8,6)  CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
    longitude         NUMERIC(9,6)  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    source            TEXT        NOT NULL
                      CHECK (source IN ('map','telegram_location','link','text_search','saved_place','manual_zone')),
    saved_place_id    UUID,                                   -- بلا FK: حذف المكان لا يُبطل طلباً ماضياً
    PRIMARY KEY (order_request_id, sequence),
    CONSTRAINT ck_customer_order_request_stops_coordinates_complete
        CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE INDEX IF NOT EXISTS ix_customer_order_request_stops_zone
    ON customer_order_request_stops (zone_id);

-- ─────────────────────────────────────────────────────────────────────
-- 5) customer_outbox — Domain Events Outbox
--    aggregate_id = wasla_public_id للأحداث الشخصية، أو معرّف طلب العميل لأحداث الطلب.
--    قاعدة الخصوصية في events.json: الحمولة على مستوى المنطقة الفرعية،
--    بلا إحداثيات خام وبلا نصوص كتبها المستخدم.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_outbox (
    id            BIGSERIAL    PRIMARY KEY,
    event_id      UUID         NOT NULL UNIQUE,
    event_type    TEXT         NOT NULL,
    event_version TEXT         NOT NULL,
    aggregate_type TEXT        NOT NULL
                  CHECK (aggregate_type IN ('customer','customer_order_request')),
    aggregate_id  TEXT         NOT NULL,
    payload       JSONB        NOT NULL,
    occurred_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_customer_outbox_unpublished
    ON customer_outbox (occurred_at) WHERE published_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION customer_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customer_profiles_updated_at ON customer_profiles;
CREATE TRIGGER trg_customer_profiles_updated_at BEFORE UPDATE ON customer_profiles
    FOR EACH ROW EXECUTE FUNCTION customer_set_updated_at();

DROP TRIGGER IF EXISTS trg_customer_saved_places_updated_at ON customer_saved_places;
CREATE TRIGGER trg_customer_saved_places_updated_at BEFORE UPDATE ON customer_saved_places
    FOR EACH ROW EXECUTE FUNCTION customer_set_updated_at();

DROP TRIGGER IF EXISTS trg_customer_order_requests_updated_at ON customer_order_requests;
CREATE TRIGGER trg_customer_order_requests_updated_at BEFORE UPDATE ON customer_order_requests
    FOR EACH ROW EXECUTE FUNCTION customer_set_updated_at();

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- التراجع (rollback) — يُحذف بترتيب عكسي للتبعيات.
-- ─────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS customer_outbox;
-- DROP TABLE IF EXISTS customer_order_request_stops;
-- DROP TABLE IF EXISTS customer_order_requests;
-- DROP TABLE IF EXISTS customer_saved_places;
-- DROP TABLE IF EXISTS customer_profiles;
-- DROP FUNCTION IF EXISTS customer_set_updated_at();
