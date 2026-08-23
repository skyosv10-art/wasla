-- WASLA Reputation & Fraud Service — Data Contract (PostgreSQL DDL)
-- Phase 09 — Reputation & Fraud (خدمة السمعة وإشارات الاحتيال)
--
-- المبدأ الجوهري (ADR-014):
--   - **الواقعة تُخزَّن والنقطة تُشتقّ**: `reputation_facts` دفترٌ لا يُعدَّل (append-only)،
--     و`reputation_scores` نتيجةٌ تحمل نسخةَ قواعدها وزمنَ حسابها وآخرَ واقعةٍ دخلت فيها.
--     عدّادٌ يُزاد بلا دفترٍ تحته يجعل كل خطأ حسابيّ نهائياً، ويجعل واقعةً سُلّمت مرّتين
--     تُضاعف النقاط بلا أن يعرف أحد.
--   - **مصدر الحقيقة حدثٌ منشور لا استعلام**: كل واقعة تحمل `source_event_id` و
--     `source_event_type` و`source_sequence`. والتسليم at-least-once، فقيدُ التفرّد
--     `ux_reputation_facts_source` يعيش **في القاعدة** لا في `if` واحد يسقط بأوّل
--     تشغيلٍ متوازٍ.
--   - **لا مفتاح أجنبي يعبر حدّ الخدمة**: `subject_public_id` و`order_public_id`
--     مراجعُ عامّة opaque لا مفاتيح إلى `customers` ولا `orders` ولا `drivers`. ولا
--     نسخةَ حالةٍ من الطلب هنا: عمودٌ مُنسَخ يتخلّف بصمت (علّة ADR-012 §2).
--   - **الأرقام بياناتٌ لا كود** (`reputation_rulesets` · `reputation_rule_weights`):
--     الأوزان والحدود والعتبات والنوافذ نسخةٌ مجمّدة، وكل نتيجةٍ وإشارةٍ تحمل
--     `ruleset_version`. فيبقى «لماذا كانت نقاطي 62؟» سؤالاً له جواب بعد سنة.
--   - **التقييم درجةٌ بلا نصّ** (القرار 5): لا عمود `comment` ولا `note` ولا `body`.
--     غيابُه مقصود: النصّ الحرّ يحتاج تنقيحاً وحجباً ومالكاً، وذاك Phase 16.
--   - **الخدمة لا تعاقب** (القرار 7): لا `is_suspended` ولا `is_banned` ولا `is_blocked`
--     ولا `is_fraudster`. الإيقاف يملكه `services/drivers` (ADR-012 القرار 3)، والقرار
--     الإداريّ يملكه Phase 15. ورتبة `under_watch` تسميةٌ تُقرأ ولا تُنفَّذ.
--   - **إشارة الاحتيال تشرح نفسها**: قاعدةٌ مُسمّاة (`rule_code`) على نافذةٍ محدّدة
--     بعتبةٍ مُعلَنة. لا احتمالٌ إحصائيّ: سائقٌ يُراجَع بـ«احتمال 0.87» لا يمكن الدفاع
--     عنه ولا الردّ عليه. ولا عمود `state` للإشارة: البتّ فيها مراجعةٌ بشرية لا يملكها
--     هذا الطور، وعمودُ حالةٍ لا يكتبه أحد يُقرأ خطأً.
--   - **الزمن نبضة لا مؤقّت** (سابقة ADR-011 القرار 3 · ADR-013 القرار 4): إعادةُ
--     الحساب استحقاقٌ مخزّن (`next_recompute_at`) يُقارَن بساعةٍ مُحقونة، والنبضة
--     تقرؤه بفهرس. فإعادة تشغيل الخدمة لا تُفقِد حساباً، والاختبار يُقدّم الساعة بلا `sleep`.
--   - **لا بيانات شخصية ولا مُعرّف قناة** (ADR-007): لا اسم ولا هاتف ولا إحداثية ولا
--     `chat_id` ولا `telegram`. وإن ظهر مال فهو عددٌ صحيح بوحدةٍ صغرى وعملةٌ صريحة:
--     لا `NUMERIC` للمال ولا عائم بحال.
--
-- المصدر: PostgreSQL (source of truth). Domain Events عبر Outbox من البداية.
-- الترقيم: أي ترحيل (migration) يجب أن يكون عكوساً (reversible) وموثّقاً في TASK_LOG.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) reputation_rulesets — نسخةُ القواعد، مجمّدةً
--    نفس شكل `negotiation_policies` و`driver_eligibility_policies`: تُجمَّد ثمّ تُستعمل.
--    نتيجةٌ تشير إلى نسخةٍ قابلة للتعديل هي نتيجةٌ لا يمكن تفسيرها لاحقاً.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reputation_rulesets (
    ruleset_version         INTEGER     PRIMARY KEY CHECK (ruleset_version >= 1),
    label                   TEXT        NOT NULL CHECK (char_length(label) BETWEEN 3 AND 64),

    -- حدود النتيجة ونقطة البداية: مستخدمٌ جديد لا يبدأ من الصفر (فيُظلَم) ولا من القمّة
    -- (فتُصبح الرتبة بلا معنى). البداية مُعلَنة رقماً لا مخفيّة في الكود.
    score_floor             INTEGER     NOT NULL CHECK (score_floor >= 0),
    score_ceiling           INTEGER     NOT NULL CHECK (score_ceiling > 0),
    starting_score          INTEGER     NOT NULL CHECK (starting_score >= 0),

    -- أقلّ عددٍ من الوقائع قبل إعلان نتيجةٍ ذات معنى. نتيجةٌ من واقعةٍ واحدة رأيٌ لا قياس.
    min_facts_for_score     INTEGER     NOT NULL CHECK (min_facts_for_score BETWEEN 1 AND 100),

    -- تلاشي أثر القديم: نصف العمر بالأيام. القرار 3 — التلاشي حسابُ نبضةٍ مسجَّل،
    -- لا دالّةٌ تُطبَّق لحظة القراءة فتُعطي جوابين في دقيقتين.
    decay_half_life_days    INTEGER     NOT NULL CHECK (decay_half_life_days BETWEEN 7 AND 720),

    -- عتبات الرتب: `under_watch` تسميةٌ تُقرأ ولا تُنفَّذ (القرار 7).
    tier_standard_at        INTEGER     NOT NULL CHECK (tier_standard_at >= 0),
    tier_trusted_at         INTEGER     NOT NULL CHECK (tier_trusted_at >= 0),
    tier_under_watch_below  INTEGER     NOT NULL CHECK (tier_under_watch_below >= 0),

    -- نافذة التقييم: بعدها يُغلق الباب. تقييمٌ بعد شهرين ذاكرةٌ لا شهادة.
    rating_window_hours     INTEGER     NOT NULL CHECK (rating_window_hours BETWEEN 1 AND 720),

    -- نافذة رصد الاحتيال بالأيام، وعتبةُ كل قاعدة في `reputation_rule_weights` لا هنا.
    fraud_window_days       INTEGER     NOT NULL CHECK (fraud_window_days BETWEEN 1 AND 90),

    -- استحقاق إعادة الحساب الدوريّ بالساعات — فهرسُ النبضة (القرار 8).
    recompute_interval_hours INTEGER    NOT NULL CHECK (recompute_interval_hours BETWEEN 1 AND 168),

    is_frozen               BOOLEAN     NOT NULL DEFAULT false,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_reputation_rulesets_score_bounds CHECK (score_ceiling > score_floor),
    CONSTRAINT ck_reputation_rulesets_start_in_bounds
        CHECK (starting_score >= score_floor AND starting_score <= score_ceiling),
    -- ترتيب العتبات: رتبةٌ موثوقة أدنى من رتبةٍ عادية تجعل التصنيف عبثاً.
    CONSTRAINT ck_reputation_rulesets_tier_order
        CHECK (tier_trusted_at > tier_standard_at AND tier_under_watch_below <= tier_standard_at)
);

