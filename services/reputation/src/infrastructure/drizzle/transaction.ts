/**
 * وحدةُ العمل على PostgreSQL لخدمة السمعة — المالكُ الوحيد لحدود المعاملة.
 *
 * ## لماذا معاملةٌ واحدةٌ لكل قرار
 *
 * قرارٌ واحدٌ في هذه الخدمة يكتب أكثرَ من جدول: تسجيلُ واقعةٍ يكتب `reputation_facts`
 * ثمّ `reputation_scores` ثمّ `reputation_outbox`، ونبضةٌ تكتب نتائجَ وإشاراتٍ وأحداثاً.
 * وبقاءُ نصفِ ذلك مقروءاً ليس عطلاً مؤقّتاً بل رقمٌ خاطئ يبقى: واقعةٌ سُجّلت ونتيجةٌ لم
 * تُحدَّث تعني سمعةً تنقص واقعةً بلا أن يشتكي شيء، ونتيجةٌ تغيّرت وحدثٌ لم يدخل الصندوق
 * تعني مستهلكاً لن يعرف أبداً أنّ الرتبة تغيّرت.
 *
 * ## ولماذا `read()` بلا معاملة
 *
 * القراءةُ لا تحتاج ذرّيةً، واحتجازُ اتصالِ معاملةٍ لقراءةٍ يُطيل القفلَ بلا مقابل. ومع
 * ذلك تُبنى المُهيئاتُ هنا أيضاً: القارئُ يرى **نفسَ** المنافذ التي يراها الكاتب على
 * اتصال الجذر، فلا يتسرّب SQL إلى طبقة الاستخدام في مسارٍ ولا في آخر.
 *
 * ولا يجوز لمستودعٍ ولا لحالة استخدامٍ أن تستدعي `db.transaction` مباشرة. لو فعلت لصارت
 * الحدودُ موزّعةً بين طبقاتٍ لا تعرف ترتيبَ الكتابات، ولالتزم جزءٌ من قرارٍ قبل أن يفشل
 * الجزءُ التالي — وذاك بعينه ما يفحصه `atomicity.integration.test.ts`.
 */

import type { Clock, IdGenerator, ReputationDependencies } from "../../ports.js";
import type { OutboxDrainRunner, OutboxDrainStore } from "../../outbound/drain-outbox.js";
import type { Db, DbOrTx } from "./db.js";
import {
  PostgresFactRepository,
  PostgresFraudSignalRepository,
  PostgresIdempotencyRepository,
  PostgresOutboxDrainStore,
  PostgresRatingRepository,
  PostgresReputationOutbox,
  PostgresRulesetRepository,
  PostgresScoreRepository,
} from "./repository.js";

/**
 * ما لا تملكه القاعدةُ ولا يجوز تبديلُه داخل المعاملة.
 *
 * الساعةُ والمُعرّفات فقط — ولا منفذَ خارجيّ واحد. وهذا الغيابُ مقصودٌ ومُعلَن: السمعةُ
 * مستهلكٌ لا مُستعلِم، ولا منفذَ لها يقرأ طلباً ولا يكتب في مِلك غيره ولا ينشر على ناقل
 * (ADR-014 · `ports.ts` §اتّجاه التبعية). فلو ظهر يوماً حقلٌ ثالثٌ في هذه الواجهة اسمُه
 * `orders` أو `bus`، فذاك تغييرُ عمارةٍ يحتاج ADR لا إضافةَ سطر.
 */
export interface ReputationSharedDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** المجموعةُ الكاملة التي تراها حالاتُ الاستخدام. */
export type ReputationUnitOfWorkDeps = ReputationDependencies;

/**
 * السياقُ المُسلَّم إلى العملية.
 *
 * `db` معروضٌ للتشخيص واختبارات الذرّية وحدها؛ العملُ الطبيعيّ يستعمل `deps` كي يبقى
 * محمولاً إلى مُهيئ الذاكرة ولا يتسرّب SQL إلى طبقة الاستخدام.
 */
export interface ReputationUnitOfWorkContext {
  readonly db: DbOrTx;
  readonly deps: ReputationUnitOfWorkDeps;
}

