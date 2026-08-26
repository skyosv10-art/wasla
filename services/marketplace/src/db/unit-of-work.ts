/**
 * وحدةُ العمل — **معاملةٌ واحدةٌ** تضمّ الدفترَ والإسقاطَ معاً، وإعادةُ محاولةٍ مُسمّاة.
 *
 * ## لماذا معاملةٌ واحدة ولا كتابتان متتاليتان
 *
 * كلُّ قرارٍ في هذه الخدمةِ كتابتان على الأقل: صفٌّ في الدفتر (`store_reviews`) وصفٌّ مُتحقِّقٌ
 * في المورد (`stores`). وكتابتان بلا معاملةٍ تُنتجان ثلاثَ نهاياتٍ إحداها سامّةٌ: قرارٌ في
 * الدفترِ وحالةٌ قديمةٌ في المورد — أي متجرٌ **اعتُمد** ويقول النظامُ إنّه `pending_review`،
 * فيراه صاحبُه معتمَداً في سجلِّ القراراتِ وغيرَ ظاهرٍ في السوق. وهذا ما لا تُصلحه إعادةُ
 * محاولةٍ ولا يُكتشف بقراءةٍ: الصفُّ المُتحقِّقُ يبدو سليماً في ذاتِه.
 *
 * والمعاملةُ تجعل النهايتَين وحدَهما ممكنتَين: كلُّ شيءٍ أو لا شيء. ويُثبتها
 * `atomicity.integration.test.ts` بفشلٍ مدفوعٍ بالحاقنِ **في وسطِ** المعاملة (بعد الدفترِ وقبل
 * الإسقاط) ثمّ يعدّ الصفوف: صفرٌ في الجدولَين.
 *
 * ## ولماذا إعادةُ محاولةٍ ولم يكفِ القفل
 *
 * التسلسلُ يُقرأ من الدفترِ ثمّ يُكتب، فقرارانِ على متجرٍ واحدٍ في نفسِ اللحظةِ يتسابقان.
 * والحارسُ فهرسٌ فريدٌ في العقدِ لا قفلٌ متشائم، فالخاسرُ يفشل **فشلاً مُسمّىً** يُعرف من اسمِ
 * القيدِ وحدَه (`SEQUENCE_RACE_CONSTRAINTS`) — فتُعاد **العمليّةُ كلُّها** من قراءةٍ جديدةٍ
 * للدفتر، لا الكتابةُ وحدَها: الحالةُ المُشتقّةُ مبنيّةٌ على ما قرأته المحاولةُ السابقة، وإعادةُ
 * الكتابةِ بنفسِ المُدخلِ كانت ستُثبّت اشتقاقاً على قراءةٍ صارت قديمة.
 *
 * وسقفُ المحاولاتِ ثلاثٌ: سباقٌ يتكرّر ثلاثاً ليس سباقاً بل عطبٌ يجب أن يظهر لا أن يُذاب في
 * حلقةٍ بلا حدّ. وعددُ المحاولاتِ يُعاد إلى المُنادي كي تُقاس في اختبارِ التزامنِ وتظهر في
 * النبضةِ لاحقاً: إعادةٌ صامتةٌ تُخفي حِملاً حقيقيّاً، ورقمٌ ظاهرٌ هو ما يمنع أن يصير السقفُ
 * عشرةً بلا سبب.
 *
 * ولمَ لا `SELECT … FOR UPDATE` على صفِّ المتجر؟ لأنّ أوّلَ قرارٍ (`review_requested`) يقع على
 * متجرٍ لا صفَّ دفترٍ له بعد، وقفلٌ على ماضٍ غيرِ موجودٍ لا يمنع سباقاً؛ والقفلُ المتشائم قرارٌ
 * يُعلَن إن أثبت القياسُ أنّ الإعادةَ مُكلفة.
 *
 * ## والمجموعةُ ستّةُ مخازنَ لا سبعة
 *
 * `idempotency` انضمّ في المراجعة 4/6 مع الطبقةِ التي تقرأ `Idempotency-Key` — ووجودُه **داخلَ**
 * المجموعةِ هو ما يجعل الحرسَ والحفظَ يقعان في معاملةِ الكتابةِ نفسِها: مخزنٌ يُبنى على `db`
 * لا على `tx` كان سيقرأ ويكتب خارجَ المعاملة، فيبقى مفتاحٌ محفوظاً لكتابةٍ تراجعت.
 *
 * ولا `outbox` بعد: صندوقُ الصادرِ في 5/6 لأنّه يُكتب في معاملةِ القرارِ نفسِها ولا معنى له
 * خارجَها. ودرسُ الطور 10 المكتوبُ في `contracts/schema.sql` صريحٌ: مخزنٌ يهبط قبل ما يصله يبقى
 * غيرَ موصولٍ ويظنّ الجميعُ أنّه يعمل.
 */

