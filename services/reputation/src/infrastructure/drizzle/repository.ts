/**
 * مُهيئاتُ منافذ السمعة على PostgreSQL عبر Drizzle.
 *
 * هذه الطبقةُ هي حدُّ التحويل الوحيد بين صفوف Postgres ونماذج المجال: اللحظاتُ تخرج
 * نصّاً ISO، والنتيجةُ تبقى عدداً صحيحاً كما في العقد، وJSONB لا يعبر إلّا كحدثٍ
 * متعاقدٍ عليه في `reputation_outbox`. ولا تفتح المستودعاتُ معاملةً: اختيارُ الحدود
 * مسؤوليّةُ `PostgresReputationUnitOfWork` وحدها (`transaction.ts`).
 *
 * ## القيودُ تُترجَم بأسمائها، لا بحدسٍ عن الرمز
 *
 * كلُّ كتابةٍ تُغلَّف بـ`catch` واحدٍ يمرّ على `translate`، و`translate` يقرأ اسمَ القيد
 * من خطأ Postgres ويرميه خطأَ مجالٍ **بنفس الاسم** الذي يرميه مُهيئُ الذاكرة
 * (`constraintViolated(name)` = `REPUTATION_VALIDATION_FAILED` + `details.constraint`).
 * وهذا بعينه ما يجعل حزمةَ المطابقة فحصاً لا دعوى: الاختبارُ يؤكّد **الرمزَ والاسم**،
 * فلو ترجم أحدُ المُهيئين قيداً إلى خطأٍ آخر لظهر الفرقُ في البناء لا في الإنتاج.
 *
 * واسمٌ غيرُ معروفٍ لا يُترجَم بل يُعاد كما هو: خطأٌ لم نتوقّعه يجب أن يصعد بصورته
 * الأولى، لأنّ تحويلَه إلى `REPUTATION_VALIDATION_FAILED` كان سيُخفي خطأَ اتصالٍ أو
 * ترحيلٍ ناقصٍ تحت رمزٍ يوحي بأنّ المُرسل أخطأ.
 *
 * ## سلسلةُ `cause`
 *
 * Drizzle يُغلّف خطأَ العميل، فقراءةُ `error.code` وحدها كانت ستُخطئ الاسمَ وترمي الخطأَ
 * الخام. ولذلك يمرّ `postgresError` على ثمانِ حلقاتٍ يجمع أوّلَ `code` من خمسة محارف
 * وأوّلَ `constraint`.
 */

import { and, asc, desc, eq, isNull, lte, max, sql } from "drizzle-orm";

import { constraintViolated } from "../../domain/errors.js";
import type { ReputationDomainEvent } from "../../domain/events.js";
import type {
  FraudRuleCode,
  FraudSeverity,
  FraudSignalRow,
  ReputationFactKind,
  ReputationFactRow,
  ReputationFraudThresholdRow,
  ReputationIdempotencyRow,
  ReputationRatingReasonCode,
  ReputationRatingRow,
  ReputationRuleWeightRow,
  ReputationRulesetRow,
  ReputationScoreRow,
  ReputationSubjectType,
  ReputationTier,
} from "../../domain/model.js";
import type { ReputationActorType } from "../../domain/model.js";
import { assertRulesetInvariants } from "../../domain/ruleset.js";
import type {
  FactFilter,
  FactRepository,
  FactSourceKey,
  FraudSignalFilter,
  FraudSignalRepository,
  IdempotencyRepository,
  OutboxPort,
  RatingFilter,
  RatingRepository,
  RulesetRepository,
  ScoreRepository,
} from "../../ports.js";
import { ENFORCED_CONSTRAINTS } from "../constraints.js";
import type { DbOrTx } from "./db.js";
import {
  fraudSignals,
  reputationFacts,
  reputationFraudThresholds,
  reputationIdempotency,
  reputationOutbox,
  reputationRatings,
  reputationRuleWeights,
  reputationRulesets,
  reputationScores,
} from "./schema.js";

// ---------------------------------------------------------------------------
// تحويلُ اللحظات وترجمةُ الأخطاء
// ---------------------------------------------------------------------------

/** لحظةٌ إلزاميّة إلى نصّ ISO. */
function need(value: Date): string {
  return value.toISOString();
}

