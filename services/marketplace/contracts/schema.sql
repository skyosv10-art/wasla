-- WASLA Marketplace Service — Data Contract (PostgreSQL DDL)
-- Phase 11 — Marketplace Foundation (أساسُ السوق: متجرٌ ومنتجٌ وطلبُ مراجعة)
--
-- المبدأ الجوهري (ADR-016):
--   - **القرارُ يُخزَّن والحالةُ تُشتقّ** (القرار 1 · وسابقتُه ADR-015 القرار 2): `store_reviews`
--     و`product_reviews` دفتران لا يُعدَّلان (append-only) لكلِّ قرارٍ اتُّخذ — طلبِ مراجعةٍ أو
--     اعتمادٍ أو رفضٍ أو إيقافٍ أو إعادةٍ — و`stores.state` و`products.moderation_state` صفّان
--     **مُتحقِّقان** يُعاد بناؤهما من الدفترَين وحدَهما. حذفُ عمودَي الحالةِ يجب أن يكون عملاً
--     **بلا خسارة**. النسخةُ الخاطئةُ الأرخص: `UPDATE stores SET state = 'approved'` بلا دفترٍ
--     تحته — فيصير سؤالُ «مَن اعتمد هذا المتجرَ ومتى وعلى أيِّ أساس؟» بلا جواب، وهو أوّلُ
--     سؤالٍ يُسأل يومَ يشتكي مشترٍ من متجرٍ ما كان يجب أن يُعتمَد.
--   - **الاعتمادُ قرارُ إنسانٍ لا اشتقاقُ زمن** (القرار 2): بخلاف الاشتراكِ الذي تُحرّكه نبضةٌ،
--     لا شيءَ هنا يعتمد متجراً بمرور الوقت. ولذلك **لا `tick`** ولا عمودَ «يُعتمَد تلقائياً
--     بعد كذا يوماً». النسخةُ الخاطئةُ الأرخص: اعتمادٌ تلقائيٌّ «لتسريعِ الإطلاق» — فيصير
--     غيابُ المُراجعِ إباحةً، وهي أسوأُ صيغةٍ للإباحة: لا أحدَ قرّرها ولا أحدَ يملكها.
--   - **الظهورُ مُشتَقٌّ لا مُخزَّن** (القرار 3): لا عمودَ `is_visible` ولا `is_public` في أيِّ
--     جدول. ظهورُ منتجٍ اقترانُ أربعةِ شروطٍ (المتجرُ `approved` · المنتجُ `published` ·
--     اعتدالُه `approved` · كميّتُه > 0) تُقرأ كلُّها من صفوفٍ قائمة. النسخةُ الخاطئةُ الأرخص:
--     راية ظهورٍ تُحدَّث في كلِّ مسار — فينسى مسارٌ واحدٌ تحديثَها فيبقى منتجُ متجرٍ مُوقَفٍ
--     ظاهراً للمشترين، وهو عيبٌ لا يُكتشَف إلّا بشكوى.
--   - **رقمٌ واحدٌ للسعرِ ولا مالَ يتحرّك** (القرار 4 · وحدُّ ADR-015 القرار 6 قائم):
--     `price_minor_units` عددٌ **صحيحٌ** بأصغرِ وحدةٍ (هللة) و`currency_code` مُقيَّدٌ بـ`SAR`
--     وحدَها. وهو **بيانُ كتالوجٍ لا معاملة**: لا ضريبةَ ولا خصمَ ولا عمولةَ ولا فاتورةَ ولا
--     إجماليَّ ولا تحصيلَ ولا تسويةَ في أيِّ عمودٍ هنا — **وحارسٌ سالبٌ يُثبت غيابَها**، والمالُ
--     المتحرّكُ ملكُ Phase 13 (طلباتُ المتاجر) و Phase 17 (الفوترةُ ورسومُ المتاجر). ولا نوعَ
--     فاصلةٍ عائمةٍ ولا `NUMERIC`: سعرٌ بفاصلةٍ ثنائيّةٍ يُنتج هللةً ضائعةً لا يُحاسَب عليها أحد.
--   - **المخزونُ دفترٌ أيضاً، والحجزُ ليس هنا** (القرار 5): `product_inventory.quantity_on_hand`
--     صفٌّ مُتحقِّقٌ من `inventory_adjustments` (دفترٌ لا يُعدَّل بفروقٍ مُسمّاةِ السبب)، و**لا
--     عمودَ محجوزٍ ولا مُتاحٍ**: الحجزُ عمليّةُ طلبٍ يملكها Phase 13، ولو أُعلن هنا عمودُ
--     `quantity_reserved` لأصبح لدينا نصفُ نظامِ حجزٍ بلا مَن يُنقصه، فيتسرّب مخزونٌ ولا
--     يُعرَف أين ذهب.
--   - **الملكيّةُ مرجعٌ عامٌّ لا مفتاحٌ أجنبيّ** (القرار 6 · ADR-001): المالكُ والموظّفُ
--     والمُراجعُ مراجعُ opaque بصيغة `WS-##########`. لا `REFERENCES identity_*` ولا
--     `REFERENCES drivers` ولا `REFERENCES customers` — السوقُ يُنشَأ **من هويّةٍ قائمة** ولا
--     ينسخها ولا يستعلمها بمفتاحٍ عابرٍ للحدّ.
--   - **العنوانُ اللطيف (slug) مفتاحُ الرابطِ العميق، ولا يُخزَّن رابطٌ** (القرار 7):
--     `stores.slug` فريدٌ **بلا حساسيّةٍ للحالة** وثابتٌ بعد أوّلِ اعتماد، والروابطُ
--     (الويبُ و`startapp`) **تُبنى** من القالب في حزمةِ العقد. النسخةُ الخاطئةُ الأرخص: عمودُ
--     `deep_link` مُخزَّنٌ — فيصير تغييرُ نطاقٍ واحدٍ مُهاجرةً على كلِّ صفٍّ، وتبقى صفوفٌ قديمةٌ
--     تحمل رابطاً ميّتاً لا يعرف أحدٌ أنّه ميّت.
--   - **الأدوارُ قائمةٌ مغلقةٌ ومالكٌ واحدٌ لا يُزال** (القرار 8): `owner · manager · staff`،
--     و`ux_store_staff_single_owner` يمنع مالكاً ثانياً، ولا يُحذف صفٌّ أبداً — الإزالةُ
--     `removed_at`. فسؤالُ «مَن كان يملك صلاحيّةَ النشرِ في رمضان؟» يبقى مُجاباً.
--   - **لا حذفَ صلبٌ ولا بحثٌ هنا** (القرار 9): لا `DELETE` في أيِّ مسار — النهايةُ
--     `archived`. ولا فهرسَ بحثٍ ولا `tsvector` ولا وسومَ حرّة: البحثُ طورٌ لاحقٌ يملكه
--     Phase 12، وفهرسٌ نصفُ مبنيٍّ هنا كان سيصير مصدرَ حقيقةٍ ثانياً لا يُصان.
--
-- المصدر: PostgreSQL (source of truth). Domain Events عبر Outbox من البداية.
-- الترقيم: أي ترحيل (migration) يجب أن يكون عكوساً (reversible) وموثّقاً في TASK_LOG.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) store_categories — تصنيفٌ مبذورٌ بعمقِ مستويَين، لا شجرةٌ يبنيها المستخدم
--    ولمَ لا تصنيفٌ حرٌّ يكتبه صاحبُ المتجر؟ لأنّ الطورَ 12 يبحث بالتصنيف، والبحثُ في
--    حقلٍ حرٍّ بحثٌ في أخطاءِ الإملاء: «الكترونيات» و«إلكترونيات» و«electronics» ثلاثةُ
--    تصنيفاتٍ لمعنى واحد. والعمقُ مستويان بقصد: شجرةٌ بلا حدٍّ تحتاج استعلاماً تكراريّاً
--    في كلِّ صفحةٍ، ثمّ تُنتج فرعاً بعمقِ سبعةٍ لا يجده أحد.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_categories (
    category_id             UUID        PRIMARY KEY,
    slug                    TEXT        NOT NULL CHECK (slug ~ '^[a-z][a-z0-9-]{1,47}$'),

    -- المستوى مُعلَنٌ عموداً لا مُستنتَجاً بالتسلسل: استعلامُ «كلُّ الجذور» يجب أن يكون
    -- شرطاً واحداً لا استعلاماً تكراريّاً، والقيدُ أدناه يربطه بوجودِ الأب أو غيابه.
    depth                   SMALLINT    NOT NULL CHECK (depth IN (1, 2)),
    parent_category_id      UUID,

    -- ثلاثةُ عناوينَ لا حقلٌ واحدٌ يُترجَم لاحقاً (ADR-006): العربيّةُ إلزاميّةٌ لأنّ السوقَ
    -- سعوديٌّ أوّلاً، والإنجليزيّةُ والأرديّةُ اختياريّتان لأنّ غيابَ ترجمةٍ حقيقةٌ تُقرأ
    -- لا فراغٌ يُملأ بالعربيّةِ صمتاً فيظنّ المستهلكُ أنّه تُرجم.
    label_ar                TEXT        NOT NULL CHECK (char_length(label_ar) BETWEEN 2 AND 64),
    label_en                TEXT        CHECK (label_en IS NULL OR char_length(label_en) BETWEEN 2 AND 64),
    label_ur                TEXT        CHECK (label_ur IS NULL OR char_length(label_ur) BETWEEN 2 AND 64),

    -- الترتيبُ بيانٌ لا رأيُ واجهة: لو رتّبت كلُّ واجهةٍ بنفسها لاختلف ترتيبُ التصنيفات
    -- بين البوتِ والويبِ، فيشكو صاحبُ متجرٍ أنّ تصنيفَه «اختفى» وهو في مكانه.
    sort_order              SMALLINT    NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 999),

    -- التعطيلُ لا الحذف: تصنيفٌ عُطِّل تبقى منتجاتُه مقروءةً ولا تُقبل منتجاتٌ جديدةٌ فيه
    -- (`STORE_CATEGORY_INACTIVE`). حذفُه كان سيترك منتجاتٍ بلا تصنيفٍ لا تظهر ولا تُشرَح.
    is_active               BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ux_store_categories_slug UNIQUE (slug),
    CONSTRAINT fk_store_categories_parent
        FOREIGN KEY (parent_category_id) REFERENCES store_categories (category_id),

    -- جذرٌ بلا أبٍ وفرعٌ بأبٍ: قيدٌ واحدٌ يمنع «جذراً له أب» و«فرعاً بلا أب» معاً، فلا
    -- يحتاج الكودُ أن يتذكّر أيَّهما يفحص. والعمقُ 2 يعني أنّ أبَ الفرعِ جذرٌ بالضرورة.
    CONSTRAINT ck_store_categories_depth_parent
        CHECK ((depth = 1 AND parent_category_id IS NULL) OR (depth = 2 AND parent_category_id IS NOT NULL))
);

