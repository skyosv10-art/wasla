-- WASLA Delivery Service — Data Contract (PostgreSQL DDL)
-- Phase 13 — Store Orders & Delivery (طلباتُ المتجرِ والتوصيلُ)
--
-- المبدأ الجوهري (ADR-026):
--   - **طلبُ المتجرِ مجموعةٌ مستقلّةٌ**: `store_orders` ملكُ هذه الخدمةِ وحدَها.
--     طلبُ النقلِ (`services/orders`) مجالٌ آخرُ بآلةِ حالاتٍ أخرى (ADR-026 §2.1).
--   - **حالتانِ متعامدتانِ لا واحدةٌ**: `fulfillment_state` قرارُ الخدمةِ،
--     و`payment_state` مرآةُ نيّةِ دفعٍ خارجيّةٍ بمرجعٍ (`payment_ref`) — لا
--     معالجةَ ماليّةَ هنا: الفوترةُ طورٌ لاحقٌ (M5-17) (ADR-026 §2.2).
--   - **لا أرصدةَ مخزونٍ هنا**: لقطاتُ الأصنافِ (كميّةٌ · سعرُ وقتِ الطلبِ) ملكُ
--     الطلبِ، والكميّةُ الحيّةُ مصدرُها السوقُ عبرَ الحدِّ المتَّفقِ عليهِ — لا
--     `JOIN` إلى جداولِ السوقِ ولا كتابةً فيها (ADR-026 §2.3).
--   - **التوصيلُ مرآةٌ خشنةٌ**: `delivery_tasks` تُسقِطُ نتائجَ `dispatch.*` على
--     حالاتٍ خشنةٍ ولا تعيدُ بناءَ منطقِ العروضِ والموجاتِ (ADR-026 §2.4).
--   - **لا إثباتَ بلا تسليمٍ ولا تسليمَ بلا إثباتٍ**: القيدُ `ck_delivery_proof`
--     يرفضُ `delivered` بلا إثباتٍ (نوعٍ ومرجعٍ) ويرفضُ إثباتاً على حالةٍ
--     غيرِ مُسلَّمةٍ (ADR-026 §2.4).
--   - **لا بياناتِ شخصيّةَ ولا إحداثيّاتِ**: مراجعُ opaque بصيغةِ `WS-##########`
--     فقط (ADR-026 §2.6 · ADR-001 · ADR-007).
--
-- المصدر: PostgreSQL (source of truth لطلبِ المتجرِ ومهمّةِ التوصيلِ). Domain
-- Events عبرَ Outbox من البداية. أيُّ ترحيلٍ يجبُ أن يكونَ عكوساً (ADR-024) —
-- الانتظامُ في الترحيلاتِ المولَّدةِ يبدأُ عندَ أوّلِ تطبيقٍ فعليٍّ على قاعدةٍ
-- (سابقةُ `services/search` · مؤجَّلٌ في ADR-026 §4.5).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) store_orders — مجموعةُ طلبِ المتجرِ
--    سلّةُ أصنافٍ من متجرٍ واحدٍ: تُدفعُ (مرآةً) وتُنتقى وتُستبدلُ وتُوصَّلُ.
--    الحالتانِ متعامدتانِ: fulfillment (قرارُ الخدمةِ) وpayment (مرآةُ خارجٍ).
-- ─────────────────────────────────────────────────────────────────────
-- المرجعُ العامُّ للطلبِ (`WS-##########`) يُولَّدُ من متتالٍ لا من التطبيقِ
-- (المراجعةُ 6/N): توليدُهُ في Node يحتاجُ استعلامَ تفرُّدٍ وحلقةَ إعادةٍ خاطئةً
-- تحتَ التزامنِ، والقاعدةُ تُجيبُ «أعطِني رقماً لم يأخذْهُ أحدٌ» بصدقٍ.
-- البدايةُ عاليةٌ (5000000001) كي لا تتصادمَ مع مراجعِ البذورِ في اختباراتِ
-- التكاملِ (`WS-0000000001`...) — تصادمٌ كهذا يُفشلُ اختباراً بريئاً.
CREATE SEQUENCE IF NOT EXISTS store_order_public_id_seq START 5000000001;

