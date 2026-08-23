/**
 * مرآةُ Drizzle لعقد PostgreSQL — تسعةُ جداولَ بنفس الأسماء والأنواع والقيود.
 *
 * ## هذا الملفُّ مرآةٌ لا مصدر
 *
 * الحقيقةُ في `services/reputation/contracts/schema.sql` (مُجمَّد، المراجعة 1/6)، وهو
 * نفسُه **الترحيل**: مُغلَّفٌ بـ`BEGIN;`/`COMMIT;` ويحمل في ذيله عكسَه (DROP بترتيبٍ
 * معاكس) تعليقاً. ولا يُنشئ هذا الملفُّ جدولاً ولا يُولّد DDL: لو صار توليدُ Drizzle هو
 * ما يُطبَّق على القاعدة لصار للمخطّط مصدران، ولاختلفا أوّلَ مرّةٍ يُضاف قيدٌ في أحدهما،
 * وذاك اختلافٌ يُكتشَف في الإنتاج لا في البناء.
 *
 * ولذلك يحرسها اختبارُ `schema-drift.test.ts`: يقرأ الـDDL وقت التشغيل ويقارن
 * **الاتجاهين** — عمودٌ أو قيدٌ في العقد بلا مرآة، أو في المرآة بلا عقد، يُفشل البناء.
 * وهو لا يعدّ الأسماء وحدها: الخطأُ المؤذي أن يبقى الاسمُ ويتغيّر النوعُ أو الإلزامُ أو
 * الافتراض، فتمرّ كتابةٌ في الذاكرة وتُرفَض في القاعدة.
 *
 * ## ما لا يُمثَّل هنا وما يُمثَّل
 *
 * القيودُ **المُسمّاة** الخمسةَ عشرَ كلُّها ممثّلةٌ بأسمائها (`ck_`/`ux_`/`pk_`) لأنّها
 * القيودُ التي يُقارنها الحارسُ ويسمّيها الخطأُ في `details.constraint`. أمّا فحوصُ
 * العمود الواحد بلا اسمٍ (`subject_public_id ~ '^WS-…'` وأمثالُها) فتُسمّيها Postgres
 * تلقائياً ولا يُبنى عليها سلوك، فلا تُنسَخ هنا: نسخُها بأسماءٍ نختارها كان سيخلق أسماءً
 * لا وجودَ لها في القاعدة، وذاك أسوأُ من عدمِ نسخِها.
 *
 * وأنواعُ `TIMESTAMPTZ` تبقى على تمثيل Drizzle الافتراضيّ (`Date`) ويُحوّلها المستودعُ
 * إلى نصّ ISO في موضعٍ واحد (`iso()`/`need()` في `repository.ts`)، كما في خدمة التفاوض.
 * و`mode: "string"` كان أقصرَ ظاهرياً وأسوأ: عميلُ `pg` يُعيد نصَّ Postgres
 * (`2026-03-01 12:00:00+00`) لا ISO، فيصير صفُّ القاعدة غيرَ مساوٍ لصفّ الذاكرة
 * بـ`toEqual` بلا فرقٍ في المعنى — وحزمةُ المطابقة التي تُصلح ذلك بمُحوّلاتٍ متفرّقة
 * تُخفي أوّلَ انحرافٍ حقيقيّ.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/** عمودُ لحظةٍ بمنطقةٍ زمنيّة. التحويلُ إلى نصّ ISO مسؤوليّةُ المستودع لا المرآة. */
const instant = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------
// نسخُ القواعد — الأحكامُ بياناً مُرقّماً
// ---------------------------------------------------------------------------

