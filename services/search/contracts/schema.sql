-- WASLA Search Service — Data Contract (PostgreSQL DDL)
-- Phase 12 — Marketplace Search (نموذجُ قراءةٍ مشتقٌّ لا مصدرُ حقيقةٍ)
--
-- المبدأ الجوهري (ADR-025):
--   - **الفهرسُ نموذجُ قراءةٍ مُشتقٌّ، لا مصدرُ حقيقةٍ**: `search_product_index`
--     إسقاطٌ قابلٌ لإعادةِ البناءِ من أحداثِ السوقِ في أيِّ لحظةٍ. مصدرُ
--     الحقيقةِ لقراراتِ السوقِ هو `stores.state`/`products.moderation_state`
--     (ADR-016). لا قيمةَ لما في الفهرسِ إن لم تُثبتِ الأحداثُ أنّهُ صحيح.
--   - **الظهورُ يُعادُ بناؤُهُ من الحالةِ لا يُخزَّنُ رايةً**: لا عمودَ
--     `is_visible`. شرطُ الظهورِ (متجرٌ approved · منتجٌ published · اعتدالٌ
--     approved · كميّةٌ > 0) يُتحقَّقُ منهُ عند القراءةِ بـ`WHERE` على أعمدةِ
--     الحالةِ، فلا تُبنى رايةٌ تنسى تحديثَها (ADR-025 §2.2).
--   - **لا تزاوجٌ مباشرٌ عبرَ الحدِّ**: الفهرسُ ملكٌ لطورِ البحثِ وحدَهُ. لا
--     `JOIN` إلى جداولِ السوقِ. الاستهلاكُ من outbox السوقِ قراءةً بمنفذِ
--     قراءةٍ (ADR-025 §2.3)، وإعادةُ البناءِ الكاملةُ من منفذِ قراءةٍ
--     مُصرَّحٍ بهِ (GET /products/{productId}).
--   - **البحثُ ثنائيُّ اللغةِ والترتيبُ مفسَّرٌ**: `tsvector` للإنجليزيِّ
--     (`english`)، و`simple` مُطَبَّعٌ للعربيِّ مع `pg_trgm` لمطابقةِ الأخطاءِ
--     والبادئاتِ. الترتيبُ قواعدٌ مقروءةٌ: exact > prefix > fts > trigram.
--   - **لا حذفَ صلبٌ**: النهايةُ `archived` (حذفٌ ناعمٌ) — متوافقٌ مع ADR-016
--     القرارُ 8/9. الحذفُ من الفهرسِ يعني `archived_at` لا `DELETE`.
--
-- المصدر: PostgreSQL (source of truth للفهرسِ نفسِه). Domain Events عبر
-- Outbox من البداية. الترقيم: أيُّ ترحيلٍ يجبُ أن يكونَ عكوساً (reversible)
-- وموثَّقاً في TASK_LOG (ADR-024).
--
-- مراجعةٌ 2/N — Relay Consumer:
--   تُضافُ جداولُ حالةِ الإسقاطِ (projection state) التي يملكُها البحثُ
--   وحدَهُ: `search_marketplace_store_state` و`search_marketplace_product_state`
--   (مصدرُ الحالةِ المُستهلكةِ + التسلسلُ لكشفِ الأحداثِ القديمةِ)،
--   و`search_relay_consumed_events` (الإهمالُ + الحرفُ السامُ)،
--   و`search_relay_checkpoint` (تقدُّمُ الاستهلاكِ بـoffset يملكُهُ البحثُ).
--   ولا يكتبُ البحثُ في `marketplace_outbox` (لا `markPublished`) —
--   `published_at` دَينُ Phase 09، والتقدُّمُ ملكُ البحثِ في مخطَّطِهِ.

BEGIN;