/** نصُّ لحظةٍ إلى `Date` — تحويلُ صيغةٍ نقيّ، لا قراءةُ ساعة. */
function at(value: string): Date {
  return new Date(value);
}

export function postgresError(error: unknown): {
  code?: string;
  constraint?: string;
} {
  let cursor = error;
  const found: { code?: string; constraint?: string } = {};
  for (let step = 0; step < 8 && cursor !== null && typeof cursor === "object"; step += 1) {
    const candidate = cursor as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (found.code === undefined && typeof candidate.code === "string" && candidate.code.length === 5) {
      found.code = candidate.code;
    }
    if (found.constraint === undefined && typeof candidate.constraint === "string") {
      found.constraint = candidate.constraint;
    }
    if (candidate.cause === cursor) break;
    cursor = candidate.cause;
  }
  return found;
}

const ENFORCED = new Set<string>(ENFORCED_CONSTRAINTS);

/**
 * خطأُ Postgres إلى خطأِ المجال — بنفس اسمِ القيد الذي يرميه مُهيئُ الذاكرة.
 *
 * لا جدولَ ترجمةٍ يدويّ باسمٍ لكلّ قيد: القائمةُ المُلزِمة `ENFORCED_CONSTRAINTS`
 * موجودةٌ أصلاً ويحرسها اختبارُ الانحراف مقابل الـDDL، فبناءُ جدولٍ ثانٍ هنا كان سيخلق
 * مصدراً ثالثاً يسهو عنه من يُضيف قيداً.
 */
function translate(error: unknown): never {
  const detail = postgresError(error);
  if (detail.constraint !== undefined && ENFORCED.has(detail.constraint)) {
    throw constraintViolated(detail.constraint);
  }
  throw error;
}

// ---------------------------------------------------------------------------
// نسخُ القواعد
// ---------------------------------------------------------------------------

type RulesetRecord = typeof reputationRulesets.$inferSelect;
type WeightRecord = typeof reputationRuleWeights.$inferSelect;
type ThresholdRecord = typeof reputationFraudThresholds.$inferSelect;

function toWeight(row: WeightRecord): ReputationRuleWeightRow {
  return {
    rulesetVersion: row.rulesetVersion,
    subjectType: row.subjectType as ReputationSubjectType,
    factKind: row.factKind as ReputationFactKind,
    weightPoints: row.weightPoints,
  };
}

function toThreshold(row: ThresholdRecord): ReputationFraudThresholdRow {
  return {
    rulesetVersion: row.rulesetVersion,
    ruleCode: row.ruleCode as FraudRuleCode,
    subjectType: row.subjectType as ReputationSubjectType,
    thresholdCount: row.thresholdCount,
    severity: row.severity as FraudSeverity,
  };
}

/**
 * مستودعُ نسخِ القواعد — قراءةٌ فقط، والزرعُ من الترحيل لا من الكود.
 *
 * لا `insert` في هذا المستودع بحال: صفوفُ النسخة 1 مكتوبةٌ في `contracts/schema.sql`
 * نفسِه بـ`INSERT … ON CONFLICT DO NOTHING`، وهو الترحيل. ودالّةُ زرعٍ في الكود كانت
 * ستجعل لنسخةِ القواعد مصدرين — أحدُهما يركض في الاختبار والآخر في الإنتاج — فتُحسب
 * السمعةُ بأحكامٍ مختلفةٍ في البيئتين ولا يُكتشف ذلك إلّا بمقارنة أرقامٍ لا تُقارَن.
 *
 * وكلُّ نسخةٍ مقروءةٍ تمرّ على `assertRulesetInvariants`: ترحيلٌ يدويٌّ في بيئةٍ ما قد
 * يترك رتبةً موثوقةً أدنى من رتبةٍ عاديّة، وذاك خطأٌ يجعل التصنيفَ عبثاً بلا أن يفشل شيء.
 */
export class PostgresRulesetRepository implements RulesetRepository {
  constructor(private readonly db: DbOrTx) {}

  async find(rulesetVersion: number): Promise<ReputationRulesetRow | null> {
    const rows = await this.db
      .select()
      .from(reputationRulesets)
      .where(eq(reputationRulesets.rulesetVersion, rulesetVersion))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return this.hydrate(row);
  }

