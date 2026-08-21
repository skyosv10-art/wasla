-- WASLA Matching Service — Data Contract (PostgreSQL DDL)
-- Phase 07 — Matching & Dispatch (خدمة المطابقة)
--
-- المبدأ الجوهري (ADR-011):
--   - هذه الخدمة تجيب سؤالاً واحداً: **من المرشّحون، وبأي ترتيب؟** لا تعرف عرضاً ولا مهلة
--     ولا طلباً مفتوحاً. التنسيق كلّه عند `services/dispatch` (§16: لا نخلط بين Matching وDispatch).
--   - `driver_candidacy` **إسقاط ترشيح** لا ملف سائق: يحمل ما تحتاجه الفلاتر الصلبة فقط.
--     لا اسم ولا هاتف ولا وثيقة ولا موقع خام — من يحتاج ملفاً كاملاً ينتظر Phase 05.
--   - `driver_public_id` مرجع opaque بـCHECK **بلا FK** (سابقة ADR-009 §1 · ADR-010 القرار 4):
--     جدول السائق غير موجود بعد، والانتظار كان سيُدخل مرحلةً على المسار الحرج في انتظار
--     مرحلة خارجه.
--   - **الأهلية مُدّعاة لا مُتحقَّقة** حتى Phase 05، ولذلك يُخزَّن `eligibility_source` مع الصفّ:
--     من يقرأ الصفّ بعد شهر يعرف **من قال هذا** ولا يظنّه تحقّقاً.
--   - **المجهول ليس مرشّحاً (fail-closed)**: لا صفّ ⇒ لا ترشيح؛ أهليّة غير `eligible` ⇒ لا ترشيح؛
--     وصفّ قديم (`updated_at` أقدم من نافذة الحداثة) ⇒ لا ترشيح. «متاح قبل ساعتين» ليست معلومة
--     توافر، والفشل المفتوح هنا يعني عرضاً يُهدر على سائق نائم ومهلةً تُستهلك بلا مقابل.
--   - `zone_id` مرجع opaque إلى هرم الجغرافيا **بلا FK** (ADR-006): التحقّق عبر منفذ لا عبر قيد.
--   - **الأوزان بيانات لا كود** (§30.2 · ADR-011 القرار 6): `matching_rulesets` بنسخة مُرقّمة
--     **لا تُحرَّر بعد استعمالها**. تغيير الترتيب = نسخة جديدة، فتبقى قرارات الأمس مفهومة
--     بقواعد الأمس.
--   - `matching_decisions` سجل تدقيق يجيب بعد شهر عن «لماذا هذا السائق؟». محتواه حسّاس
--     تنافسياً (مُعرّفات مرشّحين ودرجاتهم) فلا يُعاد في مسار عام ولا يدخل حمولة حدث
--     (ADR-011 القرار 8).
--   - القناة لا تظهر هنا: لا `telegram` ولا `chat_id` في أي عمود (ADR-007).
--
-- المصدر: PostgreSQL (source of truth). الترشيح إسقاط، والمصدر النهائي له يصير Phase 05.
-- الترقيم: أي ترحيل (migration) يجب أن يكون عكوساً (reversible) وموثّقاً في TASK_LOG.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) driver_candidacy — إسقاط الترشيح
--    مفتاحه المُعرّف العام لا UUID داخلي: الكاتب (بوت السائق اليوم، Driver Core لاحقاً)
--    لا يعرف إلّا هذا المُعرّف، وإعطاؤه مفتاحاً ثانياً يجعله يحتاج قراءة قبل كل كتابة.
--    الصفّ **يُستبدَل بالكامل** عند كل تحديث (PUT) لا يُدمَج: دمج جزئي على إسقاط يُنتج
--    خلائط لا يقصدها أحد (توافر جديد مع مناطق قديمة).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_candidacy (
    driver_public_id     TEXT        PRIMARY KEY
                         CHECK (driver_public_id ~ '^WS-[0-9]{10}$'),

    -- التوافر: حالة مُعلَنة من السائق أو مُشتقّة من قبولٍ مُلزِم (busy) أو من وصول
    -- الطلب إلى حالة نهائية (available). §78 «Busy/free transitions» يعيش هنا لا في
    -- محرّك الطلبات: المحرّك يعرف الإسناد ولا يعرف حالة السائق (ADR-010 القرار 4).
    availability_state   TEXT        NOT NULL DEFAULT 'offline'
                         CHECK (availability_state IN ('available','busy','offline')),

    -- الأهلية: مُدّعاة حتى Phase 05. `unknown` هي الحالة الافتراضية الصادقة —
    -- لا `eligible` — لأن الافتراضي المتساهل يُنتج عروضاً لسائقين لا نعرف عنهم شيئاً.
    eligibility_state    TEXT        NOT NULL DEFAULT 'unknown'
                         CHECK (eligibility_state IN ('eligible','ineligible','suspended','unknown')),
    -- من قال إنّه مؤهَّل. `driver_core` يظهر حين توجد Phase 05، وحينها يتغيّر المُنادي
    -- ولا يتغيّر هذا الجدول.
    eligibility_source   TEXT        NOT NULL DEFAULT 'claimed'
                         CHECK (eligibility_source IN ('claimed','driver_core')),

    -- أنواع الخدمة التي يقبلها، ومطابقتها لعقد الطلب (ADR-009 §7) شرط: قائمة مُقفلة
    -- هنا وهناك، لأن نقص عنصر يُخفي مرشّحاً صالحاً وزيادته تُنتج عرضاً لا يُنفَّذ.
    service_kinds        TEXT[]      NOT NULL DEFAULT '{}'
                         CHECK (
                             array_length(service_kinds, 1) IS NULL
                             OR service_kinds <@ ARRAY['ride','delivery']::TEXT[]
                         ),
    vehicle_class        TEXT        CHECK (vehicle_class IS NULL OR vehicle_class IN
                             ('sedan','suv','van','pickup','motorcycle','truck_small')),

    -- المناطق التي يخدمها: مُعرّفات من هرم الجغرافيا. التطابق يُحسَب بالهرم لا بالمساواة
    -- (ADR-006): المنطقة نفسها، أو منطقة يشملها أصلٌ يخدمه السائق.
    -- مراجع opaque إلى الجغرافيا (بلا FK) — ونوعها UUID كما في كل خدمة أخرى:
    -- نوع مختلف للمرجع نفسه يُنتج تحويلات صامتة عند كل حدّ.
    zone_ids             UUID[]      NOT NULL DEFAULT '{}',

    -- مُدخَلات العدالة (§31): بلا هذين العمودين تفوز الحسابات الأقدم دائماً.
    last_offered_at      TIMESTAMPTZ,
    last_assigned_at     TIMESTAMPTZ,

    -- عدّادات تاريخ المطابقة نفسها — لا سمعة ولا تقييم (محرّك السمعة مرحلة لاحقة،
    -- ولا نُخزّن تقييماً لا نملكه).
    offers_received      INTEGER     NOT NULL DEFAULT 0 CHECK (offers_received  >= 0),
    offers_accepted      INTEGER     NOT NULL DEFAULT 0 CHECK (offers_accepted  >= 0),
    orders_completed     INTEGER     NOT NULL DEFAULT 0 CHECK (orders_completed >= 0),
    -- لا يُقبل قبولٌ أكثر من عرض: عدّاد مستحيل يُنتج نسبة قبول أكبر من واحد فيقلب الترتيب.
    CONSTRAINT ck_candidacy_accepted_lte_received CHECK (offers_accepted <= offers_received),

    -- حداثة الصفّ: عمود القرار في fail-closed. الكاتب لا يملؤه — الخدمة تكتبه عند كل PUT.
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- من كتب الصفّ آخر مرّة (تدقيق): كود جهة لا مُعرّف مستخدم ولا مُعرّف قناة.
    updated_by           TEXT        NOT NULL DEFAULT 'unknown'
                         CHECK (updated_by IN ('driver_bot','admin','driver_core','test','unknown'))
);

