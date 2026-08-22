-- WASLA Negotiation & Chat Service — Data Contract (PostgreSQL DDL)
-- Phase 08 — Negotiation & Chat (خدمة التفاوض والمحادثة)
--
-- المبدأ الجوهري (ADR-013):
--   - **الخيط ثنائيّ**: تفاوضٌ واحد يربط طلباً واحداً بسائقٍ واحد، ولا يُفتح إلّا على
--     عرض توزيع قائم (`dispatch_offer_id`). لا مزادَ جماعياً في هذه المرحلة: خيطٌ واحد
--     لطلبٍ يتحدّث فيه عدّة سائقين يجعل «السعر المتفَق عليه» جملةً بلا فاعل، ويُدخل
--     الخدمة في قرار الاختيار وهو قرار التوزيع لا قرارها.
--   - **التفاوض لا يملك سعر الطلب.** لا يوجد في هذا المخطّط ما يكتب في `orders`، ولا
--     عمود يدّعي حالة طلب. المبلغ المتفَق عليه يُسلَّم إلى محرّك الطلب عبر منفذ واحد
--     (`AgreedPricePort`)، والمحرّك وحده يكتبه في الطلب — سابقة `OrderIntakePort`
--     (ADR-009 §3) و`CandidacyPort` (ADR-012 القرار 3).
--   - **المحاولة تُسجَّل قبل نتيجتها** (`negotiation_price_handoffs`): بعد شهر يُسأل
--     «لماذا يحمل هذا الطلب هذا السعر؟» فيبدأ الجواب من هنا لا من ذاكرة أحد. وفشل
--     التسليم **لا يُبطل الاتفاق**: الاتفاق حدث بين طرفين، وعجزُ الشبكة عن نقله ليس
--     رجوعاً عنه (سابقة ADR-012 القرار 3).
--   - **المال أعداد صحيحة بوحدة صغرى وعملة صريحة**: `amount_minor BIGINT` و`currency`
--     بثلاثة أحرف. لا `NUMERIC` للمال ولا `FLOAT` بحال: التفاوض يقارن مبالغ ويُساويها،
--     ومساواةُ العواشر الثنائية كذبةٌ تظهر بعد النشر.
--   - **الزمن نبضة لا مؤقّت** (سابقة ADR-011 القرار 3 · ADR-012 القرار 5): انتهاء دور
--     أو خيط **ليس** حالة تكتبها وظيفة خلفية، بل استحقاق مخزّن (`expires_at`) يُقارَن
--     بساعة مُحقونة، و`next_tick_at` هو الفهرس الذي تقرؤه النبضة. فإعادة تشغيل الخدمة
--     لا تُفقِد انتهاءً، والاختبار يُقدّم الساعة بلا `sleep`.
--   - **المحادثة محتوى، والحدث ليس محتوى**: `body` نصٌّ كتبه المستخدم يُخزَّن هنا
--     ويُسلَّم إلى الطرف الآخر، و**ممنوع** أن يظهر في أي حمولة حدث (ADR-013 القرار 6 ·
--     سابقة ADR-009 §7 في `shipment_description`).
--   - **الترجمة عَرضٌ لا تخزين** (القرار 7): يُخزَّن `source_locale` فقط. لا جدول
--     `negotiation_message_translations`: نصٌّ مترجم مخزّن يصير حقيقة ثانية تتخلّف عن
--     الأولى عند أي حجب أو تصحيح، ولا أحد يعرف أيّهما المرجع.
--   - **الحدود المخزَّنة سياسة مُرقّمة ومُقفَلة** (`negotiation_policies`): الحدّ الأدنى
--     والأعلى للمبلغ وعدد الأدوار والمهل كلّها نسخة مجمّدة، لا أرقام في الكود. تغيير
--     السياسة نسخة جديدة، فيبقى كل خيط قابلاً للتفسير بالسياسة التي حكمَته.
--   - **الدفع والتسوية ليسا هنا** (§19 · Phase 19): لا `payment_status` ولا `settlement`.
--     والسمعة ليست هنا (Phase 09): لا `rating` ولا عمود يُحصي سلوك التفاوض.
--     ومحرّك التسعير ليس هنا: لا `suggested_amount_minor` ولا نموذج يقترح سعراً.
--   - القناة لا تظهر: لا `telegram` ولا `chat_id` في أي عمود (ADR-007). واجهة المحادثة
--     طبقة توصيل تُبنى فوق هذا العقد لا داخله.
--
-- المصدر: PostgreSQL (source of truth). Domain Events عبر Outbox من البداية.
-- الترقيم: أي ترحيل (migration) يجب أن يكون عكوساً (reversible) وموثّقاً في TASK_LOG.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) negotiation_policies — سياسة التفاوض، نسخةً مجمّدة
--    نفس شكل `driver_eligibility_policies`: النسخة تُجمَّد ثمّ تُستعمل، ولا تُعدَّل بعد
--    التجميد. خيطٌ يشير إلى نسخة قابلة للتعديل هو خيطٌ لا يمكن تفسير قراره لاحقاً.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS negotiation_policies (
    policy_version        INTEGER     PRIMARY KEY CHECK (policy_version >= 1),
    label                 TEXT        NOT NULL CHECK (char_length(label) BETWEEN 3 AND 64),
    currency              TEXT        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

    -- حدود المبلغ: عرضٌ بريال واحد وعرضٌ بمليون كلاهما إساءة لا تفاوض.
    min_amount_minor      BIGINT      NOT NULL CHECK (min_amount_minor > 0),
    max_amount_minor      BIGINT      NOT NULL CHECK (max_amount_minor > 0),

    -- سقف الأدوار: التفاوض بلا سقف يُبقي الطلب معلّقاً ويُتعب الطرفين.
    max_rounds            INTEGER     NOT NULL CHECK (max_rounds BETWEEN 1 AND 20),

    -- مهلة الدور ومهلة الخيط بالثواني. الثواني لا الفواصل الزمنية كي تكون المقارنة
    -- في المجال حسابَ أعداد لا حسابَ أنواع قاعدة.
    round_ttl_seconds     INTEGER     NOT NULL CHECK (round_ttl_seconds BETWEEN 30 AND 3600),
    thread_ttl_seconds    INTEGER     NOT NULL CHECK (thread_ttl_seconds BETWEEN 60 AND 86400),

    max_message_length    INTEGER     NOT NULL CHECK (max_message_length BETWEEN 1 AND 1000),
    max_messages_per_thread INTEGER   NOT NULL CHECK (max_messages_per_thread BETWEEN 1 AND 500),

    is_frozen             BOOLEAN     NOT NULL DEFAULT false,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_negotiation_policies_amount_bounds CHECK (max_amount_minor > min_amount_minor),
    -- مهلة الخيط لا تقصر عن مهلة دور واحد: خيطٌ ينتهي قبل أن يُجاب أول عرضٍ فيه سياسة عبثية.
    CONSTRAINT ck_negotiation_policies_ttl_order CHECK (thread_ttl_seconds >= round_ttl_seconds)
);

