/**
 * مرآةُ Drizzle لعقد PostgreSQL — **الجداولُ العشرةُ كلُّها**، بأسمائها وأنواعها وقيودها المُسمّاة.
 *
 * ## هذا الملفُّ مرآةٌ لا مصدر
 *
 * الحقيقةُ في `services/subscriptions/contracts/schema.sql` (مُجمَّد، المراجعة 1/6)، وهو
 * نفسُه **الترحيل**: مُغلَّفٌ بـ`BEGIN;`/`COMMIT;` ويحمل في ذيله عكسَه تعليقاً. ولا يُولّد
 * هذا الملفُّ DDL ولا يُنشئ جدولاً؛ `migrate.ts` يُطبّق نصَّ العقد كما هو. ولو صار توليدُ
 * Drizzle هو ما يُطبَّق لصار للمخطّط مصدران، ولاختلفا أوّلَ مرّةٍ يُضاف قيدٌ في أحدهما.
 *
 * ## ولماذا صارت عشرةً في المراجعة 5/6
 *
 * كانت المرآةُ سبعةً بعد 4/6، وبقيت ثلاثةٌ بلا مرآةٍ **بقرارٍ مكتوب**: مرآةٌ لجدولٍ لا مخزنَ
 * له وعدٌ بلا مُنفِّذٍ ولا اختبار. وهذه المراجعةُ تكتب المخازنَ الثلاثةَ فعلاً —
 * `referral_rewards` (مكافأةُ الإحالةِ مرّةً واحدة) و`subscription_idempotency` (الجوابُ
 * المحفوظُ بنفسِ بايتاتِه) و`subscription_outbox` (الحدثُ مع الحقيقةِ في معاملةٍ واحدة) —
 * فانعكست الثلاثةُ وصارت `NOT_MIRRORED_TABLES` **فارغةً**.
 *
 * وفراغُ القائمةِ ليس سطراً مُهمَلاً: `schema-drift.test.ts` يُطابقها مع فرق (جداولُ العقد −
 * جداولُ المرآة)، فجدولٌ يُضاف إلى العقد غداً بلا مرآةٍ يُفشل البناءَ حتى يُعلَن بالاسم.
 *
 * ## وثلاثةُ قيودٍ بلا مرآةٍ بقصد
 *
 * `subscription_idempotency` و`subscription_outbox` تحملان في العقد فحوصاً **بلا أسماء**
 * (`char_length(...) BETWEEN 8 AND 128` · `event_type ~ '^(subscription|referral)\\.[a-z_]+$'`
 * ...)، فلا تُنعكس هنا: حارسُ الانحرافِ يقارن القيودَ **المُسمّاةَ** بحرفها، واسمٌ نخترعه في
 * المرآةِ لا وجودَ له في القاعدة — فيصير الحارسُ يُثبت اتفاقَ اسمٍ لا يحرسه أحد. أمّا الفحصُ
 * نفسُه فيبقى خطَّ الدفاع الثاني في القاعدة، ويُقابله في الكود فحصٌ مُسمّىً قبل الكتابة
 * (`assertIdempotencyKey` في `db/idempotency.ts`).
 *
 * وأنواعُ `TIMESTAMPTZ` تبقى على تمثيل Drizzle الافتراضيّ (`Date`) ويُحوّلها المخزنُ إلى
 * نصّ ISO في موضعٍ واحد (`iso()` في `repository.ts`)، كما في خدمتَي التفاوض والسمعة.
 * و`mode: "string"` كان أقصرَ ظاهرياً وأسوأ: عميلُ `pg` يُعيد صيغةَ Postgres
 * (`2026-03-01 12:00:00+00`) لا ISO، فيصير صفُّ القاعدة غيرَ مساوٍ لصفّ الذاكرة بـ`toEqual`
 * بلا فرقٍ في المعنى.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/** عمودُ لحظةٍ بمنطقةٍ زمنيّة. التحويلُ إلى نصّ ISO مسؤوليّةُ المخزن لا المرآة. */