CREATE TABLE IF NOT EXISTS store_orders (
    order_id           UUID        PRIMARY KEY,
    public_id          TEXT        NOT NULL UNIQUE CHECK (public_id ~ '^WS-[0-9]{10}$'),
    customer_ref       TEXT        NOT NULL CHECK (customer_ref ~ '^WS-[0-9]{10}$'),
    store_id           UUID        NOT NULL,                -- مرجعٌ منطقيٌّ لمتجرِ السوقِ — لا FK عبرَ الحدِّ (ADR-026 §2.3)
    -- مرجعُ المتجرِ العامُّ = الـslug الذي ينشرُهُ السوقُ في كلِّ مسارٍ عامٍّ
    -- (services/marketplace/contracts/schema.sql: `^[a-z][a-z0-9-]{2,47}$`
    -- ومقفولٌ بعدَ أوّلِ موافقةٍ). المراجعةُ 8/N رفعتْ دَينَ ADR-026 §4.9-2:
    -- لم يكن للسوقِ مرجعٌ عامٌّ بصيغةِ `WS-`، فكانَ العمودُ يطلبُ هويّةً لا
    -- يملكُها أحدٌ. §4.11 تشرحُ لماذا لا مِعجمَ تحويلٍ في هذه الخدمةِ.
    store_slug         TEXT        NOT NULL CHECK (store_slug ~ '^[a-z][a-z0-9-]{2,47}$'),

    -- الحالةُ المتعامدةُ الأولى: التنفيذُ (قرارُ هذه الخدمةِ · ADR-026 §3.1)
    fulfillment_state  TEXT        NOT NULL CHECK (fulfillment_state IN (
                                     'draft','placed','confirmed','picking','picked',
                                     'ready_for_delivery','handed_to_courier',
                                     'delivered','cancelled','rejected','failed')),

    -- الحالةُ المتعامدةُ الثانية: الدفعُ (مرآةُ نيّةٍ خارجيّةٍ · ADR-026 §3.2)
    payment_state      TEXT        NOT NULL CHECK (payment_state IN (
                                     'pending','authorized','captured','failed',
                                     'refunding','partially_refunded','refunded')),
    payment_ref        TEXT        CHECK (payment_ref IS NULL OR char_length(payment_ref) BETWEEN 1 AND 128),

    -- الحالةُ المتعامدةُ الثالثة: المخزونُ (مرآةُ حجزٍ في السوقِ · ADR-026 §2.3 · §3.1)
    -- placed → confirmed يتطلّبُ payment_state=authorized **و** inventory_state=reserved.
    -- الحجزُ طلبٌ يُرسَلُ إلى السوقِ عبرَ الحدِّ، والمرجعُ يُخزَّنُ هنا.
    inventory_state    TEXT        NOT NULL DEFAULT 'none' CHECK (inventory_state IN (
                                     'none','reserving','reserved','released','consumed')),
    inventory_ref      TEXT        CHECK (inventory_ref IS NULL OR char_length(inventory_ref) BETWEEN 1 AND 128),

    -- المالُ لقطةُ طلبٍ بأصغرِ وحدةٍ (هللة) وعملةٍ واحدةٍ (ADR-026 §2.6)
    currency_code      TEXT        NOT NULL CHECK (currency_code = 'SAR'),
    items_total_minor_units    INTEGER NOT NULL CHECK (items_total_minor_units >= 0),
    delivery_fee_minor_units   INTEGER NOT NULL CHECK (delivery_fee_minor_units >= 0),
    total_minor_units          INTEGER NOT NULL CHECK (total_minor_units = items_total_minor_units + delivery_fee_minor_units),

    placed_at          TIMESTAMPTZ,
    delivered_at       TIMESTAMPTZ,
    cancelled_at       TIMESTAMPTZ,

    -- التزامنُ المتفائلُ: كلُّ انتقالٍ يرفعُ النسخةَ
    version            INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- فهرسُ رحلةِ العميلِ: طلباتُ مرجعٍ واحدٍ بترتيبِ أحدثِها.
CREATE INDEX IF NOT EXISTS ix_store_orders_customer
    ON store_orders (customer_ref, created_at DESC);

-- فهرسُ طابورِ المتجرِ: ما على المتجرِ تنفيذُه الآن.
CREATE INDEX IF NOT EXISTS ix_store_orders_store_active
    ON store_orders (store_id, fulfillment_state)
    WHERE fulfillment_state IN ('placed','confirmed','picking','picked','ready_for_delivery');

-- ─────────────────────────────────────────────────────────────────────
-- 2) store_order_items — أصنافُ الطلبِ (لقطاتٌ لا أرصدةَ)
--    الكميّةُ والسعرُ لقطةُ وقتِ الطلبِ؛ والاستبدالُ قرارُ صنفٍ لا طلبٍ
--    (ADR-026 §2.5): الصفُّ الأصليُّ يبقى ويُسجَّلُ البديلُ بمرجعِه.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_order_items (
    order_item_id      UUID        PRIMARY KEY,
    order_id           UUID        NOT NULL REFERENCES store_orders (order_id),
    line_no            INTEGER     NOT NULL CHECK (line_no >= 1),
    product_id         UUID        NOT NULL,                -- مرجعٌ منطقيٌّ لمنتجِ السوقِ
    sku                TEXT        NOT NULL CHECK (char_length(sku) BETWEEN 1 AND 64),
    quantity           INTEGER     NOT NULL CHECK (quantity >= 1),

    -- لقطةُ السعرِ وقتَ الطلبِ (هللة) — لا يُقرأُ سعرُ الكتالوجِ بعدها
    unit_price_minor_units  INTEGER NOT NULL CHECK (unit_price_minor_units >= 0),
    line_total_minor_units  INTEGER NOT NULL CHECK (line_total_minor_units = quantity * unit_price_minor_units),

    -- الاستبدالُ (ADR-026 §2.5): مسموحٌ فقط أثناءَ picking — يُطبَّقُ في
    -- آلةِ الحالاتِ؛ هنا يُسجَّلُ الأثرُ: البديلُ وسبَبُهُ وفرقُ السعرِ.
    substituted_product_id  UUID,
    substitution_reason     TEXT CHECK (substitution_reason IS NULL OR substitution_reason IN (
                              'out_of_stock','customer_approved_alternative','store_policy')),
    substitution_price_delta_minor_units INTEGER
                            CHECK (substitution_price_delta_minor_units IS NOT NULL OR substituted_product_id IS NULL),

    UNIQUE (order_id, line_no)
);