-- النسخة 1: أرقامٌ **مُعلَنة** لا إغفال. من يريد غيرها يُصدر نسخة 2 ويُبرّرها في ADR.
--   • حدود المبلغ 500..500000 هللة (5..5000 ريال) — نطاق مشوار أو توصيل داخل مدينة.
--   • خمسة أدوار: أكثر من ذلك مساومةٌ لا تفاوض، وأقلّ يمنع عرضاً مضادّاً معقولاً.
--   • 120 ثانية للدور و900 للخيط: العدّاد التنازلي الذي يراه الطرفان هو هذا الرقم.
INSERT INTO negotiation_policies (
    policy_version, label, currency,
    min_amount_minor, max_amount_minor, max_rounds,
    round_ttl_seconds, thread_ttl_seconds,
    max_message_length, max_messages_per_thread, is_frozen
)
VALUES (1, 'saudi-launch-v1', 'SAR', 500, 500000, 5, 120, 900, 1000, 100, true)
ON CONFLICT (policy_version) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 2) negotiation_threads — خيط التفاوض (طلب × سائق)
--    `state` يُعدّد الحالات، والانتقالات تُفرَض في `domain/state-machine.ts` لا في القاعدة:
--    سابقة ADR-010 القرار 2 — قيدُ قاعدة لا يعرف الحالة السابقة إلّا بمُشغّل، والمُشغّل
--    يُخفي القاعدة عن مخزن الذاكرة فتُثبت البوابة شيئاً في وضع وشيئاً آخر في وضع.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS negotiation_threads (
    id                    UUID        PRIMARY KEY,

    -- مراجع opaque بلا FK: كلٌّ من الطلب والسائق والعميل والعرض في خدمة أخرى وقاعدة أخرى
    -- (سابقة ADR-009 §1). الشكل يُتحقَّق منه هنا، والوجود يُتحقَّق منه عبر منفذ.
    order_public_id       TEXT        NOT NULL CHECK (order_public_id ~ '^ORD-[0-9]{10}$'),
    customer_public_id    TEXT        NOT NULL CHECK (customer_public_id ~ '^WS-[0-9]{10}$'),
    driver_public_id      TEXT        NOT NULL CHECK (driver_public_id ~ '^WS-[0-9]{10}$'),
    dispatch_offer_id     UUID        NOT NULL,

    -- مُقفلة ومطابقة حرفياً لعقد الطلب (`orders.order_type`) وعقد السائق: نقصُ عنصر
    -- يمنع تفاوضاً مشروعاً، وزيادته تفتح خيطاً لا يملكه أحد.
    service_kind          TEXT        NOT NULL CHECK (service_kind IN ('ride','delivery')),

    state                 TEXT        NOT NULL DEFAULT 'open'
                          CHECK (state IN ('open','agreed','declined','expired','cancelled')),
    -- لا نهاية بلا سبب (سابقة `ck_orders_terminal_needs_reason`).
    close_reason_code     TEXT        CHECK (close_reason_code IS NULL OR close_reason_code IN (
                              'agreed',
                              'declined_by_customer','declined_by_driver',
                              'max_rounds_reached','thread_expired',
                              'cancelled_by_dispatch','order_withdrawn'
                          )),

    policy_version        INTEGER     NOT NULL REFERENCES negotiation_policies(policy_version),
    currency              TEXT        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

    -- المبلغ الذي فُتح به الخيط: يُحفَظ لأن السؤال «من أين بدأ التفاوض؟» يُسأل كثيراً،
    -- ولأن الدور رقم 1 قد ينتهي ويُستبدل فيضيع الأصل لو لم يُثبَّت هنا.
    opening_amount_minor  BIGINT      NOT NULL CHECK (opening_amount_minor > 0),
    -- من فتح الخيط: عرض العميل أو طلب السائق سعراً.
    opened_by             TEXT        NOT NULL CHECK (opened_by IN ('customer','driver')),

    round_count           INTEGER     NOT NULL DEFAULT 0 CHECK (round_count >= 0),
    -- رقم آخر دور مُنشَأ. مرافق لـ`round_count` عمداً: الأول عدّاد والثاني مؤشّر، وفصلهما
    -- يجعل التفاؤل (`expected_round_no`) قابلاً للتحقّق بلا قراءة الجدول الفرعي.
    current_round_no      INTEGER     NOT NULL DEFAULT 0 CHECK (current_round_no >= 0),
    agreed_round_no       INTEGER     CHECK (agreed_round_no IS NULL OR agreed_round_no >= 1),

    expires_at            TIMESTAMPTZ NOT NULL,
    -- أقرب استحقاق يعني هذا الخيط: أدنى (انتهاء الدور المعلّق، انتهاء الخيط). NULL بعد الإغلاق.
    next_tick_at          TIMESTAMPTZ,
    closed_at             TIMESTAMPTZ,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- تفاؤل الكتابة: قبولان متزامنان لا يُنتجان اتفاقين.
    version               INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),

    -- خيطٌ واحد لكل (طلب × سائق): إعادة العرض على السائق نفسه تُكمل خيطه لا تفتح ثانياً،
    -- وإلّا صار «ما اتّفقنا عليه» سؤالاً بجوابين.
    CONSTRAINT ux_negotiation_threads_order_driver UNIQUE (order_public_id, driver_public_id),
    -- عرضُ توزيعٍ واحد لا يُنتج خيطين.
    CONSTRAINT ux_negotiation_threads_dispatch_offer UNIQUE (dispatch_offer_id),

    -- الحالة المفتوحة لا تحمل أثر إغلاق، والمغلقة تحمله كاملاً.
    CONSTRAINT ck_negotiation_threads_open_is_clean CHECK (
        state <> 'open'
        OR (closed_at IS NULL AND agreed_round_no IS NULL AND close_reason_code IS NULL)
    ),
    CONSTRAINT ck_negotiation_threads_closed_has_reason CHECK (
        state = 'open'
        OR (closed_at IS NOT NULL AND close_reason_code IS NOT NULL AND next_tick_at IS NULL)
    ),
    -- `agreed` وحدها تسمّي دوراً، وهي وحدها سببها `agreed`: حالة تقول «اتُّفق» بلا دور
    -- هي مبلغٌ بلا مصدر، ودورٌ متَّفق عليه في خيط مرفوض هو تناقض صريح.
    CONSTRAINT ck_negotiation_threads_agreed_names_round CHECK (
        (state = 'agreed' AND agreed_round_no IS NOT NULL AND close_reason_code = 'agreed')
        OR (state <> 'agreed' AND agreed_round_no IS NULL AND close_reason_code <> 'agreed')
        OR state = 'open'
    ),
    -- المؤشّر لا يسبق العدّاد، والدور المتَّفق عليه موجود فعلاً.
    CONSTRAINT ck_negotiation_threads_round_counters CHECK (current_round_no <= round_count),
    CONSTRAINT ck_negotiation_threads_agreed_round_exists CHECK (
        agreed_round_no IS NULL OR agreed_round_no <= current_round_no
    )
);

