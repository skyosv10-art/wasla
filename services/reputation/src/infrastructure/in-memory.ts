/**
 * مُهيئاتُ الذاكرة — تفرض **كلَّ** قيدٍ مُسمّى في `schema.sql` بنفس الأسماء.
 *
 * الغرضُ ليس «مخزناً للاختبارات». الغرضُ أن تكون حزمةُ اختبارات المجال كلُّها قابلةً
 * للتشغيل على جهازٍ لا شيءَ مُثبّتٌ فيه، وأن يكون ما تُثبته صحيحاً على Postgres أيضاً —
 * ولذلك ترفض هذه المخازن ما ترفضه القاعدة، **باسم القيد** (انظر `constraints.ts`).
 * وحزمةُ مطابقةٍ في المراجعة 3/6 ستُشغّل نفس اختبارات حالات الاستخدام على المُهيئين معاً،
 * فتتحوّل «الذاكرةُ تُحاكي القيود» من دعوى إلى فحص.
 *
 * ## ثلاثةُ أشياء لا تفعلها هذه المخازن
 *
 * **لا تسأل الساعة.** كلُّ لحظةٍ تدخل وسيطاً. مخزنٌ يُختم صفّاً بـ`Date.now()` يجعل
 * اختبارَ نبضةٍ ينتظر الزمنَ الحقيقيّ.
 *
 * **لا تُصلح مدخلاً.** لا تشذيبَ نصٍّ ولا تعويضَ حقلٍ غائبٍ بقيمةٍ افتراضية. المدخلُ
 * الناقصُ يُرفَض في المجال قبل الوصول هنا، ومخزنٌ «ودود» يُخفي علّةً في حالة استخدام.
 *
 * **لا تُرتّب عشوائياً.** كلُّ قراءةٍ تُعيد ترتيباً حتميّاً مُصرَّحاً به، لأنّ اختبارَ
 * مطابقةٍ يقارن قائمتين لا يجوز أن يفشل بحسب ترتيب إدراج.
 */

import type { FraudRuleCode, ReputationSubjectType } from "../domain/contract-sets.js";
import type { ReputationDomainEvent } from "../domain/events.js";
import type {
  FraudSignalRow,
  ReputationFactRow,
  ReputationIdempotencyRow,
  ReputationRatingRow,
  ReputationRulesetRow,
  ReputationScoreRow,
} from "../domain/model.js";
import { SEEDED_RULESETS } from "../domain/ruleset.js";
import { toEpochMillis } from "../domain/time.js";
import {
  enforceFactSourceUnique,
  enforceFraudSignalConstraints,
  enforceRatingConstraints,
  enforceRulesetConstraints,
  enforceScoreConstraints,
  factSourceUniqueKey,
  fraudSignalRuleWindowKey,
  ratingOrderPairKey,
  scorePrimaryKey,
} from "./constraints.js";
import type {
  Clock,
  FactFilter,
  FactRepository,
  FactSourceKey,
  FraudSignalFilter,
  FraudSignalRepository,
  IdGenerator,
  IdempotencyRepository,
  OutboxPort,
  RatingFilter,
  RatingRepository,
  ReputationDependencies,
  RulesetRepository,
  ScoreRepository,
} from "../ports.js";

// ---------------------------------------------------------------------------
// الساعة والمُعرّفات — حتميّتان بالكامل
// ---------------------------------------------------------------------------

/**
 * ساعةٌ تُدفَع بيدٍ.
 *
 * لا `sleep` في أي اختبارٍ في هذه الحزمة: من أراد أن يمرّ يومان يستدعي `advanceDays(2)`.
 * اختبارُ تلاشٍ ينتظر ثلاثين يوماً حقيقياً اختبارٌ لا يُكتب، ونصفُ عمرٍ 180 يوماً لا
 * يُختبَر إلّا بساعةٍ تُدفَع.
 */
export class ManualClock implements Clock {
  private current: number;

  constructor(start: string) {
    this.current = toEpochMillis(start, "start");
  }

  now(): string {
    return new Date(this.current).toISOString();
  }

  set(instant: string): void {
    this.current = toEpochMillis(instant, "instant");
  }

  advanceMillis(millis: number): void {
    this.current += millis;
  }

  advanceHours(hours: number): void {
    this.advanceMillis(hours * 3_600_000);
  }

  advanceDays(days: number): void {
    this.advanceMillis(days * 86_400_000);
  }
}

