-- WASLA Search Service — Data Contract (PostgreSQL DDL)
-- Phase 12 — Marketplace Search (نموذجُ قراءةٍ مشتقٌّ لا مصدرُ حقيقةٍ)
--
-- المبدأ الجوهري (ADR-025):
--   - **الفهرسُ نموذجُ قراءةٍ مشتقٌّ، لا مصدرُ حقيقةٍ**: `search_product_index`
--     إسقاطٌ قابلٌ لإعادةِ البناءِ من أحداثِ السوقِ في أيِّ لحظةٍ. مصدرُ
--     الحقيقةِ لقراراتِ السوقِ هو `stores.state`/`products.moderation_state`
--     (ADR-016). لا قيمةَ لما في الفهرسِ إن لم تُثبتِ الأحداثُ أنّهُ صحيحٌ.
--   - **الظهورُ يُعادُ بناؤُهُ من الحالةِ لا يُخزَّنُ رايةً**: لا عمودَ
--     `is_visible`. شرطُ الظهورِ (متجرٌ approved · منتجٌ published · اعتدالٌ
--     approved · كميّةٌ > 0) يُتحقَّقُ منهُ عند بناءِ الوثيقةِ، فلا تُبنى
--     وثيقةٌ لمنتجٍ غيرِ ظاهرٍ أصلًا (ADR-016 القرارُ 3).
--   - **لا تزاوجٌ مباشرٌ عبرَ الحدِّ**: الفهرسُ ملكٌ لطورِ البحثِ وحدَهُ. لا
--     `JOIN` إلى جداولِ السوقِ. الاستهلاكُ من outbox السوقِ (مراجعةٌ لاحقةٌ)،
--     وإعادةُ البناءِ الكاملةُ من منفذِ قراءةٍ مُصرَّحٍ بهِ.
--   - **البحثُ ثنائيُّ اللغةِ والترتيبُ مفسَّرٌ**: `tsvector` للإنجليزيِّ
--     (`english`)، و`simple` مُطَبَّعٌ للعربيِّ مع `pg_trgm` لمطابقةِ الأخطاءِ
--     والبادئاتِ. الترتيبُ قواعدٌ مقروءةٌ: exact > prefix > fts > trigram.
--   - **لا حذفَ صلبٌ**: النهايةُ `archived` (حذفٌ ناعمٌ) — متوافقٌ مع ADR-016
--     القرارُ 8/9. الحذفُ من الفهرسِ يعني عدمَ بناءِ وثيقةٍ للمنتجِ المُخفى.
--
-- المصدر: PostgreSQL (source of truth للفهرسِ نفسِه). Domain Events عبر
-- Outbox من البداية. الترقيم: أيُّ ترحيلٍ يجبُ أن يكونَ عكوساً (reversible)
-- وموثَّقاً في TASK_LOG (ADR-024).

BEGIN;

-- تفعيلُ امتدادِ pg_trgm لمطابقةِ الأخطاءِ الإملائيّةِ والبادئاتِ.
-- (متوفّرٌ في PostgreSQL، لا حزمةً خارجيّةً.)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─────────────────────────────────────────────────────────────────────
-- 1) search_product_index — وثيقةُ فهرسِ المنتجِ (نموذجُ قراءةٍ مشتقٌّ)
--    كلُّ صفٍّ وثيقةُ منتجٍ واحدةٌ. تُبنى عند ظهورِ المنتجِ، وتُحدَّثُ أو
--    تُحذفُ ناعماً عند تغيُّرِ الحالةِ. لا تُبنى لمنتجٍ غيرِ ظاهرٍ.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_product_index (
    product_id          UUID        PRIMARY KEY,
    store_id            UUID        NOT NULL,
    store_slug          TEXT        NOT NULL,
    product_slug        TEXT        NOT NULL,
    category_id         UUID        NOT NULL,

    -- عناوينُ بكلِّ لغةٍ (ar إلزاميٌّ — fallback). لا JSONB (ADR-006).
    title_ar             TEXT        NOT NULL CHECK (char_length(title_ar) BETWEEN 1 AND 256),
    title_en             TEXT        CHECK (title_en IS NULL OR char_length(title_en) BETWEEN 1 AND 256),

    -- سعرٌ صحيحٌ بأصغرِ وحدةٍ (هللة). بيانُ كتالوجٍ لا معاملة (ADR-016 قرار 4).
    price_minor_units    INTEGER     NOT NULL CHECK (price_minor_units >= 0),
    currency_code        TEXT        NOT NULL CHECK (currency_code = 'SAR'),

    -- طابعٌ زمنيٌّ لآخرِ مزامنةٍ مع المصدرِ (للكشفِ عن التأخّرِ — ingestion lag).
    indexed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- الحذفُ الناعمُ: وثيقةٌ تُحذفُ ناعماً لا تُرجَعُ في نتائجِ البحثِ.
    archived_at          TIMESTAMPTZ
);

-- فهرسُ البحثِ الإنجليزيِّ (FTS).
CREATE INDEX IF NOT EXISTS ix_search_products_fts_en
    ON search_product_index
    USING gin (to_tsvector('english', coalesce(title_en, title_ar)));

-- فهرسُ البحثِ العربيِّ (simple + trigram للمطابقةِ التقريبيّةِ).
CREATE INDEX IF NOT EXISTS ix_search_products_trgm_ar
    ON search_product_index
    USING gin (title_ar gin_trgm_ops);

-- فهرسُ البادئةِ (slug/title) — مطابقةٌ تامّةٌ وبادئةٌ.
CREATE INDEX IF NOT EXISTS ix_search_products_slug
    ON search_product_index (store_slug, product_slug);

CREATE INDEX IF NOT EXISTS ix_search_products_category
    ON search_product_index (category_id)
    WHERE archived_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 2) search_outbox — Domain Events Outbox
--    أحداثُ دورةِ حياةِ الفهرسِ (بُنيَ، أُعيدَ بناؤُهُ، تدهورَ) — لا أحداثِ
--    السوقِ (تلك تُستهلَكُ لا تُنتَجُ).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_outbox (
    id            BIGSERIAL    PRIMARY KEY,
    event_id      UUID         NOT NULL UNIQUE,
    event_type    TEXT         NOT NULL,
    event_version TEXT         NOT NULL,
    aggregate_id  TEXT         NOT NULL,                      -- index_id
    payload       JSONB        NOT NULL,
    occurred_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_search_outbox_unpublished
    ON search_outbox (occurred_at)
    WHERE published_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- updated_at / archived_at triggers
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_set_indexed_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.indexed_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_search_product_index_indexed_at ON search_product_index;
CREATE TRIGGER trg_search_product_index_indexed_at BEFORE UPDATE ON search_product_index
    FOR EACH ROW EXECUTE FUNCTION search_set_indexed_at();

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- التراجع (rollback) — يُحذف بترتيب عكسي للتبعيات.
-- ─────────────────────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_search_product_index_indexed_at ON search_product_index;
-- DROP FUNCTION IF EXISTS search_set_indexed_at();
-- DROP TABLE IF EXISTS search_outbox;
-- DROP TABLE IF EXISTS search_product_index;
