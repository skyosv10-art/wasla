-- WASLA Driver Subscription & Referral Service — Data Contract (PostgreSQL DDL)
-- Phase 10 — Driver Subscription & Referral (خدمة اشتراك السائق والإحالة)
--
-- المبدأ الجوهري (ADR-015):
--   - **المُدّة تُخزَّن والحالة تُشتقّ** (القرار 2): `subscription_periods` دفترٌ لا يُعدَّل
--     (append-only) لكل مُدّةٍ مُنحت — تجربةً أو دفعاً أو مكافأةَ إحالة — و`subscriptions`
--     صفٌّ **مُتحقِّق** يُعاد بناؤه من الدفتر وحده. حذفُ جدول الحالة بالكامل يجب أن يكون
--     عملاً **بلا خسارة**. النسخةُ الخاطئةُ الأرخص: عمودُ `state` يُحدَّث بـ`UPDATE` بلا
--     دفترٍ تحته — فيصير سؤالُ «لماذا هذا السائق `active`؟» بلا جواب، وخطأٌ واحدٌ في
--     التاريخ نهائيّاً لا يُصلحه إلا التخمين.
--   - **أربعُ حالاتٍ في جدولِ انتقالاتٍ مُعلَن** (القرار 3): `trial · active · expired ·
--     community`، والانتقالُ صفٌّ في `subscription_transitions` بسببٍ من قائمةٍ مغلقة
--     وتسلسلٍ متفرّد. و**التجديدُ ليس انتقالاً**: مُدّةٌ جديدةٌ تُضاف والحالةُ تبقى
--     `active` — فلا `active → active` في الدفتر. ولا حالةَ نهائيّة: `community` أرضيّةٌ
--     لا نهاية. النسخةُ الخاطئةُ الأرخص: `if` متفرّقةٌ في المُستهلكات، فيصير كلُّ فرعٍ
--     جديدٍ في الكود انتقالاً جديداً لم يقرّره أحد.
--   - **`community` ليست عقوبة** (القرار 4 · وسابقتُه ADR-014 القرار 7): لا `is_suspended`
--     ولا `is_blocked` ولا `is_banned` ولا `is_throttled` في أيِّ جدولٍ هنا. السائقُ في
--     `community` يُبقي `accept_orders` بسقفٍ يوميّ ويفقد الامتيازاتَ المدفوعةَ فقط.
--     الإيقافُ يملكه `services/drivers` (ADR-012 القرار 3)، والقرارُ الإداريُّ Phase 15.
--   - **لا مالَ هنا أبداً** (القرار 6): لا `amount` ولا `amount_minor` ولا `currency` ولا
--     `price` ولا `invoice_id` ولا `refund` في أيِّ عمود — **وحارسٌ سالبٌ يُثبت غيابَها**.
--     التفعيلُ يستلزم `payment_reference` نصّاً **مُعتِماً** لا يُفسَّر ولا يُفتَّش، والمبالغُ
--     والفواتيرُ والاستردادُ ملكُ Phase 17 (Billing). النسخةُ الخاطئةُ الأرخص: عمودُ
--     `price_minor` في كتالوج الخطط «للعرض فقط» — فيصير مصدرَ حقيقةٍ ثانياً للسعر،
--     ويكذب يومَ يتغيّر السعرُ في Billing ولا يتغيّر هنا.
--   - **الخطّةُ كتالوجٌ مُجمَّدٌ مُنسَّخ** (القرار 7): `(plan_code, plan_version)` مفتاحٌ
--     مركّب، و`is_frozen` شرطُ استعمال، وكلُّ صفٍّ مُشتَقٍّ يحمل `plan_version` — كما يحمل
--     كلُّ مُشتَقٍّ في السمعة `ruleset_version`. النسخةُ الخاطئةُ الأرخص: تعديلُ
--     `duration_days` في مكانه، فتتغيّر مُددٌ مُنحت في الماضي بأثرٍ رجعيّ.
--   - **الإحالةُ تُكافأ على وقائعَ لا على تسجيل** (القرار 8): `referrals.state` يمرّ
--     `pending → qualified → rewarded` أو `rejected` **بسببٍ مُسمّىً** من قائمةٍ مغلقة، و
--     `qualifying_fact_count` عددُ وقائعِ المُحال المُسجَّلة في السمعة (تصل حدثاً أو قراءةً،
--     **لا بمفتاحٍ أجنبيٍّ عابرٍ للحدّ**). النسخةُ الخاطئةُ الأرخص: مكافأةٌ عند التسجيل —
--     فيصير أرخصُ طريقٍ للربح اختراعَ سائقين لا خدمةَ عملاء، وهذا نصُّ ما تمنعه بوابةُ الطور.
--   - **المكافأةُ منحةُ أيّامٍ مرّةً واحدةً** (القرار 9): صفٌّ واحدٌ لكلّ إحالةٍ بقيدٍ
--     مُسمّىً `ux_referral_rewards_referral`، و**تُطبَّق بمُدّةٍ في نفس الدفتر**
--     (`source = 'referral_reward'`) لا بعمودٍ خاصّ. النسخةُ الخاطئةُ الأرخص: عدّادُ
--     «أيّامٌ ممنوحة» يُزاد — فيصير رصيدان لا يتّفقان ولا ثالثَ يحكم بينهما.
--   - **الزمنُ نبضةٌ لا مؤقّت** (القرار 5 · سابقةُ ADR-011 القرار 3 · ADR-013 القرار 4):
--     الانقضاءُ مُشتَقٌّ من `ends_at ≤ now` وتُحقِّقه `POST /subscriptions/tick`، ولا مؤقّتَ
--     داخل الخدمة. فإعادةُ التشغيلِ لا تُفقِد انقضاءً، والاختبارُ يُقدّم الساعةَ بلا `sleep`.
--   - **لا بيانات شخصية ولا مُعرّف قناة** (ADR-007): لا اسمَ ولا هاتفَ ولا `chat_id`.
--     السائقُ والمالكُ مراجعُ عامّةٌ opaque بصيغة `WS-##########` — لا مفاتيحَ إلى
--     `drivers` ولا `identity`. ولا عمودَ نصٍّ حرٍّ (لا `comment` ولا `note`): الأسبابُ
--     رموزٌ من قوائمَ مغلقةٍ كي تُقاس وتُترجَم وتُدافَع عنها.
--
-- المصدر: PostgreSQL (source of truth). Domain Events عبر Outbox من البداية.
-- الترقيم: أي ترحيل (migration) يجب أن يكون عكوساً (reversible) وموثّقاً في TASK_LOG.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) subscription_plans — كتالوجُ الخطط، مُنسَّخاً ومُجمَّداً
--    نفس شكل `reputation_rulesets` و`negotiation_policies`: تُجمَّد ثمّ تُستعمل.
--    ولا عمودَ سعرٍ هنا بقصد (القرار 6) — الخطّةُ **مدّةٌ واستحقاقات**، والسعرُ في Billing.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_plans (
    plan_code               TEXT        NOT NULL CHECK (plan_code ~ '^[a-z][a-z0-9-]{2,47}$'),
    plan_version            INTEGER     NOT NULL CHECK (plan_version >= 1),
    label                   TEXT        NOT NULL CHECK (char_length(label) BETWEEN 3 AND 64),

    -- أيّامُ التجربة: صفرٌ يعني «لا تجربة في هذه الخطّة» وهو قرارٌ مشروع، لا غيابُ قيمة.
    trial_days              INTEGER     NOT NULL CHECK (trial_days BETWEEN 0 AND 90),

    -- مدّةُ المُدّةِ المدفوعة بالأيّام. لا «شهر» ولا «سنة»: الشهرُ ليس وحدةَ قياسٍ ثابتة،
    -- وحسابُ نهايةِ مدّةٍ بـ«شهر» يُنتج جوابين مختلفين في يناير وفبراير.
    duration_days           INTEGER     NOT NULL CHECK (duration_days BETWEEN 1 AND 730),

    -- مهلةُ ما بعد الانقضاء قبل النزول إلى `community`. صفرٌ يعني النزولَ فوراً.
    community_grace_days    INTEGER     NOT NULL CHECK (community_grace_days BETWEEN 0 AND 90),

    -- سقفُ الطلباتِ اليوميُّ على **أرضيّةِ المجتمع** (ملحقُ ADR-015 · المراجعة 2/6).
    -- القرارُ 4 يقول إنّ السائقَ في `community` يُبقي `accept_orders` **بسقفٍ يوميّ**، وذاك
    -- السقفُ رقمٌ لا مكانَ له إلّا هنا: لو عاش في كودِ المجال لصار تغييرُ أرضيّةِ
    -- كلِّ السائقين نشرةً لا نسخةَ خطّة، ولما بقي في النّظام ما يُبين ما كانت الأرضيّة
    -- أمس. ولمَ لا صفٌّ في `subscription_plan_entitlements` برمزِ `daily_order_cap`؟ لأنّ ذاك
    -- الصفَّ هو سقفُ الخطّةِ **المدفوعة**، ورمزٌ واحدٌ لا يحمل رقمَين لحالتَين.
    community_daily_order_cap INTEGER   NOT NULL CHECK (community_daily_order_cap BETWEEN 0 AND 1000),

    -- أيّامُ مكافأةِ الإحالةِ وعتبةُ تأهيلِها ونافذتُها: **أرقامٌ بياناتٌ لا كود** (القرار 7).
    -- فتغييرُ العتبةِ نسخةُ خطّةٍ جديدةٌ يُدافَع عنها، لا سطرٌ يُعدَّل في مُهيّئٍ.
    referral_reward_days    INTEGER     NOT NULL CHECK (referral_reward_days BETWEEN 0 AND 365),
    referral_qualifying_facts INTEGER   NOT NULL CHECK (referral_qualifying_facts BETWEEN 1 AND 100),
    referral_window_days    INTEGER     NOT NULL CHECK (referral_window_days BETWEEN 1 AND 365),

    -- التجميدُ شرطُ استعمال: خطّةٌ غيرُ مجمّدةٍ تُقرأ ولا تُمنَح (`SUBSCRIPTION_PLAN_NOT_FROZEN`).
    is_frozen               BOOLEAN     NOT NULL DEFAULT FALSE,
    frozen_at               TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (plan_code, plan_version),

    -- التجميدُ وزمنُه يتحرّكان معاً أو لا يتحرّكان. حالةٌ «مجمّدةٌ بلا زمنِ تجميد» تُفقِد
    -- القدرةَ على معرفة أيِّ نسخةٍ كانت سارية حين مُنحت مُدّةٌ في الماضي.
    CONSTRAINT ck_subscription_plans_frozen_at
        CHECK ((is_frozen AND frozen_at IS NOT NULL) OR (NOT is_frozen AND frozen_at IS NULL))
);

