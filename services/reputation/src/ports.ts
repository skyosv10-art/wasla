/**
 * المنافذ (حدودُ العمارة السداسية) لمجال السمعة وإشارات الاحتيال.
 *
 * حالاتُ الاستخدام تعتمد على هذه الواجهات وحدها. والمُهيئاتُ تقيم في `./infrastructure`:
 * مخازنُ الذاكرة هنا (المراجعة 2/6)، ومستودعاتُ Drizzle/Postgres في المراجعة 3/6 مع
 * حزمةِ مطابقةٍ تُشغّل **نفس** اختبارات حالات الاستخدام على المُهيئين — فلا يعني «نجح في
 * الذاكرة» يوماً «نجح».
 *
 * ## اتّجاه التبعية (ADR-014)
 *
 *   - السمعةُ **مستهلكٌ** لأحداث محرّك الطلب لا مُستعلِمٌ عنه. ولذلك **لا منفذَ هنا يقرأ
 *     طلباً**: لا `OrderPort` ولا `OrderStatusPort` ولا عميلَ HTTP. سؤالُ «هل اكتمل هذا
 *     الطلب؟» يُجاب **من الدفتر** (`REPUTATION_ORDER_NOT_COMPLETED`)، لأنّ تابعاً
 *     متزامناً هنا كان سيجعل تقييمَ عميلٍ يفشل لأنّ خدمةً أخرى تتعافى — وسمعةٌ تتعطّل
 *     بتعطّل غيرها ليست مصدرَ حقيقةٍ لأحد.
 *   - **ولا منفذَ يكتب في مِلك غيره**: لا كتابةَ في `orders`، ولا في `drivers`، ولا
 *     إيقافَ حسابٍ، ولا تعديلَ أولوية. هذه الخدمة تُنتج أرقاماً وإشاراتٍ ويقرؤها من
 *     يملك القرار (القرار 7 · سابقة `OrderIntakePort` في ADR-009 §3
 *     و`CandidacyProjectionPort` في ADR-012 القرار 3).
 *   - **ولا منفذَ ناقل.** الأحداث تُكتب إلى `reputation_outbox` في **نفس** معاملة القرار
 *     عبر `OutboxPort`، والنشرُ من الصندوق مسؤوليّةُ ناشرٍ ليس من هذه المرحلة (الدَّينُ
 *     المُعلَن نفسه في الأطوار 06 و07 و08). لا `fetch` في هذه الحزمة بحال.
 *
 * ## لماذا كلُّ توقيعٍ يأخذ لحظةً
 *
 * لا دالّةَ مستودعٍ تسأل الساعة. `listDueForRecompute(now)` تأخذ `now`، و`insert` تأخذ
 * لحظةَ التسجيل. مُهيئٌ يقرأ `now()` بنفسه يجعل اختبارَ نبضةٍ ينتظر الزمن الحقيقيّ، فتصير
 * حزمةُ الاختبارات بطيئةً ثم متقلّبةً ثم محذوفة.
 */

import type {
  FraudRuleCode,
  ReputationSubjectType,
} from "./domain/contract-sets.js";
import type { ReputationDomainEvent } from "./domain/events.js";
import type {
  FraudSignalRow,
  ReputationFactRow,
  ReputationIdempotencyRow,
  ReputationRatingRow,
  ReputationRulesetRow,
  ReputationScoreRow,
} from "./domain/model.js";

/** زمنُ الساعة نصّاً ISO-8601. المجال لا يستدعي `Date.now()` أبداً. */
export interface Clock {
  now(): string;
}

/** مُولّد UUID (مُعرّفاتُ الوقائع والتقييمات والإشارات والأحداث). */
export interface IdGenerator {
  uuid(): string;
}

// ---------------------------------------------------------------------------
// نسخُ القواعد
// ---------------------------------------------------------------------------

export interface RulesetRepository {
  find(rulesetVersion: number): Promise<ReputationRulesetRow | null>;
  list(): Promise<readonly ReputationRulesetRow[]>;
  /**
   * النسخةُ التي يُحسب بها الآن.
   *
   * تُعاد **نسخةٌ واحدة** لا قائمةٌ يختار منها المستدعي: لو كان الاختيار عند المستدعي
   * لأمكن أن يُحسب شخصان في نفس النبضة بنسختين، فيُقارَن رقمان لا يقيسان الشيء نفسه.
   */
  findActive(): Promise<ReputationRulesetRow | null>;
}

// ---------------------------------------------------------------------------
// الدفتر
// ---------------------------------------------------------------------------

