/**
 * مرآةُ Drizzle لعقد PostgreSQL — **الجداولُ العشرةُ كلُّها**، بأسمائها وأنواعها وقيودها.
 *
 * ## هذا الملفُّ مرآةٌ لا مصدر
 *
 * الحقيقةُ في `services/subscriptions/contracts/schema.sql` (مُجمَّد، المراجعة 1/6)، وهو
 * **العقدُ القانونيُّ**: الكتالوجُ الذي يُقاسُ عليه كلُّ تمثيلٍ آخر. وهذا الملفُّ يُسقِطُ
 * العقدَ إلى TypeScript لتُكمِلَ الاستعلاماتُ الترجمةَ، ويُولِّدُ منهُ `drizzle-kit generate`
 * الترحيلاتِ العكوسةَ (ADR-024).
 *
 * ولذلك يحرسها اختبارُ `schema-drift.test.ts`: يقرأ الـDDL وقت التشغيل ويقارن
 * **الاتجاهين** — عمودٌ أو قيدٌ أو فهرسٌ في العقد بلا مرآة، أو في المرآة بلا عقد، يُفشل
 * البناء.
 *
 * ## [مصالحة ADR-024 · الموجة 3]
 *
 * كانَ الإسقاطُ يُعلِنُ تعمُّدَ إغفالِ فحوصِ العمودِ الواحدِ («تسميةُ قيدٍ لم يُسمِّهِ
 * Postgres تضعُ خيالاً في معجمِ حارسِ الانحدارِ»)، لكنّ ولادةَ المولِّدِ غيّرتِ الحسابَ:
 * الترحيلُ المولَّدُ من إسقاطٍ بلا القيودِ المضمَّنةِ كانَ سيُنشئَ قاعدةً **أرخى من
 * العقدِ** — انحدارٌ صامتٌ يعيشُ في الإنتاجِ لا في المرآةِ. فأُلحِقَت القيودُ المضمَّنةُ
 * كلُّها بأسمائِها الكنونيّةِ `<table>_<column>_check` (وهو ما يسمّيهِ PostgreSQL
 * فعلاً عندَ تطبيقِ العقدِ، فالاسمُ حقيقةٌ في الكتالوجِ لا خيالٌ)، وصِيغَت فهارسُ `DESC`
 * و`WHERE` كما في العقدِ، ووُسِّمت المفاتيحُ المركّبةُ بأسمائِها الكنونيّةِ (`_pkey`).
 * والتكافؤُ يقيسُهُ اختبارُ الدورةِ الكاملةِ في سبعةِ أبعادِ كتالوجٍ
 * (`migrations.integration.test.ts`)، وحارسُ الانحرافِ يشتقُّ الأسماءَ الكنونيّةَ للقيودِ
 * المضمَّنةِ غيرِ المسماةِ من نصِّ العقدِ كذلك.
 *
 * ## ما لا يُمثَّل هنا
 *
 * أنواعُ `TIMESTAMPTZ` تبقى على تمثيل Drizzle الافتراضيّ (`Date`) ويُحوّلها المخزنُ إلى
 * نصّ ISO في موضعٍ واحد (`iso()` في `repository.ts`)، كما في خدمتَي التفاوض والسمعة.
 * و`mode: \"string\"` كان أقصرَ ظاهرياً وأسوأ: عميلُ `pg` يُعيد صيغةَ Postgres
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
    primaryKey({ name: "subscription_plans_pkey", columns: [table.planCode, table.planVersion] }),
    check("subscription_plans_plan_code_check", sql`${table.planCode} ~ '^[a-z][a-z0-9-]{2,47}$'`),
    check("subscription_plans_plan_version_check", sql`${table.planVersion} >= 1`),
    check("subscription_plans_label_check", sql`char_length(${table.label}) BETWEEN 3 AND 64`),
    check("subscription_plans_trial_days_check", sql`${table.trialDays} BETWEEN 0 AND 90`),
    check("subscription_plans_duration_days_check", sql`${table.durationDays} BETWEEN 1 AND 730`),
    check(
      "subscription_plans_community_grace_days_check",
      sql`${table.communityGraceDays} BETWEEN 0 AND 90`,
    ),
    check(
      "subscription_plans_community_daily_order_cap_check",
      sql`${table.communityDailyOrderCap} BETWEEN 0 AND 1000`,
    ),
    check(
      "subscription_plans_referral_reward_days_check",
      sql`${table.referralRewardDays} BETWEEN 0 AND 365`,
    ),
    check(
      "subscription_plans_referral_qualifying_facts_check",
      sql`${table.referralQualifyingFacts} BETWEEN 1 AND 100`,
    ),
    check(
      "subscription_plans_referral_window_days_check",
      sql`${table.referralWindowDays} BETWEEN 1 AND 365`,
    ),
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
    primaryKey({
      name: "subscription_plan_entitlements_pkey",
      columns: [table.planCode, table.planVersion, table.entitlementCode],
    }),
    foreignKey({
      name: "fk_subscription_plan_entitlements_plan",
      columns: [table.planCode, table.planVersion],
      foreignColumns: [subscriptionPlans.planCode, subscriptionPlans.planVersion],
    }),
    check(
      "subscription_plan_entitlements_entitlement_code_check",
      sql`${table.entitlementCode} IN ('accept_orders', 'daily_order_cap', 'priority_dispatch', 'zone_multi_select')`,
    ),
    check("subscription_plan_entitlements_limit_value_check", sql`${table.limitValue} >= -1`),
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
    check(
      "subscription_periods_driver_public_id_check",
      sql`${table.driverPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "subscription_periods_source_check",
      sql`${table.source} IN ('trial', 'payment', 'referral_reward')`,
    ),
    check(
      "subscription_periods_payment_reference_check",
      sql`${table.paymentReference} IS NULL OR char_length(${table.paymentReference}) BETWEEN 4 AND 64`,
    ),
    check("subscription_periods_granted_days_check", sql`${table.grantedDays} > 0`),
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
      "subscription_transitions_driver_public_id_check",
      sql`${table.driverPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "subscription_transitions_from_state_check",
      sql`${table.fromState} IS NULL OR ${table.fromState} IN ('trial', 'active', 'expired', 'community')`,
    ),
    check(
      "subscription_transitions_to_state_check",
      sql`${table.toState} IN ('trial', 'active', 'expired', 'community')`,
    ),
    check(
      "subscription_transitions_reason_code_check",
      sql`${table.reasonCode} IN ('trial_granted', 'payment_activated', 'referral_reward_applied', 'period_ended', 'community_grace_ended')`,
    ),
    check("subscription_transitions_sequence_check", sql`${table.sequence} >= 1`),
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
 * لا تُفقد معلومةً واحدة. ولذلك بقي الحارسُ النصّيُّ في `purity.test.ts` قائماً
 * على الدفتر، واستُثني هذا الملفُّ **باسمه** لا بتوسيع نمطٍ يُبيح التعديلَ في كلّ مكان.
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
      "subscriptions_driver_public_id_check",
      sql`${table.driverPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "subscriptions_state_check",
      sql`${table.state} IN ('trial', 'active', 'expired', 'community')`,
    ),
    check("subscriptions_state_sequence_check", sql`${table.stateSequence} >= 1`),
    check(
      "ck_subscriptions_period_state",
      sql`(${table.state} IN ('trial', 'active') AND ${table.currentPeriodId} IS NOT NULL AND ${table.expiresAt} IS NOT NULL) OR (${table.state} IN ('expired', 'community') AND ${table.currentPeriodId} IS NULL AND ${table.expiresAt} IS NULL)`,
    ),
    index("ix_subscriptions_expiring")
      .on(table.expiresAt)
      .where(sql`${table.state} IN ('trial', 'active')`),
  ],
);

/**
 * رمزُ الإحالة: صفٌّ واحدٌ لكلّ مالكٍ (`ux_referral_codes_owner`)، يُزرَع داخلَ معاملةِ بدءِ
 * التجربة — لا عند أوّل قراءة.
 */