const instant = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------
// 1) كتالوجُ الخطط — مُنسَّخاً ومُجمَّداً، ولا عمودَ سعرٍ فيه (ADR-015 القرار 6)
// ---------------------------------------------------------------------------

export const subscriptionPlans = pgTable(
  "subscription_plans",
  {
    planCode: text("plan_code").notNull(),
    planVersion: integer("plan_version").notNull(),
    label: text("label").notNull(),
    trialDays: integer("trial_days").notNull(),
    durationDays: integer("duration_days").notNull(),
    communityGraceDays: integer("community_grace_days").notNull(),
    communityDailyOrderCap: integer("community_daily_order_cap").notNull(),
    referralRewardDays: integer("referral_reward_days").notNull(),
    referralQualifyingFacts: integer("referral_qualifying_facts").notNull(),
    referralWindowDays: integer("referral_window_days").notNull(),
    isFrozen: boolean("is_frozen").notNull().default(false),
    frozenAt: instant("frozen_at"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.planCode, table.planVersion] }),
    check(
      "ck_subscription_plans_frozen_at",
      sql`(${table.isFrozen} AND ${table.frozenAt} IS NOT NULL) OR (NOT ${table.isFrozen} AND ${table.frozenAt} IS NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 2) استحقاقاتُ الخطّة — صفّاً صفّاً لا حمولةً حرّة
// ---------------------------------------------------------------------------

export const subscriptionPlanEntitlements = pgTable(
  "subscription_plan_entitlements",
  {
    planCode: text("plan_code").notNull(),
    planVersion: integer("plan_version").notNull(),
    entitlementCode: text("entitlement_code").notNull(),
    limitValue: integer("limit_value").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.planCode, table.planVersion, table.entitlementCode] }),
    foreignKey({
      name: "fk_subscription_plan_entitlements_plan",
      columns: [table.planCode, table.planVersion],
      foreignColumns: [subscriptionPlans.planCode, subscriptionPlans.planVersion],
    }),
  ],
);

// ---------------------------------------------------------------------------
// 3) دفترُ المُدد — append-only، مصدرُ الحقيقة الأوّل (القرار 2)
// ---------------------------------------------------------------------------

export const subscriptionPeriods = pgTable(
  "subscription_periods",
  {
    periodId: uuid("period_id").primaryKey(),
    driverPublicId: text("driver_public_id").notNull(),
    planCode: text("plan_code").notNull(),
    planVersion: integer("plan_version").notNull(),
    source: text("source").notNull(),
    paymentReference: text("payment_reference"),
    grantedDays: integer("granted_days").notNull(),
    startsAt: instant("starts_at").notNull(),
    endsAt: instant("ends_at").notNull(),
    sourceEventId: uuid("source_event_id"),
    traceId: text("trace_id"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "fk_subscription_periods_plan",
      columns: [table.planCode, table.planVersion],
      foreignColumns: [subscriptionPlans.planCode, subscriptionPlans.planVersion],
    }),
    check("ck_subscription_periods_window", sql`${table.endsAt} > ${table.startsAt}`),
    check(
      "ck_subscription_periods_payment_reference",
      sql`(${table.source} = 'payment' AND ${table.paymentReference} IS NOT NULL) OR (${table.source} <> 'payment' AND ${table.paymentReference} IS NULL)`,
    ),
    index("ix_subscription_periods_driver").on(table.driverPublicId, table.startsAt),
  ],
);

// ---------------------------------------------------------------------------
// 4) دفترُ الانتقالات — append-only، مصدرُ الحقيقة الثاني (القرار 3)
// ---------------------------------------------------------------------------

export const subscriptionTransitions = pgTable(
  "subscription_transitions",
  {
    transitionId: uuid("transition_id").primaryKey(),
    driverPublicId: text("driver_public_id").notNull(),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    reasonCode: text("reason_code").notNull(),
    periodId: uuid("period_id"),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    occurredAt: instant("occurred_at").notNull(),
    traceId: text("trace_id"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("ux_subscription_transitions_sequence").on(table.driverPublicId, table.sequence),
    check(
      "ck_subscription_transitions_state_changes",
      sql`${table.fromState} IS DISTINCT FROM ${table.toState}`,
    ),
    check(
      "ck_subscription_transitions_genesis",
      sql`(${table.fromState} IS NOT NULL) OR (${table.toState} = 'trial' AND ${table.reasonCode} = 'trial_granted' AND ${table.sequence} = 1)`,
    ),
  ],
);

/**
 * **الصفُّ المُتحقِّق** — لا مصدرَ حقيقةٍ بل نتيجةُ اشتقاقٍ مكتوبةٌ لتُقرأ بسرعة.
 *
 * هذا الجدولُ الوحيدُ في الخدمة الذي يُكتب فوق صفٍّ قائم، وذاك جائزٌ لأنّه **مُشتَقٌّ بالكامل**
 * من `subscription_periods` و`subscription_transitions`: حذفُه كلِّه وإعادةُ بنائه من الدفتر
 * لا تُفقد معلومةً واحدة (وهذا ما يُثبته `POST /subscriptions/{id}/recompute` واختبارُ
 * `projection.integration.test.ts`). ولذلك بقي الحارسُ النصّيُّ في `purity.test.ts` قائماً
 * على الدفتر، واستُثني هذا الملفُّ **باسمه** لا بتوسيع نمطٍ يُبيح التعديلَ في كلّ مكان.
 *
 * والأعمدةُ المُلزمة معاً محروسةٌ بـ`ck_subscriptions_period_state`: `trial`/`active` ⇒ مُدّةٌ
 * حاضرةٌ ونهايةٌ معلومة، و`expired`/`community` ⇒ الاثنان `NULL`. فصفٌّ يقول `active` بلا
 * نهايةٍ لا يستقرّ في القاعدة أصلاً، ولا نحتاج فحصاً في الكود يذكّرنا بذلك.
 *
 * وقيدُ `driver_public_id ~ '^WS-[0-9]{10}$'` والقيدُ على تعداد `state` بلا اسمٍ في العقد،
 * فلا مرآةَ لهما هنا: حارسُ الانحراف يقارن **القيودَ المُسمّاة** بحرفها، وإضافةُ اسمٍ من عندنا
 * كانت ستُنتج اسماً لا وجودَ له في القاعدة.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    subscriptionId: uuid("subscription_id").primaryKey(),
    driverPublicId: text("driver_public_id").notNull(),
    state: text("state").notNull(),
    planCode: text("plan_code").notNull(),
    planVersion: integer("plan_version").notNull(),
    currentPeriodId: uuid("current_period_id"),
    startedAt: instant("started_at").notNull(),
    expiresAt: instant("expires_at"),
    stateSequence: bigint("state_sequence", { mode: "number" }).notNull(),
    stateChangedAt: instant("state_changed_at").notNull(),
    computedAt: instant("computed_at").notNull(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("ux_subscriptions_driver").on(table.driverPublicId),
    foreignKey({
      name: "fk_subscriptions_plan",
      columns: [table.planCode, table.planVersion],
      foreignColumns: [subscriptionPlans.planCode, subscriptionPlans.planVersion],
    }),
    check(
      "ck_subscriptions_period_state",
      sql`(${table.state} IN ('trial', 'active') AND ${table.currentPeriodId} IS NOT NULL AND ${table.expiresAt} IS NOT NULL) OR (${table.state} IN ('expired', 'community') AND ${table.currentPeriodId} IS NULL AND ${table.expiresAt} IS NULL)`,
    ),
    index("ix_subscriptions_expiring").on(table.expiresAt),
  ],
);

/**
 * رمزُ الإحالة: صفٌّ واحدٌ لكلّ مالكٍ (`ux_referral_codes_owner`)، يُزرَع داخلَ معاملةِ بدءِ
 * التجربة — لا عند أوّل قراءة. والقراءةُ (`GET /referrals/codes/{owner}`) لا تكتب شيئاً
 * وتُجيب 404 حين يغيب الصفّ: إنشاءٌ عند القراءةِ يجعل `GET` كاتباً، فيُولِد رمزاً لمن لم
 * يبدأ تجربةً ويفتح طريقَ كتابةٍ غيرِ محميّةٍ بمفتاحِ تكرار.
 *
 * ولمَ لا يُنشأ مع الاشتراك؟ لأنّ الرمزَ ليس شرطاً لاشتراكٍ ولا يملكه دفترُ المُدَد؛ وإنشاؤه
 * في نفس معاملةِ التجربة كان سيجعل فشلَ صياغةِ رمزٍ يمنع سائقاً من بدء تجربته.
 */
export const referralCodes = pgTable(
  "referral_codes",
  {
    referralCode: text("referral_code").primaryKey(),
    ownerPublicId: text("owner_public_id").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [unique("ux_referral_codes_owner").on(table.ownerPublicId)],
);

/**
 * المطالبةُ بالإحالة — صفٌّ واحدٌ لكلّ **مُحالٍ** (`ux_referrals_referee`) لا لكلّ مُحيل.
 *
 * القيدُ على المُحال هو ما يمنع أن يُحسب سائقٌ جديدٌ لعشرة مُحيلين، وهو نفسُه الذي يجعل
 * إعادةَ المطالبة تُعاد جواباً محفوظاً بـ`200` بدل صفٍّ ثانٍ. و`ck_referrals_not_self` خطُّ
 * الدفاع الثاني تحت `referralSelfForbidden()` في المجال.
 */
export const referrals = pgTable(
  "referrals",
  {
    referralId: uuid("referral_id").primaryKey(),
    referralCode: text("referral_code").notNull(),
    referrerPublicId: text("referrer_public_id").notNull(),
    refereePublicId: text("referee_public_id").notNull(),
    state: text("state").notNull(),
    reasonCode: text("reason_code"),
    qualifyingFactCount: integer("qualifying_fact_count").notNull().default(0),
    planCode: text("plan_code").notNull(),
    planVersion: integer("plan_version").notNull(),
    windowEndsAt: instant("window_ends_at").notNull(),
    claimedAt: instant("claimed_at").notNull(),
    stateChangedAt: instant("state_changed_at").notNull(),
    traceId: text("trace_id"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "fk_referrals_code",
      columns: [table.referralCode],
      foreignColumns: [referralCodes.referralCode],
    }),
    foreignKey({
      name: "fk_referrals_plan",
      columns: [table.planCode, table.planVersion],
      foreignColumns: [subscriptionPlans.planCode, subscriptionPlans.planVersion],
    }),
    unique("ux_referrals_referee").on(table.refereePublicId),
    check(
      "ck_referrals_not_self",
      sql`${table.referrerPublicId} <> ${table.refereePublicId}`,
    ),
    check(
      "ck_referrals_reason_code",
      sql`(${table.state} = 'rejected' AND ${table.reasonCode} IS NOT NULL) OR (${table.state} <> 'rejected' AND ${table.reasonCode} IS NULL)`,
    ),
    index("ix_referrals_referrer").on(table.referrerPublicId, table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// 8) مكافآتُ الإحالة — صفٌّ واحدٌ لكلّ إحالةٍ ولكلّ مُدّةٍ ممنوحة (ADR-015 القرار 9)
// ---------------------------------------------------------------------------

/**
 * المكافأةُ **حقيقةٌ مُنجَزةٌ** لا نيّة: صفٌّ هنا يعني أنّ مُدّةً دخلت الدفترَ فعلاً.
 *
 * ولذلك `granted_period_id` إلزاميٌّ ومفتاحٌ أجنبيٌّ ومُتفرِّد: مكافأةٌ بلا مُدّةٍ كانت ستجعل
 * «مُنِحت 30 يوماً» صفّاً يقوله جدولُ المكافآتِ وينكره الدفتر، ومُدّةٌ واحدةٌ تُعلَّق عليها
 * مكافأتان كانت ستجعل الأيّامَ تُحسب مرّتين في التقرير بلا أن يُخلق يومٌ واحد.
 *
 * و`ux_referral_rewards_referral` هو الحارسُ الحقيقيُّ لـ«مرّةً واحدة»: التسليمُ at-least-once،
 * فإعادةُ تسليمِ `reputation.fact_recorded` تصل ثانيةً بالضرورة — ورفضُ القاعدةِ بقيدٍ
 * مُسمّىً يُترجَم إلى `REFERRAL_REWARD_ALREADY_GRANTED` خيرٌ من `if` يسبقه سباقٌ.
 */
export const referralRewards = pgTable(
  "referral_rewards",
  {
    rewardId: uuid("reward_id").primaryKey(),
    referralId: uuid("referral_id").notNull(),
    grantedPeriodId: uuid("granted_period_id").notNull(),
    beneficiaryPublicId: text("beneficiary_public_id").notNull(),
    rewardDays: integer("reward_days").notNull(),
    planCode: text("plan_code").notNull(),
    planVersion: integer("plan_version").notNull(),
    grantedAt: instant("granted_at").notNull(),
    traceId: text("trace_id"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "fk_referral_rewards_referral",
      columns: [table.referralId],
      foreignColumns: [referrals.referralId],
    }),
    foreignKey({
      name: "fk_referral_rewards_period",
      columns: [table.grantedPeriodId],
      foreignColumns: [subscriptionPeriods.periodId],
    }),
    foreignKey({
      name: "fk_referral_rewards_plan",
      columns: [table.planCode, table.planVersion],
      foreignColumns: [subscriptionPlans.planCode, subscriptionPlans.planVersion],
    }),
    unique("ux_referral_rewards_referral").on(table.referralId),
    unique("ux_referral_rewards_period").on(table.grantedPeriodId),
  ],
);

// ---------------------------------------------------------------------------
// 9) سجلُّ منعِ التكرار — الجوابُ المحفوظُ بنفسِ بايتاتِه لا «رأيتُ هذا المفتاح»
// ---------------------------------------------------------------------------

/**
 * `response_status` و`response_body` عمودان في هذا الجدول لسببٍ واحد: إعادةُ المفتاحِ يجب أن
 * تُعيد **نفسَ الجواب** لا 409.
 *
 * النسخةُ الخاطئةُ الأرخصُ هنا جدولٌ بعمودٍ واحدٍ (`idempotency_key`) يقول «مرّ من قبل» ثم
 * يُجيب 409: عميلُ الجوّال الذي انقطع اتصالُه بعد الكتابةِ وقبل قراءةِ الجواب يُعيد الطلبَ —
 * وهو محقٌّ — فيرى رفضاً لعمليةٍ **نجحت**، فيُظهر للسائق «فشل الدفع» بعد أن خُصم منه.
 *
 * و`request_hash` يفصل «نفسَ الطلب» عن «مفتاحٍ أُعيد استعمالُه لطلبٍ آخر»: الأولُ يستحقّ
 * الجوابَ المحفوظ، والثاني خطأُ عميلٍ يستحقّ `SUBSCRIPTION_IDEMPOTENCY_KEY_REUSED`. ومفتاحٌ
 * بلا بصمةِ طلبٍ كان سيجعل «ابدأ تجربةً لسائقٍ» و«فعّل اشتراكَ سائقٍ آخر» بنفسِ المفتاحِ
 * يُعيدان جوابَ الأوّلِ للثاني.
 *
 * ولا قيدَ مُسمّىً في المرآة: فحوصُ العقد هنا (`char_length ... BETWEEN 8 AND 128` ...) بلا
 * أسماء، ويُقابلها في الكود `assertIdempotencyKey` قبل الكتابة.
 */
export const subscriptionIdempotency = pgTable("subscription_idempotency", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  routeKey: text("route_key").notNull(),
  requestHash: text("request_hash").notNull(),
  responseStatus: integer("response_status").notNull(),
  responseBody: jsonb("response_body").notNull(),
  traceId: text("trace_id"),
  createdAt: instant("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 10) صندوقُ الصادر — الحدثُ يُكتب مع الحقيقةِ في معاملةٍ واحدة
// ---------------------------------------------------------------------------

/**
 * الحدثُ هنا لا في ناقلٍ خارجيّ، لأنّ الكتابةَ في القاعدةِ والنشرَ على الناقلِ لا يجتمعان
 * في معاملةٍ واحدة.
 *
 * النسخةُ الخاطئةُ الأرخص: `await bus.publish(event)` بعد `COMMIT`. تُصيب في التجربة وتُخطئ
 * في الإنتاج بأحد وجهَين — إمّا نُشر حدثٌ لمعاملةٍ انسحبت (مستهلكٌ يُصدّق تفعيلاً لم يحدث)،
 * أو نجحت المعاملةُ وسقطت العمليةُ قبل النشرِ (تفعيلٌ حقيقيٌّ لا يعرفه أحد). والثاني أسوأ:
 * لا أثرَ له في سجلٍّ ولا مقياسٍ، ويظهر بعد أسابيعَ كسائقٍ «فعّل ولم تُفتح له الأوامر».
 *
 * و`published_at` هو كلُّ الحالة: `NULL` تعني «لم يُنشَر بعد»، والفهرسُ الجزئيُّ في العقد
 * (`ix_subscription_outbox_unpublished`) يجعل المسحَ يقرأ غيرَ المنشورِ وحده — فلا يصير
 * الناشرُ أبطأَ كلَّ يومٍ لأنّ الجدولَ ينمو.
 *
 * و`attempts` و`last_error` ليسا ترفاً: تسليمٌ يفشل صامتاً يجعل «الصندوقُ فارغٌ» و«الناقلُ
 * مكسورٌ منذ ساعة» متشابهَين من الخارج.
 */
export const subscriptionOutbox = pgTable("subscription_outbox", {
  eventId: uuid("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  payload: jsonb("payload").notNull(),
  occurredAt: instant("occurred_at").notNull(),
  publishedAt: instant("published_at"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  traceId: text("trace_id"),
  createdAt: instant("created_at").notNull().defaultNow(),
});

/**
 * الجداولُ التي لا مرآةَ لها — **فارغةٌ بعد المراجعة 5/6**، وليست سطراً مُهمَلاً.
 *
 * قائمةٌ مقروءةٌ من اختبارٍ خيرٌ من فقرةٍ في شرحٍ لا يقرؤها البناء: `schema-drift.test.ts`
 * يُطابقها مع فرق (جداولُ العقد − جداولُ المرآة) فلا يمرّ جدولٌ يُنسى في أحد الجانبين.
 *
 * وانعكس في 4/6 ثلاثةٌ (`subscriptions` · `referral_codes` · `referrals`)، وفي 5/6 الثلاثةُ
 * الباقيةُ (`referral_rewards` · `subscription_idempotency` · `subscription_outbox`) مع
 * مخازنِها ومُناديها. والقائمةُ تبقى مُصدَّرةً فارغةً لا تُحذَف: جدولٌ يُضاف إلى العقد غداً
 * بلا مرآةٍ يجب أن يُفشل البناءَ حتى يُعلَن هنا بالاسم — وحذفُ القائمةِ كان سيحذف الحارس.
 */
export const NOT_MIRRORED_TABLES: ReadonlyArray<string> = Object.freeze([]);