-- ─────────────────────────────────────────────────────────────────────
-- 2) subscription_plan_entitlements — ما تُبيحه الخطّة، صفّاً صفّاً
--    ولمَ لا `JSONB` واحدٌ في `subscription_plans`؟ لأنّ الاستحقاقَ يُقرأ من خارج الخدمة
--    (07 للأولويّة · 13 لسقف الطلبات)، وحمولةٌ حرّةٌ تعني أنّ كلَّ مستهلكٍ يخترع مفتاحَه
--    ولا حارسَ يُسقط مفتاحاً أُسيء كتابتُه. الصفُّ المُقيَّدُ يُخطئ مرّةً واحدةً: عند الكتابة.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_plan_entitlements (
    plan_code               TEXT        NOT NULL,
    plan_version            INTEGER     NOT NULL,
    entitlement_code        TEXT        NOT NULL CHECK (entitlement_code IN ('accept_orders', 'daily_order_cap', 'priority_dispatch', 'zone_multi_select')),

    -- `-1` تعني «بلا سقف» صراحةً، و`0` تعني «ممنوع». والفرقُ بينهما ليس تفصيلاً:
    -- `NULL` كان سيعني الاثنين معاً، فيقرؤه مستهلكٌ إباحةً وآخرُ منعاً.
    limit_value             INTEGER     NOT NULL CHECK (limit_value >= -1),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (plan_code, plan_version, entitlement_code),
    CONSTRAINT fk_subscription_plan_entitlements_plan
        FOREIGN KEY (plan_code, plan_version) REFERENCES subscription_plans (plan_code, plan_version)
);

