-- WASLA Order Engine Service — Data Contract (PostgreSQL DDL)
-- Phase 06 — Order Engine
--
-- المبدأ الجوهري (ADR-010):
--   - هذه الخدمة **وحدها** تملك الطلب: لا خدمة أخرى تكتب في هذه الجداول ولا تقرؤها مباشرة (§37).
--   - **لا حالة مسوّدة (draft)**: الطلب لا يبلغ المحرّك إلّا مُتحقَّقاً (ADR-009: التسليم يُحاوَل قبل الكتابة)،
--     فحالة البدء `published`. حالة لا مسار إليها = حالة مستحيلة، وبوابة الخروج تمنعها نصّاً.
--   - `order_public_id` يملكه المحرّك: `ORD-` + عشرة أرقام من **متتالية في القاعدة** لا من التطبيق،
--     لأن التفرّد خاصية قاعدة (سابقة `WS-` في خدمة الهوية). ويُصدَر مرّة واحدة عند القبول.
--   - `customer_public_id` و`driver_public_id` مرجعان opaque بـCHECK **بلا FK**: خدمة أخرى وقاعدة أخرى.
--     أهلية السائق ليست مسؤولية المحرّك (Phase 05 تملك الملف، Phase 07 تملك الفلترة).
--   - `zone_id` مرجع opaque إلى هرم الجغرافيا **بلا FK** (ADR-006 · ADR-009).
--   - المال **عدد صحيح بالوحدة الصغرى** — لا عدد عشري في المال أبداً.
--   - **كل انتقال حالة** يكتب صفّاً في `order_status_history` ويُنتج حدثاً في `order_outbox`،
--     والثلاثة (تحديث الحالة + التدقيق + الحدث) **في معاملة واحدة** (§77: Audit + Outbox).
--   - القناة لا تظهر هنا: لا `telegram` ولا `chat_id` في أي عمود (ADR-007).
--
-- المصدر: PostgreSQL (source of truth). Domain Events عبر Outbox من البداية.
-- الترقيم: أي ترحيل (migration) يجب أن يكون عكوساً (reversible) وموثّقاً في TASK_LOG.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 0) متتالية المعرّف العام — التفرّد خاصية قاعدة لا خاصية عملية
--    عمليتان متزامنتان لا يمكن أن تُصدرا المعرّف نفسه.
-- ─────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS order_public_id_seq AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;