import { isSequenceRace } from "./constraints.js";
import type { Db, DbOrTx } from "./client.js";
import { PostgresCategoryStore } from "./categories.js";
import { PostgresIdempotencyStore } from "./idempotency.js";
import { PostgresMarketplaceLedger } from "./ledger.js";
import { PostgresMarketplaceProjection } from "./projection.js";
import { PostgresResourceStore } from "./resources.js";
import { PostgresStaffStore } from "./staff.js";

export interface MarketplaceStores {
  readonly resources: PostgresResourceStore;
  readonly ledger: PostgresMarketplaceLedger;
  readonly projection: PostgresMarketplaceProjection;
  readonly staff: PostgresStaffStore;
  readonly categories: PostgresCategoryStore;
  readonly idempotency: PostgresIdempotencyStore;
}

/** كلُّ المخازنِ مربوطةً بنفسِ الاتصالِ — فلا يقع نصفُها خارجَ المعاملة. */
export function bindStores(db: DbOrTx): MarketplaceStores {
  return {
    resources: new PostgresResourceStore(db),
    ledger: new PostgresMarketplaceLedger(db),
    projection: new PostgresMarketplaceProjection(db),
    staff: new PostgresStaffStore(db),
    categories: new PostgresCategoryStore(db),
    idempotency: new PostgresIdempotencyStore(db),
  };
}

/** حدُّ إعادةِ المحاولة — مُعلَنٌ ليُقرأ في الاختبارِ لا رقماً مدسوساً في حلقة. */
export const MAX_DECISION_ATTEMPTS = 3;

/**
 * خطّافٌ للاختبارِ وحدَه: يُنادى **داخلَ** المعاملةِ بين الكتابتَين.
 *
 * ولمَ يوجد في مسارِ الإنتاجِ أصلاً؟ لأنّ ذرّيّةَ المعاملةِ لا تُثبَت من خارجِها: لا سبيلَ
 * لكسرِ معاملةٍ في منتصفِها إلّا من داخلِها، والبديلُ كان قتلَ العمليّةِ بإشارةٍ — وذاك يفحص
 * Postgres لا يفحص كودَنا. والخطّافُ `undefined` في كلِّ مسارٍ حقيقيّ، وستُثبت المراجعة 4/6
 * أنّه لا يُمرَّر من طبقةِ HTTP أبداً.
 */
export type TransactionProbe = (stage: "after-ledger" | "after-projection") => Promise<void>;

export interface UnitOfWorkContext {
  readonly stores: MarketplaceStores;
  readonly probe?: TransactionProbe;
}

export type UnitOfWork<T> = (context: UnitOfWorkContext) => Promise<T>;

export class MarketplaceUnitOfWork {
  constructor(
    private readonly db: Db,
    private readonly probe?: TransactionProbe,
  ) {}

  /** قراءةٌ بلا معاملة: لا كتابةَ فلا شيءَ لِيُلَفّ، والمعاملةُ الفارغةُ ثمنٌ بلا مقابل. */
  async read<T>(work: UnitOfWork<T>): Promise<T> {
    return work({ stores: bindStores(this.db), probe: this.probe });
  }

  /** كتابةٌ في معاملةٍ واحدة، وإعادةُ تشغيلٍ على سباقِ التسلسلِ وحدَه. */
  async write<T>(work: UnitOfWork<T>): Promise<{ readonly value: T; readonly attempts: number }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_DECISION_ATTEMPTS; attempt += 1) {
      try {
        const value = await this.db.transaction(async (tx) =>
          work({ stores: bindStores(tx), probe: this.probe }),
        );
        return { value, attempts: attempt };
      } catch (error) {
        if (!isSequenceRace(error)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }
}
