-- WASLA Dispatch Service — Data Contract (PostgreSQL DDL)
-- Phase 07 — Dispatch
--
-- المبدأ الجوهري (ADR-011):
--   - هذه الخدمة **وحدها** تملك تنسيق «من يستلم العرض ومتى»: لا تقرأ خدمة أخرى هذه الجداول
--     ولا تكتب فيها مباشرة (§37). اختيار المرشّحين وترتيبهم مِلْك `services/matching`؛
--     وتسجيل الإسناد وحالة الطلب مِلْك `services/orders` عبر HTTP فقط.
--   - `order_id` و`order_public_id` و`driver_public_id` مراجع opaque **بلا FK**: الجداول
--     المالكة في خدمات أخرى، والتحقق من وجودها يمر عبر منفذ لا عبر قاعدة مشتركة.
--   - الزمن **نبضة لا مؤقّت**: لا حالة معلّقة بلا موعد مكتوب. `expires_at` محفوظ عند الإنشاء
--     لكل مهمة وموجة وعرض؛ و`escalation_expires_at` مكتوب قبل التصعيد كي لا تنسى إعادة تشغيل
--     العملية نهاية المسار البشري.
--   - الإعدادات نسخةٌ على المهمة لا مرجع حي: تغيير قواعد المطابقة لا يغيّر عرضاً أُرسل فعلاً.
--   - القبول الأول يحسم في القاعدة: موجة نشطة واحدة للمهمة، وعرض مقبول واحد للمهمة.
--   - كل نتيجة نهائية تحمل `reason_code` من كتالوج معلن؛ نص حرّ لا يصلح للتدقيق أو الأحداث.
--
-- المصدر: PostgreSQL (source of truth). Domain Events عبر Outbox من البداية.
-- الترقيم: أي ترحيل (migration) يجب أن يكون عكوساً (reversible) وموثّقاً في TASK_LOG.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) dispatch_jobs — مهمة التوزيع، لا الطلب نفسه
--    المهمة صريحة لأن الطلب لا «يجد» سائقاً تلقائياً: إنشاءها نداء معلن، ثم تقودها نبضة.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_jobs (
    id                          UUID        PRIMARY KEY,
    -- مرجع طلب في خدمة orders: لا FK ولا قراءة جدول عابر للخدمات.
    order_id                    UUID        NOT NULL UNIQUE,
    order_public_id             TEXT        NOT NULL UNIQUE
                                CHECK (order_public_id ~ '^ORD-[0-9]{10}$'),
    -- مستوى المنطقة فقط؛ الإحداثيات لا تدخل عقد التوزيع أو أحداثه (ADR-011 القرار 8).
    zone_id                     UUID        NOT NULL,
    order_type                  TEXT        NOT NULL CHECK (order_type IN ('ride','delivery')),
    vehicle_class               TEXT        NOT NULL
                                CHECK (vehicle_class IN ('sedan','suv','van','pickup','motorcycle','truck_small')),
    status                      TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN (
                                    'pending',              -- أُنشئت ولم تفتح النبضة موجتها الأولى بعد
                                    'dispatching',          -- موجة آلية مفتوحة أو جاهزة لفتح التالية
                                    'escalated_community',  -- قرار التصعيد سُجل؛ التوصيل مِلْك القناة
                                    'assigned',             -- قُبل عرض واحد وسجله المحرك
                                    'exhausted',             -- انتهى التصعيد بلا قبول
                                    'cancelled'              -- أُوقفت المهمة قبل الإسناد
                                )),
    status_reason_code          TEXT        CHECK (status_reason_code IS NULL OR char_length(status_reason_code) BETWEEN 3 AND 64),

    -- لقطة قواعد المطابقة والتوزيع عند الإنشاء: مرجع حيّ يجعل مهلة عرض قائمة تتغيّر بعد إرسالها.
    ruleset_version             INTEGER     NOT NULL CHECK (ruleset_version >= 1),
    wave_size                   SMALLINT    NOT NULL CHECK (wave_size >= 1),
    offer_timeout_seconds       INTEGER     NOT NULL CHECK (offer_timeout_seconds >= 1),
    max_waves                   SMALLINT    NOT NULL CHECK (max_waves >= 1),
    escalation_timeout_seconds  INTEGER     NOT NULL CHECK (escalation_timeout_seconds >= 1),

    -- نهاية النافذة الآلية ونهاية التصعيد محسوبتان بساعة محقونة عند الإنشاء، لا بعداد ذاكرة.
    expires_at                  TIMESTAMPTZ NOT NULL,
    escalation_expires_at       TIMESTAMPTZ NOT NULL,
    created_idempotency_key     TEXT        NOT NULL CHECK (char_length(created_idempotency_key) BETWEEN 8 AND 128),
    payload_fingerprint         TEXT        NOT NULL CHECK (char_length(payload_fingerprint) = 64),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ux_dispatch_jobs_idempotency_key UNIQUE (created_idempotency_key),
    -- لا نهاية بلا سبب: «انتهت» دون كود لا تفسر لماذا خرج الطلب من المسار.
    CONSTRAINT ck_dispatch_jobs_terminal_needs_reason CHECK (
        status NOT IN ('assigned','exhausted','cancelled') OR status_reason_code IS NOT NULL
    ),
    -- لا يسبق انتهاء التصعيد انتهاء المسار الآلي؛ وإلا صار التصعيد نافذة سالبة مخفية.
    CONSTRAINT ck_dispatch_jobs_deadline_order CHECK (escalation_expires_at >= expires_at)
);