-- ─────────────────────────────────────────────────────────────────────
-- 2) stores — المتجرُ، وحالتُه صفٌّ مُتحقِّقٌ من دفترِ المراجعات
--    `state_sequence` يقيم هنا لا في الدفتر وحده لأنّ المستهلكَ يقرأ المتجرَ لا الدفتر،
--    ومستهلكٌ يرى حالةً بلا تسلسلٍ لا يعرف إن كانت أحدثَ ممّا عنده (التسليمُ at-least-once).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stores (
    store_id                UUID        PRIMARY KEY,

    -- مرجعُ المالك العلنيُّ (ADR-001). لا مفتاحَ أجنبيّاً إلى الهويّة: هذه الخدمةُ تصدّق
    -- المرجعَ ولا تملكه، ومَن أراد ملفَّ المالكِ سأل خدمةَ الهويّة.
    owner_public_id         TEXT        NOT NULL CHECK (owner_public_id ~ '^WS-[0-9]{10}$'),

    -- العنوانُ اللطيف: مفتاحُ الرابطِ العميقِ ومُعرِّفُ المتجرِ في كلِّ مسارٍ علنيّ.
    -- محفوظٌ **بحرفِه** ومُقيَّدٌ بحروفٍ صغيرةٍ كي لا يوجد `Wasla-Store` و`wasla-store` معاً:
    -- رابطان يُقرآن سواءً في رسالةٍ صوتيّةٍ ويؤدّيان إلى متجرَين مختلفَين هو بابُ انتحال.
    slug                    TEXT        NOT NULL CHECK (slug ~ '^[a-z][a-z0-9-]{2,47}$'),

    title_ar                TEXT        NOT NULL CHECK (char_length(title_ar) BETWEEN 2 AND 80),
    title_en                TEXT        CHECK (title_en IS NULL OR char_length(title_en) BETWEEN 2 AND 80),
    title_ur                TEXT        CHECK (title_ur IS NULL OR char_length(title_ur) BETWEEN 2 AND 80),

    -- نصُّ الوصفِ يقيم في المورد **ولا يسافر في أيِّ حدث** (القرار 10): مستهلكُ الأحداثِ
    -- يبني ترتيباً أو فهرساً أو إشعاراً، ولا واحدَ منها يحتاج نصّاً حرّاً؛ ونصٌّ حرٌّ في
    -- حمولةٍ يُنسخ في سبعةِ مخازنَ ثمّ يُطلب حذفُه من مكانٍ واحد.
    description_ar          TEXT        CHECK (description_ar IS NULL OR char_length(description_ar) <= 2000),

    category_id             UUID        NOT NULL,

    -- الحالةُ صفٌّ مُتحقِّقٌ (القرار 1). القائمةُ مغلقةٌ ومطابقةٌ حرفيّاً لثابتِ الحزمة،
    -- و`archived` نهايةٌ لا رجوعَ منها: متجرٌ يعود من الأرشيفِ يعود بتاريخٍ لا أحدَ راجعه.
    state                   TEXT        NOT NULL DEFAULT 'draft'
        CHECK (state IN ('draft', 'pending_review', 'approved', 'rejected', 'suspended', 'archived')),
    state_sequence          INTEGER     NOT NULL DEFAULT 1 CHECK (state_sequence >= 1),

    -- زمنُ أوّلِ اعتمادٍ: بعده يُقفَل `slug` (القرار 7). ولمَ أوّلُ اعتمادٍ لا آخرُه؟ لأنّ
    -- الرابطَ يُنشَر بعد الاعتمادِ الأوّل، وما نُشِر لا يُسحب بإيقافٍ ثمّ إعادة.
    first_approved_at       TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- `LOWER(slug)` لا `slug` وحدَه: القيدُ على النصِّ يسمح بفرقِ حالةٍ يُقرأ سواءً.
    CONSTRAINT fk_stores_category FOREIGN KEY (category_id) REFERENCES store_categories (category_id),

    -- متجرٌ نشطٌ واحدٌ لكلِّ مالكٍ في نطاقِ الإطلاق (`STORE_OWNER_LIMIT_REACHED`)، والأرشيفُ
    -- لا يُحجز الاسم. ولمَ حدٌّ أصلاً؟ لأنّ مالكاً بعشرةِ متاجرَ في أوّلِ أسبوعٍ إشارةُ
    -- إغراقٍ لا نموّ، ورفعُ الحدِّ قرارٌ يُتخذ برقمٍ مقروءٍ لا بغيابِ قيد.
    CONSTRAINT ck_stores_first_approved_state
        CHECK (first_approved_at IS NULL OR state <> 'draft')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_stores_slug_lower ON stores (LOWER(slug));
CREATE UNIQUE INDEX IF NOT EXISTS ux_stores_owner_active
    ON stores (owner_public_id) WHERE state <> 'archived';
CREATE INDEX IF NOT EXISTS ix_stores_state_category ON stores (state, category_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3) store_reviews — دفترُ قراراتِ المتجر، لا يُعدَّل ولا يُحذف
--    كلُّ صفٍّ يحمل **مَن قرّر ولماذا وفي أيِّ تسلسل**. والسببُ رمزٌ من قائمةٍ مغلقةٍ لا
--    نصٌّ حرّ: «غيرُ مطابق» بالعربيّةِ ثلاثُ صيغٍ لا تُعَدّ ولا تُترجَم ولا تُشتكى منها.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_reviews (
    review_id               UUID        PRIMARY KEY,
    store_id                UUID        NOT NULL,

    -- القرارُ لا الحالة: `review_requested` قرارُ صاحبِ المتجر، والبقيّةُ قراراتُ مُراجع.
    -- والفرقُ بين القرارِ والحالةِ مقصودٌ: الحالةُ تُشتقّ من آخرِ قرارٍ، فلو سمّينا العمودَ
    -- `state` لصار الدفترُ نسخةً ثانيةً من عمودِ الحالةِ لا سبباً له.
    decision                TEXT        NOT NULL
        CHECK (decision IN ('review_requested', 'approved', 'rejected', 'suspended', 'reinstated', 'archived')),

    -- سببُ الرفضِ أو الإيقافِ: إلزاميٌّ لهما، ممنوعٌ لغيرهما (القيدُ أدناه). رفضٌ بلا سببٍ
    -- يُعيد صاحبَ المتجرِ إلى التخمين، ثمّ يُعيد الطلبَ كما هو فيُرفض ثانيةً.
    reason_code             TEXT
        CHECK (reason_code IS NULL OR reason_code IN (
            'incomplete_profile', 'prohibited_category', 'duplicate_store',
            'misleading_title', 'unverified_owner', 'policy_violation', 'owner_request'
        )),

    actor_type              TEXT        NOT NULL CHECK (actor_type IN ('owner', 'moderator', 'system')),

    -- مرجعُ الفاعلِ العلنيّ. `NULL` **فقط** لفاعلِ النظام، والقيدُ يمنع قراراً بشريّاً
    -- بلا فاعلٍ مُسمّى: قرارُ اعتمادٍ بلا صاحبٍ قرارٌ لا يُسأل عنه أحد.
    actor_public_id         TEXT        CHECK (actor_public_id IS NULL OR actor_public_id ~ '^WS-[0-9]{10}$'),

    from_state              TEXT        CHECK (from_state IS NULL OR from_state IN ('draft', 'pending_review', 'approved', 'rejected', 'suspended', 'archived')),
    to_state                TEXT        NOT NULL CHECK (to_state IN ('draft', 'pending_review', 'approved', 'rejected', 'suspended', 'archived')),
    state_sequence          INTEGER     NOT NULL CHECK (state_sequence >= 1),
    decided_at              TIMESTAMPTZ NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_store_reviews_store FOREIGN KEY (store_id) REFERENCES stores (store_id),
    CONSTRAINT ux_store_reviews_sequence UNIQUE (store_id, state_sequence),
    CONSTRAINT ck_store_reviews_reason_required
        CHECK ((decision IN ('rejected', 'suspended') AND reason_code IS NOT NULL)
            OR (decision NOT IN ('rejected', 'suspended') AND (decision = 'archived' OR reason_code IS NULL))),
    CONSTRAINT ck_store_reviews_actor
        CHECK ((actor_type = 'system' AND actor_public_id IS NULL) OR (actor_type <> 'system' AND actor_public_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ix_store_reviews_store_seq ON store_reviews (store_id, state_sequence DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 4) store_staff — الأدوارُ، ولا صفَّ يُحذف
--    الإزالةُ `removed_at` لا `DELETE`: لو حُذف الصفُّ لصار «مَن نشر هذا المنتجَ؟» سؤالاً
--    بلا جوابٍ بعد أن يترك الموظّفُ المتجر — وهو أوّلُ سؤالٍ في أيِّ نزاعِ اعتدال.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_staff (
    staff_id                UUID        PRIMARY KEY,
    store_id                UUID        NOT NULL,
    member_public_id        TEXT        NOT NULL CHECK (member_public_id ~ '^WS-[0-9]{10}$'),

    -- ثلاثةُ أدوارٍ ومصفوفةُ صلاحيّاتِها مُعلَنةٌ في حزمةِ العقد لا مُستنتَجةً من `if`:
    -- المالكُ يملك كلَّ شيءٍ في متجره، والمديرُ ينشر ويعدّل المخزونَ ولا يطلب مراجعةً،
    -- والموظّفُ يعدّل المخزونَ وحدَه. ولا دورَ يعتمد متجراً: الاعتدالُ سلطةٌ من خارجِ المتجر.
    role                    TEXT        NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
    added_by_public_id      TEXT        NOT NULL CHECK (added_by_public_id ~ '^WS-[0-9]{10}$'),
    added_at                TIMESTAMPTZ NOT NULL,
    removed_at              TIMESTAMPTZ,
    removed_by_public_id    TEXT        CHECK (removed_by_public_id ~ '^WS-[0-9]{10}$'),

    CONSTRAINT fk_store_staff_store FOREIGN KEY (store_id) REFERENCES stores (store_id),
    CONSTRAINT ck_store_staff_removed_pair
        CHECK ((removed_at IS NULL AND removed_by_public_id IS NULL) OR (removed_at IS NOT NULL AND removed_by_public_id IS NOT NULL)),
    CONSTRAINT ck_store_staff_removed_after_added CHECK (removed_at IS NULL OR removed_at >= added_at)
);

-- عضويّةٌ نشطةٌ واحدةٌ لكلِّ شخصٍ في متجر، ومالكٌ نشطٌ واحدٌ لكلِّ متجر. القيدان جزئيّان
-- (`WHERE removed_at IS NULL`) كي يبقى التاريخُ كاملاً ولا يمنع صفٌّ مُزالٌ عودةَ الشخص.
CREATE UNIQUE INDEX IF NOT EXISTS ux_store_staff_active_member
    ON store_staff (store_id, member_public_id) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_store_staff_single_owner
    ON store_staff (store_id) WHERE role = 'owner' AND removed_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 5) products — المنتجُ: حالةُ نشرٍ يملكها المتجر، وحالةُ اعتدالٍ يملكها المُراجع
--    عمودان لا عمودٌ واحدٌ بقصد: «مسودّةٌ» قرارُ صاحبِ المتجر و«مرفوضٌ» قرارُ المُراجع،
--    وخلطُهما في عمودٍ واحدٍ يجعل ردَّ منتجٍ مرفوضٍ إلى المسودّةِ محواً لقرارِ الاعتدال.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
    product_id              UUID        PRIMARY KEY,
    store_id                UUID        NOT NULL,

    -- رمزُ الصنفِ كما يكتبه المتجرُ: فريدٌ **داخلَ المتجر** لا في السوقِ كلِّه. توحيدُه
    -- عالميّاً كان سيمنع متجرَين من استعمالِ `A-1`، وهو منعٌ لا يخدم أحداً.
    sku                     TEXT        NOT NULL CHECK (sku ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$'),
    title_ar                TEXT        NOT NULL CHECK (char_length(title_ar) BETWEEN 2 AND 120),
    title_en                TEXT        CHECK (title_en IS NULL OR char_length(title_en) BETWEEN 2 AND 120),
    title_ur                TEXT        CHECK (title_ur IS NULL OR char_length(title_ur) BETWEEN 2 AND 120),
    description_ar          TEXT        CHECK (description_ar IS NULL OR char_length(description_ar) <= 4000),

    -- التصنيفُ **ورقةٌ** (`depth = 2`) لا جذرٌ (`PRODUCT_CATEGORY_NOT_LEAF`): منتجٌ في الجذرِ
    -- يجعل «إلكترونيّات» سلّةَ كلِّ ما لم يُصنَّف، ثمّ لا يفيد البحثُ في الطور 12 بشيء.
    category_id             UUID        NOT NULL,

    -- السعرُ: عددٌ صحيحٌ بالهللةِ (القرار 4). صفرٌ ممنوعٌ لأنّ «مجّاناً» في كتالوجٍ يُقرأ
    -- خطأً في السعرِ لا عرضاً، والعرضُ المجّانيُّ قرارُ تسويقٍ يملكه طورٌ لاحق.
    price_minor_units       INTEGER     NOT NULL CHECK (price_minor_units BETWEEN 1 AND 100000000),

    -- عملةٌ واحدةٌ مُقيَّدةٌ لا حقلٌ حرٌّ بثلاثةِ أحرف: سوقُ الإطلاقِ سعوديٌّ، وعملةٌ ثانيةٌ
    -- تحتاج سعرَ صرفٍ ومصدرَه ولحظتَه — وذاك قرارٌ لا يُتخذ بعمودٍ يقبل أيَّ ثلاثةِ أحرف.
    currency_code           TEXT        NOT NULL DEFAULT 'SAR' CHECK (currency_code = 'SAR'),

    state                   TEXT        NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'archived')),
    moderation_state        TEXT        NOT NULL DEFAULT 'pending' CHECK (moderation_state IN ('pending', 'approved', 'rejected')),
    moderation_sequence     INTEGER     NOT NULL DEFAULT 1 CHECK (moderation_sequence >= 1),

    created_by_public_id    TEXT        NOT NULL CHECK (created_by_public_id ~ '^WS-[0-9]{10}$'),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_products_store FOREIGN KEY (store_id) REFERENCES stores (store_id),
    CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES store_categories (category_id),
    CONSTRAINT ux_products_store_sku UNIQUE (store_id, sku),

    -- منتجٌ منشورٌ لا يكون اعتدالُه مُعلَّقاً أو مرفوضاً: القيدُ يجعل هذا **مستحيلاً في
    -- القاعدة** لا مرجوّاً في الكود، فمسارٌ ينسى الفحصَ يفشل عند الكتابةِ لا عند الشكوى.
    CONSTRAINT ck_products_published_moderated
        CHECK (state <> 'published' OR moderation_state = 'approved')
);

CREATE INDEX IF NOT EXISTS ix_products_store_state ON products (store_id, state);
CREATE INDEX IF NOT EXISTS ix_products_category_state ON products (category_id, state, moderation_state);

-- ─────────────────────────────────────────────────────────────────────
-- 6) product_reviews — دفترُ قراراتِ اعتدالِ المنتج
--    نفسُ شكلِ `store_reviews` بقصد: مُراجعٌ واحدٌ يقرأ الاثنين، وشكلان مختلفان لمعنى
--    واحدٍ يجعلان كلَّ لوحةٍ وكلَّ تقريرِ اعتدالٍ يُكتب مرّتَين.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_reviews (
    review_id               UUID        PRIMARY KEY,
    product_id              UUID        NOT NULL,
    decision                TEXT        NOT NULL CHECK (decision IN ('approved', 'rejected')),
    reason_code             TEXT
        CHECK (reason_code IS NULL OR reason_code IN (
            'prohibited_item', 'misleading_title', 'wrong_category', 'price_implausible', 'duplicate_listing', 'policy_violation'
        )),
    actor_type              TEXT        NOT NULL CHECK (actor_type IN ('moderator', 'system')),
    actor_public_id         TEXT        CHECK (actor_public_id IS NULL OR actor_public_id ~ '^WS-[0-9]{10}$'),
    from_state              TEXT        CHECK (from_state IS NULL OR from_state IN ('pending', 'approved', 'rejected')),
    to_state                TEXT        NOT NULL CHECK (to_state IN ('pending', 'approved', 'rejected')),
    moderation_sequence     INTEGER     NOT NULL CHECK (moderation_sequence >= 1),
    decided_at              TIMESTAMPTZ NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_product_reviews_product FOREIGN KEY (product_id) REFERENCES products (product_id),
    CONSTRAINT ux_product_reviews_sequence UNIQUE (product_id, moderation_sequence),
    CONSTRAINT ck_product_reviews_reason_required
        CHECK ((decision = 'rejected' AND reason_code IS NOT NULL) OR (decision <> 'rejected' AND reason_code IS NULL)),
    CONSTRAINT ck_product_reviews_actor
        CHECK ((actor_type = 'system' AND actor_public_id IS NULL) OR (actor_type <> 'system' AND actor_public_id IS NOT NULL))
);