CREATE INDEX IF NOT EXISTS ix_store_order_items_order
    ON store_order_items (order_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3) store_order_transitions — سجلُّ الانتقالاتِ (append-only)
--    كلُّ انتقالِ حالةٍ (تنفيذٍ أو دفعٍ) يُسجَّلُ باتجاهَيهِ وسببِهِ وفاعلِهِ.
--    لا UPDATE ولا DELETE: من يريدُ تصحيحَ قرارٍ يُسجِّلُ انتقالاً معاكساً
--    بقرارٍ — وهذا نسقُ دفاترِ القراراتِ في كلِّ الأطوارِ.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_order_transitions (
    transition_id      BIGSERIAL   PRIMARY KEY,
    order_id           UUID        NOT NULL REFERENCES store_orders (order_id),
    state_kind         TEXT        NOT NULL CHECK (state_kind IN ('fulfillment','payment','inventory')),
    from_state         TEXT        NOT NULL,
    to_state           TEXT        NOT NULL CHECK (to_state <> from_state),
    reason_code        TEXT        NOT NULL CHECK (char_length(reason_code) BETWEEN 3 AND 64),
    actor_type         TEXT        NOT NULL CHECK (actor_type IN ('system','customer','store','courier','admin')),
    actor_ref          TEXT        CHECK (actor_ref IS NULL OR actor_ref ~ '^WS-[0-9]{10}$'),
    trace_id           TEXT,
    occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_store_order_transitions_order
    ON store_order_transitions (order_id, occurred_at);

-- ─────────────────────────────────────────────────────────────────────
-- 4) delivery_tasks — مهمّةُ التوصيلِ (مرآةٌ خشنةٌ لساقِ التوصيلِ)
--    مهمّةٌ لطلبِ متجرٍ واحدٍ (1:1 في هذا الطورِ). المنطقُ الدقيقُ (موجةٌ ·
--    عرضٌ · مهلةٌ) ملكُ dispatch — هنا المرآةُ والنتيجةُ (ADR-026 §2.4).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_tasks (
    task_id            UUID        PRIMARY KEY,
    order_id           UUID        NOT NULL UNIQUE REFERENCES store_orders (order_id),

    state              TEXT        NOT NULL CHECK (state IN (
                                     'pending_eligibility','eligible','dispatch_requested',
                                     'driver_assigned','timed_out','reassigned','exhausted',
                                     'picked_up','in_transit','arrived','delivered',
                                     'ineligible','failed','cancelled')),

    -- أهليّةُ التوصيلِ: سببٌ مغلقٌ حين تعذَّرَت
    ineligibility_reason TEXT      CHECK (ineligibility_reason IS NULL OR ineligibility_reason IN (
                                     'outside_coverage','store_not_orderable','no_courier_service')),

    -- تفويضُ dispatch: مرجعُ المهمّةِ هناك — لا نسخُ منطقِها هنا
    dispatch_job_ref   TEXT        CHECK (dispatch_job_ref IS NULL OR char_length(dispatch_job_ref) BETWEEN 1 AND 128),

    -- علامةُ ماءِ dispatch (ADR-026 §2.4 · المراجعة 3/N): آخرُ حدثٍ استُهلكَ
    -- نهائيّاً لهذهِ المهمّةِ (تطبيقاً أو تجاهلاً). ترتيبُها معجميٌّ على
    -- (occurred_at, event_id) — الحدثُ الأقدمُ لا يتراجعُ بالحالةِ أبداً.
    -- ملكُ التوصيلِ وحده: المستهلكُ لا يكتبُ في صندوقِ dispatch أبداً
    -- (لا published_at) — التقدّمُ كلُّهُ هنا.
    dispatch_last_occurred_at TIMESTAMPTZ,
    dispatch_last_event_id   UUID,

    -- المندوبُ مرجعٌ opaque — لا اسمَ ولا هاتفَ (ADR-026 §2.6)
    courier_ref        TEXT        CHECK (courier_ref IS NULL OR courier_ref ~ '^WS-[0-9]{10}$'),

    -- إثباتُ التسليمِ: شرطٌ لازمٌ لdelivered (ADR-026 §2.4)
    proof_type         TEXT        CHECK (proof_type IS NULL OR proof_type IN ('otp','photo','signature','pin_code')),
    proof_ref          TEXT        CHECK (proof_ref IS NULL OR char_length(proof_ref) BETWEEN 1 AND 256),

    assigned_at        TIMESTAMPTZ,
    delivered_at       TIMESTAMPTZ,

    version            INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- لا تسليمَ بلا إثباتٍ ولا إثباتَ قبلَ التسليمِ (ADR-026 §2.4)
    CONSTRAINT ck_delivery_proof CHECK (
      (state = 'delivered') = (proof_type IS NOT NULL AND proof_ref IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS ix_delivery_tasks_active
    ON delivery_tasks (state)
    WHERE state IN ('eligible','dispatch_requested','driver_assigned','timed_out','reassigned','picked_up','in_transit','arrived');

-- ─────────────────────────────────────────────────────────────────────
-- 5) delivery_task_transitions — سجلُّ انتقالاتِ مهمّةِ التوصيلِ (append-only)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_task_transitions (
    transition_id      BIGSERIAL   PRIMARY KEY,
    task_id            UUID        NOT NULL REFERENCES delivery_tasks (task_id),
    from_state         TEXT        NOT NULL,
    to_state           TEXT        NOT NULL CHECK (to_state <> from_state),
    reason_code        TEXT        NOT NULL CHECK (char_length(reason_code) BETWEEN 3 AND 64),
    actor_type         TEXT        NOT NULL CHECK (actor_type IN ('system','customer','store','courier','admin','dispatch')),
    actor_ref          TEXT        CHECK (actor_ref IS NULL OR actor_ref ~ '^WS-[0-9]{10}$'),
    trace_id           TEXT,
    occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_delivery_task_transitions_task
    ON delivery_task_transitions (task_id, occurred_at);

-- ─────────────────────────────────────────────────────────────────────
-- 6) delivery_outbox — صندوقُ الصادرِ (نفسُ نسقِ أطوارِ السوقِ والبحثِ)
--    كلُّ حدثِ نطاقٍ يُكتبُ في المعاملةِ نفسِها التي تغيّرُ الحالةَ — فلا
--    تغييرَ صامتاً ولا حدثَ بلا قرارٍ. النشرُ مرحلةٌ لاحقةٌ (relay).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_outbox (
    outbox_id          BIGSERIAL   PRIMARY KEY,
    event_id           UUID        NOT NULL UNIQUE,
    event_type         TEXT        NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 96),
    event_version      TEXT        NOT NULL CHECK (event_version ~ '^v[0-9]+$'),
    aggregate_type     TEXT        NOT NULL CHECK (aggregate_type IN ('store_order','delivery_task')),
    aggregate_id       TEXT        NOT NULL CHECK (char_length(aggregate_id) BETWEEN 1 AND 64),
    payload            JSONB       NOT NULL,
    trace_id           TEXT,
    -- لحظةُ الواقعةِ من مظروفِ الحدثِ (المراجعة 3/N): نفسُ عمودِ السوقِ
    -- والبحثِ — بلا هذا العمودِ يضيعُ occurred_at من المظروفِ عندَ الكتابةِ.
    occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_delivery_outbox_unpublished
    ON delivery_outbox (outbox_id)
    WHERE published_at IS NULL;

-- ─────────────────────────────────────────────────────────────
-- 7) delivery_relay_consumed_events — دفترُ استهلاكِ أحداثِ dispatch
--    (منعُ التكرار · ADR-026 §4.2): كلُّ صفٍّ حدثٌ من dispatch_outbox
--    حُسِمَ أمرُهُ نهائيّاً أو أُرجِئَ. المفتاحُ event_id نفسُهُ — فإعادةُ
--    التسليمِ بعدَ إعادةِ بناءِ المستهلكِ no-op لا صفٌ ثانٍ.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_relay_consumed_events (
    event_id       UUID        PRIMARY KEY,
    event_type     TEXT        NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 96),
    aggregate_type TEXT        NOT NULL CHECK (aggregate_type IN ('dispatch_job','dispatch_offer')),
    aggregate_id   TEXT        NOT NULL CHECK (char_length(aggregate_id) BETWEEN 1 AND 64),
    consumed_status TEXT     NOT NULL CHECK (consumed_status IN (
                                   'pending','applied','skipped_stale',
                                   'ignored','ignored_foreign','poisoned')),
    attempt_count  INTEGER     NOT NULL CHECK (attempt_count >= 1),
    last_error     TEXT,
    consumed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 8) delivery_relay_checkpoint — نقطةُ تقدّمِ المستهلكِ (المراجعة 3/N):
