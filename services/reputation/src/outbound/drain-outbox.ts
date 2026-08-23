/**
 * تصريفُ صندوق الصادر: يقرأ غيرَ المنشور، يُسلّم، ثمّ يُعلّم (الطور 09 · المراجعة 5/6).
 *
 * هذا أوّلُ ناشرِ صندوقٍ في المستودع كلِّه. حتى الطور 08 كانت كلُّ خدمةٍ تكتب في صندوقها
 * ولا أحدَ يُصرّفه — دَينٌ مُعلَنٌ في HANDOFF لا عطلٌ مخفيّ — والطور 09 يسدّده لصندوقه
 * وحده، ويترك النمطَ مكتوباً لمن يُصرّف صناديقَ الأطوار 06 و07 و08.
 *
 * ## الثلاثةُ التي يجب أن تصحّ (HANDOFF §16-ي البند 3)
 *
 *   1. **فشلُ التسليم لا يُبطل الكتابة.** الواقعةُ والنتيجةُ التزمتا في معاملة القرار،
 *      والتصريفُ معاملةٌ أخرى تماماً. فلو ربطناهما لصار عطلُ ناقلٍ يمحو سمعةً صحيحة —
 *      وذاك بعينه ما وُجد صندوقُ الصادر ليمنعه.
 *   2. **إعادةُ المحاولة لا تُنتج نشرتين لنفس الصفّ.** لا تُحلّ هذه بـ`if` في الكود بل
 *      بقفلٍ في القاعدة: `FOR UPDATE SKIP LOCKED` (انظر `PostgresOutboxDrainStore`).
 *      ومُصرّفان يعملان معاً لا يريان نفسَ الصفّ أصلاً.
 *   3. **التعليمُ شرطيّ**: `UPDATE ... WHERE published_at IS NULL`، ويُرجع هل تغيّر صفٌّ.
 *      فلو عُلّم الصفُّ مرّتين بأيِّ سبيلٍ لَظهر ذلك في التقرير بدل أن يمرّ.
 *
 * ## وما لا يصحّ، مُعلَناً لا مخفيّاً
 *
 * التسليمُ هنا **at-least-once ولا يمكن أن يكون at-most-once**. لو نجح التسليمُ ثمّ
 * سقطت العمليةُ قبل الالتزام، فالصفُّ يبقى غيرَ منشورٍ ويُسلَّم مرّةً ثانية. وذاك ليس
 * إهمالاً: التسليمُ إلى نظامٍ خارجيٍّ والالتزامُ في قاعدتنا لا يقعان في معاملةٍ واحدة
 * إلّا بمعاملةٍ موزّعة، وثمنُها أعلى من ثمن التكرار.
 *
 * والثمنُ مدفوعٌ في المكان الصحيح: `id` هو `event_id` نفسُه ولا يتغيّر بإعادة التسليم،
 * فمستهلكٌ يُزيل التكرارَ به يرى الحدثَ مرّةً واحدة — وهو بعينه ما تفعله السمعةُ نفسُها
 * مع أحداث المحرّك عبر `ux_reputation_facts_source`. والنسخةُ الخاطئةُ الأرخص: أن يُعلَّم
 * الصفُّ منشوراً **قبل** التسليم — فيصير النظامُ at-most-once، ويُفقَد الحدثُ نهائياً
 * عند أوّل عطلِ شبكةٍ بلا أن يبقى له أثر.
 *
 * ## لا مؤقّت
 *
 * لا `setInterval` هنا ولا في الخدمة (`purity.test.ts` يحرسه). `drainOutbox` نداءٌ
 * واحدٌ يُصرّف دفعةً ويُرجع تقريراً، ومَن يُكرّره خارجُ الخدمة — كمُشغّل النبضة.
 *
 * Scope: خدمة السمعة · تصريفُ صندوق الصادر
 * Last Updated: 2026-08-23
 * Status: Active
 * Related Code: src/outbound/event-sink.ts · src/infrastructure/drizzle/transaction.ts
 * Related Team: Reputation & Trust
 */

