-- WASLA Driver Core Service — Data Contract (PostgreSQL DDL)
-- Phase 05 — Driver Core (خدمة نواة السائق)
--
-- المبدأ الجوهري (ADR-012):
--   - ملف السائق ملفُّ **دور** كملف العميل (سابقة ADR-009 §1): مفتاحه `wasla_public_id`
--     مرجعاً opaque بـCHECK على الشكل **بلا FK إلى `identity_users`** — خدمة أخرى وقاعدة
--     أخرى. ووجود ملف سائق لا يمنع ملف عميل للشخص نفسه: الشخص واحد والأدوار متعدّدة.
--   - **الأهليّة دالّة مُشتقّة لا عمود يُكتب باليد.** لا يوجد في هذا المخطّط عمود
--     `is_eligible` ولا `eligibility_state` يكتبه أحد. الأهليّة تُحسب من (حالة الملف ×
--     التحقّق × مركبة رئيسية × وثائق مطلوبة سارية × منطقة خدمة × نوع خدمة) بسياسة
--     **مُرقّمة ومُقفَلة** في `driver_eligibility_policies`. عمودٌ يكتبه أحدهم يمكن أن
--     يكذب؛ ودالّةٌ تُعاد حسابتها من مصادرها لا تكذب إلّا إذا كذب مصدرها، والمصدر مخزّن.
--   - **ما يُنشَر إلى المطابقة يُسجَّل قبل نشره** (`driver_candidacy_publications`): بعد
--     شهر يُسأل «لماذا عُرض هذا الطلب على هذا السائق؟» والجواب يبدأ من هنا لا من ذاكرة أحد.
--     وخدمة السائق **لا تكتب في قاعدة المطابقة** — تنادي `PUT /candidacy/{id}` وحده
--     (ADR-012 القرار 3 · سابقة `OrderIntakePort` في ADR-009 §3).
--   - **الزمن نبضة لا مؤقّت** (سابقة ADR-011 القرار 3): انتهاء وثيقة **ليس** حالة تُكتب
--     بوظيفة خلفية، بل استحقاق مخزّن (`expires_at`) يُقارَن بساعة مُحقونة، و
--     `eligibility_recheck_at` على الملف هو الفهرس الذي تقرؤه النبضة. فإعادة تشغيل
--     الخدمة لا تُفقِد انتهاءً، والاختبار يُقدّم الساعة بلا انتظار.
--   - **الوثائق مراجع لا محتوى**: `storage_ref` مُعرّف في مخزن الملفّات، ولا رقم هوية
--     ولا رقم رخصة ولا صورة في هذه القاعدة (§9.2 + سياسة الخصوصية). والتحقّق هنا
--     «تسجيل وجمع وتحقّق من الاتساق والصلاحية حسب المتوفّر» لا قرار تعسّفي.
--   - **الاشتراك ليس هنا** (§10 · Phase 10): لا عمود `subscription_status` ولا `TRIAL`
--     ولا `COMMUNITY`. عمودٌ يُضاف قبل مالكه يُملأ بقيَم يخترعها من لا يملك القرار.
--   - **السمعة والتقييم ليسا هنا** (§9.1 يذكرهما · Phase 09 يملكهما): لا `rating` ولا
--     `reputation_score` ولا `completion_rate`. لا نُخزّن رقماً لا نملك مصدره.
--   - القناة لا تظهر: لا `telegram` ولا `chat_id` في أي عمود (ADR-007). واجهة السائق
--     طبقة توصيل تُبنى فوق هذا العقد لا داخله.
--
-- المصدر: PostgreSQL (source of truth). Domain Events عبر Outbox من البداية.
-- الترقيم: أي ترحيل (migration) يجب أن يكون عكوساً (reversible) وموثّقاً في TASK_LOG.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) driver_profiles — ملف السائق (ملفُّ دور لمستخدم قائم)
--    `status` قرار إداري صريح، و`verification_status` نتيجة مراجعة الوثائق.
--    الفصل بينهما مقصود: إيقافُ سائق مُتحقَّق منه يجب أن يبقى مرئياً كإيقاف،
--    لا أن يُمحى بإرجاع تحقّقه إلى `unverified` فيضيع سبب المنع.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_profiles (
    wasla_public_id        TEXT        PRIMARY KEY
                           CHECK (wasla_public_id ~ '^WS-[0-9]{10}$'),
    display_name           TEXT        CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 80),
    preferred_locale       TEXT        NOT NULL DEFAULT 'ar'
                           CHECK (preferred_locale IN ('ar','en','ur')),

    -- مدينة العمل: مرجع opaque إلى هرم الجغرافيا (بلا FK · ADR-006). التحقّق من وجود
    -- المنطقة ونشاطها يمرّ بـGeographyPort لا بقيد قاعدة.
    work_city_zone_id      UUID,

    -- أنواع الخدمة التي يقبلها. القائمة مُقفلة وهي **نفسها** المقفلة في عقد الطلب
    -- وفي إسقاط الترشيح: نقصُ عنصر يُخفي سائقاً صالحاً، وزيادته تُنتج عرضاً لا يُنفَّذ.
    service_kinds          TEXT[]      NOT NULL DEFAULT '{}'
                           CHECK (
                               array_length(service_kinds, 1) IS NULL
                               OR service_kinds <@ ARRAY['ride','delivery']::TEXT[]
                           ),

    -- التوافر **المُعلَن من السائق** لا التوافر الفعلي: `busy` ليست من كلماته لأنّها
    -- تُشتقّ من التزام جارٍ يملكه التوزيع (ADR-011). القاعدة الحاكمة في ADR-012 القرار 4:
    -- «الالتزام الجاري يعلو على الإعلان».
    declared_availability  TEXT        NOT NULL DEFAULT 'offline'
                           CHECK (declared_availability IN ('available','offline')),

    -- نتيجة مراجعة الوثائق. `pending_review` تعني «قُدِّم شيء ولم يُبَتّ فيه»،
    -- وهي ليست أهليّة: المجهول ليس مرشّحاً (fail-closed).
    verification_status    TEXT        NOT NULL DEFAULT 'unverified'
                           CHECK (verification_status IN ('unverified','pending_review','verified','rejected')),

    -- قرار إداري. الإيقاف يعلو على كل شيء ولا يُشتقّ من غيره.
    status                 TEXT        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','suspended')),
    suspension_reason_code TEXT        CHECK (suspension_reason_code IS NULL OR char_length(suspension_reason_code) BETWEEN 3 AND 64),

    -- نسخة سياسة الأهليّة التي حُسِبت بها آخر مرّة: قرار الأمس يُفهَم بقواعد الأمس.
    eligibility_policy_version INTEGER NOT NULL DEFAULT 1 CHECK (eligibility_policy_version >= 1),

    -- **مؤشّر النبضة**: أقرب لحظة قد تتغيّر عندها الأهليّة بلا فعل من أحد (انتهاء وثيقة).
    -- NULL تعني «لا شيء ينتهي تلقائياً»، ولا تعني «لا تُعِد الحساب أبداً».
    eligibility_recheck_at TIMESTAMPTZ,
    -- آخر أهليّة نُشرت فعلاً إلى المطابقة، لا الأهليّة المحسوبة الآن: الفرق بينهما
    -- هو **الانحراف** الذي تسدّه النبضة، وبلا تسجيله لا يُقاس.
    last_published_state   TEXT        CHECK (last_published_state IS NULL OR last_published_state IN ('eligible','ineligible','suspended','unknown')),
    last_published_at      TIMESTAMPTZ,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- الإيقاف يحمل سببه: منعٌ بلا سبب لا يمكن رفعه ولا مراجعته.
    CONSTRAINT ck_driver_profiles_suspension_reason CHECK (
        (status = 'suspended' AND suspension_reason_code IS NOT NULL)
        OR
        (status = 'active'    AND suspension_reason_code IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS ix_driver_profiles_recheck
    ON driver_profiles (eligibility_recheck_at)
    WHERE eligibility_recheck_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_driver_profiles_work_city
    ON driver_profiles (work_city_zone_id) WHERE work_city_zone_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 2) driver_service_zones — مناطق الخدمة المفضّلة
--    جدول لا عمود مصفوفة: المنطقة تحمل ترتيب تفضيل وتاريخ إضافة، والمصفوفة لا تحمل
--    شيئاً منهما. والتطابق يُحسَب بالهرم لا بالمساواة (ADR-006) في طبقة المطابقة.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_service_zones (
    wasla_public_id  TEXT        NOT NULL
                     REFERENCES driver_profiles(wasla_public_id) ON DELETE CASCADE,
    zone_id          UUID        NOT NULL,                    -- مرجع opaque إلى الجغرافيا (بلا FK)
    preference_rank  INTEGER     NOT NULL CHECK (preference_rank BETWEEN 1 AND 50),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (wasla_public_id, zone_id)
);

-- ترتيب التفضيل فريد لكل سائق: رتبتان متساويتان تعنيان أنّ التفضيل ليس تفضيلاً.
CREATE UNIQUE INDEX IF NOT EXISTS ux_driver_service_zones_rank
    ON driver_service_zones (wasla_public_id, preference_rank);

CREATE INDEX IF NOT EXISTS ix_driver_service_zones_zone
    ON driver_service_zones (zone_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3) driver_vehicles — المركبات
--    مركبة رئيسية واحدة على الأكثر بفهرس فريد جزئي: «رئيسيّتان» حالة مستحيلة يجب أن
--    تمنعها القاعدة لا أن يتذكّرها الكود. ولوحة المركبة تُخزَّن لأنّها تشغيليّة
--    (تسليم واستلام)، و**لا تدخل أي حمولة حدث** (events.json يمنعها بحارس).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_vehicles (
    id               UUID        PRIMARY KEY,
    wasla_public_id  TEXT        NOT NULL
                     REFERENCES driver_profiles(wasla_public_id) ON DELETE CASCADE,
    vehicle_class    TEXT        NOT NULL
                     CHECK (vehicle_class IN ('sedan','suv','van','pickup','motorcycle','truck_small')),
    make             TEXT        CHECK (make  IS NULL OR char_length(make)  BETWEEN 1 AND 40),
    model            TEXT        CHECK (model IS NULL OR char_length(model) BETWEEN 1 AND 40),
    model_year       INTEGER     CHECK (model_year IS NULL OR model_year BETWEEN 1970 AND 2100),
    color            TEXT        CHECK (color IS NULL OR char_length(color) BETWEEN 1 AND 24),
    plate_number     TEXT        CHECK (plate_number IS NULL OR char_length(plate_number) BETWEEN 3 AND 16),
    is_primary       BOOLEAN     NOT NULL DEFAULT false,
    status           TEXT        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','retired')),
    idempotency_key  TEXT        NOT NULL
                     CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- مركبة مُتقاعدة لا تكون رئيسية: الأهليّة تقرأ الرئيسية، ومُتقاعدةٌ رئيسية تُنتج
    -- سائقاً مؤهَّلاً بمركبة لا وجود لها.
    CONSTRAINT ck_driver_vehicles_retired_not_primary
        CHECK (status = 'active' OR is_primary = false)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_driver_vehicles_one_primary
    ON driver_vehicles (wasla_public_id) WHERE is_primary;

CREATE UNIQUE INDEX IF NOT EXISTS ux_driver_vehicles_idempotency
    ON driver_vehicles (wasla_public_id, idempotency_key);

CREATE INDEX IF NOT EXISTS ix_driver_vehicles_owner
    ON driver_vehicles (wasla_public_id, status);

-- ─────────────────────────────────────────────────────────────────────
-- 4) driver_documents — وثائق السائق
--    نسخة واحدة سارية لكل نوع: الفهرس الفريد الجزئي يمنع «رخصتين مُتحقَّقتين»
--    إحداهما منتهية. والاستبدال يُبقي القديمة `superseded` لا يحذفها — التدقيق
--    يحتاج أن يرى ما كان مقبولاً يوم اتُّخذ القرار.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_documents (
    id                    UUID        PRIMARY KEY,
    wasla_public_id       TEXT        NOT NULL
                          REFERENCES driver_profiles(wasla_public_id) ON DELETE CASCADE,
    document_type         TEXT        NOT NULL
                          CHECK (document_type IN (
                              'national_id','driving_license','vehicle_registration',
                              'vehicle_insurance','vehicle_photo')),
    -- مرجع في مخزن الملفّات لا محتوى الملف: القاعدة ليست مخزن صور، ولا تحمل رقم وثيقة.
    storage_ref           TEXT        NOT NULL
                          CHECK (char_length(storage_ref) BETWEEN 8 AND 200),
    vehicle_id            UUID        REFERENCES driver_vehicles(id) ON DELETE CASCADE,
    status                TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','verified','rejected','superseded')),
    issued_at             DATE,
    -- الانتهاء **بيانٌ لا حالة**: الحالة تُشتقّ منه بمقارنة الساعة المُحقونة، فلا
    -- تُخزَّن حالة `expired` يمكن أن تتخلّف عن الواقع بين وظيفتين خلفيتين.
    expires_at            DATE,
    reviewed_at           TIMESTAMPTZ,
    reviewed_by           TEXT        CHECK (reviewed_by IS NULL OR char_length(reviewed_by) BETWEEN 2 AND 64),
    rejection_reason_code TEXT        CHECK (rejection_reason_code IS NULL OR char_length(rejection_reason_code) BETWEEN 3 AND 64),
    idempotency_key       TEXT        NOT NULL
                          CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- كل بتّ يحمل وقته ومَن بتّه، والرفض يحمل سببه.
    CONSTRAINT ck_driver_documents_review_coherence CHECK (
        (status = 'pending'    AND reviewed_at IS NULL     AND reviewed_by IS NULL     AND rejection_reason_code IS NULL)
        OR
        (status = 'verified'   AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND rejection_reason_code IS NULL)
        OR
        (status = 'rejected'   AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND rejection_reason_code IS NOT NULL)
        OR
        (status = 'superseded')
    ),
    -- تاريخ انتهاء قبل تاريخ إصدار ليس بياناً ناقصاً بل بيانٌ خاطئ.
    CONSTRAINT ck_driver_documents_dates CHECK (
        issued_at IS NULL OR expires_at IS NULL OR expires_at > issued_at
    ),
    -- وثيقة مركبة تلزمها مركبة، ووثيقة شخص لا تحمل مركبة: الخلط يُنتج تأميناً
    -- «مُتحقَّقاً» لا يُعرَف أيّ مركبة يغطّي.
    CONSTRAINT ck_driver_documents_vehicle_scope CHECK (
        (document_type IN ('vehicle_registration','vehicle_insurance','vehicle_photo') AND vehicle_id IS NOT NULL)
        OR
        (document_type IN ('national_id','driving_license') AND vehicle_id IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_driver_documents_one_live_per_type
    ON driver_documents (wasla_public_id, document_type, COALESCE(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE status IN ('pending','verified');

CREATE UNIQUE INDEX IF NOT EXISTS ux_driver_documents_idempotency
    ON driver_documents (wasla_public_id, idempotency_key);

CREATE INDEX IF NOT EXISTS ix_driver_documents_owner
    ON driver_documents (wasla_public_id, status);

-- أقرب انتهاء لوثيقة سارية: مصدر `eligibility_recheck_at` وفهرس النبضة.
CREATE INDEX IF NOT EXISTS ix_driver_documents_expiry
    ON driver_documents (expires_at)
    WHERE status = 'verified' AND expires_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 5) driver_eligibility_policies — قاعدة الأهليّة **بياناً بنسخة مُقفَلة**
--    (سابقة `matching_rulesets` · ADR-011 القرار 6): تغيير المطلوب = نسخة جديدة،
--    فتبقى قرارات الأمس مفهومة بقواعد الأمس. والنسخة المُستعمَلة تُقفَل فلا تُحرَّر.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_eligibility_policies (
    version                    INTEGER     PRIMARY KEY CHECK (version >= 1),
    label                      TEXT        NOT NULL CHECK (char_length(label) BETWEEN 3 AND 64),

    -- الوثائق المطلوبة لكل نوع خدمة. مصفوفتان لا جدول واحد: السؤال دائماً
    -- «ما المطلوب لهذا النوع؟» ولا يُسأل عكسه.
    required_documents_ride     TEXT[]     NOT NULL DEFAULT ARRAY['national_id','driving_license','vehicle_registration']::TEXT[],
    required_documents_delivery TEXT[]     NOT NULL DEFAULT ARRAY['national_id','driving_license','vehicle_registration']::TEXT[],

    require_primary_vehicle     BOOLEAN    NOT NULL DEFAULT true,
    require_service_zone        BOOLEAN    NOT NULL DEFAULT true,

    -- مهلة سماح بعد انتهاء وثيقة (بالأيام). صفرٌ **مُعلَن** لا إغفال: النسخة 1 لا
    -- تسامح، ومن يريد التسامح يُصدر نسخة 2 ويُبرّرها.
    document_grace_days         INTEGER    NOT NULL DEFAULT 0 CHECK (document_grace_days BETWEEN 0 AND 60),

    is_frozen                   BOOLEAN    NOT NULL DEFAULT false,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- كل نوع مطلوب يجب أن يكون نوعاً معروفاً: مطلوبٌ مجهول لا يمكن تقديمه أبداً،
    -- فيصير كل سائق غير مؤهَّل بصمت.
    CONSTRAINT ck_policy_required_documents_known CHECK (
        required_documents_ride     <@ ARRAY['national_id','driving_license','vehicle_registration','vehicle_insurance','vehicle_photo']::TEXT[]
        AND
        required_documents_delivery <@ ARRAY['national_id','driving_license','vehicle_registration','vehicle_insurance','vehicle_photo']::TEXT[]
    )
);

INSERT INTO driver_eligibility_policies (version, label, is_frozen)
VALUES (1, 'saudi-launch-v1', true)
ON CONFLICT (version) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 6) driver_eligibility_log — لماذا صار مؤهَّلاً (أو لم يصر)
--    سجل إلحاقي لا يُحدَّث: يُجيب بعد شهر عن سؤال لا يُجيبه عمود واحد.
--    `reasons` أكواد لا نصوص: النص يُترجَم ويتغيّر، والكود يُقارَن ويُحصى.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_eligibility_log (
    id               BIGSERIAL   PRIMARY KEY,
    wasla_public_id  TEXT        NOT NULL
                     REFERENCES driver_profiles(wasla_public_id) ON DELETE CASCADE,
    from_state       TEXT        CHECK (from_state IS NULL OR from_state IN ('eligible','ineligible','suspended','unknown')),
    to_state         TEXT        NOT NULL
                     CHECK (to_state IN ('eligible','ineligible','suspended','unknown')),
    reasons          TEXT[]      NOT NULL DEFAULT '{}',
    policy_version   INTEGER     NOT NULL CHECK (policy_version >= 1),
    -- ما الذي حرّك الحساب: فعل من السائق، أو مراجعة إدارية، أو **مرور الزمن**.
    trigger          TEXT        NOT NULL
                     CHECK (trigger IN ('profile_changed','document_reviewed','document_submitted',
                                        'vehicle_changed','zones_changed','availability_declared',
                                        'suspended','reinstated','expiry_tick','recompute')),
    evaluated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- حالةٌ غير مؤهَّلة بلا سبب واحد على الأقل تعني حاسباً لا يشرح نفسه.
    CONSTRAINT ck_eligibility_log_reasons CHECK (
        to_state = 'eligible' OR array_length(reasons, 1) >= 1
    )
);

CREATE INDEX IF NOT EXISTS ix_driver_eligibility_log_driver
    ON driver_eligibility_log (wasla_public_id, evaluated_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 7) driver_candidacy_publications — ما أُرسل إلى المطابقة فعلاً
--    خدمة السائق لا تكتب في قاعدة المطابقة (ADR-012 القرار 3). وهذا الجدول يسجّل
--    **محاولة** النشر ونتيجتها: فشلُ نشرٍ صامت يعني سائقاً مؤهَّلاً لا يراه أحد،
--    وهي أسوأ الحالات لأنّها لا تُنتج شكوى من أحد.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_candidacy_publications (
    id                  BIGSERIAL   PRIMARY KEY,
    wasla_public_id     TEXT        NOT NULL
                        REFERENCES driver_profiles(wasla_public_id) ON DELETE CASCADE,
    eligibility_state   TEXT        NOT NULL
                        CHECK (eligibility_state IN ('eligible','ineligible','suspended','unknown')),
    availability_state  TEXT        NOT NULL
                        CHECK (availability_state IN ('available','busy','offline')),
    service_kinds       TEXT[]      NOT NULL DEFAULT '{}',
    zone_ids            UUID[]      NOT NULL DEFAULT '{}',
    vehicle_class       TEXT        CHECK (vehicle_class IS NULL OR vehicle_class IN
                            ('sedan','suv','van','pickup','motorcycle','truck_small')),
    outcome             TEXT        NOT NULL
                        CHECK (outcome IN ('published','rejected','unavailable')),
    -- كود الفشل كما ردّته المطابقة، أو `TIMEOUT` إن لم تردّ. لا نصّ استثناء خام.
    failure_code        TEXT        CHECK (failure_code IS NULL OR char_length(failure_code) BETWEEN 3 AND 64),
    attempted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_candidacy_publication_outcome CHECK (
        (outcome = 'published' AND failure_code IS NULL)
        OR
        (outcome <> 'published' AND failure_code IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS ix_driver_candidacy_publications_driver
    ON driver_candidacy_publications (wasla_public_id, attempted_at DESC);

-- النشر الفاشل وحده يُفهرَس: هو ما يُقرأ في التشغيل، وحجمه حجم المشكلة لا حجم النجاح.
CREATE INDEX IF NOT EXISTS ix_driver_candidacy_publications_failed
    ON driver_candidacy_publications (attempted_at DESC) WHERE outcome <> 'published';

-- ─────────────────────────────────────────────────────────────────────
-- 8) driver_outbox — Domain Events Outbox
--    قاعدة الخصوصية في events.json: لا اسم ولا هاتف ولا لوحة ولا `storage_ref`
--    ولا إحداثية في أي حمولة. الحدث يقول «ماذا تغيّر» لا «من هو».
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_outbox (
    id             BIGSERIAL    PRIMARY KEY,
    event_id       UUID         NOT NULL UNIQUE,
    event_type     TEXT         NOT NULL,
    event_version  TEXT         NOT NULL,
    aggregate_type TEXT         NOT NULL
                   CHECK (aggregate_type IN ('driver','driver_document','driver_vehicle')),
    aggregate_id   TEXT         NOT NULL,
    payload        JSONB        NOT NULL,
    occurred_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_driver_outbox_unpublished
    ON driver_outbox (occurred_at) WHERE published_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 9) driver_idempotency — ذاكرة مفاتيح منع التكرار
--    ترحيل إضافي عكوس أُضيف في Phase 05 · MR 3/6 (التراجع: DROP TABLE driver_idempotency).
--    سابقة حرفيّة: `dispatch_idempotency` في Phase 07 · MR 5a/6، ولنفس السبب.
--
--    منفذ `IdempotencyStore` (ports.ts) موجود منذ MR 2/6 بلا مكان يخزّن فيه، وحالتا
--    استعماله في `manage-vehicles.ts` و`manage-documents.ts` تخزّنان **بصمة الحمولة**
--    لا المفتاح وحده. الجدول ليس تكراراً لـ`ux_driver_vehicles_idempotency` ولا
--    لـ`ux_driver_documents_idempotency`: ذانك الفهرسان يمنعان صفّاً ثانياً بنفس
--    المفتاح، وهذا الجدول يجيب عن السؤال الذي لا يجيبه أي منهما — «هل هذه إعادة
--    محاولة لنفس الطلب، أم مفتاحٌ أُعيد استعماله بحمولة أخرى؟». بلا البصمة تبدو
--    الحالتان نجاحاً واحداً، فتُقبل ورقة سائق تحت مفتاح سيّارة سائق آخر بصمت.
--
--    المفتاح المخزَّن **مُنَطَّق** (namespaced): `vehicle:<wasla_public_id>:<key>` أو
--    `document:<wasla_public_id>:<key>` كما يبنيه الاستعمال. لذلك الحدّ 8..192 لا
--    8..128: الحدّ الأخير هو حدّ `assertIdempotencyKey` للمفتاح الخام وحده
--    (وهو حدّ عمودَي `idempotency_key` أعلاه)، وإضافة البادئة تبلغ 151 محرفاً.
--    حدٌّ تقبله الدالّة وترفضه القاعدة يُنتج 500 بلا سبب مفهوم — وهذا بالضبط ما
--    وجدته MR 3/6 قبل أن يقع.
--    لا سياسة تقليم في هذه المرحلة (دَين تشغيلي مُعلَن — Phase 09، كما في driver_outbox).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_idempotency (
    idempotency_key     TEXT        PRIMARY KEY
                        CHECK (char_length(idempotency_key) BETWEEN 8 AND 192),
    -- بصمة الحمولة المُعيَّرة لا الحمولة نفسها: لا `storage_ref` ولا لوحة مركبة
    -- ولا نصّ يكتبه سائق في جدول تدقيق تقني (§9.2 + سياسة الخصوصية).
    payload_fingerprint TEXT        NOT NULL
                        CHECK (char_length(payload_fingerprint) BETWEEN 1 AND 4096),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION driver_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_driver_profiles_updated_at ON driver_profiles;
CREATE TRIGGER trg_driver_profiles_updated_at BEFORE UPDATE ON driver_profiles
    FOR EACH ROW EXECUTE FUNCTION driver_set_updated_at();

DROP TRIGGER IF EXISTS trg_driver_vehicles_updated_at ON driver_vehicles;
CREATE TRIGGER trg_driver_vehicles_updated_at BEFORE UPDATE ON driver_vehicles
    FOR EACH ROW EXECUTE FUNCTION driver_set_updated_at();

DROP TRIGGER IF EXISTS trg_driver_documents_updated_at ON driver_documents;
CREATE TRIGGER trg_driver_documents_updated_at BEFORE UPDATE ON driver_documents
    FOR EACH ROW EXECUTE FUNCTION driver_set_updated_at();

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- التراجع (rollback) — يُحذف بترتيب عكسي للتبعيات.
-- ─────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS driver_idempotency;
-- DROP TABLE IF EXISTS driver_outbox;
-- DROP TABLE IF EXISTS driver_candidacy_publications;
-- DROP TABLE IF EXISTS driver_eligibility_log;
-- DROP TABLE IF EXISTS driver_eligibility_policies;
-- DROP TABLE IF EXISTS driver_documents;
-- DROP TABLE IF EXISTS driver_vehicles;
-- DROP TABLE IF EXISTS driver_service_zones;
-- DROP TABLE IF EXISTS driver_profiles;
-- DROP FUNCTION IF EXISTS driver_set_updated_at();
