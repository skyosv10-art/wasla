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
CREATE TABLE IF NOT EXISTS store_orders (
    order_id           UUID        PRIMARY KEY,
    public_id          TEXT        NOT NULL UNIQUE CHECK (public_id ~ '^WS-[0-9]{10}$'),
    customer_ref       TEXT        NOT NULL CHECK (customer_ref ~ '^WS-[0-9]{10}$'),
    store_id           UUID        NOT NULL,                -- مرجعٌ منطقيٌّ لمتجرِ السوقِ — لا FK عبرَ الحدِّ (ADR-026 §2.3)
    store_public_id    TEXT        NOT NULL CHECK (store_public_id ~ '^WS-[0-9]{10}$'),

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
    state_kind         TEXT        NOT NULL CHECK (state_kind IN ('fulfillment','payment')),
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

COMMIT;
