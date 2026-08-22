/**
 * وحدة العمل PostgreSQL لخدمة التفاوض.
 *
 * كل عملية تطبيقية كاتبة تدخل `run()` مرة واحدة: فتح الخيط، عرض الجولة، قبولها، أو الإلغاء
 * قد تكتب أكثر من جدول (الخيط، الجولة، الاتفاق، الصادر، ومفتاح التكرار). المعاملة الواحدة
 * تمنع بقاء نصف القرار قابلاً للقراءة، مثل جولة بلا حدث أو اتفاق بلا خيط مغلق.
 *
 * أما `read()` فلا تفتح معاملة. القراءة لا تحتاج الذرية ولا يجوز لها الاحتفاظ باتصال معاملة
 * أطول من الاستعلام؛ ذلك يخفض احتمال قفل غير ضروري ويجعل مسار القراءة قابلاً للقياس بوضوح.
 *
 * لا يجوز لأي مستودع أو استعمال حالة آخر استدعاء `db.transaction` مباشرة. لو فعل، تصبح حدود
 * العملية موزعة بين طبقات لا تعرف ترتيب الكتابات، وقد يلتزم جزء من قرار قبل أن يفشل الجزء
 * التالي. هذه الوحدة هي المالك الوحيد للمعاملة وتحقن نفس محولاتها إلى العملية كلها.
 */

import type {
  AgreedPricePort,
  Clock,
  DispatchOfferPort,
  IdGenerator,
  NegotiationDependencies,
} from '../../ports.js';
import type { Db, DbOrTx } from './db.js';
import {
  PostgresAgreementRepository,
  PostgresMessageRepository,
  PostgresNegotiationIdempotencyStore,
  PostgresNegotiationOutbox,
  PostgresNegotiationPolicyRepository,
  PostgresPriceHandoffRepository,
  PostgresRoundRepository,
  PostgresThreadRepository,
} from './repository.js';

/**
 * التبعيات التي لا تملكها قاعدة البيانات ولا يجب تبديلها داخل المعاملة.
 *
 * يجري حقنها من التطبيق أو مهيئ الاختبار كي تكون الساعة والمعرفات والمنافذ الخارجية واحدة
 * في الذاكرة وPostgreSQL؛ التخزين وحده هو المتغير في اختبار مطابقة المنافذ.
 */
export interface NegotiationSharedDeps {
  readonly offers: DispatchOfferPort;
  readonly agreedPrice: AgreedPricePort;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** المجموعة الكاملة التي تراها استعمالات الحالة. */
export type NegotiationUnitOfWorkDeps = NegotiationDependencies;

/**
 * السياق الذي تسلمه وحدة العمل إلى العملية.
 *
 * يعرض `db` للتشخيص واختبارات الذرية فقط. يجب أن تستعمل العملية `deps` في عملها الطبيعي كي
 * تبقى محمولة إلى محولات الذاكرة ولا تتسرب SQL إلى طبقة الاستعمال.
 */
export interface NegotiationUnitOfWorkContext {
  readonly db: DbOrTx;
  readonly deps: NegotiationUnitOfWorkDeps;
}

/**
 * يربط جميع منافذ التخزين بموصل واحد أو معاملة واحدة.
 *
 * إنشاء المحولات هنا، لا في كل استعمال حالة، يضمن أن جولة وخيطاً وصادراً ضمن `run()` تتحدث
 * إلى `tx` نفسه. البديل الذي ينشئ مستودعاً من `db` العادي في كل خطوة يبدو صحيحاً في اختبار
 * ناجح، لكنه يفسد أول تراجع لأن الكتابة السابقة تكون قد التزمت بالفعل.
 */
export function bindNegotiationAdapters(
  db: DbOrTx,
  shared: NegotiationSharedDeps,
): NegotiationUnitOfWorkDeps {
  return {
    threads: new PostgresThreadRepository(db),
    rounds: new PostgresRoundRepository(db),
    messages: new PostgresMessageRepository(db),
    agreements: new PostgresAgreementRepository(db),
    handoffs: new PostgresPriceHandoffRepository(db),
    policies: new PostgresNegotiationPolicyRepository(db),
    outbox: new PostgresNegotiationOutbox(db),
    idempotency: new PostgresNegotiationIdempotencyStore(db),
    ...shared,
  };
}

/**
 * البوابة الوحيدة لحدود المعاملة في خدمة التفاوض.
 *
 * الكائن قصير العمر على مستوى عملية الطلب. يملك اتصال Drizzle الجذر فقط، ولا يخزن حالة
 * تفاوض أو ساعة أو منفذاً خارجياً بين العمليات؛ لذلك لا يمكن أن تتسرب معاملة قديمة إلى طلب
 * لاحق أو أن تعبر ذاكرة الاختبار بين السيناريوهات.
 */
export class PostgresNegotiationUnitOfWork {
  constructor(private readonly db: Db) {}

  /**
   * يشغّل عملية كتابة في معاملة واحدة.
   *
   * إذا رمى أي مستودع أو منفذ صادر خطأ، يعيد PostgreSQL كل ما سبقه. لا تلتقط هذه الطبقة
   * الخطأ أو تترجمه: ترجمة القيود داخل المستودع، وأخطاء المنافذ الخارجية جزء من قرار التراجع.
   */
  async run<T>(
    shared: NegotiationSharedDeps,
    operation: (context: NegotiationUnitOfWorkContext) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      return operation({
        db: tx,
        deps: bindNegotiationAdapters(tx, shared),
      });
    });
  }

  /**
   * يشغّل قراءة بلا BEGIN/COMMIT وبلا حجز اتصال معاملة.
   *
   * اختيار المحولات هنا ما زال مهماً: القارئ يرى المنافذ نفسها التي يراها الكاتب، لكن على
   * اتصال الجذر. يختبر `atomicity.integration.test.ts` صراحة أن هذا المسار لا يستدعي
   * `db.transaction` ولا يترك صفاً أو أثراً في القاعدة.
   */
  async read<T>(
    shared: NegotiationSharedDeps,
    operation: (context: NegotiationUnitOfWorkContext) => Promise<T>,
  ): Promise<T> {
    return operation({
      db: this.db,
      deps: bindNegotiationAdapters(this.db, shared),
    });
  }
}