/**
 * مفتاحُ تفرّدِ الواقعة — نفسُ أعمدة `ux_reputation_facts_source` بنفس ترتيبها.
 *
 * وجودُه نوعاً مُسمّى لا وسائطَ خمسةً متفرّقة مقصود: خمسةُ نصوصٍ وعددٍ في توقيعٍ واحد
 * تُبدَّل اثنان منها بلا أن يشتكي `tsc`، وتبديلُ `factKind` بـ`orderPublicId` هنا يعني
 * فحصَ تفرّدٍ يصمت دائماً — فتُسجَّل الواقعةُ مرّتين ويُضاعَف وزنُها بلا أن يعرف أحد.
 */
export interface FactSourceKey {
  readonly subjectType: ReputationSubjectType;
  readonly subjectPublicId: string;
  readonly factKind: ReputationFactRow["factKind"];
  readonly orderPublicId: string;
  readonly sourceSequence: number;
}

export interface FactFilter {
  readonly subjectType?: ReputationSubjectType;
  readonly subjectPublicId?: string;
  readonly orderPublicId?: string;
  readonly factKind?: ReputationFactRow["factKind"];
}

export interface FactRepository {
  /** الواقعةُ المسجَّلة بنفس مفتاح المصدر، أو غيابُها. أساسُ `duplicate: true`. */
  findBySource(key: FactSourceKey): Promise<ReputationFactRow | null>;
  insert(row: ReputationFactRow): Promise<ReputationFactRow>;
  /**
   * دفترُ شخصٍ كاملاً، مُرتّباً تصاعدياً بـ`occurredAt`.
   *
   * الحسابُ يحتاج الدفتر كلَّه لا آخرَه: التلاشي دالّةٌ في عمر **كل** واقعة، ودفترٌ
   * مقطوعٌ عند مئةٍ يُنتج رقماً يقفز حين تخرج الواقعةُ الأقدم من النافذة. حدُّ الصفحة
   * شأنُ القراءة عبر HTTP لا شأنُ الحساب، ولذلك ليس في هذا التوقيع `limit`.
   */
  listBySubject(
    subjectType: ReputationSubjectType,
    subjectPublicId: string,
  ): Promise<readonly ReputationFactRow[]>;
  list(filter: FactFilter): Promise<readonly ReputationFactRow[]>;
  /**
   * أحدثُ `sourceSequence` مسجَّلٍ لهذا الشخص على هذا الطلب، أو `null`.
   *
   * به يُكتشَف الحدثُ المتأخّرُ في الوصول (`REPUTATION_SOURCE_EVENT_STALE`). والسؤال
   * مربوطٌ بـ(شخصٍ × طلب) لا بالطلب وحده: العميلُ والسائقُ لكلٍّ منهما سلسلةُ انتقالاتٍ
   * تخصّه على نفس الطلب، وخلطُهما كان سيجعل واقعةَ أحدهما تُبطل واقعةَ الآخر.
   */
  latestSourceSequence(
    subjectType: ReputationSubjectType,
    subjectPublicId: string,
    orderPublicId: string,
  ): Promise<number | null>;
  /** هل في الدفتر واقعةُ اكتمالٍ لهذا الطلب؟ أساسُ `REPUTATION_ORDER_NOT_COMPLETED`. */
  findOrderCompletion(orderPublicId: string): Promise<ReputationFactRow | null>;
}

// ---------------------------------------------------------------------------
// النتائج
// ---------------------------------------------------------------------------

export interface ScoreRepository {
  find(
    subjectType: ReputationSubjectType,
    subjectPublicId: string,
  ): Promise<ReputationScoreRow | null>;
  /**
   * كتابةُ النتيجة المحسوبة (إدراجٌ أو تحديث).
   *
   * `upsert` ولا `update` منفصلة: النتيجةُ **مُشتقّةٌ** بالكامل، فلا فرقَ في المعنى بين
   * أوّل حسابٍ وحسابٍ لاحق. ودالّتان كانتا ستُلزما كلَّ مستدعٍ بفرعٍ «هل هي موجودة؟»،
   * وذاك الفرعُ بعينه موضعُ التسابق الذي يُنتج نتيجتين لشخصٍ واحد.
   */
  upsert(row: ReputationScoreRow): Promise<ReputationScoreRow>;
  /**
   * النتائجُ المستحقّةُ لإعادة الحساب عند `now` — فهرسُ النبضة.
   *
   * `limit` إلزاميّ: نبضةٌ تسحب كل الصفوف المستحقّة تُصبح استعلاماً يطول كل يوم، وأوّلُ
   * يومٍ تتأخّر فيه تُصبح النبضةُ التي لا تنتهي.
   */
  listDueForRecompute(now: string, limit: number): Promise<readonly ReputationScoreRow[]>;
}