-- ─────────────────────────────────────────────────────────────────────
-- 1) orders — الطلب
--    `status` حالة **الطلب** (بخلاف `customer_order_requests.status` التي هي حالة التسليم).
--    قيد CHECK يُعدّد الحالات المسموحة كلّها؛ والانتقالات بينها تُفرَض في `domain/state-machine.ts`
--    لا في القاعدة: قيد قاعدة لا يعرف الحالة السابقة إلّا بمُشغّل، والمُشغّل يُخفي القاعدة عن
--    الاختبار ويجعلها غير قابلة للتشغيل بمخزن ذاكرة (وبذلك تُصبح البوابة تُثبت شيئاً في وضع
--    وشيئاً آخر في وضع). المصدر الوحيد للانتقالات هو الجدول الصريح في المجال.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id                    UUID        PRIMARY KEY,
    order_public_id       TEXT        NOT NULL UNIQUE
                          CHECK (order_public_id ~ '^ORD-[0-9]{10}$'),
    -- مرجع نيّة الطلب عند خدمة العميل: يُحفظ لتتبّع النسب (lineage) لا للقراءة عبر الخدمات.
    order_request_id      UUID        NOT NULL UNIQUE,
    customer_public_id    TEXT        NOT NULL
                          CHECK (customer_public_id ~ '^WS-[0-9]{10}$'),
    order_type            TEXT        NOT NULL
                          CHECK (order_type IN ('ride','delivery')),
    vehicle_class         TEXT        NOT NULL
                          -- القائمة مُقفلة ومطابقة حرفياً لعقد التسليم (ADR-009 §7): أي نقص هنا
                          -- يجعل المحرّك يرفض طلباً صالحاً، وأي زيادة تجعله يقبل ما لا يُطابقه سائق.
                          CHECK (vehicle_class IN ('sedan','suv','van','pickup','motorcycle','truck_small')),
    status                TEXT        NOT NULL DEFAULT 'published'
                          CHECK (status IN (
                              -- المسار التشغيلي — لا حالة مسوّدة (ADR-010 القرار 2)
                              'published','searching','offered','negotiating','accepted','assigned',
                              'driver_en_route','arrived','in_progress','completed',
                              -- عابرتان لا نهايتان (ADR-010 القرار 3.5)
                              'driver_rejected','driver_timeout',
                              -- نهائية
                              'expired','no_driver_found','customer_cancelled','driver_cancelled',
                              'partner_cancelled','blocked','failed',
                              -- ما بعد الإتمام
                              'payment_disputed','under_review'
                          )),
    -- سبب الوصول إلى الحالة الحالية: إلزامي على كل حالة غير سعيدة (يُفرَض في المجال،
    -- وحارسه هنا يمنع الحالات النهائية بلا سبب: لا نهاية بلا سبب.
    status_reason_code    TEXT        CHECK (status_reason_code IS NULL OR char_length(status_reason_code) BETWEEN 3 AND 64),
    price_mode            TEXT        NOT NULL
                          CHECK (price_mode IN ('customer_offer','negotiable')),
    offered_amount_minor  BIGINT      CHECK (offered_amount_minor IS NULL OR offered_amount_minor > 0),
    offered_currency      TEXT        CHECK (offered_currency IS NULL OR offered_currency ~ '^[A-Z]{3}$'),
    -- وصف الشحنة نصّ كتبه المستخدم: يُخزَّن ويُسلَّم، و**ممنوع** أن يظهر في أي حدث (ADR-009 §7).
    shipment_description  TEXT        CHECK (shipment_description IS NULL OR char_length(shipment_description) <= 300),
    shipment_type         TEXT        CHECK (shipment_type IS NULL OR shipment_type IN ('parcel','documents','food','goods','other')),
    shipment_weight_kg    NUMERIC(7,2) CHECK (shipment_weight_kg IS NULL OR (shipment_weight_kg >= 0 AND shipment_weight_kg <= 3000)),
    notes                 TEXT        CHECK (notes IS NULL OR char_length(notes) <= 300),
    -- الإسناد النشط: مرجع إلى صفّ في order_assignments. حالة تُسمّي سائقاً لا يجوز أن تخلو منه
    -- (حرّاس ADR-010 القرار 3.8)، وحالة قبل القبول لا يجوز أن تحمله.
    active_assignment_id  UUID,
    idempotency_key       TEXT        NOT NULL
                          CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
    -- بصمة الحمولة: إعادة المفتاح نفسه بحمولة مختلفة تُكتشف بالمقارنة معها لا بقراءة الحقول.
    payload_fingerprint   TEXT        NOT NULL
                          CHECK (char_length(payload_fingerprint) = 64),
    requested_at          TIMESTAMPTZ NOT NULL,
    accepted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),   -- لحظة قبول المحرّك للتسليم
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- وضع السعر ومبلغه لا يتناقضان: عرض بلا مبلغ ليس عرضاً، ومبلغ في وضع تفاوض كذبة.
    CONSTRAINT ck_orders_price_mode_amount CHECK (
        (price_mode = 'customer_offer' AND offered_amount_minor IS NOT NULL AND offered_currency IS NOT NULL)
        OR
        (price_mode = 'negotiable'      AND offered_amount_minor IS NULL     AND offered_currency IS NULL)
    ),
    -- المبلغ والعملة يأتيان معاً أو لا يأتيان.
    CONSTRAINT ck_orders_money_complete CHECK ((offered_amount_minor IS NULL) = (offered_currency IS NULL)),
    -- وصف الشحنة وحجمها لطلب توصيل فقط: مشوارٌ له شحنة نموذجٌ مشوّش.
    CONSTRAINT ck_orders_shipment_only_delivery CHECK (
        order_type = 'delivery'
        OR (shipment_description IS NULL AND shipment_type IS NULL AND shipment_weight_kg IS NULL)
    ),
    -- لا حالة نهائية بلا سبب.
    CONSTRAINT ck_orders_terminal_needs_reason CHECK (
        status NOT IN ('expired','no_driver_found','customer_cancelled','driver_cancelled',
                       'partner_cancelled','blocked','failed')
        OR status_reason_code IS NOT NULL
    ),
    -- حالة تُسمّي سائقاً تستلزم إسناداً نشطاً؛ وحالة قبل القبول لا تحمله.
    CONSTRAINT ck_orders_assignment_matches_status CHECK (
        (status IN ('accepted','assigned','driver_en_route','arrived','in_progress','completed')
             AND active_assignment_id IS NOT NULL)
        OR
        (status IN ('published','searching','offered','negotiating')
             AND active_assignment_id IS NULL)
        OR
        -- الحالات النهائية وما بعد الإتمام والعابرتان: قد تحمل إسناداً وقد لا تحمله،
        -- لأن الطلب قد يفشل قبل أي إسناد أو بعده.
        status IN ('driver_rejected','driver_timeout','expired','no_driver_found',
                   'customer_cancelled','driver_cancelled','partner_cancelled','blocked','failed',
                   'payment_disputed','under_review')
    )
);