-- ─────────────────────────────────────────────────────────────────────
-- 3) subscriptions — الحالةُ **المُتحقِّقة**، لا مصدرُ الحقيقة
--    مصدرُ الحقيقة `subscription_periods` + `subscription_transitions`. هذا الصفُّ ذاكرةٌ
--    سريعةٌ تُعاد بناؤها بـ`POST /subscriptions/{driverPublicId}/recompute` (القرار 2).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
    subscription_id         UUID        PRIMARY KEY,
    driver_public_id        TEXT        NOT NULL CHECK (driver_public_id ~ '^WS-[0-9]{10}$'),
    state                   TEXT        NOT NULL CHECK (state IN ('trial', 'active', 'expired', 'community')),
    plan_code               TEXT        NOT NULL,
    plan_version            INTEGER     NOT NULL,

    -- المُدّةُ السارية. `NULL` مشروعةٌ في `expired` و`community`: لا مُدّةَ تحتهما.
    current_period_id       UUID,
    started_at              TIMESTAMPTZ NOT NULL,

    -- انقضاءُ المُدّةِ السارية. `NULL` في `expired` و`community` — والحارسُ يُثبت الاقتران
    -- كي لا يُقرأ `NULL` «لا ينقضي أبداً».
    expires_at              TIMESTAMPTZ,

    -- تسلسلُ الحالة: يُطابق `sequence` آخرِ انتقالٍ في الدفتر. فقارئٌ يرى تسلسلاً أقدمَ
    -- من الدفتر يعرف أنّه يقرأ حالةً متخلّفة، بلا أن يقارن طوابعَ زمنيّةً بساعتين مختلفتين.
    state_sequence          BIGINT      NOT NULL CHECK (state_sequence >= 1),
    state_changed_at        TIMESTAMPTZ NOT NULL,
    computed_at             TIMESTAMPTZ NOT NULL,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- سائقٌ واحدٌ اشتراكٌ واحد. القيدُ في القاعدة لا في `if`: طلبان متوازيان لبدء التجربة
    -- يمرّان معاً من أيّ فحصٍ في الذاكرة، ولا يمرّان من هذا.
    CONSTRAINT ux_subscriptions_driver UNIQUE (driver_public_id),

    CONSTRAINT fk_subscriptions_plan
        FOREIGN KEY (plan_code, plan_version) REFERENCES subscription_plans (plan_code, plan_version),

    -- الاقترانُ الملزم: مُدّةٌ ساريةٌ وانقضاءٌ يوجدان معاً في `trial` و`active`، ويغيبان
    -- معاً في `expired` و`community`.
    CONSTRAINT ck_subscriptions_period_state
        CHECK (
            (state IN ('trial', 'active') AND current_period_id IS NOT NULL AND expires_at IS NOT NULL)
            OR (state IN ('expired', 'community') AND current_period_id IS NULL AND expires_at IS NULL)
        )
);