// ---------------------------------------------------------------------------
// التقييمات
// ---------------------------------------------------------------------------

export interface RatingFilter {
  readonly subjectType?: ReputationSubjectType;
  readonly subjectPublicId?: string;
  readonly orderPublicId?: string;
}

export interface RatingRepository {
  /** التقييمُ المسجَّل لنفس (طلب × مُقيِّم × مُقيَّم) — أعمدةُ `ux_reputation_ratings_order_pair`. */
  findByOrderPair(
    orderPublicId: string,
    raterPublicId: string,
    subjectPublicId: string,
  ): Promise<ReputationRatingRow | null>;
  insert(row: ReputationRatingRow): Promise<ReputationRatingRow>;
  list(filter: RatingFilter): Promise<readonly ReputationRatingRow[]>;
  /** ما **أرسله** هذا الشخص من تقييمات. مدخلُ `rating_extremity_burst` وحدها. */
  listByRater(raterPublicId: string): Promise<readonly ReputationRatingRow[]>;
}

// ---------------------------------------------------------------------------
// إشارات الاحتيال
// ---------------------------------------------------------------------------

export interface FraudSignalFilter {
  readonly subjectType?: ReputationSubjectType;
  readonly subjectPublicId?: string;
  readonly ruleCode?: FraudRuleCode;
}

export interface FraudSignalRepository {
  /**
   * الإشارةُ المرفوعة لهذه (القاعدة × الشخص × نافذة) — أعمدةُ `ux_fraud_signals_rule_window`.
   *
   * وجودُها يعني «رُفعت في هذه النافذة»، ولا تُرفَع ثانية. وليس هذا خطأً ولا تعارضاً:
   * إعادةُ النبضة حالةٌ عادية، وردُّ خطأٍ عليها كان سيُشوّش عدّادَ الأخطاء على أمرٍ يقع كل
   * ساعة (`errors.md` §ما لا يُنتجه أي رمز).
   */
  findByRuleWindow(
    subjectType: ReputationSubjectType,
    subjectPublicId: string,
    ruleCode: FraudRuleCode,
    windowEndedAt: string,
  ): Promise<FraudSignalRow | null>;
  insert(row: FraudSignalRow): Promise<FraudSignalRow>;
  list(filter: FraudSignalFilter): Promise<readonly FraudSignalRow[]>;
}

// ---------------------------------------------------------------------------
// المعالجة الواحدة
// ---------------------------------------------------------------------------

export interface IdempotencyRepository {
  find(idempotencyKey: string): Promise<ReputationIdempotencyRow | null>;
  insert(row: ReputationIdempotencyRow): Promise<ReputationIdempotencyRow>;
}

// ---------------------------------------------------------------------------
// صندوق الصادر
// ---------------------------------------------------------------------------

/**
 * كتابةُ الأحداث في **نفس** معاملة القرار.
 *
 * لا `publish` ولا `send` في هذا المنفذ: الاسمُ `append` لأنّ ما يحدث كتابةٌ في جدول لا
 * إرسالٌ على شبكة. منفذٌ اسمُه `publish` كان سيدعو مُهيئاً يُطلق `fetch` داخل المعاملة،
 * فتُقفل المعاملةُ على مهلةِ شبكةٍ ويُنشَر حدثٌ لقرارٍ سيُلغى بعده.
 */
export interface OutboxPort {
  append(events: readonly ReputationDomainEvent[], at: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// الحزمة التي تُمرَّر إلى حالات الاستخدام
// ---------------------------------------------------------------------------

/**
 * تبعيّاتُ المجال كاملةً في كائنٍ واحد.
 *
 * كلُّ حالةِ استخدامٍ تأخذ هذا الكائن وحمولةً، ولا تأخذ عشرةَ وسائط. وهو ما يجعل إضافةَ
 * منفذٍ في مراجعةٍ لاحقة تغييراً في موضعٍ واحد لا في تسعةِ توقيعات.
 */
export interface ReputationDependencies {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly rulesets: RulesetRepository;
  readonly facts: FactRepository;
  readonly scores: ScoreRepository;
  readonly ratings: RatingRepository;
  readonly fraudSignals: FraudSignalRepository;
  readonly idempotency: IdempotencyRepository;
  readonly outbox: OutboxPort;
}