CREATE INDEX IF NOT EXISTS ix_negotiation_threads_order   ON negotiation_threads (order_public_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_negotiation_threads_driver  ON negotiation_threads (driver_public_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_negotiation_threads_state   ON negotiation_threads (state, created_at DESC);
-- الفهرس الذي تقرؤه النبضة: الخيوط المفتوحة المستحقّة فقط.
CREATE INDEX IF NOT EXISTS ix_negotiation_threads_tick_due
    ON negotiation_threads (next_tick_at) WHERE state = 'open';

-- ─────────────────────────────────────────────────────────────────────
-- 3) negotiation_rounds — الأدوار: عرضٌ ومقابله
--    الدور وحدة التفاوض: مبلغٌ اقترحه طرفٌ في لحظة، له مهلة ونتيجة واحدة.
--    التبادل (لا يقترح طرفٌ دورين متتاليين) يُفرَض في المجال: القيد يحتاج معرفة الصف
--    السابق، وذلك مُشغّل، والمُشغّل يُخفي القاعدة عن مخزن الذاكرة.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS negotiation_rounds (
    id                    UUID        PRIMARY KEY,
    thread_id             UUID        NOT NULL REFERENCES negotiation_threads(id) ON DELETE CASCADE,
    round_no              INTEGER     NOT NULL CHECK (round_no >= 1),
    proposed_by           TEXT        NOT NULL CHECK (proposed_by IN ('customer','driver')),

    amount_minor          BIGINT      NOT NULL CHECK (amount_minor > 0),
    currency              TEXT        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

    state                 TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (state IN ('pending','accepted','rejected','superseded','expired')),
    -- من حسم الدور. NULL على `pending`، ومطلوب على القبول والرفض؛ و`superseded`
    -- و`expired` لا فاعل لهما: الأولى نتيجة عرضٍ مضادّ والثانية نتيجة زمن.
    resolved_by           TEXT        CHECK (resolved_by IS NULL OR resolved_by IN ('customer','driver')),

    expires_at            TIMESTAMPTZ NOT NULL,
    responded_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ux_negotiation_rounds_thread_no UNIQUE (thread_id, round_no),
    CONSTRAINT ck_negotiation_rounds_state_timestamp CHECK (
        (state = 'pending'  AND responded_at IS NULL     AND resolved_by IS NULL)
        OR (state IN ('accepted','rejected') AND responded_at IS NOT NULL AND resolved_by IS NOT NULL)
        OR (state IN ('superseded','expired') AND resolved_by IS NULL)
    ),
    -- من اقترح لا يحسم: القبول الذاتي ليس اتفاقاً بل إعلان (القرار 3).
    CONSTRAINT ck_negotiation_rounds_no_self_resolution CHECK (
        resolved_by IS NULL OR resolved_by <> proposed_by
    )
);

CREATE INDEX IF NOT EXISTS ix_negotiation_rounds_thread ON negotiation_rounds (thread_id, round_no DESC);
-- دورٌ معلّق واحد لكل خيط: حارسٌ قاعدة لا «إن كان» يتسابق في عمليتين
-- (سابقة `ux_dispatch_offers_one_accepted_job`).
CREATE UNIQUE INDEX IF NOT EXISTS ux_negotiation_rounds_one_pending
    ON negotiation_rounds (thread_id) WHERE state = 'pending';
-- ودورٌ مقبول واحد على الأكثر: الاتفاق لا يتكرّر.
CREATE UNIQUE INDEX IF NOT EXISTS ux_negotiation_rounds_one_accepted
    ON negotiation_rounds (thread_id) WHERE state = 'accepted';
CREATE INDEX IF NOT EXISTS ix_negotiation_rounds_pending_due
    ON negotiation_rounds (expires_at) WHERE state = 'pending';

-- ─────────────────────────────────────────────────────────────────────
-- 4) negotiation_messages — رسائل المحادثة
--    `body` نصّ كتبه المستخدم: يُخزَّن ويُسلَّم، و**ممنوع** أن يظهر في أي حدث.
--    الحجب (`redacted_at`) لا يحذف الصفّ: حذفُ رسالةٍ يُفقد تسلسل المحادثة ويجعل
--    شكوى «قال لي كذا» غير قابلة للفحص. النصّ يُفرَّغ والصفّ يبقى.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS negotiation_messages (
    id                    UUID        PRIMARY KEY,
    thread_id             UUID        NOT NULL REFERENCES negotiation_threads(id) ON DELETE CASCADE,
    sequence_no           INTEGER     NOT NULL CHECK (sequence_no >= 1),
    author_role           TEXT        NOT NULL CHECK (author_role IN ('customer','driver','system')),

    body                  TEXT        CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 1000),
    -- لغة النصّ كما كُتب. الترجمة عَرضٌ لا تخزين (القرار 7).
    source_locale         TEXT        NOT NULL DEFAULT 'ar' CHECK (source_locale IN ('ar','en','ur')),
    -- رمز رسالة النظام (مثل `round_expired`) بدل نصٍّ مُترجم مخزّن: الرمز يُعرَض بأي لغة،
    -- والنصّ المخزّن يُقفل الرسالة على لغة كاتبها.
    system_code           TEXT        CHECK (system_code IS NULL OR char_length(system_code) BETWEEN 3 AND 64),
    -- ربطٌ اختياري بدور: «هذه الرسالة صاحبت هذا العرض».
    round_no              INTEGER     CHECK (round_no IS NULL OR round_no >= 1),

    redacted_at           TIMESTAMPTZ,
    redaction_reason_code TEXT        CHECK (redaction_reason_code IS NULL OR char_length(redaction_reason_code) BETWEEN 3 AND 64),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ux_negotiation_messages_thread_seq UNIQUE (thread_id, sequence_no),
    -- رسالة الطرفين نصّ بلا رمز، ورسالة النظام رمز بلا نصّ: خلطهما يجعل العارض يخمّن.
    CONSTRAINT ck_negotiation_messages_body_or_code CHECK (
        (author_role IN ('customer','driver') AND system_code IS NULL AND (body IS NOT NULL OR redacted_at IS NOT NULL))
        OR (author_role = 'system' AND system_code IS NOT NULL AND body IS NULL)
    ),
    -- المحجوب لا نصّ له وله سبب: حجبٌ بلا سبب لا يُدافَع عنه بعد شهر.
    CONSTRAINT ck_negotiation_messages_redaction CHECK (
        (redacted_at IS NULL AND redaction_reason_code IS NULL)
        OR (redacted_at IS NOT NULL AND redaction_reason_code IS NOT NULL AND body IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS ix_negotiation_messages_thread ON negotiation_messages (thread_id, sequence_no);

-- ─────────────────────────────────────────────────────────────────────
-- 5) negotiation_agreements — الاتفاق: صفٌّ واحد لكل خيط متَّفق عليه
--    جدولٌ منفصل لا أعمدة في الخيط: الاتفاق كيانٌ يُسلَّم إلى محرّك الطلب وله دورة
--    تسليم خاصّة (`handoff_state`)، ولو سكن أعمدةَ الخيط لخلط «ما اتّفقا عليه» بـ«هل
--    وصل الخبر»، وهما سؤالان مختلفان جوابهما مختلف.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS negotiation_agreements (
    thread_id             UUID        PRIMARY KEY REFERENCES negotiation_threads(id) ON DELETE CASCADE,
    order_public_id       TEXT        NOT NULL CHECK (order_public_id ~ '^ORD-[0-9]{10}$'),
    driver_public_id      TEXT        NOT NULL CHECK (driver_public_id ~ '^WS-[0-9]{10}$'),
    round_no              INTEGER     NOT NULL CHECK (round_no >= 1),

    amount_minor          BIGINT      NOT NULL CHECK (amount_minor > 0),
    currency              TEXT        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    -- من قَبِل الدور فصار الاتفاق. مقترحُ الدور هو الطرف الآخر بالضرورة.
    accepted_by           TEXT        NOT NULL CHECK (accepted_by IN ('customer','driver')),
    policy_version        INTEGER     NOT NULL REFERENCES negotiation_policies(policy_version),
    agreed_at             TIMESTAMPTZ NOT NULL,

    -- حالة تسليم السعر إلى محرّك الطلب. `rejected` حالةٌ نهائية لا تُعاد محاولتها:
    -- محرّك الطلب قال «لا يقبل هذا الطلب سعراً الآن»، وإعادة السؤال إزعاجٌ لا إصلاح.
    handoff_state         TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (handoff_state IN ('pending','handed_off','rejected','abandoned')),
    handoff_attempts      INTEGER     NOT NULL DEFAULT 0 CHECK (handoff_attempts >= 0),
    handed_off_at         TIMESTAMPTZ,
    -- أقرب موعد لإعادة المحاولة. النبضة تقرؤه؛ لا مؤقّت.
    next_handoff_at       TIMESTAMPTZ,
    last_error_code       TEXT        CHECK (last_error_code IS NULL OR char_length(last_error_code) BETWEEN 3 AND 64),

    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- اتفاقٌ واحد لكل طلب × سائق (مضاعف لقيد الخيط، مقصود: الجدول يُقرأ وحده كثيراً).
    CONSTRAINT ux_negotiation_agreements_order_driver UNIQUE (order_public_id, driver_public_id),
    CONSTRAINT ck_negotiation_agreements_handed_off_at CHECK (
        (handoff_state = 'handed_off' AND handed_off_at IS NOT NULL AND next_handoff_at IS NULL)
        OR (handoff_state <> 'handed_off' AND handed_off_at IS NULL)
    ),
    -- ما لا يُعاد لا موعد له، والفشل يُسمّي سببه.
    CONSTRAINT ck_negotiation_agreements_terminal_no_retry CHECK (
        handoff_state NOT IN ('rejected','abandoned') OR next_handoff_at IS NULL
    ),
    CONSTRAINT ck_negotiation_agreements_failure_named CHECK (
        handoff_state NOT IN ('rejected','abandoned') OR last_error_code IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS ix_negotiation_agreements_order ON negotiation_agreements (order_public_id);
CREATE INDEX IF NOT EXISTS ix_negotiation_agreements_handoff_due
    ON negotiation_agreements (next_handoff_at) WHERE handoff_state = 'pending';

-- ─────────────────────────────────────────────────────────────────────
-- 6) negotiation_price_handoffs — سجلّ محاولات تسليم السعر
--    كل محاولة صفٌّ يُكتب **قبل** معرفة نتيجتها ثمّ تُكمَل نتيجته: محاولةٌ تُسجَّل بعد
--    نجاحها تُخفي الفشل الصامت (سابقة `driver_candidacy_publications`).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS negotiation_price_handoffs (
    id                    UUID        PRIMARY KEY,
    thread_id             UUID        NOT NULL REFERENCES negotiation_agreements(thread_id) ON DELETE CASCADE,
    attempt_no            INTEGER     NOT NULL CHECK (attempt_no >= 1),
    amount_minor          BIGINT      NOT NULL CHECK (amount_minor > 0),
    currency              TEXT        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    requested_at          TIMESTAMPTZ NOT NULL,
    -- NULL يعني «محاولة بدأت ولم تُكمَل»: انقطاعٌ وقع أثناءها، وهي معلومة لا نقص.
    outcome               TEXT        CHECK (outcome IS NULL OR outcome IN ('accepted','rejected','unavailable')),
    response_status       INTEGER     CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
    error_code            TEXT        CHECK (error_code IS NULL OR char_length(error_code) BETWEEN 3 AND 64),
    completed_at          TIMESTAMPTZ,

    CONSTRAINT ux_negotiation_price_handoffs_attempt UNIQUE (thread_id, attempt_no),
    CONSTRAINT ck_negotiation_price_handoffs_completion CHECK (
        (outcome IS NULL AND completed_at IS NULL)
        OR (outcome IS NOT NULL AND completed_at IS NOT NULL)
    ),
    -- كل نتيجة غير القبول تُسمّي رمز خطئها.
    CONSTRAINT ck_negotiation_price_handoffs_failure_named CHECK (
        outcome IS NULL OR outcome = 'accepted' OR error_code IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS ix_negotiation_price_handoffs_thread
    ON negotiation_price_handoffs (thread_id, attempt_no DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 7) negotiation_idempotency — سجلّ المفاتيح، بنفس شكل الخدمات السابقة
--    البصمة تكشف إعادة المفتاح بحمولة مختلفة بالمقارنة لا بقراءة الحقول.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS negotiation_idempotency (
    idempotency_key       TEXT        PRIMARY KEY
                          CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
    scope                 TEXT        NOT NULL CHECK (scope IN (
                              'open_thread','propose_round','accept_round',
                              'reject_round','post_message','cancel_thread'
                          )),
    thread_id             UUID        REFERENCES negotiation_threads(id) ON DELETE CASCADE,
    payload_fingerprint   TEXT        NOT NULL CHECK (char_length(payload_fingerprint) = 64),
    response_status       INTEGER     NOT NULL CHECK (response_status BETWEEN 100 AND 599),
    response_body         JSONB       NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_negotiation_idempotency_thread ON negotiation_idempotency (thread_id);

-- ─────────────────────────────────────────────────────────────────────
-- 8) negotiation_outbox — صندوق الصادر، بنفس شكل `order_outbox` و`dispatch_outbox`
--    القرار وحدثه في معاملة واحدة، فلا تغيير صامت. والناشر نفسه ليس من هذه المرحلة.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS negotiation_outbox (
    id                    UUID        PRIMARY KEY,
    aggregate_type        TEXT        NOT NULL CHECK (aggregate_type IN (
                              'negotiation_thread','negotiation_round','negotiation_message'
                          )),
    aggregate_id          TEXT        NOT NULL,
    event_type            TEXT        NOT NULL CHECK (char_length(event_type) >= 3),
    event_version         TEXT        NOT NULL CHECK (event_version ~ '^v[0-9]+$'),
    payload               JSONB       NOT NULL,
    occurred_at           TIMESTAMPTZ NOT NULL,
    published_at          TIMESTAMPTZ,
    attempts              INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error            TEXT,
    trace_id              TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_negotiation_outbox_unpublished
    ON negotiation_outbox (occurred_at) WHERE published_at IS NULL;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- الترحيل العكسي (rollback) — يُنفَّذ بترتيب معاكس للاعتماديات
-- ─────────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP TABLE IF EXISTS negotiation_outbox;
-- DROP TABLE IF EXISTS negotiation_idempotency;
-- DROP TABLE IF EXISTS negotiation_price_handoffs;
-- DROP TABLE IF EXISTS negotiation_agreements;
-- DROP TABLE IF EXISTS negotiation_messages;
-- DROP TABLE IF EXISTS negotiation_rounds;
-- DROP TABLE IF EXISTS negotiation_threads;
-- DROP TABLE IF EXISTS negotiation_policies;
-- COMMIT;