--    آخرُ صفٍّ حُسِمَ أمرُهُ من dispatch_outbox. ملكُ التوصيلِ — لا علاقةَ
--    لهُ بـ published_at في صندوقِ dispatch.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_relay_checkpoint (
    consumer_id      TEXT        PRIMARY KEY CHECK (char_length(consumer_id) BETWEEN 3 AND 96),
    last_occurred_at TIMESTAMPTZ NOT NULL,
    last_event_id    UUID        NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 9) delivery_inventory_observations — لقطاتُ مخزونٍ من السوق (ADR-026 §2.3)
--    المستهلكُ يقرأُ فرقَ المخزونِ من السوقِ ويُخزِّنُ لقطةً لا رصيداً: آخرُ
--    تسويةٍ لكلِّ (متجرٍ، منتجٍ) بكميّتِها بعدَ التسويةِ وتسلسلِها. لا JOINَ
--    إلى جداولِ السوقِ ولا كتابةً فيها — الحدُّ المتَّفقُ عليهِ.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_inventory_observations (
    store_id              UUID        NOT NULL,
    product_id            UUID        NOT NULL,
    last_adjustment_id    UUID        NOT NULL,
    last_marketplace_event_id UUID    NOT NULL,
    last_adjustment_sequence  INTEGER NOT NULL,
    observed_quantity_after   INTEGER NOT NULL,
    last_quantity_delta       INTEGER NOT NULL,
    last_reason_code          TEXT    NOT NULL,
    occurred_for          TIMESTAMPTZ NOT NULL,
    observed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    trace_id              TEXT,
    PRIMARY KEY (store_id, product_id)
);