  async list(): Promise<readonly ReputationRulesetRow[]> {
    const rows = await this.db
      .select()
      .from(reputationRulesets)
      .orderBy(asc(reputationRulesets.rulesetVersion));
    const hydrated: ReputationRulesetRow[] = [];
    for (const row of rows) hydrated.push(await this.hydrate(row));
    return hydrated;
  }

  async findActive(): Promise<ReputationRulesetRow | null> {
    const rows = await this.db
      .select()
      .from(reputationRulesets)
      .where(eq(reputationRulesets.isFrozen, true))
      .orderBy(desc(reputationRulesets.rulesetVersion))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return this.hydrate(row);
  }

  private async hydrate(row: RulesetRecord): Promise<ReputationRulesetRow> {
    const [weights, thresholds] = await Promise.all([
      this.db
        .select()
        .from(reputationRuleWeights)
        .where(eq(reputationRuleWeights.rulesetVersion, row.rulesetVersion))
        .orderBy(asc(reputationRuleWeights.subjectType), asc(reputationRuleWeights.factKind)),
      this.db
        .select()
        .from(reputationFraudThresholds)
        .where(eq(reputationFraudThresholds.rulesetVersion, row.rulesetVersion))
        .orderBy(asc(reputationFraudThresholds.ruleCode)),
    ]);

    return assertRulesetInvariants({
      rulesetVersion: row.rulesetVersion,
      label: row.label,
      scoreFloor: row.scoreFloor,
      scoreCeiling: row.scoreCeiling,
      startingScore: row.startingScore,
      minFactsForScore: row.minFactsForScore,
      decayHalfLifeDays: row.decayHalfLifeDays,
      tierStandardAt: row.tierStandardAt,
      tierTrustedAt: row.tierTrustedAt,
      tierUnderWatchBelow: row.tierUnderWatchBelow,
      ratingWindowHours: row.ratingWindowHours,
      fraudWindowDays: row.fraudWindowDays,
      recomputeIntervalHours: row.recomputeIntervalHours,
      isFrozen: row.isFrozen,
      weights: weights.map(toWeight),
      fraudThresholds: thresholds.map(toThreshold),
    });
  }
}

// ---------------------------------------------------------------------------
// الدفتر — الوقائع
// ---------------------------------------------------------------------------

type FactRecord = typeof reputationFacts.$inferSelect;

function toFact(row: FactRecord): ReputationFactRow {
  return {
    id: row.id,
    subjectType: row.subjectType as ReputationSubjectType,
    subjectPublicId: row.subjectPublicId,
    factKind: row.factKind as ReputationFactKind,
    orderPublicId: row.orderPublicId,
    sourceEventType: row.sourceEventType,
    sourceEventId: row.sourceEventId,
    sourceSequence: row.sourceSequence,
    actorType: row.actorType as ReputationActorType,
    reasonCode: row.reasonCode,
    occurredAt: need(row.occurredAt),
    recordedAt: need(row.recordedAt),
    traceId: row.traceId,
  };
}

/**
 * ترتيبُ الدفتر: `occurred_at` ثم `source_sequence` ثم `id`.
 *
 * نفسُ ترتيب مُهيئ الذاكرة حرفياً. والمرتبتان الثانية والثالثة ليستا زينة: واقعتان في
 * نفس المللي ثانية أمرٌ عاديٌّ في نبضةٍ تُعالج دفعةً، وترتيبٌ غيرُ حاسمٍ كان سيجعل
 * `listBySubject` تُعيد تسلسلين مختلفين للبيانات نفسها — فيمرّ اختبارُ المطابقة مرّةً
 * ويفشل أخرى بلا تغييرٍ في الكود.
 */
function factOrder() {
  return [
    asc(reputationFacts.occurredAt),
    asc(reputationFacts.sourceSequence),
    asc(reputationFacts.id),
  ] as const;
}

export class PostgresFactRepository implements FactRepository {
  constructor(private readonly db: DbOrTx) {}