import type { Clock } from "../ports.js";
import type { EventSinkPort, OutboxRecord } from "./event-sink.js";

/**
 * مخزنُ الصندوق كما يراه المُصرّف — ثلاثُ عملياتٍ ولا رابعة.
 *
 * ولا يسكن هذا المنفذُ في `ReputationDependencies`: تلك المجموعةُ تُبنى حول معاملةِ
 * **قرارٍ** (واقعة + نتيجة + حدث)، وحالاتُ الاستخدام لا تقرأ الصندوق أبداً وإلّا صار
 * قرارٌ يعتمد على أثرِه. وإضافةُ حقلٍ رابعٍ إلى `ReputationSharedDeps` أشدُّ منعاً:
 * ترويستُها تقول صريحاً إنّ حقلاً باسم `bus` تغييرُ عمارةٍ يحتاج ADR.
 */
export interface OutboxDrainStore {
  /**
   * يحتجز دفعةً من غير المنشور ويُرجعها مُرتَّبةً بالأقدم.
   *
   * «يحتجز» لا «يقرأ»: على PostgreSQL صفوفُ الدفعة تُقفَل حتى نهاية المعاملة، فمُصرّفٌ
   * ثانٍ يعمل في اللحظة نفسِها يتخطّاها ولا ينتظرها. والترتيبُ بـ`occurred_at` ثمّ `id`:
   * لحظةُ الحدث لا لحظةُ الكتابة، فتأخُّرُ نبضةٍ لا يُعيد ترتيبَ ما وقع.
   */
  claimUnpublished(limit: number): Promise<readonly OutboxRecord[]>;
  /**
   * يُعلّم صفّاً منشوراً، ويُرجع `false` إن كان معلَّماً أصلاً.
   *
   * الشرطيّةُ هي الحرس: `UPDATE ... WHERE published_at IS NULL`. و`void` كان سيُخفي
   * النشرةَ الثانية تماماً، فلا يبقى فرقٌ بين تصريفٍ سليمٍ وتصريفٍ يُسلّم مرّتين.
   */
  markPublished(id: string, publishedAt: string): Promise<boolean>;
  /**
   * يُسجّل محاولةً فاشلة: `attempts + 1` و`last_error`، و`published_at` يبقى فارغاً.
   *
   * ولا يُحذف الصفُّ ولا يُنقل إلى جدولِ موتى: صفٌّ بقي مع سببِ فشلِه يُقرأ بعد شهرٍ
   * ويُعاد تسليمُه، وصفٌّ محذوفٌ حدثٌ فُقد ولا يعرف أحدٌ أنّه كان.
   */
  recordDeliveryFailure(id: string, reason: string): Promise<void>;
}

/**
 * مَن يفتح معاملةَ التصريف.
 *
 * الاحتجازُ والتسليمُ والتعليمُ في معاملةٍ **واحدة**، وإلّا سقط القفل: `SKIP LOCKED`
 * يُحرّر أقفالَه عند الالتزام، فتصريفٌ يحتجز في معاملةٍ ثمّ يُسلّم خارجَها يفتح البابَ
 * لمُصرّفٍ ثانٍ يحتجز نفسَ الصفّ.
 *
 * ولذلك يُمرَّر التسليمُ **داخلَ** المعاملة، وهو الثمنُ المعروف: معاملةٌ تنتظر شبكةً.
 * ولأنّه ثمنٌ حقيقيّ، `limit` وسيطٌ إلزاميّ لا افتراضٌ مخفيّ: دفعةٌ من ألف صفٍّ تُبقي
 * معاملةً مفتوحةً دقائق فتُعطّل `VACUUM` وتُطيل الأقفال.
 */
export interface OutboxDrainRunner {
  drain<T>(work: (store: OutboxDrainStore) => Promise<T>): Promise<T>;
}