CREATE INDEX IF NOT EXISTS ix_dispatch_jobs_status_due
    ON dispatch_jobs (status, expires_at);
CREATE INDEX IF NOT EXISTS ix_dispatch_jobs_escalation_due
    ON dispatch_jobs (escalation_expires_at) WHERE status = 'escalated_community';

-- ─────────────────────────────────────────────────────────────────────
-- 2) dispatch_waves — دفعة متزامنة من العروض
--    «مفتوحة» هي الحالة الوحيدة النشطة؛ الفهرس الجزئي يحسم السباق بين نبضتين أو نسختين للخدمة.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_waves (
    id              UUID        PRIMARY KEY,
    job_id          UUID        NOT NULL REFERENCES dispatch_jobs(id) ON DELETE CASCADE,
    wave_number     SMALLINT    NOT NULL CHECK (wave_number >= 1),
    status          TEXT        NOT NULL DEFAULT 'open'
                    CHECK (status IN (
                        'open',        -- عروض الموجة تنتظر جواباً أو مهلة
                        'completed',   -- حُسمت عروضها؛ السبب يميّز قبولاً من انتهاء بلا قبول
                        'cancelled'    -- ألغيت المهمة أو أمر المحرك بإيقافها
                    )),
    reason_code     TEXT        CHECK (reason_code IS NULL OR char_length(reason_code) BETWEEN 3 AND 64),
    opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ux_dispatch_waves_job_number UNIQUE (job_id, wave_number),
    CONSTRAINT ck_dispatch_waves_terminal_needs_reason CHECK (
        status = 'open' OR reason_code IS NOT NULL
    ),
    CONSTRAINT ck_dispatch_waves_state_timestamp CHECK (
        (status = 'open' AND completed_at IS NULL)
        OR (status <> 'open' AND completed_at IS NOT NULL)
    )
);

