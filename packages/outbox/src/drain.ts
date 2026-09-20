/**
 * منطقُ تصريفِ صندوقِ الصادر — مُستخرَجٌ من reputation (ADR-042 · موجة 1).
 *
 * ## الثلاثةُ التي يجب أن تصحّ
 *
 *   1. **فشلُ التسليم لا يُبطل الكتابة.** الواقعةُ والنتيجةُ التزمتا في معاملةِ
 *      القرار، والتصريفُ معاملةٌ أخرى تماماً. فلو ربطناهما لصار عطلُ ناقلٍ يمحو
 *      سجلًّا صحيحًا — وذاك بعينه ما وُجد صندوقُ الصادر ليمنعه.
 *   2. **إعادةُ المحاولة لا تُنتج نشرتين لنفس الصفّ.** لا تُحلّ هذه بـ`if` في الكود
 *      بل بقفلٍ في القاعدة: `FOR UPDATE SKIP LOCKED`.
 *   3. **التعليمُ شرطيّ**: `UPDATE ... WHERE published_at IS NULL`، ويُرجع هل تغيّر
 *      صفٌّ.
 *
 * ## `recordDeliveryFailure` اختياريّ (G3)
 *
 * الجداولُ بلا `attempts`/`last_error` (G3 — 5 من 13 بعدَ CLM-0245: dispatch ·
 * marketplace · matching · orders · search) لا تستطيعُ تسجيلَ الفشلِ
 * بشكلٍ دائم. `OutboxDrainStore.recordDeliveryFailure` منفذٌ اختياريّ: إن لم
 * يُنفّذْه المحوّلُ، يظلُّ الفشلُ في `DrainReport.failed` (في الذاكرة) ولا
 * يُكتب في القاعدة. وهذا لا يُسكتُ الفشلَ بل يُؤجّلُ ثباتَه إلى G3.
 *
 * ## لا مؤقّت
 *
 * لا `setInterval` هنا. `drainOutbox` نداءٌ واحدٌ يُصرّف دفعةً ويُرجع تقريراً،
 * ومَن يُكرّره خارجُ الخدمة.
 *
 * Scope: مشترك · صندوقُ الصادر
 * Last Updated: 2026-09-20
 * Status: Active
 * Related Code: services/reputation/src/outbound/drain-outbox.ts (الأصل)
 */

import type { EventSinkPort, OutboxRecord, DrainFailure, DrainReport } from "./types.js";

/**
 * واجهةُ الساعة — تُحقنُ لا تُستورَد. `Date.now()` كان سيُنتجُ قيمةً غيرَ
 * مُحدَّدةٍ في الاختبار.
 */
export interface Clock {
  now(): string;
}

/**
 * مخزنُ الصندوق كما يراه المُصرّف.
 *
 * `recordDeliveryFailure` اختياريّ: الجداولُ بلا `attempts`/`last_error` (G3)
 * لا تُنفّذُه، والتصريفُ يظلُّ يعملُ بلا ثباتِ الفشل.
 */
export interface OutboxDrainStore {
  /**
   * يحتجز دفعةً من غير المنشور ويُرجعها مُرتَّبةً بالأقدم.
   *
   * «يحتجز» لا «يقرأ»: على PostgreSQL صفوفُ الدفعة تُقفَل حتى نهاية المعاملة،
   * فمُصرّفٌ ثانٍ يعمل في اللحظة نفسِها يتخطّاها ولا ينتظرها.
   */
  claimUnpublished(limit: number): Promise<readonly OutboxRecord[]>;
  /**
   * يُعلّم صفّاً منشوراً، ويُرجع `false` إن كان معلَّماً أصلاً.
   *
   * الشرطيّةُ هي الحرس: `UPDATE ... WHERE published_at IS NULL`.
   */
  markPublished(id: string, publishedAt: string): Promise<boolean>;
  /**
   * يُسجّل محاولةً فاشلة: `attempts + 1` و`last_error`.
   *
   * اختياريّ: الجداولُ بلا `attempts`/`last_error` (G3) لا تُنفّذُه.
   * التصريفُ يظلُّ يعملُ، والفشلُ يُسجَّلُ في `DrainReport.failed` فقط.
   */
  recordDeliveryFailure?(id: string, reason: string): Promise<void>;
}

/**
 * مَن يفتح معاملةَ التصريف.
 *
 * الاحتجازُ والتسليمُ والتعليمُ في معاملةٍ **واحدة**، وإلّا سقط القفل:
 * `SKIP LOCKED` يُحرّر أقفالَه عند الالتزام.
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

/**
 * يُصرّف دفعةً واحدة.
 *
 * `sink` وسيطٌ صريحٌ لا حقلٌ في التبعيّات: منفذُ التسليم ليس ملكاً للخدمة بل
 * لمن يُشغّلها.
 *
 * وفشلُ صفٍّ لا يوقف الدفعة: الحلقةُ تمضي إلى التالي.
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
        const reason = error instanceof Error ? error.message : String(error);
        if (store.recordDeliveryFailure) {
          await store.recordDeliveryFailure(record.id, reason.slice(0, 500));
        }
        failed.push({ id: record.id, eventType: record.eventType, reason });
        continue;
      }

      const changed = await store.markPublished(record.id, options.clock.now());
      if (changed) published += 1;
      else alreadyPublished += 1;
    }

    return { claimed: records.length, published, failed, alreadyPublished };
  });
}