-- المرشّح المُحتمَل وحده يُفهرَس: الفلترة تبدأ دائماً بـ(متاح · مؤهَّل)، والفهرس الجزئي
-- يُبقي حجمه بحجم السائقين المتاحين لا بحجم كل من سجّل يوماً.
CREATE INDEX IF NOT EXISTS ix_candidacy_ready
    ON driver_candidacy (updated_at DESC)
    WHERE availability_state = 'available' AND eligibility_state = 'eligible';
CREATE INDEX IF NOT EXISTS ix_candidacy_zones     ON driver_candidacy USING GIN (zone_ids);
CREATE INDEX IF NOT EXISTS ix_candidacy_services  ON driver_candidacy USING GIN (service_kinds);

-- ─────────────────────────────────────────────────────────────────────
-- 2) matching_rulesets — الأوزان والفلاتر بنسخها
--    §30.2 ينصّ أنّ النسب Configuration. وهنا قيدان يمنعان أسوأ خطأين:
--      (أ) مجموع الأوزان يجب أن يكون 100 بالضبط (بأعداد صحيحة: لا كسور عشرية في وزن،
--          لأن 0.1+0.2 ليست 0.3 وترتيب السائقين ليس موضعاً لطرافة العشريات).
--      (ب) النسخة المُستعمَلة **تُقفَل** (`is_frozen`) فلا تُحرَّر: تحرير نسخة مُستعمَلة
--          يُعيد كتابة تاريخ قرارات لا يمكن تفسيرها بعدها.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matching_rulesets (
    version                    INTEGER     PRIMARY KEY CHECK (version >= 1),
    label                      TEXT        NOT NULL CHECK (char_length(label) BETWEEN 3 AND 64),

    -- الأوزان: نقاط مئوية صحيحة. أوزان الصفر مذكورة صراحةً ولا تُحذف —
    -- الصفر المُعلَن يقول «المُدخَل غير موجود اليوم»، والحذف يقول «لم يفكّر أحد فيه».
    w_eta                      INTEGER     NOT NULL DEFAULT 0  CHECK (w_eta         BETWEEN 0 AND 100),
    w_distance                 INTEGER     NOT NULL DEFAULT 0  CHECK (w_distance    BETWEEN 0 AND 100),
    w_zone_proximity           INTEGER     NOT NULL DEFAULT 40 CHECK (w_zone_proximity BETWEEN 0 AND 100),
    w_completion               INTEGER     NOT NULL DEFAULT 20 CHECK (w_completion  BETWEEN 0 AND 100),
    w_rating                   INTEGER     NOT NULL DEFAULT 0  CHECK (w_rating      BETWEEN 0 AND 100),
    w_acceptance               INTEGER     NOT NULL DEFAULT 20 CHECK (w_acceptance  BETWEEN 0 AND 100),
    w_fairness                 INTEGER     NOT NULL DEFAULT 20 CHECK (w_fairness    BETWEEN 0 AND 100),
    CONSTRAINT ck_ruleset_weights_sum_100 CHECK (
        w_eta + w_distance + w_zone_proximity + w_completion
        + w_rating + w_acceptance + w_fairness = 100
    ),

    -- معاملات الفلاتر الصلبة
    candidacy_freshness_seconds INTEGER     NOT NULL DEFAULT 120 CHECK (candidacy_freshness_seconds BETWEEN 15 AND 3600),
    max_candidates              INTEGER     NOT NULL DEFAULT 20  CHECK (max_candidates BETWEEN 1 AND 200),
    -- سقف العدالة: أقصى ثوان تُحتسَب في مُدخَل «الوقت منذ آخر عرض». بلا سقف يصير من لم
    -- يُعرَض عليه شيء منذ شهر فائزاً دائماً بغضّ النظر عن كل شيء آخر.
    fairness_horizon_seconds    INTEGER     NOT NULL DEFAULT 3600 CHECK (fairness_horizon_seconds BETWEEN 60 AND 86400),

    is_frozen                   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    frozen_at                   TIMESTAMPTZ,
    CONSTRAINT ck_ruleset_frozen_at CHECK ((is_frozen = FALSE AND frozen_at IS NULL)
                                        OR (is_frozen = TRUE  AND frozen_at IS NOT NULL))
);