CREATE INDEX IF NOT EXISTS ix_subscriptions_expiring
    ON subscriptions (expires_at) WHERE state IN ('trial', 'active');

-- ─────────────────────────────────────────────────────────────────────
-- 4) subscription_periods — دفترُ المُدد (append-only) · مصدرُ الحقيقة الأوّل
--    كلُّ يومٍ يملكه سائقٌ جاء من صفٍّ هنا: تجربةً أو دفعاً أو مكافأةَ إحالة. ولا `UPDATE`
--    على هذا الجدول: تمديدٌ صفٌّ جديد، وإلغاءٌ ليس في هذا الطور (**دَينٌ مُعلَن**).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_periods (
    period_id               UUID        PRIMARY KEY,
    driver_public_id        TEXT        NOT NULL CHECK (driver_public_id ~ '^WS-[0-9]{10}$'),
    plan_code               TEXT        NOT NULL,
    plan_version            INTEGER     NOT NULL,
    source                  TEXT        NOT NULL CHECK (source IN ('trial', 'payment', 'referral_reward')),

    -- مرجعُ الدفعِ **مُعتِمٌ**: نصٌّ يُخزَّن ولا يُفسَّر ولا يُفتَّش، ولا مبلغَ معه (القرار 6).
    -- من أراد أن يعرف «كم دُفع» سأل Billing؛ ومن أراد أن يعرف «هل يملك أيّاماً» سأل هنا.
    payment_reference       TEXT        CHECK (payment_reference IS NULL OR char_length(payment_reference) BETWEEN 4 AND 64),
    granted_days            INTEGER     NOT NULL CHECK (granted_days > 0),
    starts_at               TIMESTAMPTZ NOT NULL,
    ends_at                 TIMESTAMPTZ NOT NULL,
    source_event_id         UUID,
    trace_id                TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_subscription_periods_plan
        FOREIGN KEY (plan_code, plan_version) REFERENCES subscription_plans (plan_code, plan_version),

    -- مُدّةٌ تنتهي قبل أن تبدأ ليست خطأَ إدخال: هي بابٌ لمنحِ أيّامٍ بالسالب.
    CONSTRAINT ck_subscription_periods_window CHECK (ends_at > starts_at),

    -- مرجعُ الدفع موجودٌ **إن وفقط إن** كان المصدرُ دفعاً. مُدّةُ تجربةٍ تحمل مرجعَ دفعٍ
    -- تُفقِد المعنى، ومُدّةُ دفعٍ بلا مرجعٍ تُفقِد إمكانَ التطابق مع Billing لاحقاً.
    CONSTRAINT ck_subscription_periods_payment_reference
        CHECK ((source = 'payment' AND payment_reference IS NOT NULL) OR (source <> 'payment' AND payment_reference IS NULL))
);

