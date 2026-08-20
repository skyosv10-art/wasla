-- WASLA Geography & Localization Service — Data Contract (PostgreSQL DDL)
-- Phase 02 — Geography & Localization Foundation
--
-- المبدأ الجوهري (ADR-006):
--   - التسلسل الهرمي الجغرافي: Country → Region → City → District → Zone.
--   - كل مستوى له معرّف UUID ثابت + كود readable فريد ضمن سياقه.
--   - أسماء مترجمة (AR/EN/UR) في جداول *_names منفصلة لكل مستوى — لا JSONB.
--   - موقع المستخدم (geo_user_locations) يُخزّن wasla_public_id كمرجع opaque
--     (CHECK ^WS-[0-9]{10}$) — **لا FK إلى identity_users** (تغليف بين الخدمات).
--   - تغيير الموقع لا يُنشئ هوية جديدة (Identity مستقر) — يُسجَّل في history + outbox.
--
-- المصدر: PostgreSQL (source of truth). Domain Events عبر Outbox من البداية.
-- الترقيم: أي ترحيل (migration) يجب أن يكون عكوساً (reversible) وموثّقاً في TASK_LOG.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) geo_countries — البلدان
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geo_countries (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT         NOT NULL,                        -- ISO 3166-1 alpha-2 (مثال: SA)
    iso3        TEXT         NOT NULL,                        -- ISO 3166-1 alpha-3 (مثال: SAU)
    status      TEXT         NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','inactive')),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    version     INTEGER      NOT NULL DEFAULT 1               -- optimistic concurrency
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_geo_countries_code ON geo_countries (code);

-- ─────────────────────────────────────────────────────────────────────
-- 2) geo_regions — المناطق/الإمارات ضمن بلد
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geo_regions (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id UUID         NOT NULL REFERENCES geo_countries(id) ON DELETE RESTRICT,
    code        TEXT         NOT NULL,                        -- كود محلي فريد ضمن البلد
    status      TEXT         NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','inactive')),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    version     INTEGER      NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_geo_regions_country_code ON geo_regions (country_id, code);

-- ─────────────────────────────────────────────────────────────────────
-- 3) geo_cities — المدن ضمن منطقة
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geo_cities (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    region_id   UUID         NOT NULL REFERENCES geo_regions(id) ON DELETE RESTRICT,
    code        TEXT         NOT NULL,
    status      TEXT         NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','inactive')),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    version     INTEGER      NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_geo_cities_region_code ON geo_cities (region_id, code);

-- ─────────────────────────────────────────────────────────────────────
-- 4) geo_districts — الأحياء/المقاطعات ضمن مدينة
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geo_districts (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id     UUID         NOT NULL REFERENCES geo_cities(id) ON DELETE RESTRICT,
    code        TEXT         NOT NULL,
    status      TEXT         NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','inactive')),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    version     INTEGER      NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_geo_districts_city_code ON geo_districts (city_id, code);

-- ─────────────────────────────────────────────────────────────────────
-- 5) geo_zones — المناطق الفرعية/النقاط ضمن حي
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geo_zones (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    district_id UUID         NOT NULL REFERENCES geo_districts(id) ON DELETE RESTRICT,
    code        TEXT         NOT NULL,
    status      TEXT         NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','inactive')),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    version     INTEGER      NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_geo_zones_district_code ON geo_zones (district_id, code);

-- ─────────────────────────────────────────────────────────────────────
-- 6) جداول الأسماء المترجمة — اسم واحد لكل (كيان، locale)
--    locale ∈ ('ar','en','ur'). ar = اللغة الافتراضية/الأساسية (fallback).
--    جداول منفصلة (لا JSONB): تكامل مرجعي + قيد فرادة + فهرسة + fallback نظيف.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geo_country_names (
    country_id  UUID         NOT NULL REFERENCES geo_countries(id) ON DELETE CASCADE,
    locale      TEXT         NOT NULL CHECK (locale IN ('ar','en','ur')),
    name        TEXT         NOT NULL,
    PRIMARY KEY (country_id, locale)
);

CREATE TABLE IF NOT EXISTS geo_region_names (
    region_id   UUID         NOT NULL REFERENCES geo_regions(id) ON DELETE CASCADE,
    locale      TEXT         NOT NULL CHECK (locale IN ('ar','en','ur')),
    name        TEXT         NOT NULL,
    PRIMARY KEY (region_id, locale)
);

CREATE TABLE IF NOT EXISTS geo_city_names (
    city_id     UUID         NOT NULL REFERENCES geo_cities(id) ON DELETE CASCADE,
    locale      TEXT         NOT NULL CHECK (locale IN ('ar','en','ur')),
    name        TEXT         NOT NULL,
    PRIMARY KEY (city_id, locale)
);

CREATE TABLE IF NOT EXISTS geo_district_names (
    district_id UUID         NOT NULL REFERENCES geo_districts(id) ON DELETE CASCADE,
    locale      TEXT         NOT NULL CHECK (locale IN ('ar','en','ur')),
    name        TEXT         NOT NULL,
    PRIMARY KEY (district_id, locale)
);

CREATE TABLE IF NOT EXISTS geo_zone_names (
    zone_id     UUID         NOT NULL REFERENCES geo_zones(id) ON DELETE CASCADE,
    locale      TEXT         NOT NULL CHECK (locale IN ('ar','en','ur')),
    name        TEXT         NOT NULL,
    PRIMARY KEY (zone_id, locale)
);