-- ─────────────────────────────────────────────────────────────────────
-- 7) inventory_adjustments — دفترُ المخزون: فروقٌ مُسمّاةُ السبب، لا كميّةٌ تُكتب
--    ولمَ فرقٌ لا كميّةٌ نهائيّة؟ لأنّ «صارت 7» لا تُخبر إن كانت 12 نقصت خمساً أو 3 زادت
--    أربعاً، وكتابتان متوازيتان تُنتجان آخرَ كاتبٍ يفوز — وهو أسوأُ ما يمكن أن يحدث لمخزون.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_adjustments (
    adjustment_id           UUID        PRIMARY KEY,
    product_id              UUID        NOT NULL,

    -- الفرقُ موجبٌ أو سالبٌ ولا يكون صفراً: صفٌّ بفرقِ صفرٍ يقول إنّ شيئاً حدث ولم يحدث.
    quantity_delta          INTEGER     NOT NULL CHECK (quantity_delta <> 0 AND quantity_delta BETWEEN -1000000 AND 1000000),

    -- الكميّةُ بعد الفرقِ محفوظةٌ في الصفِّ لا محسوبةً عند القراءة: دفترٌ بلا رصيدٍ لاحقٍ
    -- يحتاج جمعَ كلِّ التاريخِ لتفسيرِ صفٍّ واحد، وحارسُ الانحرافِ يقارن الرصيدَين فيمسك
    -- أيَّ كتابةٍ خارجَ الدفتر.
    quantity_after          INTEGER     NOT NULL CHECK (quantity_after >= 0),
    reason_code             TEXT        NOT NULL
        CHECK (reason_code IN ('initial_stock', 'restock', 'correction', 'shrinkage', 'archive_zeroed')),
    actor_public_id         TEXT        NOT NULL CHECK (actor_public_id ~ '^WS-[0-9]{10}$'),
    adjustment_sequence     INTEGER     NOT NULL CHECK (adjustment_sequence >= 1),
    occurred_at             TIMESTAMPTZ NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_inventory_adjustments_product FOREIGN KEY (product_id) REFERENCES products (product_id),
    CONSTRAINT ux_inventory_adjustments_sequence UNIQUE (product_id, adjustment_sequence)
);