CREATE INDEX IF NOT EXISTS ix_subscription_periods_driver
    ON subscription_periods (driver_public_id, starts_at);

-- ─────────────────────────────────────────────────────────────────────
-- 5) subscription_transitions — دفترُ الانتقالات (append-only) · مصدرُ الحقيقة الثاني
--    `from_state IS NULL` تعني الإنشاءَ (∅ → trial). والتسلسلُ متفرّدٌ لكل سائق، فلا
--    انتقالان يتسابقان على نفس الرقم، ولا انتقالٌ «يسبق» آخرَ حدث بعده.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_transitions (
    transition_id           UUID        PRIMARY KEY,
    driver_public_id        TEXT        NOT NULL CHECK (driver_public_id ~ '^WS-[0-9]{10}$'),
    from_state              TEXT        CHECK (from_state IS NULL OR from_state IN ('trial', 'active', 'expired', 'community')),
    to_state                TEXT        NOT NULL CHECK (to_state IN ('trial', 'active', 'expired', 'community')),
    reason_code             TEXT        NOT NULL CHECK (reason_code IN ('trial_granted', 'payment_activated', 'referral_reward_applied', 'period_ended', 'community_grace_ended')),
    period_id               UUID,
    sequence                BIGINT      NOT NULL CHECK (sequence >= 1),
    occurred_at             TIMESTAMPTZ NOT NULL,
    trace_id                TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ux_subscription_transitions_sequence UNIQUE (driver_public_id, sequence),

    -- **لا انتقالَ إلى نفسِ الحالة** (القرار 3): التجديدُ مُدّةٌ لا انتقال. ولو سُمح به
    -- لصار دفترُ الانتقالاتِ سجلَّ تجديداتٍ، ولفقدَ معناه الوحيد: «متى تغيّر شيء؟».
    CONSTRAINT ck_subscription_transitions_state_changes CHECK (from_state IS DISTINCT FROM to_state),

    -- الإنشاءُ لا يكون إلّا إلى `trial` وبسببِ `trial_granted`، وبتسلسلٍ = 1.
    CONSTRAINT ck_subscription_transitions_genesis
        CHECK ((from_state IS NOT NULL) OR (to_state = 'trial' AND reason_code = 'trial_granted' AND sequence = 1))
);

-- ─────────────────────────────────────────────────────────────────────
-- 6) referral_codes — رمزُ الإحالةِ ومالكُه
--    الرمزُ **مُعتِمٌ ومولَّد** (`WR-XXXXXXXX`): لا اسمَ ولا هاتفَ ولا جزءَ من مُعرّفٍ داخله،
--    فمشاركتُه علناً لا تكشف صاحبَه.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_codes (
    referral_code           TEXT        PRIMARY KEY CHECK (referral_code ~ '^WR-[0-9A-Z]{8}$'),
    owner_public_id         TEXT        NOT NULL CHECK (owner_public_id ~ '^WS-[0-9]{10}$'),
    is_active               BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- رمزٌ واحدٌ لكلّ مالك. رمزان لشخصٍ واحدٍ يجعلان عدَّ إحالاتِه يحتاج توحيداً، وكلُّ
    -- توحيدٍ بابُ خطأ.
    CONSTRAINT ux_referral_codes_owner UNIQUE (owner_public_id)
);