/**
 * يربط كلَّ منافذ التخزين بموصلٍ واحدٍ أو معاملةٍ واحدة.
 *
 * إنشاءُ المُهيئات هنا لا في كل حالة استخدام هو ما يضمن أنّ الواقعةَ والنتيجةَ والصندوقَ
 * داخل `run()` تتحدّث إلى `tx` نفسِه. والبديلُ الذي يبني مستودعاً من `db` الجذر في كل
 * خطوةٍ يبدو صحيحاً في اختبارٍ ناجح ثمّ يفسد أوّلَ تراجعٍ: الكتابةُ السابقة تكون قد
 * التزمت فعلاً.
 */
export function bindReputationAdapters(
  db: DbOrTx,
  shared: ReputationSharedDeps,
): ReputationUnitOfWorkDeps {
  return {
    rulesets: new PostgresRulesetRepository(db),
    facts: new PostgresFactRepository(db),
    scores: new PostgresScoreRepository(db),
    ratings: new PostgresRatingRepository(db),
    fraudSignals: new PostgresFraudSignalRepository(db),
    idempotency: new PostgresIdempotencyRepository(db),
    outbox: new PostgresReputationOutbox(db),
    ...shared,
  };
}

export class PostgresReputationUnitOfWork {
  constructor(private readonly db: Db) {}

  /**
   * يُشغّل كتابةً في معاملةٍ واحدة.
   *
   * لا يلتقط هذا المستوى خطأً ولا يترجمه: ترجمةُ القيود في المستودع، وأيُّ خطأٍ يصعد هو
   * قرارُ تراجعٍ كامل. و`catch` هنا كان سيُنتج أسوأَ ما يمكن: معاملةٌ التزمت نصفَ قرارٍ
   * لأنّ أحداً «عالج» الخطأ.
   */
  async run<T>(
    shared: ReputationSharedDeps,
    operation: (context: ReputationUnitOfWorkContext) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) =>
      operation({ db: tx, deps: bindReputationAdapters(tx, shared) }),
    );
  }

  /** يُشغّل قراءةً بلا `BEGIN`/`COMMIT` وبلا حجزِ اتصال معاملة. */
  async read<T>(
    shared: ReputationSharedDeps,
    operation: (context: ReputationUnitOfWorkContext) => Promise<T>,
  ): Promise<T> {
    return operation({ db: this.db, deps: bindReputationAdapters(this.db, shared) });
  }
}

/**
 * مُشغّلُ تصريفِ الصندوق على PostgreSQL (المراجعة 5/6).
 *
 * ## لِمَ مُشغّلٌ منفصلٌ عن `PostgresReputationUnitOfWork`
 *
 * الفرقُ ليس تنظيماً بل عقدَ معاملة. معاملةُ القرار تكتب واقعةً ونتيجةً وحدثاً ثمّ تلتزم
 * فوراً، ولا تنتظر شيئاً خارج القاعدة. ومعاملةُ التصريف **تنتظر شبكةً** بين الاحتجاز
 * والالتزام، وذاك ثمنٌ لا يجوز أن يُدفع في مسار الطلب.
 *
 * ودمجُهما في مُشغّلٍ واحدٍ كان سيُغري بأسوأِ نسخةٍ ممكنة: أن يُصرَّف الصندوقُ في نفس
 * معاملة تسجيل الواقعة. وحينئذٍ يصير عطلُ الناقل تراجعاً يمحو سمعةً صحيحة — وهو بعينه
 * ما وُجد صندوقُ الصادر ليمنعه.
 *
 * ولذلك لا يظهر هذا المُشغّلُ في `ReputationDependencies` ولا في `ReputationSharedDeps`:
 * حالاتُ الاستخدام لا تعرف أنّ للصندوق مُصرّفاً، ولا يمكنها استدعاؤه ولو أرادت.
 *
 * ولا يزيد هذا الملفُّ عن استدعاءٍ واحدٍ لـ`db.transaction` كما في `run()` أعلاه: القاعدةُ
 * أنّ هذا الملفَّ وحده يفتح المعاملات، وهي تبقى صحيحةً حرفيّاً بعد هذه الإضافة.
 */
export class PostgresOutboxDrainRunner implements OutboxDrainRunner {
  constructor(private readonly db: Db) {}

  async drain<T>(work: (store: OutboxDrainStore) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => work(new PostgresOutboxDrainStore(tx)));
  }
}