-- النسخة 1: أرقامٌ **مُعلَنة** لا إغفال. من يريد غيرها يُصدر نسخة 2 ويُبرّرها في ADR.
--   • النتيجة 0..100 والبداية 60: مستخدمٌ جديد فوق حدّ المراقبة ودون الثقة.
--   • خمس وقائع قبل إعلان نتيجة، ونصف عمرٍ 180 يوماً: خطأُ العام الماضي لا يساوي خطأ الأمس.
--   • نافذة تقييم 72 ساعة، ونافذة رصد احتيال 30 يوماً، وإعادة حساب كل 24 ساعة.
INSERT INTO reputation_rulesets (
    ruleset_version, label,
    score_floor, score_ceiling, starting_score,
    min_facts_for_score, decay_half_life_days,
    tier_standard_at, tier_trusted_at, tier_under_watch_below,
    rating_window_hours, fraud_window_days, recompute_interval_hours,
    is_frozen
)
VALUES (1, 'saudi-launch-v1', 0, 100, 60, 5, 180, 50, 80, 35, 72, 30, 24, true)
ON CONFLICT (ruleset_version) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 2) reputation_rule_weights — وزنُ كل واقعة، وعتبةُ كل قاعدة احتيال
--    القرار 4: واقعةٌ بلا وزنٍ مُعلَن **تُرفض** ولا تُهمَل بصمت. وزنٌ افتراضيّ صفر
--    يُخفي واقعةً لا يعرف أحدٌ أنّها أُهملت، والصمت أخطر من الرفض.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reputation_rule_weights (
    ruleset_version         INTEGER     NOT NULL REFERENCES reputation_rulesets(ruleset_version),
    subject_type            TEXT        NOT NULL CHECK (subject_type IN ('customer','driver')),
    fact_kind               TEXT        NOT NULL CHECK (fact_kind IN (
                                'order_completed','order_cancelled_by_customer',
                                'order_cancelled_by_driver','assignment_accepted',
                                'assignment_rejected','assignment_timed_out','rating_received'
                            )),
    -- الوزن قد يكون سالباً: الإلغاء يخصم. عددٌ صحيح لا عاشر — النقاط تُجمَع وتُقارَن.
    weight_points           INTEGER     NOT NULL CHECK (weight_points BETWEEN -50 AND 50),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_reputation_rule_weights PRIMARY KEY (ruleset_version, subject_type, fact_kind)
);