  async findBySource(key: FactSourceKey): Promise<ReputationFactRow | null> {
    const rows = await this.db
      .select()
      .from(reputationFacts)
      .where(
        and(
          eq(reputationFacts.subjectType, key.subjectType),
          eq(reputationFacts.subjectPublicId, key.subjectPublicId),
          eq(reputationFacts.factKind, key.factKind),
          eq(reputationFacts.orderPublicId, key.orderPublicId),
          eq(reputationFacts.sourceSequence, key.sourceSequence),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toFact(row);
  }

  async insert(row: ReputationFactRow): Promise<ReputationFactRow> {
    try {
      const inserted = await this.db
        .insert(reputationFacts)
        .values({
          id: row.id,
          subjectType: row.subjectType,
          subjectPublicId: row.subjectPublicId,
          factKind: row.factKind,
          orderPublicId: row.orderPublicId,
          sourceEventType: row.sourceEventType,
          sourceEventId: row.sourceEventId,
          sourceSequence: row.sourceSequence,
          actorType: row.actorType,
          reasonCode: row.reasonCode,
          occurredAt: at(row.occurredAt),
          recordedAt: at(row.recordedAt),
          traceId: row.traceId ?? null,
        })
        .returning();
      return toFact(inserted[0] as FactRecord);
    } catch (error) {
      return translate(error);
    }
  }

  async listBySubject(
    subjectType: ReputationSubjectType,
    subjectPublicId: string,
  ): Promise<readonly ReputationFactRow[]> {
    const rows = await this.db
      .select()
      .from(reputationFacts)
      .where(
        and(
          eq(reputationFacts.subjectType, subjectType),
          eq(reputationFacts.subjectPublicId, subjectPublicId),
        ),
      )
      .orderBy(...factOrder());
    return rows.map(toFact);
  }

  async list(filter: FactFilter): Promise<readonly ReputationFactRow[]> {
    const conditions = [
      filter.subjectType === undefined
        ? undefined
        : eq(reputationFacts.subjectType, filter.subjectType),
      filter.subjectPublicId === undefined
        ? undefined
        : eq(reputationFacts.subjectPublicId, filter.subjectPublicId),
      filter.orderPublicId === undefined
        ? undefined
        : eq(reputationFacts.orderPublicId, filter.orderPublicId),
      filter.factKind === undefined ? undefined : eq(reputationFacts.factKind, filter.factKind),
    ].filter((condition) => condition !== undefined);

    const rows = await this.db
      .select()
      .from(reputationFacts)
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(...factOrder());
    return rows.map(toFact);
  }

  async latestSourceSequence(
    subjectType: ReputationSubjectType,
    subjectPublicId: string,
    orderPublicId: string,
  ): Promise<number | null> {
    const rows = await this.db
      .select({ latest: max(reputationFacts.sourceSequence) })
      .from(reputationFacts)
      .where(
        and(
          eq(reputationFacts.subjectType, subjectType),
          eq(reputationFacts.subjectPublicId, subjectPublicId),
          eq(reputationFacts.orderPublicId, orderPublicId),
        ),
      );
    return rows[0]?.latest ?? null;
  }

  async findOrderCompletion(orderPublicId: string): Promise<ReputationFactRow | null> {
    const rows = await this.db
      .select()
      .from(reputationFacts)
      .where(
        and(
          eq(reputationFacts.orderPublicId, orderPublicId),
          eq(reputationFacts.factKind, "order_completed"),
        ),
      )
      .orderBy(...factOrder())
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toFact(row);
  }
}

// ---------------------------------------------------------------------------
// النتائج
// ---------------------------------------------------------------------------

type ScoreRecord = typeof reputationScores.$inferSelect;

function toScore(row: ScoreRecord): ReputationScoreRow {
  return {
    subjectType: row.subjectType as ReputationSubjectType,
    subjectPublicId: row.subjectPublicId,
    rulesetVersion: row.rulesetVersion,
    scorePoints: row.scorePoints,
    tier: row.tier as ReputationTier,
    factCount: row.factCount,
    computedThroughFactId: row.computedThroughFactId,
    computedAt: need(row.computedAt),
    nextRecomputeAt: need(row.nextRecomputeAt),
    traceId: row.traceId,
  };
}

export class PostgresScoreRepository implements ScoreRepository {
  constructor(private readonly db: DbOrTx) {}

  async find(
    subjectType: ReputationSubjectType,
    subjectPublicId: string,
  ): Promise<ReputationScoreRow | null> {
    const rows = await this.db
      .select()
      .from(reputationScores)
      .where(
        and(
          eq(reputationScores.subjectType, subjectType),
          eq(reputationScores.subjectPublicId, subjectPublicId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toScore(row);
  }

  /**
   * `INSERT … ON CONFLICT (pk) DO UPDATE` — إدراجٌ وتحديثٌ في رحلةٍ واحدة.
   *
   * لا فرعَ «هل هي موجودة؟» في هذا المُهيئ: ذلك الفرعُ بعينه موضعُ التسابق الذي يُنتج
   * كتابتين متزامنتين تنجح إحداهما وتفشل الأخرى بخطأِ مفتاحٍ مكرّرٍ لا يعني شيئاً
   * للمُرسل. والنتيجةُ مُشتقّةٌ بالكامل، فالتحديثُ الكاملُ لكل عمودٍ هو المعنى الصحيح.
   */
  async upsert(row: ReputationScoreRow): Promise<ReputationScoreRow> {
    const values = {
      subjectType: row.subjectType,
      subjectPublicId: row.subjectPublicId,
      rulesetVersion: row.rulesetVersion,
      scorePoints: row.scorePoints,
      tier: row.tier,
      factCount: row.factCount,
      computedThroughFactId: row.computedThroughFactId,
      computedAt: at(row.computedAt),
      nextRecomputeAt: at(row.nextRecomputeAt),
      traceId: row.traceId ?? null,
    };
    try {
      const written = await this.db
        .insert(reputationScores)
        .values(values)
        .onConflictDoUpdate({
          target: [reputationScores.subjectType, reputationScores.subjectPublicId],
          set: {
            rulesetVersion: values.rulesetVersion,
            scorePoints: values.scorePoints,
            tier: values.tier,
            factCount: values.factCount,
            computedThroughFactId: values.computedThroughFactId,
            computedAt: values.computedAt,
            nextRecomputeAt: values.nextRecomputeAt,
            traceId: values.traceId,
          },
        })
        .returning();
      return toScore(written[0] as ScoreRecord);
    } catch (error) {
      return translate(error);
    }
  }

  /**
   * المستحقّاتُ عند `now` — نفسُ ترتيب مُهيئ الذاكرة.
   *
   * الذاكرةُ ترتّب بـ`nextRecomputeAt` ثم بمفتاحٍ نصّيٍّ هو `subject_type|subject_public_id`،
   * وهنا عمودان متتاليان. والترتيبان متطابقان لأنّ `subject_type` قيمةٌ من مجموعةٍ
   * مغلقة (`customer`/`driver`) لا تكون إحداهما بادئةَ الأخرى، فلا يُغيّر الفاصلُ حكماً.
   */
  async listDueForRecompute(now: string, limit: number): Promise<readonly ReputationScoreRow[]> {
    const rows = await this.db
      .select()
      .from(reputationScores)
      .where(lte(reputationScores.nextRecomputeAt, at(now)))
      .orderBy(
        asc(reputationScores.nextRecomputeAt),
        asc(reputationScores.subjectType),
        asc(reputationScores.subjectPublicId),
      )
      .limit(limit);
    return rows.map(toScore);
  }
}

// ---------------------------------------------------------------------------
// التقييمات
// ---------------------------------------------------------------------------

type RatingRecord = typeof reputationRatings.$inferSelect;

function toRating(row: RatingRecord): ReputationRatingRow {
  return {
    id: row.id,
    orderPublicId: row.orderPublicId,
    raterType: row.raterType as ReputationSubjectType,
    raterPublicId: row.raterPublicId,
    subjectType: row.subjectType as ReputationSubjectType,
    subjectPublicId: row.subjectPublicId,
    stars: row.stars,
    reasonCode: row.reasonCode as ReputationRatingReasonCode | null,
    rulesetVersion: row.rulesetVersion,
    submittedAt: need(row.submittedAt),
    traceId: row.traceId,
  };
}

export class PostgresRatingRepository implements RatingRepository {
  constructor(private readonly db: DbOrTx) {}

  async findByOrderPair(
    orderPublicId: string,
    raterPublicId: string,
    subjectPublicId: string,
  ): Promise<ReputationRatingRow | null> {
    const rows = await this.db
      .select()
      .from(reputationRatings)
      .where(
        and(
          eq(reputationRatings.orderPublicId, orderPublicId),
          eq(reputationRatings.raterPublicId, raterPublicId),
          eq(reputationRatings.subjectPublicId, subjectPublicId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toRating(row);
  }

  async insert(row: ReputationRatingRow): Promise<ReputationRatingRow> {
    try {
      const inserted = await this.db
        .insert(reputationRatings)
        .values({
          id: row.id,
          orderPublicId: row.orderPublicId,
          raterType: row.raterType,
          raterPublicId: row.raterPublicId,
          subjectType: row.subjectType,
          subjectPublicId: row.subjectPublicId,
          stars: row.stars,
          reasonCode: row.reasonCode,
          rulesetVersion: row.rulesetVersion,
          submittedAt: at(row.submittedAt),
          traceId: row.traceId ?? null,
        })
        .returning();
      return toRating(inserted[0] as RatingRecord);
    } catch (error) {
      return translate(error);
    }
  }

  async list(filter: RatingFilter): Promise<readonly ReputationRatingRow[]> {
    const conditions = [
      filter.subjectType === undefined
        ? undefined
        : eq(reputationRatings.subjectType, filter.subjectType),
      filter.subjectPublicId === undefined
        ? undefined
        : eq(reputationRatings.subjectPublicId, filter.subjectPublicId),
      filter.orderPublicId === undefined
        ? undefined
        : eq(reputationRatings.orderPublicId, filter.orderPublicId),
    ].filter((condition) => condition !== undefined);

    const rows = await this.db
      .select()
      .from(reputationRatings)
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(asc(reputationRatings.submittedAt), asc(reputationRatings.id));
    return rows.map(toRating);
  }

  async listByRater(raterPublicId: string): Promise<readonly ReputationRatingRow[]> {
    const rows = await this.db
      .select()
      .from(reputationRatings)
      .where(eq(reputationRatings.raterPublicId, raterPublicId))
      .orderBy(asc(reputationRatings.submittedAt), asc(reputationRatings.id));
    return rows.map(toRating);
  }
}

// ---------------------------------------------------------------------------
// إشاراتُ الاحتيال
// ---------------------------------------------------------------------------

type FraudSignalRecord = typeof fraudSignals.$inferSelect;

function toFraudSignal(row: FraudSignalRecord): FraudSignalRow {
  return {
    id: row.id,
    subjectType: row.subjectType as ReputationSubjectType,
    subjectPublicId: row.subjectPublicId,
    ruleCode: row.ruleCode as FraudRuleCode,
    severity: row.severity as FraudSeverity,
    windowStartedAt: need(row.windowStartedAt),
    windowEndedAt: need(row.windowEndedAt),
    observedCount: row.observedCount,
    thresholdCount: row.thresholdCount,
    rulesetVersion: row.rulesetVersion,
    raisedAt: need(row.raisedAt),
    traceId: row.traceId,
  };
}

export class PostgresFraudSignalRepository implements FraudSignalRepository {
  constructor(private readonly db: DbOrTx) {}

  async findByRuleWindow(
    subjectType: ReputationSubjectType,
    subjectPublicId: string,
    ruleCode: FraudRuleCode,
    windowEndedAt: string,
  ): Promise<FraudSignalRow | null> {
    const rows = await this.db
      .select()
      .from(fraudSignals)
      .where(
        and(
          eq(fraudSignals.subjectType, subjectType),
          eq(fraudSignals.subjectPublicId, subjectPublicId),
          eq(fraudSignals.ruleCode, ruleCode),
          eq(fraudSignals.windowEndedAt, at(windowEndedAt)),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toFraudSignal(row);
  }

  async insert(row: FraudSignalRow): Promise<FraudSignalRow> {
    try {
      const inserted = await this.db
        .insert(fraudSignals)
        .values({
          id: row.id,
          subjectType: row.subjectType,
          subjectPublicId: row.subjectPublicId,
          ruleCode: row.ruleCode,
          severity: row.severity,
          windowStartedAt: at(row.windowStartedAt),
          windowEndedAt: at(row.windowEndedAt),
          observedCount: row.observedCount,
          thresholdCount: row.thresholdCount,
          rulesetVersion: row.rulesetVersion,
          raisedAt: at(row.raisedAt),
          traceId: row.traceId ?? null,
        })
        .returning();
      return toFraudSignal(inserted[0] as FraudSignalRecord);
    } catch (error) {
      return translate(error);
    }
  }

  async list(filter: FraudSignalFilter): Promise<readonly FraudSignalRow[]> {
    const conditions = [
      filter.subjectType === undefined ? undefined : eq(fraudSignals.subjectType, filter.subjectType),
      filter.subjectPublicId === undefined
        ? undefined
        : eq(fraudSignals.subjectPublicId, filter.subjectPublicId),
      filter.ruleCode === undefined ? undefined : eq(fraudSignals.ruleCode, filter.ruleCode),
    ].filter((condition) => condition !== undefined);

    const rows = await this.db
      .select()
      .from(fraudSignals)
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(asc(fraudSignals.raisedAt), asc(fraudSignals.id));
    return rows.map(toFraudSignal);
  }
}

// ---------------------------------------------------------------------------
// المعالجةُ الواحدة
// ---------------------------------------------------------------------------

/**
 * سجلُّ المعالجة الواحدة — وموضعُ انحرافين مُعلَنين بين المجال والعقد.
 *
 * العقدُ مُجمَّدٌ منذ المراجعة 1/6، وصفُّه يحمل ما لا يحمله نموذجُ المجال والعكس. وبدل
 * أن يُفتَح العقدُ أو يُكذَب المُهيئ، الانحرافان مُعلَنان هنا وفي
 * `docs/02-architecture/REPUTATION_PERSISTENCE.md` §الانحرافات:
 *
 *   1. **`operation` ↔ `scope`**: نفسُ المعنى باسمين. تُترجَم في هذا الموضع وحده،
 *      ونفسُ الترجمة قائمةٌ في خدمة التفاوض.
 *   2. **`response_status` و`response_body`** — انحرافٌ **مقفولٌ في المراجعة 4/6**. كانا
 *      يُكتبان `200` و`{}` حين لم يكن للخدمة مدخلٌ يُنتج جواباً، وصارا يُكتبان من
 *      `recordedResponse` ويُقرأان في `find()` — فالانحرافُ اليوم **ترجمةٌ مُسمّاة** لا
 *      دَيناً: عمودان في القاعدة يقابلان حقلاً واحداً مركّباً في المجال، لأنّهما لا يُقرأان
 *      إلّا معاً ولا معنى لأحدهما دون الآخر.
 *
 * والقراءةُ لا تُخلّ بمطابقة المُهيئين: مُهيئُ الذاكرة يحفظ نفسَ الحقل ويُعيده، فـ`find()`
 * في الموضعين تُعيد الشيءَ نفسَه حرفياً، والحرّاسُ تقيس تساوياً حقيقيّاً لا مُتغاضى عنه.
 *
 * و`ON CONFLICT DO NOTHING`: أوّلُ إدراجٍ يفوز. نفسُ سلوك مُهيئ الذاكرة بعد مواءمة
 * المراجعة 3/6 — والبديلُ (خطأُ مفتاحٍ مكرّر) كان سيرمي `reputation_idempotency_pkey`،
 * وهو اسمٌ ليس في `ENFORCED_CONSTRAINTS` فيصعد خطأً خاماً على أمرٍ عاديٍّ هو تسابقُ
 * طلبين بنفس المفتاح.
 */
export class PostgresIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly db: DbOrTx) {}

  async find(idempotencyKey: string): Promise<ReputationIdempotencyRow | null> {
    const rows = await this.db
      .select({
        idempotencyKey: reputationIdempotency.idempotencyKey,
        scope: reputationIdempotency.scope,
        payloadFingerprint: reputationIdempotency.payloadFingerprint,
        subjectPublicId: reputationIdempotency.subjectPublicId,
        responseStatus: reputationIdempotency.responseStatus,
        responseBody: reputationIdempotency.responseBody,
        createdAt: reputationIdempotency.createdAt,
      })
      .from(reputationIdempotency)
      .where(eq(reputationIdempotency.idempotencyKey, idempotencyKey))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      idempotencyKey: row.idempotencyKey,
      operation: row.scope,
      requestFingerprint: row.payloadFingerprint,
      subjectPublicId: row.subjectPublicId,
      recordedResponse: { status: row.responseStatus, payload: row.responseBody },
      createdAt: need(row.createdAt),
    };
  }

  async insert(row: ReputationIdempotencyRow): Promise<ReputationIdempotencyRow> {
    try {
      await this.db
        .insert(reputationIdempotency)
        .values({
          idempotencyKey: row.idempotencyKey,
          scope: row.operation,
          subjectPublicId: row.subjectPublicId,
          payloadFingerprint: row.requestFingerprint,
          responseStatus: row.recordedResponse.status,
          /**
           * جسمٌ يُحفظ كما ورد — و`JSONB` يقبل `null` والرقمَ والنصَ لا الكائناتِ فقط.
           *
           * ولا فحصَ شكلٍ هنا: المُهيئ لا يعرف ماذا أراد من نادى، وفحصٌ من جنس
           * «لابدّ أن يكون كائناً» كان سيرفض جواباً سليماً لمدخلٍ لم يُولَد بعد.
           */
          responseBody: row.recordedResponse.payload as never,
          createdAt: at(row.createdAt),
        })
        .onConflictDoNothing();
    } catch (error) {
      return translate(error);
    }
    const stored = await this.find(row.idempotencyKey);
    return stored ?? row;
  }
}

// ---------------------------------------------------------------------------
// صندوقُ الصادر
// ---------------------------------------------------------------------------

/**
 * كتابةُ الأحداث في **نفس** معاملة القرار.
 *
 * لا نشرَ ولا `fetch`: الصفُّ يُكتب و`published_at` يبقى `NULL` حتى يأتي ناشرٌ ليس من
 * هذه المرحلة. و`id` هو `event_id` نفسُه لا مُعرّفاً جديداً: الحدثُ يُبنى مرّةً بمُعرّفٍ
 * من المولّد، فلو أعادت محاولةٌ نفسَ الحدث لصار المفتاحُ الأساسيّ هو ما يمنع نشرَه
 * مرّتين، بلا جدولِ إزالةِ تكرارٍ إضافيّ.
 *
 * و`occurred_at` يُنسَخ من مغلّف الحدث لا من `at`: `at` لحظةُ الكتابة، و`occurred_at`
 * لحظةُ الحدث. خلطُهما كان سيجعل ناشراً يرتّب بالأقدم يُصدر ترتيباً يتغيّر بتأخّر نبضة.
 */
export class PostgresReputationOutbox implements OutboxPort {
  constructor(private readonly db: DbOrTx) {}

  async append(events: readonly ReputationDomainEvent[], appendedAt: string): Promise<void> {
    if (events.length === 0) return;
    const values = events.map((event) => ({
      id: event.event_id,
      aggregateType: event.aggregate.type,
      aggregateId: event.aggregate.id,
      eventType: event.event_type,
      eventVersion: event.event_version,
      payload: event as unknown as Record<string, unknown>,
      occurredAt: at(event.occurred_at),
      traceId: event.trace_id,
      createdAt: at(appendedAt),
    }));
    try {
      await this.db.insert(reputationOutbox).values(values).onConflictDoNothing();
    } catch (error) {
      return translate(error);
    }
  }
}

/**
 * قراءةُ الصندوق للاختبارات والتشخيص — ليست منفذاً في `ports.ts`.
 *
 * حالاتُ الاستخدام لا تقرأ الصندوق أبداً (وإلّا صار قراراً يعتمد على أثرِه)، لكن حزمةَ
 * المطابقة تحتاج أن تُقارن ما دخل الصندوق في المُهيئين. ولذلك تعيش الدالّةُ هنا لا في
 * المنفذ.
 */
export async function readOutbox(
  db: DbOrTx,
): Promise<readonly { readonly eventType: string; readonly payload: unknown }[]> {
  const rows = await db
    .select({
      eventType: reputationOutbox.eventType,
      payload: reputationOutbox.payload,
      occurredAt: reputationOutbox.occurredAt,
      id: reputationOutbox.id,
    })
    .from(reputationOutbox)
    .where(isNull(reputationOutbox.publishedAt))
    .orderBy(asc(reputationOutbox.occurredAt), asc(reputationOutbox.id));
  return rows.map((row) => ({ eventType: row.eventType, payload: row.payload }));
}

/** عددُ صفوف الصندوق — يستعمله اختبارُ الذرّية للتأكّد أنّ التراجع لم يُبقِ أثراً. */
export async function countOutbox(db: DbOrTx): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(reputationOutbox);
  return rows[0]?.total ?? 0;
}