-- ─────────────────────────────────────────────────────────────
-- 10) delivery_inventory_relay_consumed_events — دفترُ استهلاكِ أحداثِ
--     مخزونِ السوق (منعُ التكرار · ADR-026 §2.3): كلُّ صفٍّ حدثٌ من
--     marketplace_outbox حُسِمَ أمرُهُ نهائيّاً أو أُرجِئَ. المفتاحُ event_id
--     نفسُهُ — فإعادةُ التسليمِ بعدَ إعادةِ بناءِ المستهلكِ no-op لا صفٌ ثانٍ.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_inventory_relay_consumed_events (
    event_id       UUID        PRIMARY KEY,
    event_type     TEXT        NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 96),
    aggregate_type TEXT        NOT NULL CHECK (aggregate_type IN ('store','product','inventory')),
    aggregate_id   TEXT        NOT NULL CHECK (char_length(aggregate_id) BETWEEN 1 AND 64),
    consumed_status TEXT     NOT NULL CHECK (consumed_status IN (
                                   'pending','applied','skipped_stale',
                                   'ignored','poisoned')),
    attempt_count  INTEGER     NOT NULL CHECK (attempt_count >= 1),
    last_error     TEXT,
    consumed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 11) delivery_inventory_relay_checkpoint — نقطةُ تقدّمِ مستهلكِ المخزونِ:
--     آخرُ صفٍّ حُسِمَ أمرُهُ من marketplace_outbox. ملكُ التوصيلِ — لا علاقةَ
--     لهُ بـ published_at في صندوقِ السوق.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_inventory_relay_checkpoint (
    consumer_id      TEXT        PRIMARY KEY CHECK (char_length(consumer_id) BETWEEN 3 AND 96),
    last_occurred_at TIMESTAMPTZ NOT NULL,
    last_event_id    UUID        NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────────────────────────────────
-- 12) delivery_idempotency_keys — مفاتيحُ التماثُلِ للمسارَينِ الكاتبَينِ
--     (المراجعةُ 7/N · ADR-026 §4.10 — رفعُ دَينِ §4.9-3).
--
--     الصفُ يُكتَبُ **داخلَ معاملةِ الأمرِ نفسِها** لا في معاملةٍ ثانيةٍ:
--     مفتاحٌ مُلتَزَمٌ بلا طلبٍ (أو طلبٌ بلا مفتاحٍ) هو بالضبطِ الازدواجُ
--     الذي يمنعُهُ هذا الجدولُ. ولذلك لا عمودَ حالةٍ وسيطةٍ (in_progress):
--     وجودُ الصفِ مُلتَزَماً = الأمرُ تَمَّ وجوابُهُ محفوظٌ؛ وغيابُهُ = لم يتمَّ؛
--     والتزاحُمُ يُحسَمُ بالمفتاحِ الفريدِ (23505 ⇒ 409 in_flight).
--
--     البصمةُ (sha256 لـcanonical JSON) تمنعُ «مفتاحٌ واحدٌ لطلبَينِ
--     مختلفَينِ»: إعادةُ جوابِ الأولِ للثاني طلبٌ ضائعٌ بصمتٍ.
--     الجوابُ المحفوظُ جسمُ العقدِ نفسُهُ (مراجعُ WS- ومبالغُ هللةٍ) —
--     لا بياناتِ شخصيّةَ ولا إحداثيّاتٍ (§2.6).
-- ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_idempotency_keys (
    idempotency_key     TEXT        PRIMARY KEY CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$'),
    -- القائمةُ **مغلقةٌ** وتُطابقُ `IDEMPOTENT_ROUTES` حرفاً، ويحرسُ التطابقَ
    -- اختبارٌ يقرأُ هذا الملفَّ (`idempotency.test.ts`). ولمَ حارسٌ؟ لأنَّ
    -- المراجعةَ 9/N أضافت مسارَينِ إلى المجالِ ونسيتهما هنا، فكانَ الجوابُ 500
    -- من قيدٍ في القاعدةِ على طلبٍ صحيحٍ تماماً — وأوّلُ من كشفَهُ بوّابةُ
    -- الخروجِ لا اختبارُ خدمةٍ، فالحارسُ يُقصِّرُ الطريقَ إلى الكشفِ.
    route               TEXT        NOT NULL CHECK (route IN (
                                        'POST /store-orders',
                                        'POST /store-orders/{orderPublicId}/cancellation',
                                        'PUT /store-orders/{orderPublicId}/payment-mirror',
                                        'POST /store-orders/{orderPublicId}/confirmation',
                                        'POST /store-orders/{orderPublicId}/fulfillment-transition')),
    request_fingerprint TEXT        NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    response_status     SMALLINT    NOT NULL CHECK (response_status IN (200, 201)),
    response_body       JSONB       NOT NULL,
    order_id            UUID        NOT NULL REFERENCES store_orders(order_id) ON DELETE CASCADE,
    trace_id            TEXT        CHECK (trace_id IS NULL OR char_length(trace_id) <= 128),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- حياةُ المفتاحِ (المراجعةُ 13/N · ADR-026 §4.15 — رفعُ دَينِ §4.10).
    --
    -- ولمَ عمودٌ صريحٌ لا `created_at + interval` محسوبةً في كلِّ استعلامٍ؟
    -- لأنَّ المدّةَ **صفةُ الصفِّ لا صفةُ الشفرةِ**: خفضُ المدّةِ في الإعدادِ
    -- بعدَ كتابةِ صفٍّ يجبُ ألّا يُميتَ مفتاحاً وُعِدَ صاحبُهُ بأربعٍ وعشرينَ
    -- ساعةً — وحسابُها عندَ القراءةِ يفعلُ ذلكَ بالضبطِ وبأثرٍ رجعيٍّ.
    -- وعمودٌ مفهرسٌ يجعلُ المُكنسةَ مسحاً لمدىً لا مسحاً للجدولِ كلِّهِ.
    expires_at          TIMESTAMPTZ NOT NULL,
    -- مفتاحٌ ميِّتٌ عندَ كتابتِهِ يُلغي الحمايةَ صامتاً: مدّةٌ صفرٌ أو سالبةٌ
    -- تعني أنَّ كلَّ إعادةٍ تُنشئُ طلباً ثانياً. فالقيدُ يمنعُ الإعدادَ الخاطئَ
    -- في القاعدةِ لا في الشفرةِ وحدَها.
    CHECK (expires_at > created_at)
);