-- تفعيلُ امتدادِ pg_trgm لمطابقةِ الأخطاءِ الإملائيّةِ والبادئاتِ.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─────────────────────────────────────────────────────────────────────
-- 1) search_product_index — وثيقةُ فهرسِ المنتجِ (نموذجُ قراءةٍ مشتقٌّ)
--    كلُّ صفٍّ وثيقةُ منتجٍ واحدةٌ قابلةٌ للبحثِ. تُبنى عند ظهورِ المنتجِ
--    (جلبُ بياناتِ الكتالوجِ من منفذِ القراءةِ)، وتُحدَّثُ أعمدةُ الحالةِ
--    عند كلِّ حدثٍ يُغيِّرُ الظهورَ. الظهورُ مُشتقٌّ عند القراءةِ بـ`WHERE`
--    على أعمدةِ الحالةِ الأربعةِ — لا رايةٌ مُخزَّنةٌ.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_product_index (
    product_id          UUID        PRIMARY KEY,
    store_id            UUID        NOT NULL,
    store_slug          TEXT        NOT NULL,
    sku                 TEXT        NOT NULL,
    category_slug       TEXT        NOT NULL,

    -- عناوينُ بكلِّ لغةٍ (ar إلزاميٌّ — fallback). لا JSONB (ADR-006).
    title_ar             TEXT        NOT NULL CHECK (char_length(title_ar) BETWEEN 1 AND 256),
    title_en             TEXT        CHECK (title_en IS NULL OR char_length(title_en) BETWEEN 1 AND 256),

    -- سعرٌ صحيحٌ بأصغرِ وحدةٍ (هللة). بيانُ كتالوجٍ لا معاملة (ADR-016 قرار 4).
    price_minor_units    INTEGER     NOT NULL CHECK (price_minor_units >= 0),
    currency_code        TEXT        NOT NULL CHECK (currency_code = 'SAR'),

    -- أعمدةُ الحالةِ المُستهلكةِ — يُشتقُّ منها الظهورُ عند القراءةِ (ADR-025 §2.2).
    -- لا عمودَ is_visible: الظهورُ = store_state='approved' AND product_state='published'
    -- AND moderation_state='approved' AND quantity_on_hand > 0 AND archived_at IS NULL.
    store_state          TEXT        NOT NULL CHECK (store_state IN ('draft','pending_review','approved','rejected','suspended','archived')),
    product_state        TEXT        NOT NULL CHECK (product_state IN ('draft','published','archived')),
    moderation_state     TEXT        NOT NULL CHECK (moderation_state IN ('pending','approved','rejected')),
    quantity_on_hand     INTEGER     NOT NULL CHECK (quantity_on_hand >= 0),

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

-- فهرسُ البادئةِ (slug/sku) — مطابقةٌ تامّةٌ وبادئةٌ.
CREATE INDEX IF NOT EXISTS ix_search_products_slug
    ON search_product_index (store_slug, sku);

CREATE INDEX IF NOT EXISTS ix_search_products_category
    ON search_product_index (category_slug)
    WHERE archived_at IS NULL;

-- فهرسُ الترشيحِ بالظهورِ — يُساعدُ الاستعلامَ على تجاوزِ الوثائقِ غيرِ الظاهرةِ.
-- الظهورُ شرطٌ مُشتقٌّ لا عمودٌ، فالفهرسُ الجزئيُّ يُغطّي أربعةً من شروطِهِ الخمسةِ.
CREATE INDEX IF NOT EXISTS ix_search_products_visible
    ON search_product_index (store_state, product_state, moderation_state, quantity_on_hand)
    WHERE archived_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 2) search_marketplace_store_state — حالةُ المتجرِ المُستهلكةُ (إسقاطٌ)
--    مصدرُ الحقيقةِ للبحثِ عن حالةِ المتجرِ. يُحدَّثُ عند كلِّ حدثِ قرارٍ
--    على متجرٍ. التسلسلُ (`state_sequence`) يكشفُ الأحداثِ القديمةَ:
--    حدثٌ بتسلسلٍ ≤ المخزَّنِ يُهمَلُ (`skipped_stale`) فلا يُرجِعُ الحالةَ
--    إلى الوراءِ.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_marketplace_store_state (
    store_id            UUID        PRIMARY KEY,
    store_slug         TEXT        NOT NULL,
    category_slug      TEXT        NOT NULL,
    store_state        TEXT        NOT NULL CHECK (store_state IN ('draft','pending_review','approved','rejected','suspended','archived')),
    state_sequence     INTEGER     NOT NULL CHECK (state_sequence >= 1),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 3) search_marketplace_product_state — حالةُ المنتجِ المُستهلكةُ (إسقاطٌ)