export const referralCodes = pgTable(
  "referral_codes",
  {
    referralCode: text("referral_code").primaryKey(),
    ownerPublicId: text("owner_public_id").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("ux_referral_codes_owner").on(table.ownerPublicId),
    check(
      "referral_codes_referral_code_check",
      sql`${table.referralCode} ~ '^WR-[0-9A-Z]{8}$'`,
    ),
    check(
      "referral_codes_owner_public_id_check",
      sql`${table.ownerPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
  ],
);

/**
 * المطالبةُ بالإحالة — صفٌّ واحدٌ لكلّ **مُحالٍ** (`ux_referrals_referee`) لا لكلّ مُحيل.
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
      "referrals_referrer_public_id_check",
      sql`${table.referrerPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "referrals_referee_public_id_check",
      sql`${table.refereePublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "referrals_state_check",
      sql`${table.state} IN ('pending', 'qualified', 'rewarded', 'rejected')`,
    ),
    check(
      "referrals_reason_code_check",
      sql`${table.reasonCode} IS NULL OR ${table.reasonCode} IN ('self_referral', 'referrer_not_active', 'referee_already_referred', 'referee_no_qualifying_facts', 'referral_window_expired', 'referee_subscription_never_activated')`,
    ),
    check("referrals_qualifying_fact_count_check", sql`${table.qualifyingFactCount} >= 0`),
    check(
      "ck_referrals_not_self",
      sql`${table.referrerPublicId} <> ${table.refereePublicId}`,
    ),
    check(
      "ck_referrals_reason_code",
      sql`(${table.state} = 'rejected' AND ${table.reasonCode} IS NOT NULL) OR (${table.state} <> 'rejected' AND ${table.reasonCode} IS NULL)`,
    ),
    index("ix_referrals_referrer").on(table.referrerPublicId, table.createdAt),
    index("ix_referrals_pending")
      .on(table.windowEndsAt)
      .where(sql`${table.state} = 'pending'`),
  ],
);

/**
 * المكافأةُ **حقيقةٌ مُنجَزةٌ** لا نيّة: صفٌّ هنا يعني أنّ مُدّةً دخلت الدفترَ فعلاً.
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
    check(
      "referral_rewards_beneficiary_public_id_check",
      sql`${table.beneficiaryPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check("referral_rewards_reward_days_check", sql`${table.rewardDays} > 0`),
  ],
);

/**
 * سجلُّ منعِ التكرار — الجوابُ المحفوظُ بنفسِ بايتاتِه لا «رأيتُ هذا المفتاح».
 */
export const subscriptionIdempotency = pgTable(
  "subscription_idempotency",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    routeKey: text("route_key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    traceId: text("trace_id"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    check(
      "subscription_idempotency_idempotency_key_check",
      sql`char_length(${table.idempotencyKey}) BETWEEN 8 AND 128`,
    ),
    check(
      "subscription_idempotency_route_key_check",
      sql`char_length(${table.routeKey}) BETWEEN 3 AND 64`,
    ),
    check(
      "subscription_idempotency_request_hash_check",
      sql`char_length(${table.requestHash}) = 64`,
    ),
    check(
      "subscription_idempotency_response_status_check",
      sql`${table.responseStatus} BETWEEN 200 AND 499`,
    ),
  ],
);

/**
 * صندوقُ الصادر — الحدثُ يُكتب مع الحقيقةِ في معاملةٍ واحدة.
 */
export const subscriptionOutbox = pgTable(
  "subscription_outbox",
  {
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
    sequenceNumber: bigint("sequence_number", { mode: "number" }).notNull(),
  },
  (table) => [
    check(
      "subscription_outbox_event_type_check",
      sql`${table.eventType} ~ '^(subscription|referral)\\.[a-z_]+$'`,
    ),
    check(
      "subscription_outbox_aggregate_type_check",
      sql`${table.aggregateType} IN ('subscription', 'referral')`,
    ),
    check("subscription_outbox_attempts_check", sql`${table.attempts} >= 0`),
    index("ix_subscription_outbox_unpublished")
      .on(table.sequenceNumber)
      .where(sql`${table.publishedAt} IS NULL`),
  ],
);

/**
 * الجداولُ التي لا مرآةَ لها — **فارغةٌ بعد المراجعة 5/6**، وليست سطراً مُهمَلاً.
 *
 * قائمةٌ مقروءةٌ من اختبارٍ خيرٌ من فقرةٍ في شرحٍ لا يقرؤها البناء: `schema-drift.test.ts`
 * يُطابقها مع فرق (جداولُ العقد − جداولُ المرآة) فلا يمرّ جدولٌ يُنسى في أحد الجانبين.
 */
export const NOT_MIRRORED_TABLES: ReadonlyArray<string> = Object.freeze([]);