/**
 * مُعرّفاتٌ متتاليةٌ بصيغة UUID.
 *
 * تُنتج قيَماً تُطابق نمطَ UUID شكلاً وتُقرأ للإنسان (`...-000000000007`)، فيُقارن
 * الاختبارُ مُعرّفاً بعينه بلا `expect.any(String)`. و`expect.any` في موضع المُعرّف يعني
 * أنّ الاختبار لا يعرف أيّ صفٍّ يفحص، وهو أوّلُ ما يجعل اختبارَ تكرارٍ ينجح على صفّين
 * مختلفين.
 */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = "00000000-0000-4000-8000-") {}

  uuid(): string {
    this.counter += 1;
    return `${this.prefix}${String(this.counter).padStart(12, "0")}`;
  }
}

// ---------------------------------------------------------------------------
// نسخُ القواعد
// ---------------------------------------------------------------------------

export class InMemoryRulesetRepository implements RulesetRepository {
  private readonly rows = new Map<number, ReputationRulesetRow>();

  constructor(seed: readonly ReputationRulesetRow[] = SEEDED_RULESETS) {
    for (const row of seed) this.rows.set(row.rulesetVersion, enforceRulesetConstraints(row));
  }

  async find(rulesetVersion: number): Promise<ReputationRulesetRow | null> {
    return this.rows.get(rulesetVersion) ?? null;
  }

  async list(): Promise<readonly ReputationRulesetRow[]> {
    return [...this.rows.values()].sort((a, b) => a.rulesetVersion - b.rulesetVersion);
  }

  /**
   * النسخةُ النشطة = **أعلى نسخةٍ مجمَّدة**.
   *
   * «أعلى نسخة» وحدها كانت ستختار نسخةً قيدَ التحرير لحظةَ إدراجها فتُحسب النتائج بأحكامٍ
   * لم تُجمَّد بعد؛ و«النسخة 1» ثابتةً كانت ستجعل إصدار نسخة 2 بلا أثر.
   */
  async findActive(): Promise<ReputationRulesetRow | null> {
    const frozen = [...this.rows.values()].filter((row) => row.isFrozen);
    if (frozen.length === 0) return null;
    return frozen.reduce((best, row) => (row.rulesetVersion > best.rulesetVersion ? row : best));
  }
}

// ---------------------------------------------------------------------------
// الدفتر
// ---------------------------------------------------------------------------