-- ─────────────────────────────────────────────────────────────────────
-- 7) referrals — الإحالةُ وحالتُها وسببُ رفضِها **مُسمّىً**
--    `qualifying_fact_count` عددُ وقائعِ المُحال في السمعة كما وصلت (حدثاً أو قراءةً).
--    **لا مفتاحَ أجنبيّاً إلى `reputation_facts`**: ذاك حدُّ خدمةٍ آخر، والعبورُ يُنتج
--    ارتباطاً لا يُفكّ ونشرَ فشلٍ بين خدمتين.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
    referral_id             UUID        PRIMARY KEY,
    referral_code           TEXT        NOT NULL,
    referrer_public_id      TEXT        NOT NULL CHECK (referrer_public_id ~ '^WS-[0-9]{10}$'),
    referee_public_id       TEXT        NOT NULL CHECK (referee_public_id ~ '^WS-[0-9]{10}$'),
    state                   TEXT        NOT NULL CHECK (state IN ('pending', 'qualified', 'rewarded', 'rejected')),
    reason_code             TEXT        CHECK (reason_code IS NULL OR reason_code IN ('self_referral', 'referrer_not_active', 'referee_already_referred', 'referee_no_qualifying_facts', 'referral_window_expired', 'referee_subscription_never_activated')),
    qualifying_fact_count   INTEGER     NOT NULL DEFAULT 0 CHECK (qualifying_fact_count >= 0),
    plan_code               TEXT        NOT NULL,
    plan_version            INTEGER     NOT NULL,
    window_ends_at          TIMESTAMPTZ NOT NULL,
    claimed_at              TIMESTAMPTZ NOT NULL,
    state_changed_at        TIMESTAMPTZ NOT NULL,
    trace_id                TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_referrals_code FOREIGN KEY (referral_code) REFERENCES referral_codes (referral_code),
    CONSTRAINT fk_referrals_plan
        FOREIGN KEY (plan_code, plan_version) REFERENCES subscription_plans (plan_code, plan_version),

    -- المُحالُ يُحال مرّةً واحدةً في حياته. لولا هذا القيد لصار سائقٌ واحدٌ مكافأةً لكلِّ
    -- من يذكره، وهو أرخصُ أشكالِ النشاطِ المُصطنع.
    CONSTRAINT ux_referrals_referee UNIQUE (referee_public_id),

    -- إحالةُ المرءِ نفسَه ليست خطأَ إدخال: هي أوّلُ ما يُجرَّب.
    CONSTRAINT ck_referrals_not_self CHECK (referrer_public_id <> referee_public_id),

    -- السببُ موجودٌ **إن وفقط إن** كانت الحالةُ رفضاً (القرار 8): رفضٌ بلا سببٍ صمتٌ لا
    -- يُدافَع عنه، وسببٌ في حالةِ نجاحٍ يُقرأ خطأً في كلِّ لوحة.
    CONSTRAINT ck_referrals_reason_code
        CHECK ((state = 'rejected' AND reason_code IS NOT NULL) OR (state <> 'rejected' AND reason_code IS NULL))
);

CREATE INDEX IF NOT EXISTS ix_referrals_referrer ON referrals (referrer_public_id, created_at);
CREATE INDEX IF NOT EXISTS ix_referrals_pending ON referrals (window_ends_at) WHERE state = 'pending';