export const reputationRulesets = pgTable(
  "reputation_rulesets",
  {
    rulesetVersion: integer("ruleset_version").primaryKey(),
    label: text("label").notNull(),
    scoreFloor: integer("score_floor").notNull(),
    scoreCeiling: integer("score_ceiling").notNull(),
    startingScore: integer("starting_score").notNull(),
    minFactsForScore: integer("min_facts_for_score").notNull(),
    decayHalfLifeDays: integer("decay_half_life_days").notNull(),
    tierStandardAt: integer("tier_standard_at").notNull(),
    tierTrustedAt: integer("tier_trusted_at").notNull(),
    tierUnderWatchBelow: integer("tier_under_watch_below").notNull(),
    ratingWindowHours: integer("rating_window_hours").notNull(),
    fraudWindowDays: integer("fraud_window_days").notNull(),
    recomputeIntervalHours: integer("recompute_interval_hours").notNull(),
    isFrozen: boolean("is_frozen").notNull().default(false),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (table) => [
    check("ck_reputation_rulesets_score_bounds", sql`${table.scoreCeiling} > ${table.scoreFloor}`),
    check(
      "ck_reputation_rulesets_start_in_bounds",
      sql`${table.startingScore} >= ${table.scoreFloor} AND ${table.startingScore} <= ${table.scoreCeiling}`,
    ),
    check(
      "ck_reputation_rulesets_tier_order",
      sql`${table.tierTrustedAt} > ${table.tierStandardAt} AND ${table.tierUnderWatchBelow} <= ${table.tierStandardAt}`,
    ),
  ],
);

export const reputationRuleWeights = pgTable(
  "reputation_rule_weights",
  {
    rulesetVersion: integer("ruleset_version")
      .notNull()
      .references(() => reputationRulesets.rulesetVersion),
    subjectType: text("subject_type").notNull(),
    factKind: text("fact_kind").notNull(),
    weightPoints: integer("weight_points").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (table) => [
    primaryKey({
      name: "pk_reputation_rule_weights",
      columns: [table.rulesetVersion, table.subjectType, table.factKind],
    }),
  ],
);

export const reputationFraudThresholds = pgTable(
  "reputation_fraud_thresholds",
  {
    rulesetVersion: integer("ruleset_version")
      .notNull()
      .references(() => reputationRulesets.rulesetVersion),
    ruleCode: text("rule_code").notNull(),
    subjectType: text("subject_type").notNull(),
    thresholdCount: integer("threshold_count").notNull(),
    severity: text("severity").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (table) => [
    primaryKey({
      name: "pk_reputation_fraud_thresholds",
      columns: [table.rulesetVersion, table.ruleCode],
    }),
  ],
);

// ---------------------------------------------------------------------------
// الدفتر — الوقائع
// ---------------------------------------------------------------------------

export const reputationFacts = pgTable(
  "reputation_facts",
  {
    id: uuid("id").primaryKey(),
    subjectType: text("subject_type").notNull(),
    subjectPublicId: text("subject_public_id").notNull(),
    factKind: text("fact_kind").notNull(),
    orderPublicId: text("order_public_id").notNull(),
    sourceEventType: text("source_event_type").notNull(),
    sourceEventId: uuid("source_event_id").notNull(),
    sourceSequence: integer("source_sequence").notNull(),
    actorType: text("actor_type").notNull(),
    reasonCode: text("reason_code"),
    occurredAt: instant("occurred_at").notNull(),
    recordedAt: instant("recorded_at").notNull().default(sql`now()`),
    traceId: text("trace_id"),
  },
  (table) => [
    unique("ux_reputation_facts_source").on(
      table.subjectType,
      table.subjectPublicId,
      table.factKind,
      table.orderPublicId,
      table.sourceSequence,
    ),
    index("ix_reputation_facts_subject").on(
      table.subjectType,
      table.subjectPublicId,
      table.occurredAt.desc(),
    ),
    index("ix_reputation_facts_order").on(table.orderPublicId),
    index("ix_reputation_facts_kind_window").on(
      table.subjectType,
      table.subjectPublicId,
      table.factKind,
      table.occurredAt.desc(),
    ),
  ],
);

// ---------------------------------------------------------------------------
// النتائج — مُشتقّةٌ لا محفوظة
// ---------------------------------------------------------------------------

export const reputationScores = pgTable(
  "reputation_scores",
  {
    subjectType: text("subject_type").notNull(),
    subjectPublicId: text("subject_public_id").notNull(),
    rulesetVersion: integer("ruleset_version")
      .notNull()
      .references(() => reputationRulesets.rulesetVersion),
    scorePoints: integer("score_points").notNull(),
    tier: text("tier").notNull(),
    factCount: integer("fact_count").notNull(),
    computedThroughFactId: uuid("computed_through_fact_id"),
    computedAt: instant("computed_at").notNull(),
    nextRecomputeAt: instant("next_recompute_at").notNull(),
    traceId: text("trace_id"),
  },
  (table) => [
    primaryKey({
      name: "pk_reputation_scores",
      columns: [table.subjectType, table.subjectPublicId],
    }),
    check("ck_reputation_scores_non_negative", sql`${table.scorePoints} >= 0`),
    check(
      "ck_reputation_scores_new_has_no_history",
      sql`${table.tier} <> 'new' OR ${table.factCount} = 0 OR ${table.computedThroughFactId} IS NOT NULL`,
    ),
    index("ix_reputation_scores_tier").on(
      table.subjectType,
      table.tier,
      table.scorePoints.desc(),
    ),
    index("ix_reputation_scores_recompute_due").on(table.nextRecomputeAt),
  ],
);

// ---------------------------------------------------------------------------
// التقييمات — درجةٌ ورمزُ سبب، بلا نصّ
// ---------------------------------------------------------------------------

export const reputationRatings = pgTable(
  "reputation_ratings",
  {
    id: uuid("id").primaryKey(),
    orderPublicId: text("order_public_id").notNull(),
    raterType: text("rater_type").notNull(),
    raterPublicId: text("rater_public_id").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectPublicId: text("subject_public_id").notNull(),
    stars: smallint("stars").notNull(),
    reasonCode: text("reason_code"),
    rulesetVersion: integer("ruleset_version")
      .notNull()
      .references(() => reputationRulesets.rulesetVersion),
    submittedAt: instant("submitted_at").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    traceId: text("trace_id"),
  },
  (table) => [
    unique("ux_reputation_ratings_order_pair").on(
      table.orderPublicId,
      table.raterPublicId,
      table.subjectPublicId,
    ),
    check("ck_reputation_ratings_no_self", sql`${table.raterPublicId} <> ${table.subjectPublicId}`),
    check("ck_reputation_ratings_cross_side", sql`${table.raterType} <> ${table.subjectType}`),
    index("ix_reputation_ratings_subject").on(
      table.subjectType,
      table.subjectPublicId,
      table.submittedAt.desc(),
    ),
    index("ix_reputation_ratings_order").on(table.orderPublicId),
  ],
);

// ---------------------------------------------------------------------------
// إشاراتُ الاحتيال — ملاحظةُ رصدٍ تشرح نفسها، لا حُكم
// ---------------------------------------------------------------------------

export const fraudSignals = pgTable(
  "fraud_signals",
  {
    id: uuid("id").primaryKey(),
    subjectType: text("subject_type").notNull(),
    subjectPublicId: text("subject_public_id").notNull(),
    ruleCode: text("rule_code").notNull(),
    severity: text("severity").notNull(),
    windowStartedAt: instant("window_started_at").notNull(),
    windowEndedAt: instant("window_ended_at").notNull(),
    observedCount: integer("observed_count").notNull(),
    thresholdCount: integer("threshold_count").notNull(),
    rulesetVersion: integer("ruleset_version")
      .notNull()
      .references(() => reputationRulesets.rulesetVersion),
    raisedAt: instant("raised_at").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    traceId: text("trace_id"),
  },
  (table) => [
    check("ck_fraud_signals_window_order", sql`${table.windowEndedAt} > ${table.windowStartedAt}`),
    check(
      "ck_fraud_signals_over_threshold",
      sql`${table.observedCount} >= ${table.thresholdCount}`,
    ),
    unique("ux_fraud_signals_rule_window").on(
      table.subjectType,
      table.subjectPublicId,
      table.ruleCode,
      table.windowEndedAt,
    ),
    index("ix_fraud_signals_subject").on(
      table.subjectType,
      table.subjectPublicId,
      table.raisedAt.desc(),
    ),
    index("ix_fraud_signals_rule").on(table.ruleCode, table.raisedAt.desc()),
  ],
);

// ---------------------------------------------------------------------------
// المعالجةُ الواحدة
// ---------------------------------------------------------------------------

/**
 * `scope` هو اسمُ العمود في العقد، و`operation` اسمُ الحقل في المجال.
 *
 * الفرقُ مُعلَنٌ ومُترجَمٌ في المستودع لا مُصلَحٌ بتعديل العقد: العقدُ مُجمَّدٌ منذ
 * المراجعة 1/6، والصفُّ نفسُه في خدمة التفاوض له نفسُ الشكل — فبقاءُ الاسمين مختلفين
 * بترجمةٍ في موضعٍ واحد أرخصُ من ترحيلٍ يُعيد تسمية عمودٍ في تسع خدمات.
 */
export const reputationIdempotency = pgTable(
  "reputation_idempotency",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    scope: text("scope").notNull(),
    subjectPublicId: text("subject_public_id"),
    payloadFingerprint: text("payload_fingerprint").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (table) => [index("ix_reputation_idempotency_subject").on(table.subjectPublicId)],
);

// ---------------------------------------------------------------------------
// صندوقُ الصادر — يُكتَب في نفس معاملة القرار
// ---------------------------------------------------------------------------

export const reputationOutbox = pgTable(
  "reputation_outbox",
  {
    id: uuid("id").primaryKey(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    eventVersion: text("event_version").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: instant("occurred_at").notNull(),
    publishedAt: instant("published_at"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    traceId: text("trace_id"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (table) => [
    index("ix_reputation_outbox_unpublished")
      .on(table.occurredAt)
      .where(sql`${table.publishedAt} IS NULL`),
  ],
);