-- ─────────────────────────────────────────────────────────────────────
-- 7) geo_user_locations — الموقع الحالي للمستخدم
--    المرجع للهوية: wasla_public_id (opaque، CHECK ^WS-[0-9]{10}$).
--    **لا FK إلى identity_users** — تغليف بين الخدمات (ADR-006).
--    المستخدم له صف واحد (موقع حالي)؛ تغيير الموقع يحدّثه + يُسجّل في history.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geo_user_locations (
    wasla_public_id TEXT      PRIMARY KEY
                    CHECK (wasla_public_id ~ '^WS-[0-9]{10}$'),
    zone_id         UUID      NOT NULL REFERENCES geo_zones(id) ON DELETE RESTRICT,
    source          TEXT      NOT NULL
                    CHECK (source IN ('customer_bot','driver_bot','partner_bot','admin','system')),
    effective_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER   NOT NULL DEFAULT 1               -- optimistic concurrency
);

CREATE INDEX IF NOT EXISTS ix_geo_user_locations_zone ON geo_user_locations (zone_id);

-- ─────────────────────────────────────────────────────────────────────
-- 8) geo_user_location_history — سجل تغييرات موقع المستخدم
--    تغيير الموقع لا يُنشئ هوية جديدة — يُسجَّل هنا + حدث في outbox.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geo_user_location_history (
    id                BIGSERIAL   PRIMARY KEY,
    wasla_public_id  TEXT         NOT NULL
                      CHECK (wasla_public_id ~ '^WS-[0-9]{10}$'),
    old_zone_id       UUID,                                -- null عند أول تعيين
    new_zone_id       UUID         NOT NULL REFERENCES geo_zones(id) ON DELETE RESTRICT,
    changed_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    source            TEXT         NOT NULL
                      CHECK (source IN ('customer_bot','driver_bot','partner_bot','admin','system'))
);

CREATE INDEX IF NOT EXISTS ix_geo_user_location_history_user
    ON geo_user_location_history (wasla_public_id, changed_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 9) geo_outbox — Domain Events Outbox (تُنشر لاحقاً إلى Kafka دون إعادة تصميم)
--    aggregate_id = wasla_public_id (الكيان المعني بالحدث = المستخدم).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geo_outbox (
    id            BIGSERIAL    PRIMARY KEY,
    event_id      UUID         NOT NULL UNIQUE,
    event_type    TEXT         NOT NULL,
    event_version TEXT         NOT NULL,
    aggregate_id  TEXT         NOT NULL,                      -- wasla_public_id
    payload       JSONB        NOT NULL,
    occurred_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_geo_outbox_unpublished ON geo_outbox (occurred_at) WHERE published_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- updated_at triggers (لكل جدول له updated_at)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION geo_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_geo_countries_updated_at ON geo_countries;
CREATE TRIGGER trg_geo_countries_updated_at BEFORE UPDATE ON geo_countries
    FOR EACH ROW EXECUTE FUNCTION geo_set_updated_at();

DROP TRIGGER IF EXISTS trg_geo_regions_updated_at ON geo_regions;
CREATE TRIGGER trg_geo_regions_updated_at BEFORE UPDATE ON geo_regions
    FOR EACH ROW EXECUTE FUNCTION geo_set_updated_at();

DROP TRIGGER IF EXISTS trg_geo_cities_updated_at ON geo_cities;
CREATE TRIGGER trg_geo_cities_updated_at BEFORE UPDATE ON geo_cities
    FOR EACH ROW EXECUTE FUNCTION geo_set_updated_at();

DROP TRIGGER IF EXISTS trg_geo_districts_updated_at ON geo_districts;
CREATE TRIGGER trg_geo_districts_updated_at BEFORE UPDATE ON geo_districts
    FOR EACH ROW EXECUTE FUNCTION geo_set_updated_at();

DROP TRIGGER IF EXISTS trg_geo_zones_updated_at ON geo_zones;
CREATE TRIGGER trg_geo_zones_updated_at BEFORE UPDATE ON geo_zones
    FOR EACH ROW EXECUTE FUNCTION geo_set_updated_at();

DROP TRIGGER IF EXISTS trg_geo_user_locations_updated_at ON geo_user_locations;
CREATE TRIGGER trg_geo_user_locations_updated_at BEFORE UPDATE ON geo_user_locations
    FOR EACH ROW EXECUTE FUNCTION geo_set_updated_at();

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- التراجع (rollback) — يُحذف بترتيب عكسي للتبعيات.
-- ─────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS geo_outbox;
-- DROP TABLE IF EXISTS geo_user_location_history;
-- DROP TABLE IF EXISTS geo_user_locations;
-- DROP TABLE IF EXISTS geo_zone_names;
-- DROP TABLE IF EXISTS geo_district_names;
-- DROP TABLE IF EXISTS geo_city_names;
-- DROP TABLE IF EXISTS geo_region_names;
-- DROP TABLE IF EXISTS geo_country_names;
-- DROP TABLE IF EXISTS geo_zones;
-- DROP TABLE IF EXISTS geo_districts;
-- DROP TABLE IF EXISTS geo_cities;
-- DROP TABLE IF EXISTS geo_regions;
-- DROP TABLE IF EXISTS geo_countries;
-- DROP FUNCTION IF EXISTS geo_set_updated_at();