-- قاعدة ADR-011 القرار 4.1: موجة نشطة واحدة فقط، لا تعتمد على ترتيب نداءات التطبيق.
CREATE UNIQUE INDEX IF NOT EXISTS ux_dispatch_waves_one_open_job
    ON dispatch_waves (job_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS ix_dispatch_waves_open_due
    ON dispatch_waves (expires_at) WHERE status = 'open';

-- ─────────────────────────────────────────────────────────────────────
-- 3) dispatch_offers — عرض موجّه، منفصل عن سجل الإسناد في خدمة orders
--    العرض لا يعيد معرفة الأهلية ولا الترتيب؛ يحتفظ فقط بمن اختير وبموعد جواب يمكن للنبضة حسمه.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_offers (
    id                  UUID        PRIMARY KEY,
    job_id              UUID        NOT NULL REFERENCES dispatch_jobs(id) ON DELETE CASCADE,
    wave_id             UUID        NOT NULL REFERENCES dispatch_waves(id) ON DELETE CASCADE,
    -- مرجع assignment في orders حين يسجل التوزيع عرضه. بلا FK لأن orders خدمة أخرى.
    order_assignment_id UUID,
    driver_public_id    TEXT        NOT NULL CHECK (driver_public_id ~ '^WS-[0-9]{10}$'),
    status              TEXT        NOT NULL DEFAULT 'offered'
                        CHECK (status IN ('offered','accepted','rejected','timed_out','superseded','cancelled')),
    reason_code         TEXT        CHECK (reason_code IS NULL OR char_length(reason_code) BETWEEN 3 AND 64),
    offered_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL,
    responded_at        TIMESTAMPTZ,
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- يشمل الرفض والمهلة عمداً: الإعادة إزعاج للسائق لا سياسة، والمطابقة تتلقى المستبعدين.
    CONSTRAINT ux_dispatch_offers_job_driver UNIQUE (job_id, driver_public_id),
    -- كل نتيجة عرض نهائية تفسّر نفسها؛ `offered` وحدها تنتظر قراراً.
    CONSTRAINT ck_dispatch_offers_terminal_needs_reason CHECK (
        status = 'offered' OR reason_code IS NOT NULL
    ),
    CONSTRAINT ck_dispatch_offers_state_timestamp CHECK (
        (status = 'offered' AND responded_at IS NULL AND resolved_at IS NULL)
        OR (status = 'accepted' AND responded_at IS NOT NULL AND resolved_at IS NOT NULL)
        OR (status = 'rejected' AND responded_at IS NOT NULL AND resolved_at IS NOT NULL)
        OR (status IN ('timed_out','superseded','cancelled') AND resolved_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS ix_dispatch_offers_wave ON dispatch_offers (wave_id, offered_at);
CREATE INDEX IF NOT EXISTS ix_dispatch_offers_open_due ON dispatch_offers (expires_at) WHERE status = 'offered';
-- القبول الأول هو الفائز؛ الحارس قاعدة لا «إن كان» قد يتسابق في عمليتين.
CREATE UNIQUE INDEX IF NOT EXISTS ux_dispatch_offers_one_accepted_job
    ON dispatch_offers (job_id) WHERE status = 'accepted';

-- ─────────────────────────────────────────────────────────────────────
-- 4) dispatch_outbox — صندوق الصادر، بنفس شكل order_outbox
--    القرار والحدث في معاملة واحدة؛ الناشر نفسه مؤجل إلى Phase 09.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_outbox (
    event_id       UUID        PRIMARY KEY,
    event_type     TEXT        NOT NULL,
    event_version  TEXT        NOT NULL CHECK (event_version ~ '^v[0-9]+$'),
    aggregate_type TEXT        NOT NULL CHECK (aggregate_type IN ('dispatch_job','dispatch_offer')),
    aggregate_id   TEXT        NOT NULL,
    payload        JSONB       NOT NULL,
    trace_id       TEXT        CHECK (trace_id IS NULL OR char_length(trace_id) <= 128),
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_dispatch_outbox_unpublished
    ON dispatch_outbox (occurred_at) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_dispatch_outbox_aggregate
    ON dispatch_outbox (aggregate_type, aggregate_id, occurred_at);

-- ─────────────────────────────────────────────────────────────────────
-- 5) dispatch_idempotency — ذاكرة مفاتيح منع التكرار
--    ترحيل إضافي عكوس أُضيف في Phase 07 · MR 5a/6 (التراجع: DROP TABLE dispatch_idempotency).
--
--    منفذ `IdempotencyStore` (§43) موجود منذ MR 4/6 بلا مكان يخزّن فيه. الجدول
--    ليس تكراراً لـ`dispatch_jobs.created_idempotency_key`: ذلك العمود يحمي
--    «طلب واحد = مهمة واحدة» على صفّ المهمة، أمّا هذا الجدول فيخدم الكتابات التي
--    لا تُنشئ صفّاً جديداً — قبول عرض، رفض عرض، إلغاء مهمة — ولا يوجد لها صفّ
--    يُعلَّق المفتاح عليه. بلا هذا الجدول تكون إعادة محاولة «قبول العرض» بعد مهلة
--    شبكية إمّا خطأً 409 لا يستطيع السائق فعل شيء حياله، وإمّا قبولاً ثانياً.
--
--    البصمة هي جوهر القيمة: نفس المفتاح ونفس الحمولة = إعادة محاولة تنجح وتعيد
--    النتيجة المحفوظة بلا حدث ثانٍ، أمّا نفس المفتاح بحمولة مختلفة فخطأ مُنادٍ
--    يُرفَض بـ409 ولا يكتب فوق أثر غيره صامتاً. بلا تخزين البصمة تبدو الحالتان نجاحاً.
--
--    الطول 8..128 مطابق حرفياً لـ`assertIdempotencyKey` في المجال ولعمود
--    `created_idempotency_key` أعلاه ولعقود الطلبات والعملاء والمطابقة: مفتاح
--    يقبله التطبيق وترفضه القاعدة يُنتج 500 بلا سبب مفهوم.
--    لا سياسة تقليم في هذه المرحلة (دَين تشغيلي مُعلَن — Phase 09، كما في dispatch_outbox).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_idempotency (
    idempotency_key     TEXT        PRIMARY KEY
                        CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
    -- بصمة الحمولة المُعيَّرة (stable stringify) لا الحمولة نفسها: لا نصّ مستخدم
    -- ولا مُعرّف سائق في جدول تدقيق تقني.
    payload_fingerprint TEXT        NOT NULL
                        CHECK (char_length(payload_fingerprint) BETWEEN 1 AND 4096),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 6) updated_at تملكه القاعدة، كي لا يختلف أثر تحديث HTTP عن أثر نبضة التشغيل.
--
--    نتيجة مقصودة تُقرأ مع MR 5a/6: المُنادي يمرّر `changedAt` من الساعة المحقونة،
--    والقاعدة تكتب `now()` فوقه. أي أن `updated_at` هو زمن الكتابة الفعلي لا زمن
--    القرار المنطقي، وزمن القرار محفوظ في الأعمدة التي يملكها المجال
--    (`completed_at` · `responded_at` · `resolved_at`). لذلك يستثني اختبار مطابقة
--    المنافذ `updatedAt` من المقارنة صراحةً بدل أن يزيّف الساعة، وهذا مُوثَّق في
--    DISPATCH_PERSISTENCE.md §4.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION dispatch_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dispatch_jobs_updated_at ON dispatch_jobs;
CREATE TRIGGER trg_dispatch_jobs_updated_at BEFORE UPDATE ON dispatch_jobs
    FOR EACH ROW EXECUTE FUNCTION dispatch_set_updated_at();

DROP TRIGGER IF EXISTS trg_dispatch_waves_updated_at ON dispatch_waves;
CREATE TRIGGER trg_dispatch_waves_updated_at BEFORE UPDATE ON dispatch_waves
    FOR EACH ROW EXECUTE FUNCTION dispatch_set_updated_at();

DROP TRIGGER IF EXISTS trg_dispatch_offers_updated_at ON dispatch_offers;
CREATE TRIGGER trg_dispatch_offers_updated_at BEFORE UPDATE ON dispatch_offers
    FOR EACH ROW EXECUTE FUNCTION dispatch_set_updated_at();

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- التراجع (rollback) — يُحذف بترتيب عكسي للتبعيات.
-- ─────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS dispatch_idempotency;
-- DROP TABLE IF EXISTS dispatch_outbox;
-- DROP TABLE IF EXISTS dispatch_offers;
-- DROP TABLE IF EXISTS dispatch_waves;
-- DROP TABLE IF EXISTS dispatch_jobs;
-- DROP FUNCTION IF EXISTS dispatch_set_updated_at();
