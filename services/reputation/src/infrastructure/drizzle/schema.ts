/**
 * مرآةُ Drizzle لعقد PostgreSQL — تسعةُ جداولَ بنفس الأسماء والأنواع والقيود.
 *
 * ## هذا الملفُّ مرآةٌ لا مصدر
 *
 * الحقيقةُ في `services/reputation/contracts/schema.sql` (مُجمَّد، المراجعة 1/6)، وهو
 * نفسُه **العقدُ القانونيُّ**: الكتالوجُ الذي يُقاسُ عليه كلُّ تمثيلٍ آخر. وهذا الملفُّ
 * يُسقِطُ العقدَ إلى TypeScript لتُكمِلَ الاستعلاماتُ الترجمةَ، ويُولِّدُ منهُ
 * `drizzle-kit generate` الترحيلاتِ العكوسةَ (ADR-024).
 *
 * ولذلك يحرسها اختبارُ `schema-drift.test.ts`: يقرأ الـDDL وقت التشغيل ويقارن
 * **الاتجاهين** — عمودٌ أو قيدٌ في العقد بلا مرآة، أو في المرآة بلا عقد، يُفشل البناء.
 * وهو لا يعدّ الأسماء وحدها: الخطأُ المؤذي أن يبقى الاسمُ ويتغيّر النوعُ أو الإلزامُ أو
 * الافتراض، فتمرّ كتابةٌ في الذاكرة وتُرفَض في القاعدة.
 *
 * ## [مصالحة ADR-024 · الموجة 3]
 *
 * كانَ الإسقاطُ يُعلِنُ تعمُّدَ إغفالِ فحوصِ العمودِ الواحدِ («تسميةُ قيدٍ لم يُسمِّهِ
 * Postgres تضعُ خيالاً في معجمِ حارسِ الانحدارِ»)، لكنّ ولادةَ المولِّدِ غيّرتِ الحسابَ:
 * الترحيلُ المولَّدُ من إسقاطٍ بلا القيودِ المضمَّنةِ كانَ سيُنشئَ قاعدةً **أرخى من
 * العقدِ** — انحدارٌ صامتٌ يعيشُ في الإنتاجِ لا في المرآةِ. فأُلحِقَت القيودُ المضمَّنةُ
 * كلُّها بأسمائِها الكنونيّةِ `<table>_<column>_check` (وهو ما يسمّيهِ PostgreSQL
 * فعلاً عندَ تطبيقِ العقدِ، فالاسمُ حقيقةٌ في الكتالوجِ لا خيالٌ)، وسُمِّيَت الروابطُ
 * الكنونيّةَ `<table>_<column>_fkey`، وصِيغَت فهارسُ `DESC` بـ`sql\`DESC\`` المجرَّدِ
 * لا `.desc()` الذي يُخرِجُ `DESC NULLS LAST` المخالفَ للعقدِ. والتكافؤُ يقيسُهُ
 * اختبارُ الدورةِ الكاملةِ في سبعةِ أبعادِ كتالوجٍ (`migrations.integration.test.ts`).
 *
 * ## ما لا يُمثَّل هنا وما يُمثَّل
 *
 * القيودُ **المُسمّاة** كلُّها ممثّلةٌ بأسمائها (`ck_`/`ux_`/`pk_`) لأنّها
 * القيودُ التي يُقارنها الحارسُ ويسمّيها الخطأُ في `details.constraint`. وكلُّ فحصِ
 * عمودٍ واحدٍ ممثَّلٌ باسمِهِ الكنونيِّ كما يُسمّيهِ PostgreSQL عندَ تطبيقِ العقدِ.
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
  foreignKey,
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
  (t) => [
    check("reputation_rulesets_ruleset_version_check", sql`${t.rulesetVersion} >= 1`),
    check(
      "reputation_rulesets_label_check",
      sql`char_length(${t.label}) BETWEEN 3 AND 64`,
    ),
    check("reputation_rulesets_score_floor_check", sql`${t.scoreFloor} >= 0`),
    check("reputation_rulesets_score_ceiling_check", sql`${t.scoreCeiling} > 0`),
    check("reputation_rulesets_starting_score_check", sql`${t.startingScore} >= 0`),
    check(
      "reputation_rulesets_min_facts_for_score_check",
      sql`${t.minFactsForScore} BETWEEN 1 AND 100`,
    ),
    check(
      "reputation_rulesets_decay_half_life_days_check",
      sql`${t.decayHalfLifeDays} BETWEEN 7 AND 720`,
    ),
    check("reputation_rulesets_tier_standard_at_check", sql`${t.tierStandardAt} >= 0`),
    check("reputation_rulesets_tier_trusted_at_check", sql`${t.tierTrustedAt} >= 0`),
    check(
      "reputation_rulesets_tier_under_watch_below_check",
      sql`${t.tierUnderWatchBelow} >= 0`,
    ),
    check(
      "reputation_rulesets_rating_window_hours_check",
      sql`${t.ratingWindowHours} BETWEEN 1 AND 720`,
    ),
    check(
      "reputation_rulesets_fraud_window_days_check",
      sql`${t.fraudWindowDays} BETWEEN 1 AND 90`,
    ),
    check(
      "reputation_rulesets_recompute_interval_hours_check",
      sql`${t.recomputeIntervalHours} BETWEEN 1 AND 168`,
    ),
    check("ck_reputation_rulesets_score_bounds", sql`${t.scoreCeiling} > ${t.scoreFloor}`),
    check(
      "ck_reputation_rulesets_start_in_bounds",
      sql`${t.startingScore} >= ${t.scoreFloor} AND ${t.startingScore} <= ${t.scoreCeiling}`,
    ),
    check(
      "ck_reputation_rulesets_tier_order",
      sql`${t.tierTrustedAt} > ${t.tierStandardAt} AND ${t.tierUnderWatchBelow} <= ${t.tierStandardAt}`,
    ),
  ],
);

export const reputationRuleWeights = pgTable(
  "reputation_rule_weights",
  {
    rulesetVersion: integer("ruleset_version").notNull(),
    subjectType: text("subject_type").notNull(),
    factKind: text("fact_kind").notNull(),
    weightPoints: integer("weight_points").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({
      columns: [t.rulesetVersion],
      foreignColumns: [reputationRulesets.rulesetVersion],
      name: "reputation_rule_weights_ruleset_version_fkey",
    }),
    check(
      "reputation_rule_weights_subject_type_check",
      sql`${t.subjectType} IN ('customer','driver')`,
    ),
    check(
      "reputation_rule_weights_fact_kind_check",
      sql`${t.factKind} IN ('order_completed','order_cancelled_by_customer','order_cancelled_by_driver','assignment_accepted','assignment_rejected','assignment_timed_out','rating_received')`,
    ),
    check(
      "reputation_rule_weights_weight_points_check",
      sql`${t.weightPoints} BETWEEN -50 AND 50`,
    ),
    primaryKey({
      name: "pk_reputation_rule_weights",
      columns: [t.rulesetVersion, t.subjectType, t.factKind],
    }),
  ],
);

export const reputationFraudThresholds = pgTable(
  "reputation_fraud_thresholds",
  {
    rulesetVersion: integer("ruleset_version").notNull(),
    ruleCode: text("rule_code").notNull(),
    subjectType: text("subject_type").notNull(),
    thresholdCount: integer("threshold_count").notNull(),
    severity: text("severity").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({
      columns: [t.rulesetVersion],
      foreignColumns: [reputationRulesets.rulesetVersion],
      name: "reputation_fraud_thresholds_ruleset_version_fkey",
    }),
    check(
      "reputation_fraud_thresholds_rule_code_check",
      sql`${t.ruleCode} IN ('repeated_customer_cancellation','repeated_driver_cancellation','accept_then_abandon','offer_timeout_streak','rating_extremity_burst')`,
    ),
    check(
      "reputation_fraud_thresholds_subject_type_check",
      sql`${t.subjectType} IN ('customer','driver')`,
    ),
    check(
      "reputation_fraud_thresholds_threshold_count_check",
      sql`${t.thresholdCount} BETWEEN 2 AND 100`,
    ),
    check(
      "reputation_fraud_thresholds_severity_check",
      sql`${t.severity} IN ('low','medium','high')`,
    ),
    primaryKey({
      name: "pk_reputation_fraud_thresholds",
      columns: [t.rulesetVersion, t.ruleCode],
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
  (t) => [
    check("reputation_facts_subject_type_check", sql`${t.subjectType} IN ('customer','driver')`),
    check(
      "reputation_facts_subject_public_id_check",
      sql`${t.subjectPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "reputation_facts_fact_kind_check",
      sql`${t.factKind} IN ('order_completed','order_cancelled_by_customer','order_cancelled_by_driver','assignment_accepted','assignment_rejected','assignment_timed_out','rating_received')`,
    ),
    check(
      "reputation_facts_order_public_id_check",
      sql`${t.orderPublicId} ~ '^ORD-[0-9]{10}$'`,
    ),
    check(
      "reputation_facts_source_event_type_check",
      sql`char_length(${t.sourceEventType}) >= 3`,
    ),
    check("reputation_facts_source_sequence_check", sql`${t.sourceSequence} >= 1`),
    check(
      "reputation_facts_actor_type_check",
      sql`${t.actorType} IN ('system','customer','driver','partner','admin')`,
    ),
    check(
      "reputation_facts_reason_code_check",
      sql`${t.reasonCode} IS NULL OR char_length(${t.reasonCode}) BETWEEN 2 AND 64`,
    ),
    unique("ux_reputation_facts_source").on(
      t.subjectType,
      t.subjectPublicId,
      t.factKind,
      t.orderPublicId,
      t.sourceSequence,
    ),
    index("ix_reputation_facts_subject").on(
      t.subjectType,
      t.subjectPublicId,
      sql`${t.occurredAt} DESC`,
    ),
    index("ix_reputation_facts_order").on(t.orderPublicId),
    index("ix_reputation_facts_kind_window").on(
      t.subjectType,
      t.subjectPublicId,
      t.factKind,
      sql`${t.occurredAt} DESC`,
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
    rulesetVersion: integer("ruleset_version").notNull(),
    scorePoints: integer("score_points").notNull(),
    tier: text("tier").notNull(),
    factCount: integer("fact_count").notNull(),
    computedThroughFactId: uuid("computed_through_fact_id"),
    computedAt: instant("computed_at").notNull(),
    nextRecomputeAt: instant("next_recompute_at").notNull(),
    traceId: text("trace_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.rulesetVersion],
      foreignColumns: [reputationRulesets.rulesetVersion],
      name: "reputation_scores_ruleset_version_fkey",
    }),
    check("reputation_scores_subject_type_check", sql`${t.subjectType} IN ('customer','driver')`),
    check(
      "reputation_scores_subject_public_id_check",
      sql`${t.subjectPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "reputation_scores_tier_check",
      sql`${t.tier} IN ('new','standard','trusted','under_watch')`,
    ),
    check("reputation_scores_fact_count_check", sql`${t.factCount} >= 0`),
    check("ck_reputation_scores_non_negative", sql`${t.scorePoints} >= 0`),
    check(
      "ck_reputation_scores_new_has_no_history",
      sql`${t.tier} <> 'new' OR ${t.factCount} = 0 OR ${t.computedThroughFactId} IS NOT NULL`,
    ),
    primaryKey({
      name: "pk_reputation_scores",
      columns: [t.subjectType, t.subjectPublicId],
    }),
    index("ix_reputation_scores_tier").on(
      t.subjectType,
      t.tier,
      sql`${t.scorePoints} DESC`,
    ),
    index("ix_reputation_scores_recompute_due").on(t.nextRecomputeAt),
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
    rulesetVersion: integer("ruleset_version").notNull(),
    submittedAt: instant("submitted_at").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    traceId: text("trace_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.rulesetVersion],
      foreignColumns: [reputationRulesets.rulesetVersion],
      name: "reputation_ratings_ruleset_version_fkey",
    }),
    check(
      "reputation_ratings_order_public_id_check",
      sql`${t.orderPublicId} ~ '^ORD-[0-9]{10}$'`,
    ),
    check("reputation_ratings_rater_type_check", sql`${t.raterType} IN ('customer','driver')`),
    check(
      "reputation_ratings_rater_public_id_check",
      sql`${t.raterPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check("reputation_ratings_subject_type_check", sql`${t.subjectType} IN ('customer','driver')`),
    check(
      "reputation_ratings_subject_public_id_check",
      sql`${t.subjectPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check("reputation_ratings_stars_check", sql`${t.stars} BETWEEN 1 AND 5`),
    check(
      "reputation_ratings_reason_code_check",
      sql`${t.reasonCode} IS NULL OR ${t.reasonCode} IN ('on_time','late_arrival','courteous','poor_conduct','unsafe_driving','vehicle_condition','route_deviation','no_show')`,
    ),
    unique("ux_reputation_ratings_order_pair").on(
      t.orderPublicId,
      t.raterPublicId,
      t.subjectPublicId,
    ),
    check("ck_reputation_ratings_no_self", sql`${t.raterPublicId} <> ${t.subjectPublicId}`),
    check("ck_reputation_ratings_cross_side", sql`${t.raterType} <> ${t.subjectType}`),
    index("ix_reputation_ratings_subject").on(
      t.subjectType,
      t.subjectPublicId,
      sql`${t.submittedAt} DESC`,
    ),
    index("ix_reputation_ratings_order").on(t.orderPublicId),
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
    rulesetVersion: integer("ruleset_version").notNull(),
    raisedAt: instant("raised_at").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    traceId: text("trace_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.rulesetVersion],
      foreignColumns: [reputationRulesets.rulesetVersion],
      name: "fraud_signals_ruleset_version_fkey",
    }),
    check("fraud_signals_subject_type_check", sql`${t.subjectType} IN ('customer','driver')`),
    check(
      "fraud_signals_subject_public_id_check",
      sql`${t.subjectPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "fraud_signals_rule_code_check",
      sql`${t.ruleCode} IN ('repeated_customer_cancellation','repeated_driver_cancellation','accept_then_abandon','offer_timeout_streak','rating_extremity_burst')`,
    ),
    check("fraud_signals_severity_check", sql`${t.severity} IN ('low','medium','high')`),
    check("fraud_signals_observed_count_check", sql`${t.observedCount} >= 0`),
    check("fraud_signals_threshold_count_check", sql`${t.thresholdCount} >= 2`),
    check("ck_fraud_signals_window_order", sql`${t.windowEndedAt} > ${t.windowStartedAt}`),
    check(
      "ck_fraud_signals_over_threshold",
      sql`${t.observedCount} >= ${t.thresholdCount}`,
    ),
    unique("ux_fraud_signals_rule_window").on(
      t.subjectType,
      t.subjectPublicId,
      t.ruleCode,
      t.windowEndedAt,
    ),
    index("ix_fraud_signals_subject").on(
      t.subjectType,
      t.subjectPublicId,
      sql`${t.raisedAt} DESC`,
    ),
    index("ix_fraud_signals_rule").on(t.ruleCode, sql`${t.raisedAt} DESC`),
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
  (t) => [
    check(
      "reputation_idempotency_idempotency_key_check",
      sql`char_length(${t.idempotencyKey}) BETWEEN 8 AND 128`,
    ),
    check(
      "reputation_idempotency_scope_check",
      sql`${t.scope} IN ('record_fact','submit_rating','recompute_score','tick')`,
    ),
    check(
      "reputation_idempotency_subject_public_id_check",
      sql`${t.subjectPublicId} IS NULL OR ${t.subjectPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "reputation_idempotency_payload_fingerprint_check",
      sql`char_length(${t.payloadFingerprint}) = 64`,
    ),
    check(
      "reputation_idempotency_response_status_check",
      sql`${t.responseStatus} BETWEEN 100 AND 599`,
    ),
    index("ix_reputation_idempotency_subject").on(t.subjectPublicId),
  ],
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
  (t) => [
    check(
      "reputation_outbox_aggregate_type_check",
      sql`${t.aggregateType} IN ('reputation_fact','reputation_score','reputation_rating','fraud_signal')`,
    ),
    check(
      "reputation_outbox_event_type_check",
      sql`char_length(${t.eventType}) >= 3`,
    ),
    check(
      "reputation_outbox_event_version_check",
      sql`${t.eventVersion} ~ '^v[0-9]+$'`,
    ),
    check("reputation_outbox_attempts_check", sql`${t.attempts} >= 0`),
    index("ix_reputation_outbox_unpublished")
      .on(t.occurredAt)
      .where(sql`${t.publishedAt} IS NULL`),
  ],
);
