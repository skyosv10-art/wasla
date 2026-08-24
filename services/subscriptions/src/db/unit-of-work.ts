/**
 * وحدةُ العمل — **معاملةٌ واحدةٌ** تضمّ المُدّةَ والانتقالَ والصفَّ المُتحقِّق، وإعادةُ محاولةٍ مُسمّاة.
 *
 * ## لماذا معاملةٌ واحدة ولا ثلاثُ كتاباتٍ متتالية
 *
 * منحُ مُدّةٍ ثلاثُ كتابات: صفٌّ في `subscription_periods`، وانتقالٌ في
 * `subscription_transitions`، وصفٌّ مُتحقِّقٌ في `subscriptions`. وثلاثُ كتاباتٍ بلا معاملةٍ
 * تُنتج ثلاثَ حالاتِ فشلٍ جزئيّ، وأخطرُها الوسطى: مُدّةٌ في الدفتر وصفٌّ مُتحقِّقٌ قديم — أي
 * سائقٌ **دفع** ويقول النظامُ إنّه `expired`. وهذا عطبٌ لا يُكتشف بقراءةٍ ولا يُصلحه إلّا
 * تدخّلٌ يدويّ، لأنّ الصفَّ المُتحقِّق يبدو سليماً في ذاته.
 *
 * والمعاملةُ تجعل الحالتين وحدَهما ممكنتين: كلُّ شيءٍ أو لا شيء. واختبارُ
 * `atomicity.integration.test.ts` يُثبتها بفشلٍ **مدفوعٍ بالحاقن** في وسط المعاملة (بعد
 * المُدّة وقبل الصفّ المُتحقِّق) ثمّ يعدّ الصفوف: صفرٌ في الجداول الثلاثة.
 *
 * ## ولماذا إعادةُ محاولةٍ ولم يكفِ القفل
 *
 * التسلسلُ في `insertTransition` يُقرأ ثمّ يُكتب، فمُحاولتان لسائقٍ واحدٍ في نفس اللحظة
 * تتسابقان. والحارسُ اليومَ قيدٌ في القاعدة (`ux_subscription_transitions_sequence`) لا قفلٌ
 * متشائم، فالخاسرُ يفشل **فشلاً مُسمّىً** يُعرف من اسم القيد وحدَه — فيُعاد تشغيلُ العملية
 * كلِّها من قراءةٍ جديدةٍ للدفتر.
 *
 * وإعادةُ التشغيل تُنادي **العمليةَ** لا الكتابةَ وحدَها بقصد: الحالةُ المُشتقّةُ تعتمد على ما
 * قرأته المحاولةُ السابقة، فإعادةُ الكتابةِ بنفسِ المُدخل كانت ستُثبّت حساباً بُني على قراءةٍ
 * صارت قديمة. وسقفُ المحاولاتِ ثلاثٌ: سباقٌ يتكرّر ثلاثاً ليس سباقاً بل عطبٌ يجب أن يظهر.
 *
 * ولمَ لا `SELECT ... FOR UPDATE` على صفّ السائق؟ لأنّه يفترض وجودَ الصفِّ المُتحقِّق قبل
 * أوّلِ كتابةٍ (وهو غيرُ موجودٍ في منحِ التجربة)، وقفلٌ على صفٍّ لا وجودَ له لا يمنع سباقاً.
 * والقفلُ المتشائم قرارٌ مُعلَنٌ لاحقاً إن أثبت القياسُ أنّ الإعادةَ مُكلفة (HANDOFF §18.7).
 */

import { isTransitionSequenceRace } from "./constraints.js";
import type { Db, DbOrTx } from "./client.js";
import { PostgresSubscriptionProjection } from "./projection.js";
import { PostgresReferralStore } from "./referrals.js";
import { PostgresSubscriptionLedger } from "./repository.js";

/** المخازنُ الثلاثةُ مربوطةً بنفسِ الاتصال — فلا يقع نصفُها خارجَ المعاملة. */
export interface SubscriptionStores {
  readonly ledger: PostgresSubscriptionLedger;
  readonly projection: PostgresSubscriptionProjection;
  readonly referrals: PostgresReferralStore;
}

export function bindStores(db: DbOrTx): SubscriptionStores {
  return {
    ledger: new PostgresSubscriptionLedger(db),
    projection: new PostgresSubscriptionProjection(db),
    referrals: new PostgresReferralStore(db),
  };
}

/** حدُّ إعادةِ المحاولة — مُعلَنٌ ليُقرأ في الاختبار لا رقماً مدسوساً في حلقة. */
export const MAX_TRANSITION_ATTEMPTS = 3;

/**
 * خطّافٌ للاختبار وحدَه: يُنادى **داخل** المعاملة بين الكتابات.
 *
 * ولمَ في الإنتاج أيضاً؟ لأنّ ذرّيّةَ المعاملة لا تُثبَت من خارجها: لا سبيلَ لكسرِ معاملةٍ
 * في منتصفها إلّا من داخلها. والبديلُ كان قتلَ العملية بإشارةٍ — وهذا يفحص Postgres لا
 * يفحص كودَنا. والخطّافُ `undefined` في كلّ مسارٍ حقيقيّ، ويُثبت `http-drift` أنّه لا يُمرَّر
 * من طبقةِ HTTP أبداً.
 */
export type TransactionProbe = (stage: "after-period" | "after-transition") => Promise<void>;

export interface UnitOfWorkContext {
  readonly stores: SubscriptionStores;
  readonly probe?: TransactionProbe;
}

export type UnitOfWork<T> = (context: UnitOfWorkContext) => Promise<T>;

export class SubscriptionUnitOfWork {
  constructor(
    private readonly db: Db,
    private readonly probe?: TransactionProbe,
  ) {}

  /** قراءةٌ بلا معاملة: لا كتابةَ فلا شيءَ لِيُلَفّ، والمعاملةُ الفارغةُ ثمنٌ بلا مقابل. */
  async read<T>(work: UnitOfWork<T>): Promise<T> {
    return work({ stores: bindStores(this.db), probe: this.probe });
  }

  /**
   * كتابةٌ في معاملةٍ واحدة، مع إعادةِ تشغيلٍ على سباقِ التسلسل وحدَه.
   *
   * `attempts` تُعاد إلى المُنادي لأنّ النبضةَ تعدّها: إعادةٌ صامتةٌ تُخفي حِملاً حقيقيّاً،
   * ورقمٌ يظهر في اختبارِ التزامن هو ما يمنع أن يصير السقفُ عشرةً بلا سبب.
   */
  async write<T>(work: UnitOfWork<T>): Promise<{ readonly value: T; readonly attempts: number }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_TRANSITION_ATTEMPTS; attempt += 1) {
      try {
        const value = await this.db.transaction(async (tx) =>
          work({ stores: bindStores(tx), probe: this.probe }),
        );
        return { value, attempts: attempt };
      } catch (error) {
        if (!isTransitionSequenceRace(error)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }
}