-- النسخة 1: الانحراف المُعلَن عن §30.2 (ADR-011 القرار 6). لا ETA ولا مسافة ولا تقييم،
-- لأن لا خدمة مسار ولا إحداثيات ولا محرّك سمعة في المستودع — ووزنٌ لمُدخَل مفقود
-- يُنتج ثابتاً يتنكّر في صورة ذكاء.
INSERT INTO matching_rulesets (
    version, label,
    w_eta, w_distance, w_zone_proximity, w_completion, w_rating, w_acceptance, w_fairness,
    is_frozen, frozen_at
) VALUES (
    1, 'phase07-mvp-zone-and-fairness',
    0, 0, 40, 20, 0, 20, 20,
    TRUE, now()
) ON CONFLICT (version) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 3) matching_decisions — سجل قرارات المطابقة (تدقيق)
--    يجيب بعد شهر عن «لماذا هذا السائق ولم يكن ذاك؟». يُخزَّن هنا **ما دخل الترتيب
--    وبأي درجة**، ونسخة القواعد التي أنتجته. بلا هذا الصفّ تصير شكوى سائق غير قابلة
--    للفحص، ويصير كل ادّعاء عدالة ادّعاءً.
--    نموّه سريع (صفّ لكل قرار) ولا سياسة تقليم في هذه المرحلة — دَين تشغيلي مُعلَن (Phase 09).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matching_decisions (
    id                  UUID        PRIMARY KEY,
    -- مرجع الطلب في خدمة أخرى: UUID بلا FK (§37).
    order_id            UUID        NOT NULL,
    order_public_id     TEXT        NOT NULL CHECK (order_public_id ~ '^ORD-[0-9]{10}$'),
    -- مرجع مهمّة التوزيع الطالبة، إن وُجدت. المطابقة لا تقرؤه ولا تعتمد عليه:
    -- يُحفظ للربط في التحقيق لا للمنطق (وإلّا انعكس اتجاه الاعتماد).
    dispatch_job_id     UUID,
    ruleset_version     INTEGER     NOT NULL REFERENCES matching_rulesets (version),

    requested_at        TIMESTAMPTZ NOT NULL,
    -- الساعة المُستعمَلة في الحساب: مُدخَل صريح لا `now()`، لأن العدالة تُقاس بفارق زمني
    -- ونتيجة الترتيب يجب أن تكون قابلة لإعادة الإنتاج بحرفها.
    evaluated_at        TIMESTAMPTZ NOT NULL,

    -- ماذا طُلب: الحقائق التي دخلت الفلاتر الصلبة (لا نصّ كتبه مستخدم — ADR-010 القرار 7).
    order_type          TEXT        NOT NULL CHECK (order_type IN ('ride','delivery')),
    vehicle_class       TEXT        NOT NULL,
    pickup_zone_id      UUID        NOT NULL,   -- مرجع opaque إلى الجغرافيا (بلا FK)
    excluded_count      INTEGER     NOT NULL DEFAULT 0 CHECK (excluded_count >= 0),

    -- الحصيلة
    considered_count    INTEGER     NOT NULL CHECK (considered_count >= 0),
    eligible_count      INTEGER     NOT NULL CHECK (eligible_count   >= 0),
    returned_count      INTEGER     NOT NULL CHECK (returned_count   >= 0),
    CONSTRAINT ck_decision_counts_monotonic CHECK (returned_count <= eligible_count
                                               AND eligible_count <= considered_count),
    -- لماذا خرج فارغاً: كود من الكتالوج لا نصّ. «صفر مرشّح» بلا سبب أسوأ من خطأ.
    empty_reason_code   TEXT        CHECK (empty_reason_code IS NULL OR char_length(empty_reason_code) BETWEEN 3 AND 64),
    CONSTRAINT ck_decision_empty_has_reason CHECK (returned_count > 0 OR empty_reason_code IS NOT NULL),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_decisions_order ON matching_decisions (order_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 4) matching_decision_candidates — صفوف الدرجات لكل قرار
--    مفصولة عن الجدول الأعلى لأن حجمها مضاعف (عشرون مرشّحاً لكل قرار) ولأن سياسة
--    التقليم ستختلف: يُمكن حذف الدرجات وإبقاء الحصيلة.
--    **بيانات حسّاسة تنافسياً** (ADR-011 القرار 8): لا تُعاد في مسار عام، ولا تدخل حدثاً.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matching_decision_candidates (
    decision_id       UUID        NOT NULL REFERENCES matching_decisions (id) ON DELETE CASCADE,
    rank              INTEGER     NOT NULL CHECK (rank >= 1),
    driver_public_id  TEXT        NOT NULL CHECK (driver_public_id ~ '^WS-[0-9]{10}$'),

    -- الدرجة الكلّية ومكوّناتها: تُخزَّن **بأعداد صحيحة من عشرة آلاف** (basis points)
    -- لا بعشريات، فتُقارَن مقارنةً تامّة ويُعاد إنتاج الترتيب حرفياً.
    score_bp          INTEGER     NOT NULL CHECK (score_bp BETWEEN 0 AND 10000),
    zone_proximity_bp INTEGER     NOT NULL CHECK (zone_proximity_bp BETWEEN 0 AND 10000),
    completion_bp     INTEGER     NOT NULL CHECK (completion_bp     BETWEEN 0 AND 10000),
    acceptance_bp     INTEGER     NOT NULL CHECK (acceptance_bp     BETWEEN 0 AND 10000),
    fairness_bp       INTEGER     NOT NULL CHECK (fairness_bp       BETWEEN 0 AND 10000),
    -- كيف حُسم التعادل، إن حُسم: مُعلَن لا عشوائي (ADR-011 القرار 6).
    tiebreak_by       TEXT        CHECK (tiebreak_by IS NULL OR tiebreak_by IN ('score','last_offered_at','driver_public_id')),

    PRIMARY KEY (decision_id, driver_public_id),
    -- رتبة مكرّرة في القرار نفسه = ترتيب غير حتميّ. القاعدة تمنعه.
    CONSTRAINT ux_decision_rank UNIQUE (decision_id, rank)
);

-- ─────────────────────────────────────────────────────────────────────
-- 5) matching_outbox — صندوق الصادر
--    ثلاثة أحداث فقط (انظر events.json)، وكلّها تُكتب **في معاملة التغيير نفسها**:
--    حدثٌ يُنشَر بعد نجاح المعاملة في نداء ثانٍ يضيع عند أول انقطاع.
--    `MatchingEvaluatedV1` يحمل **أعداداً لا مُعرّفات**: درجات المرشّحين حسّاسة تنافسياً
--    ولا تعبر حدّ الخدمة (ADR-011 القرار 8).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matching_outbox (
    event_id       UUID        PRIMARY KEY,
    event_type     TEXT        NOT NULL,
    event_version  TEXT        NOT NULL CHECK (event_version ~ '^v[0-9]+$'),
    aggregate_type TEXT        NOT NULL CHECK (aggregate_type IN ('driver_candidacy','matching_decision')),
    aggregate_id   TEXT        NOT NULL,
    payload        JSONB       NOT NULL,
    trace_id       TEXT        CHECK (trace_id IS NULL OR char_length(trace_id) <= 128),
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ                                  -- NULL = لم يُنشر بعد
);

CREATE INDEX IF NOT EXISTS ix_matching_outbox_unpublished
    ON matching_outbox (occurred_at)
    WHERE published_at IS NULL;

COMMIT;