-- مسحُ المُكنسةِ: مدىً على `expires_at` وحدَهُ. ولا فهرسَ جزئيٌّ بـ`now()`
-- لأنَّها ليست ثابتةً (IMMUTABLE) فلا تُقبَلُ في تعريفِ فهرسٍ.
CREATE INDEX IF NOT EXISTS ix_delivery_idempotency_keys_expiry
    ON delivery_idempotency_keys (expires_at);

COMMIT;

-- ───────────────────────────────────────────────────
-- 13) delivery_inventory_reservations — سجلُ حجوزاتِ المخزونِ (ADR-026 §2.3)
--     كلُّ صفٍّ حجزُ كميةٍ لصنفٍ واحدٍ لطلبٍ واحدٍ. الحجزُ طلبٌ إلى السوقِ عبرَ
--     الحدِّ المتَّفقِ عليهِ (POST /stores/:storeSlug/inventory/reserve)،
--     والتحريرُ عكسُهُ (POST /stores/:storeSlug/inventory/release).
--     التوصيلُ يخزِّنُ المرجعَ والكميّةَ المسؤولَ عنها، لا يملكُ الرصيدَ.
-- ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_inventory_reservations (
    reservation_id     UUID        PRIMARY KEY,
    order_id           UUID        NOT NULL REFERENCES store_orders (order_id),
    store_slug         TEXT        NOT NULL CHECK (store_slug ~ '^[a-z][a-z0-9-]{2,47}$'),
    product_id         UUID        NOT NULL,
    sku                TEXT        NOT NULL CHECK (char_length(sku) BETWEEN 1 AND 64),
    quantity_reserved  INTEGER     NOT NULL CHECK (quantity_reserved >= 1),
    unit_price_minor_units  INTEGER NOT NULL CHECK (unit_price_minor_units >= 0),

    -- مرجعُ الحجزِ في السوقِ (idempotency key مشتقٌّ من order_public_id)
    marketplace_reservation_ref TEXT NOT NULL CHECK (char_length(marketplace_reservation_ref) BETWEEN 1 AND 128),

    status             TEXT        NOT NULL DEFAULT 'active' CHECK (status IN (
                                     'active','released','consumed')),
    reserved_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_at        TIMESTAMPTZ,
    trace_id           TEXT,

    UNIQUE (order_id, product_id) DEFERRABLE INITIALLY DEFERRED,
    UNIQUE (marketplace_reservation_ref)
);

CREATE INDEX IF NOT EXISTS ix_delivery_inventory_reservations_order
    ON delivery_inventory_reservations (order_id);

CREATE INDEX IF NOT EXISTS ix_delivery_inventory_reservations_active
    ON delivery_inventory_reservations (store_slug, product_id)
    WHERE status = 'active';

COMMIT;