--    مصدرُ الحقيقةِ للبحثِ عن حالةِ المنتجِ والاعتدالِ والمخزونِ.
--    `moderation_sequence` و`adjustment_sequence` يكشفانِ الأحداثِ القديمةَ
--    لكلِّ بُعدٍ، فلا يُرجِعُ التسليمُ المُعادُ المخزونَ إلى الوراءِ.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_marketplace_product_state (
    product_id             UUID        PRIMARY KEY,
    store_id               UUID        NOT NULL,
    store_slug             TEXT        NOT NULL,
    sku                    TEXT        NOT NULL,
    category_slug          TEXT        NOT NULL,
    product_state          TEXT        NOT NULL CHECK (product_state IN ('draft','published','archived')),
    moderation_state       TEXT        NOT NULL CHECK (moderation_state IN ('pending','approved','rejected')),
    moderation_sequence    INTEGER     NOT NULL DEFAULT 0 CHECK (moderation_sequence >= 0),
    quantity_on_hand        INTEGER     NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
    adjustment_sequence    INTEGER     NOT NULL DEFAULT 0 CHECK (adjustment_sequence >= 0),
    archived_at            TIMESTAMPTZ,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_search_product_state_store
    ON search_marketplace_product_state (store_id)
    WHERE archived_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 4) search_outbox — Domain Events Outbox (أحداثُ دورةِ حياةِ الفهرسِ)
--    أحداثُ دورةِ حياةِ الفهرسِ (بُنيَ، أُعيدَ بناؤُهُ، تدهورَ) — لا أحداثِ
--    السوقِ (تلك تُستهلَكُ لا تُنتَجُ).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_outbox (
    id            BIGSERIAL    PRIMARY KEY,
    event_id      UUID         NOT NULL UNIQUE,
    event_type    TEXT         NOT NULL,
    event_version TEXT         NOT NULL,
    aggregate_id  TEXT         NOT NULL,
    payload       JSONB        NOT NULL,
    occurred_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ,
    attempts      INTEGER      NOT NULL DEFAULT 0,
    last_error    TEXT
);

CREATE INDEX IF NOT EXISTS ix_search_outbox_unpublished
    ON search_outbox (id)
    WHERE published_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 5) search_relay_consumed_events — الإهمالُ + الحرفُ السامُّ (idempotency)
--    كلُّ صفٍّ حدثٌ استُهلِكَ من `marketplace_outbox`. مفتاحُ `outbox_id` يُلغي
--    التسليمَ المُكرَّرَ (duplicate delivery) بلا معالجةٍ ثانيةً. الحالةُ:
--    `applied` | `skipped` | `skipped_stale` | `ignored` | `poisoned`.
--    `attempt_count` لتتبُّعِ المحاولاتِ قبلَ السمِّ. الحالةُ النهائيّةُ
--    وحدَها (`applied`/`skipped`/`skipped_stale`/`ignored`/`poisoned`) تُقدِّمُ
--    checkpoint؛ أمّا الفشلُ القابلُ للإعادةِ فيتركُ الصفَّ غيرَ نهائيٍّ
--    فيُعادُ الحدثُ في الدورَةِ التاليةِ.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_relay_consumed_events (
    outbox_id      UUID        PRIMARY KEY,
    event_type     TEXT        NOT NULL,
    aggregate_type TEXT        NOT NULL,
    aggregate_id   TEXT        NOT NULL,
    status         TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','applied','skipped','skipped_stale','ignored','poisoned')),
    attempt_count  INTEGER     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error     TEXT,
    consumed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- إقرارُ المسمومِ (فجوةُ `G5` · موجةُ المحضرِ · `CLM-0249`): ثلاثيٌّ معاً أو
    -- لا شيءَ، ولا إقرارَ إلّا على 'poisoned'. والقيدُ الأخيرُ هوَ ما يجعلُ
    -- إعادةَ الصفِّ إلى 'pending' **تمحو الإقرارَ حتماً** — القاعدةُ ترفضُ صفّاً
    -- مُعاداً يحملُ إقراراً، فلا يبقى «عُولِجَ» على صفٍّ صارَ حيّاً.
    -- (سابقةُ `delivery_relay_consumed_events` حرفاً — ADR-026 §4.27.)
    acknowledged_at        TIMESTAMPTZ,
    acknowledged_by        TEXT,
    acknowledgement_reason TEXT,
    CONSTRAINT search_relay_consumed_events_ack_by_check
        CHECK (acknowledged_by IS NULL OR char_length(acknowledged_by) BETWEEN 1 AND 128),
    CONSTRAINT search_relay_consumed_events_ack_reason_check
        CHECK (acknowledgement_reason IS NULL OR char_length(acknowledgement_reason) BETWEEN 12 AND 512),
    CONSTRAINT ck_search_relay_consumed_events_ack_triple
        CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL)
           AND (acknowledged_at IS NULL) = (acknowledgement_reason IS NULL)),
    CONSTRAINT ck_search_relay_consumed_events_ack_poisoned_only
        CHECK (acknowledged_at IS NULL OR status = 'poisoned')
);