-- ─────────────────────────────────────────────────────────────────────
-- 8) referral_rewards — المكافأةُ مرّةً واحدةً، ومُطبَّقةً في دفترِ المُدد
--    `granted_period_id` يشير إلى الصفِّ الذي **طبّق** المكافأةَ فعلاً في
--    `subscription_periods`. فالمكافأةُ ليست وعداً في جدولٍ منفصل: هي أيّامٌ في الدفتر.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_rewards (
    reward_id               UUID        PRIMARY KEY,
    referral_id             UUID        NOT NULL,
    granted_period_id       UUID        NOT NULL,
    beneficiary_public_id   TEXT        NOT NULL CHECK (beneficiary_public_id ~ '^WS-[0-9]{10}$'),
    reward_days             INTEGER     NOT NULL CHECK (reward_days > 0),
    plan_code               TEXT        NOT NULL,
    plan_version            INTEGER     NOT NULL,
    granted_at              TIMESTAMPTZ NOT NULL,
    trace_id                TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_referral_rewards_referral FOREIGN KEY (referral_id) REFERENCES referrals (referral_id),
    CONSTRAINT fk_referral_rewards_period FOREIGN KEY (granted_period_id) REFERENCES subscription_periods (period_id),
    CONSTRAINT fk_referral_rewards_plan
        FOREIGN KEY (plan_code, plan_version) REFERENCES subscription_plans (plan_code, plan_version),

    -- مكافأةٌ واحدةٌ لكلّ إحالة (القرار 9). التسليمُ at-least-once في كلّ ناقلٍ سنختاره،
    -- فالتفرّدُ يعيش في القاعدة لا في `if` يسقط بأوّل تشغيلٍ متوازٍ.
    CONSTRAINT ux_referral_rewards_referral UNIQUE (referral_id),

    -- ومُدّةٌ واحدةٌ لا تُطبَّق مكافأتين.
    CONSTRAINT ux_referral_rewards_period UNIQUE (granted_period_id)
);

-- ─────────────────────────────────────────────────────────────────────
-- 9) subscription_idempotency — الجوابُ المحفوظُ فعلاً، لا جسمٌ يُعاد بناؤه
--    نفسُ ما استقرّ عليه الطورُ 09 بعد دَينٍ مُعلَن: إعادةُ المفتاح تُعيد **نفسَ البايتات**
--    بحالتِها المحفوظة. أمّا إعادةُ البناءِ من حالةٍ تحرّكت بعد الطلب فتُعيد جواباً لم
--    يُرسَل قطّ — وهو أسوأُ من خطأٍ صريح.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_idempotency (
    idempotency_key         TEXT        PRIMARY KEY CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
    route_key               TEXT        NOT NULL CHECK (char_length(route_key) BETWEEN 3 AND 64),
    request_hash            TEXT        NOT NULL CHECK (char_length(request_hash) = 64),
    response_status         INTEGER     NOT NULL CHECK (response_status BETWEEN 200 AND 499),
    response_body           JSONB       NOT NULL,
    trace_id                TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 10) subscription_outbox — الحدثُ يُكتب مع الحقيقةِ في معاملةٍ واحدة
--     دَينُ الأطوارِ 06 · 07 · 08 · 09 نفسُه ونمطُه المستقرّ: الكتابةُ والحدثُ معاً، والنشرُ
--     بعدهما بمُصرِّفٍ يُطالِب ثمّ يُسلّم ثمّ يُعلّم.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_outbox (
    event_id                UUID        PRIMARY KEY,
    event_type              TEXT        NOT NULL CHECK (event_type ~ '^(subscription|referral)\.[a-z_]+$'),
    aggregate_type          TEXT        NOT NULL CHECK (aggregate_type IN ('subscription', 'referral')),
    aggregate_id            TEXT        NOT NULL,
    payload                 JSONB       NOT NULL,
    occurred_at             TIMESTAMPTZ NOT NULL,
    published_at            TIMESTAMPTZ,
    attempts                INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error              TEXT,
    trace_id                TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_subscription_outbox_unpublished
    ON subscription_outbox (occurred_at) WHERE published_at IS NULL;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- الترحيل العكسي (rollback) — يُنفَّذ بترتيب معاكس للاعتماديات
-- ─────────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP TABLE IF EXISTS subscription_outbox;
-- DROP TABLE IF EXISTS subscription_idempotency;
-- DROP TABLE IF EXISTS referral_rewards;
-- DROP TABLE IF EXISTS referrals;
-- DROP TABLE IF EXISTS referral_codes;
-- DROP TABLE IF EXISTS subscription_transitions;
-- DROP TABLE IF EXISTS subscription_periods;
-- DROP TABLE IF EXISTS subscriptions;
-- DROP TABLE IF EXISTS subscription_plan_entitlements;
-- DROP TABLE IF EXISTS subscription_plans;
-- COMMIT;