-- ───────────────────────────────────────────────────
-- 14) delivery_inventory_conflicts — رايةُ تضاربِ مخزونٍ على حجزٍ نشطٍ
--     (ADR-026 §4.8 · رُفِعَ الدَّينُ في المراجعةِ 16/N — انظر §4.18)
--
--     صفٌّ واحدٌ لكلِّ فرقِ مخزونٍ مرصودٍ شكَّكَ في وحداتٍ نحملُها. **تقريرٌ
--     لا أمرٌ**: لا انتقالَ حالةٍ ولا إفراجَ حجزٍ يُشتقُّ منهُ — ولذلك
--     `changes_order_state BOOLEAN NOT NULL DEFAULT FALSE CHECK (= FALSE)`
--     مُعلَنٌ في الصفِّ نفسِهِ على سابقةِ `gates_readiness` (§4.17-2): من
--     يقرأُ صفّاً في حادثةٍ لا يقرأُ ADR.
--
--     **ولا مقارنةَ كميّةٍ بكميّةٍ هنا** — الحجزُ فرقٌ سالبٌ مخصومٌ سلفاً من
--     `quantity_on_hand` في دفترِ السوقِ، فمقارنةُ `observed_quantity_after`
--     بحجزِنا تعدُّ الشيءَ مرّتَينِ. التفصيلُ في رأسِ
--     `src/domain/inventory-conflict.ts`.
--
--     المفتاحُ الأوّليُّ `(adjustment_id)`: الفرقُ واحدٌ في دفترِ السوقِ
--     (`inventory_adjustments.adjustment_id` مفتاحٌ أوّليٌّ هناك)، فإعادةُ
--     تسليمِ الحدثِ نفسِهِ `ON CONFLICT DO NOTHING` ولا تُضاعِفُ الرايةَ.
--     ولا `REFERENCES` عبرَ الحدِّ (ADR-026 §2.3).
-- ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_inventory_conflicts (
    adjustment_id         UUID        PRIMARY KEY,
    marketplace_event_id  UUID        NOT NULL,
    store_id              UUID        NOT NULL,
    product_id            UUID        NOT NULL,

    -- مفرداتٌ مغلقةٌ تُطابقُ `INVENTORY_CONFLICT_KINDS` في
    -- `src/domain/inventory-conflict.ts` حرفاً — إضافةُ نوعٍ ترحيلٌ مُعلَنٌ.
    conflict_kind         TEXT        NOT NULL CHECK (conflict_kind IN (
                                        'stock_zeroed_while_reserved',
                                        'downward_correction_while_reserved',
                                        'shrinkage_while_reserved')),

    -- سببُ الفرقِ الأصليُّ يُحفَظُ مستقلاً عن التصنيفِ: التصنيفُ يُقدِّمُ الأشدَّ
    -- (صفرٌ) على السببِ، فلو لم يُحفَظِ السببُ لضاعَ الفرقُ بينَ صفرٍ بفقدٍ
    -- وصفرٍ بأرشفةٍ — وهُما حادثتانِ مختلفتانِ تماماً للمُشغِّلِ.
    reason_code           TEXT        NOT NULL CHECK (reason_code IN (
                                        'correction','shrinkage','archive_zeroed')),

    quantity_delta        INTEGER     NOT NULL CHECK (quantity_delta < 0),
    observed_quantity_after INTEGER   NOT NULL CHECK (observed_quantity_after >= 0),
    adjustment_sequence   INTEGER     NOT NULL CHECK (adjustment_sequence >= 1),

    affected_order_count  INTEGER     NOT NULL CHECK (affected_order_count >= 1),
    affected_units_total INTEGER   NOT NULL CHECK (affected_units_total >= 1),
    -- مراجعُ الطلباتِ العامّةُ مصفوفةً مرتَّبةً — لا جدولَ ربطٍ ثانياً: الرايةُ
    -- تُقرأُ سطراً واحداً في حادثةٍ، وجدولُ ربطٍ يعني استعلامَينِ لسطرٍ واحدٍ.
    affected_order_public_ids TEXT[]  NOT NULL CHECK (
                                        array_length(affected_order_public_ids, 1) >= 1
                                        AND array_length(affected_order_public_ids, 1) = affected_order_count),

    -- الرصدُ لا يحكمُ: ثابتٌ مُعلَنٌ في الصفِّ لا محسوبٌ في القارئِ.
    changes_order_state   BOOLEAN     NOT NULL DEFAULT FALSE CHECK (changes_order_state = FALSE),

    -- الإقرارُ التشغيليُّ: من قرأَ الرايةَ ومتى. `NULL` تعني «لم يقرأْها أحدٌ بعدُ»،
    -- وهيَ الحالةُ التي يُصفّي عليها مسارُ القراءةِ افتراضاً.
    acknowledged_at       TIMESTAMPTZ,
    acknowledged_by       TEXT        CHECK (acknowledged_by IS NULL OR char_length(acknowledged_by) BETWEEN 1 AND 128),
    CONSTRAINT ck_delivery_inventory_conflicts_ack CHECK (
        (acknowledged_at IS NULL) = (acknowledged_by IS NULL)),

    occurred_for          TIMESTAMPTZ NOT NULL,
    detected_at           TIMESTAMPTZ NOT NULL,
    trace_id              TEXT
);

-- القراءةُ التشغيليّةُ الوحيدةُ: غيرُ المُقَرِّ أوّلاً والأحدثُ أوّلاً.
CREATE INDEX IF NOT EXISTS ix_delivery_inventory_conflicts_unacknowledged
    ON delivery_inventory_conflicts (detected_at DESC)
    WHERE acknowledged_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_delivery_inventory_conflicts_product
    ON delivery_inventory_conflicts (store_id, product_id);

COMMIT;