function byOccurredAtThenSequence(
  left: ReputationFactRow,
  right: ReputationFactRow,
): number {
  const byInstant =
    toEpochMillis(left.occurredAt, "occurred_at") - toEpochMillis(right.occurredAt, "occurred_at");
  if (byInstant !== 0) return byInstant;
  if (left.sourceSequence !== right.sourceSequence) return left.sourceSequence - right.sourceSequence;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export class InMemoryFactRepository implements FactRepository {
  private readonly rows: ReputationFactRow[] = [];
  private readonly sourceKeys = new Map<string, ReputationFactRow>();

  async findBySource(key: FactSourceKey): Promise<ReputationFactRow | null> {
    return this.sourceKeys.get(factSourceUniqueKey(key)) ?? null;
  }

  async insert(row: ReputationFactRow): Promise<ReputationFactRow> {
    const key = factSourceUniqueKey(row);
    enforceFactSourceUnique(this.sourceKeys.get(key) ?? null);
    const frozen = Object.freeze({ ...row });
    this.rows.push(frozen);
    this.sourceKeys.set(key, frozen);
    return frozen;
  }

  async listBySubject(
    subjectType: ReputationSubjectType,
    subjectPublicId: string,
  ): Promise<readonly ReputationFactRow[]> {
    return this.rows
      .filter((row) => row.subjectType === subjectType && row.subjectPublicId === subjectPublicId)
      .sort(byOccurredAtThenSequence);
  }

  async list(filter: FactFilter): Promise<readonly ReputationFactRow[]> {
    return this.rows
      .filter(
        (row) =>
          (filter.subjectType === undefined || row.subjectType === filter.subjectType) &&
          (filter.subjectPublicId === undefined || row.subjectPublicId === filter.subjectPublicId) &&
          (filter.orderPublicId === undefined || row.orderPublicId === filter.orderPublicId) &&
          (filter.factKind === undefined || row.factKind === filter.factKind),
      )
      .sort(byOccurredAtThenSequence);
  }

  async latestSourceSequence(
    subjectType: ReputationSubjectType,
    subjectPublicId: string,
    orderPublicId: string,
  ): Promise<number | null> {
    const matching = this.rows.filter(
      (row) =>
        row.subjectType === subjectType &&
        row.subjectPublicId === subjectPublicId &&
        row.orderPublicId === orderPublicId,
    );
    if (matching.length === 0) return null;
    return matching.reduce((max, row) => (row.sourceSequence > max ? row.sourceSequence : max), 0);
  }

  async findOrderCompletion(orderPublicId: string): Promise<ReputationFactRow | null> {
    const matching = this.rows
      .filter((row) => row.orderPublicId === orderPublicId && row.factKind === "order_completed")
      .sort(byOccurredAtThenSequence);
    return matching[0] ?? null;
  }
}

// ---------------------------------------------------------------------------
// النتائج
// ---------------------------------------------------------------------------

export class InMemoryScoreRepository implements ScoreRepository {
  private readonly rows = new Map<string, ReputationScoreRow>();

  async find(
    subjectType: ReputationSubjectType,
    subjectPublicId: string,
  ): Promise<ReputationScoreRow | null> {
    return this.rows.get(scorePrimaryKey({ subjectType, subjectPublicId })) ?? null;
  }

  async upsert(row: ReputationScoreRow): Promise<ReputationScoreRow> {
    const frozen = Object.freeze({ ...enforceScoreConstraints(row) });
    this.rows.set(scorePrimaryKey(frozen), frozen);
    return frozen;
  }

  /**
   * المستحقّون، مُرتّبين بـ`nextRecomputeAt` تصاعدياً ثم بالمفتاح.
   *
   * ترتيبٌ حتميّ: نبضةٌ بـ`limit` تُعالج الأقدمَ استحقاقاً أوّلاً، فلا يُترك صفٌّ متأخّرٌ
   * أبداً لأنّ صفّاً آخر يسبقه في ترتيب الإدراج. وبلا هذا الترتيب يصير `limit` سبباً في
   * جَوعٍ دائمٍ لبعض الصفوف بلا أن يظهر شيءٌ في السجلّ.
   */
  async listDueForRecompute(now: string, limit: number): Promise<readonly ReputationScoreRow[]> {
    const nowMillis = toEpochMillis(now, "now");
    return [...this.rows.values()]
      .filter((row) => toEpochMillis(row.nextRecomputeAt, "next_recompute_at") <= nowMillis)
      .sort((left, right) => {
        const byDue =
          toEpochMillis(left.nextRecomputeAt, "next_recompute_at") -
          toEpochMillis(right.nextRecomputeAt, "next_recompute_at");
        if (byDue !== 0) return byDue;
        const leftKey = scorePrimaryKey(left);
        const rightKey = scorePrimaryKey(right);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      })
      .slice(0, limit);
  }
}

// ---------------------------------------------------------------------------
// التقييمات
// ---------------------------------------------------------------------------

export class InMemoryRatingRepository implements RatingRepository {
  private readonly rows: ReputationRatingRow[] = [];
  private readonly orderPairs = new Map<string, ReputationRatingRow>();

  async findByOrderPair(
    orderPublicId: string,
    raterPublicId: string,
    subjectPublicId: string,
  ): Promise<ReputationRatingRow | null> {
    return this.orderPairs.get(ratingOrderPairKey({ orderPublicId, raterPublicId, subjectPublicId })) ?? null;
  }

  async insert(row: ReputationRatingRow): Promise<ReputationRatingRow> {
    const key = ratingOrderPairKey(row);
    enforceRatingConstraints(row, this.orderPairs.get(key) ?? null);
    const frozen = Object.freeze({ ...row });
    this.rows.push(frozen);
    this.orderPairs.set(key, frozen);
    return frozen;
  }

  async list(filter: RatingFilter): Promise<readonly ReputationRatingRow[]> {
    return this.rows
      .filter(
        (row) =>
          (filter.subjectType === undefined || row.subjectType === filter.subjectType) &&
          (filter.subjectPublicId === undefined || row.subjectPublicId === filter.subjectPublicId) &&
          (filter.orderPublicId === undefined || row.orderPublicId === filter.orderPublicId),
      )
      .sort(bySubmittedAtThenId);
  }

  async listByRater(raterPublicId: string): Promise<readonly ReputationRatingRow[]> {
    return this.rows.filter((row) => row.raterPublicId === raterPublicId).sort(bySubmittedAtThenId);
  }
}

function bySubmittedAtThenId(left: ReputationRatingRow, right: ReputationRatingRow): number {
  const byInstant =
    toEpochMillis(left.submittedAt, "submitted_at") - toEpochMillis(right.submittedAt, "submitted_at");
  if (byInstant !== 0) return byInstant;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// إشارات الاحتيال
// ---------------------------------------------------------------------------

export class InMemoryFraudSignalRepository implements FraudSignalRepository {
  private readonly rows: FraudSignalRow[] = [];
  private readonly ruleWindows = new Map<string, FraudSignalRow>();

  async findByRuleWindow(
    subjectType: ReputationSubjectType,
    subjectPublicId: string,
    ruleCode: FraudRuleCode,
    windowEndedAt: string,
  ): Promise<FraudSignalRow | null> {
    return (
      this.ruleWindows.get(
        fraudSignalRuleWindowKey({ subjectType, subjectPublicId, ruleCode, windowEndedAt }),
      ) ?? null
    );
  }

  async insert(row: FraudSignalRow): Promise<FraudSignalRow> {
    const key = fraudSignalRuleWindowKey(row);
    enforceFraudSignalConstraints(row, this.ruleWindows.get(key) ?? null);
    const frozen = Object.freeze({ ...row });
    this.rows.push(frozen);
    this.ruleWindows.set(key, frozen);
    return frozen;
  }

  async list(filter: FraudSignalFilter): Promise<readonly FraudSignalRow[]> {
    return this.rows
      .filter(
        (row) =>
          (filter.subjectType === undefined || row.subjectType === filter.subjectType) &&
          (filter.subjectPublicId === undefined || row.subjectPublicId === filter.subjectPublicId) &&
          (filter.ruleCode === undefined || row.ruleCode === filter.ruleCode),
      )
      .sort((left, right) => {
        const byInstant =
          toEpochMillis(left.raisedAt, "raised_at") - toEpochMillis(right.raisedAt, "raised_at");
        if (byInstant !== 0) return byInstant;
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
      });
  }
}

// ---------------------------------------------------------------------------
// المعالجة الواحدة
// ---------------------------------------------------------------------------

export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly rows = new Map<string, ReputationIdempotencyRow>();

  async find(idempotencyKey: string): Promise<ReputationIdempotencyRow | null> {
    return this.rows.get(idempotencyKey) ?? null;
  }

  async insert(row: ReputationIdempotencyRow): Promise<ReputationIdempotencyRow> {
    const frozen = Object.freeze({ ...row });
    this.rows.set(row.idempotencyKey, frozen);
    return frozen;
  }
}

// ---------------------------------------------------------------------------
// صندوق الصادر
// ---------------------------------------------------------------------------

/**
 * صندوقٌ في الذاكرة يُراكم ما كان سيُكتب في `reputation_outbox`.
 *
 * لا نشرَ ولا `fetch`: `appended` قائمةٌ تُفحَص. وهذا وحده ما يجعل الاختبار قادراً على
 * تأكيد «حدثٌ **واحد** لطلبٍ مكتمل، لا صفرٌ ولا اثنان» — وهي عبارةُ بوّابة خروج الطور
 * (المراجعة 6/6) بعينها.
 */
export class InMemoryOutbox implements OutboxPort {
  readonly appended: { readonly event: ReputationDomainEvent; readonly at: string }[] = [];

  async append(events: readonly ReputationDomainEvent[], at: string): Promise<void> {
    for (const event of events) this.appended.push({ event, at });
  }

  eventsOfType(eventType: string): readonly ReputationDomainEvent[] {
    return this.appended.filter((entry) => entry.event.event_type === eventType).map((e) => e.event);
  }

  clear(): void {
    this.appended.length = 0;
  }
}

// ---------------------------------------------------------------------------
// التركيب
// ---------------------------------------------------------------------------

export interface InMemoryReputationDependencies extends ReputationDependencies {
  readonly clock: ManualClock;
  readonly ids: SequentialIdGenerator;
  readonly rulesets: InMemoryRulesetRepository;
  readonly facts: InMemoryFactRepository;
  readonly scores: InMemoryScoreRepository;
  readonly ratings: InMemoryRatingRepository;
  readonly fraudSignals: InMemoryFraudSignalRepository;
  readonly idempotency: InMemoryIdempotencyRepository;
  readonly outbox: InMemoryOutbox;
}

/**
 * تبعيّاتٌ كاملةٌ في الذاكرة بلحظةِ بدايةٍ مُعلَنة.
 *
 * لحظةُ البداية وسيطٌ إلزاميٌّ افتراضُه ثابتٌ مكتوب، لا `new Date()`: اختبارٌ يبدأ من
 * «الآن» يفشل يومَ يتغيّر اليوم، ونافذةُ الاحتيال سلّةٌ يوميةٌ فيكون الفشلُ عند منتصف
 * الليل بالضبط — وهو أسوأُ أنواع التقلّب: يُعاد تشغيلُه صباحاً فينجح.
 */
export function createInMemoryReputationDependencies(options: {
  readonly startAt?: string;
  readonly rulesets?: readonly ReputationRulesetRow[];
} = {}): InMemoryReputationDependencies {
  return {
    clock: new ManualClock(options.startAt ?? "2026-03-01T09:00:00.000Z"),
    ids: new SequentialIdGenerator(),
    rulesets: new InMemoryRulesetRepository(options.rulesets ?? SEEDED_RULESETS),
    facts: new InMemoryFactRepository(),
    scores: new InMemoryScoreRepository(),
    ratings: new InMemoryRatingRepository(),
    fraudSignals: new InMemoryFraudSignalRepository(),
    idempotency: new InMemoryIdempotencyRepository(),
    outbox: new InMemoryOutbox(),
  };
}