-- ─────────────────────────────────────────────────────────────────────
-- 8) product_inventory — الرصيدُ: صفٌّ مُتحقِّقٌ واحدٌ لكلِّ منتج
--    ولا عمودَ `quantity_reserved` ولا `quantity_available` (القرار 5): الحجزُ Phase 13.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_inventory (
    product_id              UUID        PRIMARY KEY,
    quantity_on_hand        INTEGER     NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),

    -- تسلسلُ آخرِ فرقٍ طُبِّق: مفتاحُ كشفِ الانحرافِ بين الرصيدِ والدفتر، ومفتاحُ التحديثِ
    -- المتنافسِ أيضاً (`WHERE last_adjustment_sequence = ?`) بلا قُفلٍ في التطبيق.
    last_adjustment_sequence INTEGER    NOT NULL DEFAULT 0 CHECK (last_adjustment_sequence >= 0),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_product_inventory_product FOREIGN KEY (product_id) REFERENCES products (product_id)
);

-- ─────────────────────────────────────────────────────────────────────
-- 9) marketplace_idempotency — منعُ التكرارِ من أوّلِ يومٍ لا كدَينٍ يُسدَّد
--    درسٌ مُعلَنٌ من الطور 10: هناك جاء المخزنُ في المراجعةِ 3/6 وبقي غيرَ موصولٍ بمسارِ
--    HTTP حتّى 6/6، فكان مُتَّصلٌ يُعيد إرسالَ طلبٍ فيستلم «موجودٌ سابقاً». هنا يُعلَن في
--    العقدِ نفسِه: كلُّ كتابةٍ تُنشئ أو تقرّر تلزمها `Idempotency-Key`، والجوابُ **يُحفَظ**.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_idempotency (
    idempotency_key         TEXT        NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),

    -- مفتاحُ المسارِ لا مسارُ HTTP بحرفِه: `store.register` لا `POST /stores`. فتغييرُ شكلِ
    -- المسارِ لا يُبطل مفاتيحَ محفوظةً، ومفتاحٌ واحدٌ لا يُعاد استعمالُه في مسارَين بالخطأ.
    route_key               TEXT        NOT NULL CHECK (route_key ~ '^[a-z][a-z0-9_.]{2,63}$'),

    -- بصمةُ الطلب: نفسُ المفتاحِ لجسمٍ مختلفٍ تعارضٌ مُسمّىً (`MARKETPLACE_IDEMPOTENCY_KEY_REUSED`)
    -- لا كتابةٌ صامتة. ستّونَ وأربعُ خانةٍ ستّ‌عشريّةٍ = SHA-256 بحرفِه.
    request_hash            TEXT        NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    response_status         INTEGER     NOT NULL CHECK (response_status BETWEEN 200 AND 299),
    response_body           JSONB       NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (route_key, idempotency_key)
);

-- ─────────────────────────────────────────────────────────────────────
-- 10) marketplace_outbox — الحدثُ يُكتب في معاملةِ التغييرِ نفسِها
--     نفسُ شكلِ صناديقِ الصادرِ في الأطوارِ 06 و07 و09 و10 بقصد: ناقلٌ واحدٌ سيُبنى مرّةً
--     (دَينُ المرحلة 09 المُعلَن) ويقرأ الصناديقَ كلَّها بشكلٍ واحد.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_outbox (
    outbox_id               UUID        PRIMARY KEY,
    event_type              TEXT        NOT NULL CHECK (event_type ~ '^marketplace\.[a-z_]+$'),
    event_version           TEXT        NOT NULL CHECK (event_version ~ '^v[0-9]+$'),
    aggregate_type          TEXT        NOT NULL CHECK (aggregate_type IN ('store', 'product', 'inventory')),
    aggregate_id            TEXT        NOT NULL,
    payload                 JSONB       NOT NULL,
    occurred_at             TIMESTAMPTZ NOT NULL,
    published_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_marketplace_outbox_unpublished
    ON marketplace_outbox (created_at) WHERE published_at IS NULL;

COMMIT;