CREATE INDEX IF NOT EXISTS ix_orders_customer     ON orders (customer_public_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_orders_status       ON orders (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_idempotency_key ON orders (idempotency_key);

-- ─────────────────────────────────────────────────────────────────────
-- 2) order_stops — نقاط الطلب (نقطتان بالضبط في هذه المرحلة)
--    قائمة مرتّبة بـsequence فـMulti-stop (§3.2) لا يحتاج هجرة.
--    `zone_id` إلزامي و`source` إلزامي (ADR-009 القرار 2): نقطة بلا منطقة غير قابلة للمطابقة.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_stops (
    id            UUID        PRIMARY KEY,
    order_id      UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    sequence      SMALLINT    NOT NULL CHECK (sequence >= 0),
    kind          TEXT        NOT NULL CHECK (kind IN ('pickup','dropoff')),
    zone_id       UUID        NOT NULL,                       -- مرجع opaque إلى الجغرافيا (بلا FK)
    -- تسمية النقطة نصّ كتبه المستخدم: يُخزَّن للعرض و**ممنوع** في الأحداث.
    label         TEXT        CHECK (label IS NULL OR char_length(label) <= 60),
    source        TEXT        NOT NULL
                  CHECK (source IN ('map','telegram_location','link','text_search','saved_place','manual_zone')),
    latitude      NUMERIC(8,6)  CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
    longitude     NUMERIC(9,6)  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_order_stops_coordinates_complete CHECK ((latitude IS NULL) = (longitude IS NULL)),
    CONSTRAINT ux_order_stops_order_sequence UNIQUE (order_id, sequence)
);

CREATE INDEX IF NOT EXISTS ix_order_stops_order ON order_stops (order_id, sequence);
CREATE INDEX IF NOT EXISTS ix_order_stops_zone  ON order_stops (zone_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3) order_status_history — سجل التدقيق (§77: Audit)
--    صفّ لكل انتقال، **بلا استثناء**، في المعاملة نفسها التي غيّرت الحالة.
--    `from_status` تكون NULL مرّة واحدة فقط: عند إنشاء الطلب (الدخول إلى `published`).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_status_history (
    id            UUID        PRIMARY KEY,
    order_id      UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    sequence      INTEGER     NOT NULL CHECK (sequence >= 1),
    from_status   TEXT,                                        -- NULL = الإنشاء
    to_status     TEXT        NOT NULL,
    reason_code   TEXT        CHECK (reason_code IS NULL OR char_length(reason_code) BETWEEN 3 AND 64),
    -- من فعل الانتقال: نظام (مهلة/انتهاء) أو عميل أو سائق أو شريك أو مشرف.
    actor_type    TEXT        NOT NULL
                  CHECK (actor_type IN ('system','customer','driver','partner','admin')),
    -- مرجع الفاعل حين يكون شخصاً: مُعرّف عام opaque لا معرّف قناة (ADR-007).
    actor_ref     TEXT        CHECK (actor_ref IS NULL OR actor_ref ~ '^WS-[0-9]{10}$'),
    trace_id      TEXT        CHECK (trace_id IS NULL OR char_length(trace_id) <= 128),
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ux_order_status_history_order_sequence UNIQUE (order_id, sequence),
    -- انتقال إلى الحالة نفسها ليس انتقالاً.
    CONSTRAINT ck_order_status_history_progresses CHECK (from_status IS NULL OR from_status <> to_status),
    -- فاعل بشري يجب أن يكون معروفاً؛ والنظام لا مرجع له.
    CONSTRAINT ck_order_status_history_actor_ref CHECK (
        (actor_type = 'system' AND actor_ref IS NULL) OR (actor_type <> 'system' AND actor_ref IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS ix_order_status_history_order ON order_status_history (order_id, sequence);

-- ─────────────────────────────────────────────────────────────────────
-- 4) order_assignments — **سجل** الإسناد لا محرّكه (§16)
--    Phase 06 تسجّل من أُسنِد إليه؛ اختيار المرشّحين والأمواج والمهل مِلْك Phase 07.
--    `driver_public_id` مرجع opaque **بلا FK**: Phase 05 لم تبدأ، وأهلية السائق ليست
--    مسؤولية المحرّك (ADR-010 القرار 4).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_assignments (
    id                UUID        PRIMARY KEY,
    order_id          UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    driver_public_id  TEXT        NOT NULL
                      CHECK (driver_public_id ~ '^WS-[0-9]{10}$'),
    sequence          SMALLINT    NOT NULL CHECK (sequence >= 1),   -- ترتيب المحاولة على الطلب
    assignment_state  TEXT        NOT NULL DEFAULT 'offered'
                      CHECK (assignment_state IN ('offered','accepted','rejected','expired','cancelled')),
    offered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at       TIMESTAMPTZ,
    rejected_at       TIMESTAMPTZ,
    expired_at        TIMESTAMPTZ,
    cancelled_at      TIMESTAMPTZ,
    reason_code       TEXT        CHECK (reason_code IS NULL OR char_length(reason_code) BETWEEN 3 AND 64),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ux_order_assignments_order_sequence UNIQUE (order_id, sequence),
    -- سائق واحد لا يُعرَض عليه الطلب نفسه مرّتين: إعادة العرض على من رفض إزعاجٌ لا سياسة.
    CONSTRAINT ux_order_assignments_order_driver UNIQUE (order_id, driver_public_id),
    -- الطابع الزمني يطابق الحالة: «مقبول» بلا accepted_at سجلٌّ يكذب.
    CONSTRAINT ck_order_assignments_state_timestamp CHECK (
        (assignment_state = 'offered'   AND accepted_at IS NULL AND rejected_at IS NULL AND expired_at IS NULL AND cancelled_at IS NULL)
        OR (assignment_state = 'accepted'  AND accepted_at  IS NOT NULL)
        OR (assignment_state = 'rejected'  AND rejected_at  IS NOT NULL)
        OR (assignment_state = 'expired'   AND expired_at   IS NOT NULL)
        OR (assignment_state = 'cancelled' AND cancelled_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS ix_order_assignments_order  ON order_assignments (order_id, sequence);
CREATE INDEX IF NOT EXISTS ix_order_assignments_driver ON order_assignments (driver_public_id, offered_at DESC);

-- مرجع الإسناد النشط يُضاف بعد الجدولين لأن الاعتماد متبادل بينهما.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS fk_orders_active_assignment;
ALTER TABLE orders ADD CONSTRAINT fk_orders_active_assignment
    FOREIGN KEY (active_assignment_id) REFERENCES order_assignments(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 5) order_outbox — صندوق الصادر (§77 · §37)
--    الحدث يُكتب في المعاملة نفسها التي غيّرت الحالة، فلا حالة بلا حدثها.
--    (هذا هو الفارق عن Phase 04: هناك كان الحدث يعبر منفذاً آخر، وهنا الجدولان لخدمة واحدة.)
--    الناشر (Publisher) مِلْك Phase 09 — الجدول هو الحدّ الذي سيقرأه.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_outbox (
    event_id       UUID        PRIMARY KEY,
    event_type     TEXT        NOT NULL,
    event_version  TEXT        NOT NULL CHECK (event_version ~ '^v[0-9]+$'),
    aggregate_type TEXT        NOT NULL CHECK (aggregate_type IN ('order','order_assignment')),
    aggregate_id   TEXT        NOT NULL,
    payload        JSONB       NOT NULL,
    trace_id       TEXT        CHECK (trace_id IS NULL OR char_length(trace_id) <= 128),
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ                                  -- NULL = لم يُنشر بعد
);

CREATE INDEX IF NOT EXISTS ix_order_outbox_unpublished ON order_outbox (occurred_at) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_order_outbox_aggregate   ON order_outbox (aggregate_type, aggregate_id, occurred_at);

-- ─────────────────────────────────────────────────────────────────────
-- 6) updated_at تملكه القاعدة (نفس نمط خدمة العميل)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION order_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION order_set_updated_at();

DROP TRIGGER IF EXISTS trg_order_assignments_updated_at ON order_assignments;
CREATE TRIGGER trg_order_assignments_updated_at BEFORE UPDATE ON order_assignments
    FOR EACH ROW EXECUTE FUNCTION order_set_updated_at();

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- التراجع (rollback) — يُحذف بترتيب عكسي للتبعيات.
-- ─────────────────────────────────────────────────────────────────────
-- ALTER TABLE orders DROP CONSTRAINT IF EXISTS fk_orders_active_assignment;
-- DROP TABLE IF EXISTS order_outbox;
-- DROP TABLE IF EXISTS order_assignments;
-- DROP TABLE IF EXISTS order_status_history;
-- DROP TABLE IF EXISTS order_stops;
-- DROP TABLE IF EXISTS orders;
-- DROP FUNCTION IF EXISTS order_set_updated_at();
-- DROP SEQUENCE IF EXISTS order_public_id_seq;