-- فهرسٌ جزئيٌّ على **غيرِ المُقَرِّ بهِ** وحدَهُ: هذا هوَ ما يُقرأُ في الحادثةِ،
-- والمُقَرُّ بهِ يبقى صفّاً للتدقيقِ لا صفّاً يُنبَّهُ عليهِ. والعمودُ
-- `consumed_at` لا `updated_at`: دفترُ البحثِ لا يملكُ الثانيَ، والحدُّ مُعلَنٌ
-- في `domain/relay-dead-letters.ts` ومنشورٌ في جوابِ المقياسِ.
CREATE INDEX IF NOT EXISTS ix_search_relay_consumed_unacknowledged
    ON search_relay_consumed_events (consumed_at)
    WHERE status = 'poisoned' AND acknowledged_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_search_consumed_status
    ON search_relay_consumed_events (status)
    WHERE status NOT IN ('applied','skipped','skipped_stale','ignored','poisoned');

-- ─────────────────────────────────────────────────────────────────────
-- 6) search_relay_checkpoint — تقدُّمُ الاستهلاكِ (offset يملكُهُ البحثُ)
--    صفٌّ واحدٌ لكلِّ مُستهلكٍ. `last_outbox_id`/`last_created_at` هو آخرُ
--    حدثٍ وصلَ لحالةٍ نهائيّةٍ. القراءةُ التاليةُ: الأحداثُ التي
--    (created_at, outbox_id) > (last_created_at, last_outbox_id).
--    لا يكتبُ البحثُ في `marketplace_outbox.published_at` — التقدُّمُ ملكُهُ.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_relay_checkpoint (
    consumer_id      TEXT        PRIMARY KEY,
    last_outbox_id   UUID        NOT NULL,
    last_created_at  TIMESTAMPTZ NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- updated_at / archived_at triggers
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_set_indexed_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.indexed_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION search_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_search_product_index_indexed_at ON search_product_index;
CREATE TRIGGER trg_search_product_index_indexed_at BEFORE UPDATE ON search_product_index
    FOR EACH ROW EXECUTE FUNCTION search_set_indexed_at();

DROP TRIGGER IF EXISTS trg_search_product_state_updated_at ON search_marketplace_product_state;
CREATE TRIGGER trg_search_product_state_updated_at BEFORE UPDATE ON search_marketplace_product_state
    FOR EACH ROW EXECUTE FUNCTION search_set_updated_at();

DROP TRIGGER IF EXISTS trg_search_store_state_updated_at ON search_marketplace_store_state;
CREATE TRIGGER trg_search_store_state_updated_at BEFORE UPDATE ON search_marketplace_store_state
    FOR EACH ROW EXECUTE FUNCTION search_set_updated_at();

DROP TRIGGER IF EXISTS trg_search_checkpoint_updated_at ON search_relay_checkpoint;
CREATE TRIGGER trg_search_checkpoint_updated_at BEFORE UPDATE ON search_relay_checkpoint
    FOR EACH ROW EXECUTE FUNCTION search_set_updated_at();

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- التراجع (rollback) — يُحذف بترتيب عكسي للتبعيات.
-- ─────────────────────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_search_checkpoint_updated_at ON search_relay_checkpoint;
-- DROP TRIGGER IF EXISTS trg_search_store_state_updated_at ON search_marketplace_store_state;
-- DROP TRIGGER IF EXISTS trg_search_product_state_updated_at ON search_marketplace_product_state;
-- DROP TRIGGER IF EXISTS trg_search_product_index_indexed_at ON search_product_index;
-- DROP TABLE IF EXISTS search_relay_checkpoint;
-- DROP TABLE IF EXISTS search_relay_consumed_events;
-- DROP TABLE IF EXISTS search_outbox;
-- DROP TABLE IF EXISTS search_marketplace_product_state;
-- DROP TABLE IF EXISTS search_marketplace_store_state;
-- DROP TABLE IF EXISTS search_product_index;
-- DROP FUNCTION IF EXISTS search_set_updated_at();
-- DROP FUNCTION IF EXISTS search_set_indexed_at();