-- أوزان النسخة 1. الاكتمال يبني، والإلغاء يخصم، والتخلّي بعد القبول أثقلُ خصمٍ للسائق:
-- من يقبل ثمّ يتركُ عميلاً واقفاً يُكلّف النظام أكثر ممّن يرفض من البداية.
INSERT INTO reputation_rule_weights (ruleset_version, subject_type, fact_kind, weight_points)
VALUES
    (1, 'customer', 'order_completed',              3),
    (1, 'customer', 'order_cancelled_by_customer', -6),
    (1, 'customer', 'rating_received',              2),
    (1, 'driver',   'order_completed',              4),
    (1, 'driver',   'order_cancelled_by_driver',   -9),
    (1, 'driver',   'assignment_accepted',          1),
    (1, 'driver',   'assignment_rejected',          0),
    (1, 'driver',   'assignment_timed_out',        -2),
    (1, 'driver',   'rating_received',              2)
ON CONFLICT (ruleset_version, subject_type, fact_kind) DO NOTHING;

-- عتبات قواعد الاحتيال، مفصولةً عن الأوزان لأنّها تُقاس بالعدد لا بالنقاط.
CREATE TABLE IF NOT EXISTS reputation_fraud_thresholds (
    ruleset_version         INTEGER     NOT NULL REFERENCES reputation_rulesets(ruleset_version),
    rule_code               TEXT        NOT NULL CHECK (rule_code IN (
                                'repeated_customer_cancellation','repeated_driver_cancellation',
                                'accept_then_abandon','offer_timeout_streak','rating_extremity_burst'
                            )),
    subject_type            TEXT        NOT NULL CHECK (subject_type IN ('customer','driver')),
    -- العدد الذي تجاوزه يُنتج إشارة، والنافذة بالأيام من نسخة القواعد.
    threshold_count         INTEGER     NOT NULL CHECK (threshold_count BETWEEN 2 AND 100),
    severity                TEXT        NOT NULL CHECK (severity IN ('low','medium','high')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_reputation_fraud_thresholds PRIMARY KEY (ruleset_version, rule_code)
);

INSERT INTO reputation_fraud_thresholds (ruleset_version, rule_code, subject_type, threshold_count, severity)
VALUES
    (1, 'repeated_customer_cancellation', 'customer',  5, 'medium'),
    (1, 'repeated_driver_cancellation',   'driver',    4, 'medium'),
    (1, 'accept_then_abandon',            'driver',    3, 'high'),
    (1, 'offer_timeout_streak',           'driver',   10, 'low'),
    (1, 'rating_extremity_burst',         'customer',  8, 'low')
ON CONFLICT (ruleset_version, rule_code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 3) reputation_facts — الدفتر، append-only
--    لا `UPDATE` ولا `DELETE` في تصميم هذه الخدمة. كل صفٍّ يحمل مصدره كي يكون
--    السؤال «من أين جاءت هذه النقطة؟» جواباً بصفٍّ واحد لا تحقيقاً.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reputation_facts (
    id                      UUID        PRIMARY KEY,
    subject_type            TEXT        NOT NULL CHECK (subject_type IN ('customer','driver')),
    -- مرجع عامّ opaque: لا مفتاح أجنبي، ولا ملفّ مستخدم هنا.
    subject_public_id       TEXT        NOT NULL CHECK (subject_public_id ~ '^WS-[0-9]{10}$'),
    fact_kind               TEXT        NOT NULL CHECK (fact_kind IN (
                                'order_completed','order_cancelled_by_customer',
                                'order_cancelled_by_driver','assignment_accepted',
                                'assignment_rejected','assignment_timed_out','rating_received'
                            )),
    order_public_id         TEXT        NOT NULL CHECK (order_public_id ~ '^ORD-[0-9]{10}$'),

    -- مصدر الواقعة: الحدث الذي أنتجها بعينه (القرار 2).
    source_event_type       TEXT        NOT NULL CHECK (char_length(source_event_type) >= 3),
    source_event_id         UUID        NOT NULL,
    -- ترتيب الانتقال على الطلب كما جاء في الحدث. مفتاحُ عدم التكرار لا معلومةً زائدة.
    source_sequence         INTEGER     NOT NULL CHECK (source_sequence >= 1),
    -- من فعل الفعل، بمفردات ActorType في محرّك الطلب. مرجعٌ لا حُكم.
    actor_type              TEXT        NOT NULL CHECK (actor_type IN (
                                'system','customer','driver','partner','admin'
                            )),
    reason_code             TEXT        CHECK (reason_code IS NULL OR char_length(reason_code) BETWEEN 2 AND 64),

    -- زمن وقوع الواقعة في العالم، وزمن تسجيلها عندنا. الفرقُ بينهما هو تأخّر الناقل،
    -- وخلطُهما يجعل النافذة المتحرّكة تكذب عند أوّل إعادة تسليم.
    occurred_at             TIMESTAMPTZ NOT NULL,
    recorded_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    trace_id                TEXT,

    -- at-least-once: نفس الحدث يصل مرّتين. القيد في القاعدة لا في الكود (القرار 2).
    CONSTRAINT ux_reputation_facts_source
        UNIQUE (subject_type, subject_public_id, fact_kind, order_public_id, source_sequence)
);

CREATE INDEX IF NOT EXISTS ix_reputation_facts_subject
    ON reputation_facts (subject_type, subject_public_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_reputation_facts_order
    ON reputation_facts (order_public_id);
-- فهرسُ النافذة المتحرّكة: قواعد الاحتيال تسأل «كم مرّة في آخر 30 يوماً؟».
CREATE INDEX IF NOT EXISTS ix_reputation_facts_kind_window
    ON reputation_facts (subject_type, subject_public_id, fact_kind, occurred_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 4) reputation_scores — النتيجة، مُشتقّةً وقابلةً لإعادة البناء
--    كل عمودٍ محسوب هنا يُكتب في **نفس** الحساب ومن **نفس** المصدر (الدفتر)، ولذلك
--    لا يخالف ADR-012 §2: ذاك رفض عموداً يُكتب من مصدرٍ غير مصدر ما يصفه.
--    حذفُ كل صفوف هذا الجدول يجب أن يكون عملاً بلا خسارة: `recompute` يُعيده كما كان.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reputation_scores (
    subject_type            TEXT        NOT NULL CHECK (subject_type IN ('customer','driver')),
    subject_public_id       TEXT        NOT NULL CHECK (subject_public_id ~ '^WS-[0-9]{10}$'),
    ruleset_version         INTEGER     NOT NULL REFERENCES reputation_rulesets(ruleset_version),

    score_points            INTEGER     NOT NULL,
    tier                    TEXT        NOT NULL CHECK (tier IN (
                                'new','standard','trusted','under_watch'
                            )),
    -- عدد الوقائع التي دخلت الحساب، وآخرُ ترتيبٍ دخل فيه. الاثنان معاً يجيبان
    -- «هل هذه النتيجة حديثة؟» بلا تخمين.
    fact_count              INTEGER     NOT NULL CHECK (fact_count >= 0),
    computed_through_fact_id UUID,
    computed_at             TIMESTAMPTZ NOT NULL,
    -- استحقاق إعادة الحساب — فهرسُ النبضة (القرار 8). لا مؤقّت في الذاكرة.
    next_recompute_at       TIMESTAMPTZ NOT NULL,
    trace_id                TEXT,

    CONSTRAINT pk_reputation_scores PRIMARY KEY (subject_type, subject_public_id),
    -- نتيجةٌ خارج حدود نسختها لا تُفسَّر ولا تُقارَن؛ الحدّان يُقرآن من `reputation_rulesets`
    -- والمجالُ يفرضهما، وهذا القيد يمنع السلبيّ المطلق على كل حال.
    CONSTRAINT ck_reputation_scores_non_negative CHECK (score_points >= 0),
    -- رتبة `new` لا تجتمع مع وقائع تكفي لنتيجة: الرتبة تصف حالةَ المعرفة لا المزاج.
    CONSTRAINT ck_reputation_scores_new_has_no_history
        CHECK (tier <> 'new' OR fact_count = 0 OR computed_through_fact_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_reputation_scores_tier
    ON reputation_scores (subject_type, tier, score_points DESC);
CREATE INDEX IF NOT EXISTS ix_reputation_scores_recompute_due
    ON reputation_scores (next_recompute_at);

-- ─────────────────────────────────────────────────────────────────────
-- 5) reputation_ratings — التقييم البشريّ: درجةٌ ورمزُ سبب، **بلا نصّ**
--    القرار 5: لا عمود `comment` ولا `note` ولا `body`. غيابُه مقصود ومُعلَن كي لا
--    يُضاف لاحقاً بحسن نيّة — النصّ يحتاج تنقيحاً وحجباً ومالكاً، وذاك Phase 16.
--    ولا يُقبل تقييمٌ إلّا على طلبٍ له واقعةُ اكتمالٍ في الدفتر (يفرضه المجال، ورمزُه
--    `REPUTATION_ORDER_NOT_COMPLETED`) وضمن نافذة `rating_window_hours`.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reputation_ratings (
    id                      UUID        PRIMARY KEY,
    order_public_id         TEXT        NOT NULL CHECK (order_public_id ~ '^ORD-[0-9]{10}$'),

    rater_type              TEXT        NOT NULL CHECK (rater_type IN ('customer','driver')),
    rater_public_id         TEXT        NOT NULL CHECK (rater_public_id ~ '^WS-[0-9]{10}$'),
    subject_type            TEXT        NOT NULL CHECK (subject_type IN ('customer','driver')),
    subject_public_id       TEXT        NOT NULL CHECK (subject_public_id ~ '^WS-[0-9]{10}$'),

    stars                   SMALLINT    NOT NULL CHECK (stars BETWEEN 1 AND 5),
    -- رمزٌ من قائمة مُقفلة: مفرداتٌ تُحصى وتُقارَن، بخلاف نصٍّ يُقرأ ولا يُقاس.
    reason_code             TEXT        CHECK (reason_code IS NULL OR reason_code IN (
                                'on_time','late_arrival','courteous','poor_conduct',
                                'unsafe_driving','vehicle_condition','route_deviation','no_show'
                            )),
    ruleset_version         INTEGER     NOT NULL REFERENCES reputation_rulesets(ruleset_version),
    submitted_at            TIMESTAMPTZ NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    trace_id                TEXT,

    -- تقييمٌ واحد لكل (طلب × مُقيِّم × مُقيَّم): تقييمان للرحلة الواحدة يجعلان الوزن
    -- مضاعفاً لمن أعاد الإرسال.
    CONSTRAINT ux_reputation_ratings_order_pair
        UNIQUE (order_public_id, rater_public_id, subject_public_id),
    -- لا يُقيّم أحدٌ نفسه — خطّ الدفاع الثاني بعد المجال (سابقة القبول الذاتي في ADR-013).
    CONSTRAINT ck_reputation_ratings_no_self CHECK (rater_public_id <> subject_public_id),
    CONSTRAINT ck_reputation_ratings_cross_side CHECK (rater_type <> subject_type)
);

CREATE INDEX IF NOT EXISTS ix_reputation_ratings_subject
    ON reputation_ratings (subject_type, subject_public_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS ix_reputation_ratings_order
    ON reputation_ratings (order_public_id);

-- ─────────────────────────────────────────────────────────────────────
-- 6) fraud_signals — ملاحظةُ رصدٍ تشرح نفسها، لا حُكم
--    القرار 6: قاعدةٌ مُسمّاة على نافذةٍ محدّدة بعتبةٍ مُعلَنة، ونسخةُ القواعد معها.
--    لا عمود `state`: البتّ في الإشارة مراجعةٌ بشرية لا يملكها هذا الطور. ولا عمود
--    `is_fraudster` بحال: هذه الخدمة لا تعاقب (القرار 7).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fraud_signals (
    id                      UUID        PRIMARY KEY,
    subject_type            TEXT        NOT NULL CHECK (subject_type IN ('customer','driver')),
    subject_public_id       TEXT        NOT NULL CHECK (subject_public_id ~ '^WS-[0-9]{10}$'),
    rule_code               TEXT        NOT NULL CHECK (rule_code IN (
                                'repeated_customer_cancellation','repeated_driver_cancellation',
                                'accept_then_abandon','offer_timeout_streak','rating_extremity_burst'
                            )),
    severity                TEXT        NOT NULL CHECK (severity IN ('low','medium','high')),

    -- النافذة التي رُصد فيها النمط، والعدد المرصود، والعتبة التي تجاوزها. ثلاثتها
    -- تجعل الإشارة قابلة للمراجعة بلا إعادة حسابٍ يدويّ.
    window_started_at       TIMESTAMPTZ NOT NULL,
    window_ended_at         TIMESTAMPTZ NOT NULL,
    observed_count          INTEGER     NOT NULL CHECK (observed_count >= 0),
    threshold_count         INTEGER     NOT NULL CHECK (threshold_count >= 2),
    ruleset_version         INTEGER     NOT NULL REFERENCES reputation_rulesets(ruleset_version),

    raised_at               TIMESTAMPTZ NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    trace_id                TEXT,

    CONSTRAINT ck_fraud_signals_window_order CHECK (window_ended_at > window_started_at),
    -- إشارةٌ بعددٍ دون العتبة إشارةٌ لا سبب لها.
    CONSTRAINT ck_fraud_signals_over_threshold CHECK (observed_count >= threshold_count),
    -- إشارةٌ واحدة لكل (قاعدة × نافذة × شخص): النبضة تُعاد، والإشارة لا تتكرّر بها.
    CONSTRAINT ux_fraud_signals_rule_window
        UNIQUE (subject_type, subject_public_id, rule_code, window_ended_at)
);

CREATE INDEX IF NOT EXISTS ix_fraud_signals_subject
    ON fraud_signals (subject_type, subject_public_id, raised_at DESC);
CREATE INDEX IF NOT EXISTS ix_fraud_signals_rule
    ON fraud_signals (rule_code, raised_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 7) reputation_idempotency — سجلّ المفاتيح، بنفس شكل الخدمات السابقة
--    البصمة تكشف إعادة المفتاح بحمولة مختلفة بالمقارنة لا بقراءة الحقول.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reputation_idempotency (
    idempotency_key         TEXT        PRIMARY KEY
                            CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
    scope                   TEXT        NOT NULL CHECK (scope IN (
                                'record_fact','submit_rating','recompute_score','tick'
                            )),
    subject_public_id       TEXT        CHECK (subject_public_id IS NULL OR subject_public_id ~ '^WS-[0-9]{10}$'),
    payload_fingerprint     TEXT        NOT NULL CHECK (char_length(payload_fingerprint) = 64),
    response_status         INTEGER     NOT NULL CHECK (response_status BETWEEN 100 AND 599),
    response_body           JSONB       NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_reputation_idempotency_subject
    ON reputation_idempotency (subject_public_id);

-- ─────────────────────────────────────────────────────────────────────
-- 8) reputation_outbox — صندوق الصادر، بنفس شكل `order_outbox` و`negotiation_outbox`
--    القرار وحدثه في معاملة واحدة، فلا تغيير صامت. والناشر نفسه ليس من هذه المرحلة.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reputation_outbox (
    id                      UUID        PRIMARY KEY,
    aggregate_type          TEXT        NOT NULL CHECK (aggregate_type IN (
                                'reputation_fact','reputation_score','reputation_rating','fraud_signal'
                            )),
    aggregate_id            TEXT        NOT NULL,
    event_type              TEXT        NOT NULL CHECK (char_length(event_type) >= 3),
    event_version           TEXT        NOT NULL CHECK (event_version ~ '^v[0-9]+$'),
    payload                 JSONB       NOT NULL,
    occurred_at             TIMESTAMPTZ NOT NULL,
    published_at            TIMESTAMPTZ,
    attempts                INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error              TEXT,
    trace_id                TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_reputation_outbox_unpublished
    ON reputation_outbox (occurred_at) WHERE published_at IS NULL;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- الترحيل العكسي (rollback) — يُنفَّذ بترتيب معاكس للاعتماديات
-- ─────────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP TABLE IF EXISTS reputation_outbox;
-- DROP TABLE IF EXISTS reputation_idempotency;
-- DROP TABLE IF EXISTS fraud_signals;
-- DROP TABLE IF EXISTS reputation_ratings;
-- DROP TABLE IF EXISTS reputation_scores;
-- DROP TABLE IF EXISTS reputation_facts;
-- DROP TABLE IF EXISTS reputation_fraud_thresholds;
-- DROP TABLE IF EXISTS reputation_rule_weights;
-- DROP TABLE IF EXISTS reputation_rulesets;
-- COMMIT;