/** مُشغّلٌ على مخزنٍ واحدٍ ثابت — الذاكرةُ أو أيُّ بديلِ اختبار. */
export function createDirectOutboxDrainRunner(store: OutboxDrainStore): OutboxDrainRunner {
  return {
    async drain<T>(work: (store: OutboxDrainStore) => Promise<T>): Promise<T> {
      return work(store);
    },
  };
}

export interface DrainFailure {
  readonly id: string;
  readonly eventType: string;
  readonly reason: string;
}

/**
 * تقريرُ دفعةٍ واحدة.
 *
 * `claimed = published + failed.length` دائماً، ويُثبته اختبار. والحقولُ منفصلةٌ لا
 * عدّادٌ واحد: «صُرّف 40» لا تقول هل نُشر أربعون أم فشل عشرون، ولوحةٌ مبنيّةٌ عليها
 * تُظهر نظاماً سليماً وناقلُه معطّل.
 */
export interface DrainReport {
  readonly claimed: number;
  readonly published: number;
  readonly failed: readonly DrainFailure[];
  /**
   * صفوفٌ سُلّمت ثمّ رفض التعليمُ الشرطيُّ أن يُغيّرها — أي كانت منشورةً أصلاً.
   *
   * الرقمُ يجب أن يبقى صفراً؛ ووجودُه في التقرير هو ما يجعله يُلاحَظ بدل أن يُبتلَع.
   * وأيُّ قيمةٍ فوق الصفر تعني أنّ الاحتجازَ لم يُقفل، وذاك عطلُ بنيةٍ لا عطلُ تسليم.
   */
  readonly alreadyPublished: number;
}

/**
 * يُصرّف دفعةً واحدة.
 *
 * `sink` وسيطٌ صريحٌ لا حقلٌ في التبعيّات: منفذُ التسليم ليس ملكاً للخدمة بل لمن
 * يُشغّلها، ومَن يُصرّف إلى ناقلٍ اليوم قد يُصرّف إلى مِلفٍّ للتشخيص غداً بلا أن تتغيّر
 * الخدمةُ سطراً.
 *
 * وفشلُ صفٍّ لا يوقف الدفعة: الحلقةُ تمضي إلى التالي. ولو أوقفناها لَصار صفٌّ واحدٌ
 * فاسدٌ سدّاً يمنع كلَّ ما بعده إلى الأبد — وهو أسوأُ من تأخّر صفٍّ واحد.
 */
export async function drainOutbox(
  runner: OutboxDrainRunner,
  sink: EventSinkPort,
  options: { readonly limit: number; readonly clock: Clock },
): Promise<DrainReport> {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
    throw new RangeError("drainOutbox limit must be an integer >= 1");
  }

  return runner.drain(async (store) => {
    const records = await store.claimUnpublished(options.limit);
    const failed: DrainFailure[] = [];
    let published = 0;
    let alreadyPublished = 0;

    for (const record of records) {
      try {
        await sink.deliver(record);
      } catch (error) {
        /**
         * الرسالةُ من العطل لا من عندنا، ومحدودةُ الطول: `last_error` عمودُ نصٍّ بلا حدّ،
         * وأثرُ مكدسٍ كامل من ألف حرفٍ يُنفخ الجدولَ ولا يُقرأ. وأوّلُ سطرٍ هو ما يُقرأ.
         */
        const reason = error instanceof Error ? error.message : String(error);
        await store.recordDeliveryFailure(record.id, reason.slice(0, 500));
        failed.push({ id: record.id, eventType: record.eventType, reason });
        continue;
      }

      /**
       * التعليمُ **بعد** التسليم — وهذا هو الترتيبُ الذي يجعل النظامَ at-least-once.
       * انظر ترويسةَ الملفّ: الترتيبُ المعكوس أرخصُ ويُفقد الأحداثَ بلا أثر.
       */
      const changed = await store.markPublished(record.id, options.clock.now());
      if (changed) published += 1;
      else alreadyPublished += 1;
    }

    return { claimed: records.length, published, failed, alreadyPublished };
  });
}
