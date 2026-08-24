/**
 * مرآةُ Drizzle لعقد PostgreSQL — **أربعةُ جداولَ من عشرة**، بأسمائها وأنواعها وقيودها المُسمّاة.
 *
 * ## هذا الملفُّ مرآةٌ لا مصدر
 *
 * الحقيقةُ في `services/subscriptions/contracts/schema.sql` (مُجمَّد، المراجعة 1/6)، وهو
 * نفسُه **الترحيل**: مُغلَّفٌ بـ`BEGIN;`/`COMMIT;` ويحمل في ذيله عكسَه تعليقاً. ولا يُولّد
 * هذا الملفُّ DDL ولا يُنشئ جدولاً؛ `migrate.ts` يُطبّق نصَّ العقد كما هو. ولو صار توليدُ
 * Drizzle هو ما يُطبَّق لصار للمخطّط مصدران، ولاختلفا أوّلَ مرّةٍ يُضاف قيدٌ في أحدهما.
 *
 * ## لماذا أربعةٌ فقط، ومن يحرس ذلك
 *
 * المراجعة 3/6 تملك **الدفترَ** وكتالوجَه: `subscription_plans` و
 * `subscription_plan_entitlements` تُبذَران من `domain/plans.ts`، و`subscription_periods`
 * و`subscription_transitions` هما مصدرا الحقيقة اللذان تُشتقّ منهما الحالة. أمّا
 * `subscriptions` (الصفُّ المُتحقِّق) و`referral_codes` و`referrals` و`referral_rewards` و
 * `subscription_idempotency` و`subscription_outbox` فتملكها المراجعاتُ 4/6 و5/6، ومرآةٌ
 * لجدولٍ لا مخزنَ له كانت ستكون وعداً بلا مُنفِّذٍ ولا اختبار.
 *
 * والقائمةُ ليست نيّةً: `schema-drift.test.ts` يقرأ الـDDL وقت التشغيل ويقارن **الاتجاهين**
 * للجداول الأربعة (عمودٌ في العقد بلا مرآة أو في المرآة بلا عقد يُفشل البناء)، ويؤكّد
 * أنّ الجداولَ غيرَ المُنعكسةِ **هي هذه الستةُ بالضبط** — فيومَ تُنعكس واحدةٌ منها يفشل
 * الاختبارُ حتى تُحدَّث القائمةُ بقرارٍ مكتوب.
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

/**
 * الجداولُ التي لا مرآةَ لها في هذه المراجعة — **مُعلَنةً بأسمائها**.
 *
 * قائمةٌ مقروءةٌ من اختبارٍ خيرٌ من فقرةٍ في شرحٍ لا يقرؤها البناء: `schema-drift.test.ts`
 * يُطابقها مع فرق (جداولُ العقد − جداولُ المرآة) فلا يمرّ جدولٌ يُنسى في أحد الجانبين.
 *
 * وانعكس في المراجعة 4/6 ثلاثةُ جداولٍ (`subscriptions` · `referral_codes` · `referrals`)
 * لأنّ طبقةَ HTTP تقرؤها وتكتبها. وبقيت ثلاثةٌ بقصد: `subscription_idempotency` و
 * `subscription_outbox` و`referral_rewards` عملُ المراجعة 5/6 — ومرآةٌ بلا مُنادٍ تُعطي
 * انطباعَ جهوزيّةٍ لا يقابلها سلوك.
 */
export const NOT_MIRRORED_TABLES: ReadonlyArray<string> = Object.freeze([
  "referral_rewards",
  "subscription_idempotency",
  "subscription_outbox",
]);
