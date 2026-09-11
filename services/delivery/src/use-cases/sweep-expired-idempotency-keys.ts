/**
 * مسحُ مفاتيحِ التماثُلِ المنتهيةِ (المراجعةُ 13/N · ADR-026 §4.15 — رفعُ دَينِ §4.10).
 *
 * ## لماذا حلقةُ دفعاتٍ لا عبارةً واحدةً
 *
 * الحذفُ الشاملُ سهلٌ في السطرِ وقاتلٌ في التشغيلِ: جدولٌ مُهمَلٌ فيهِ ملايينُ
 * المفاتيحِ المنتهيةِ يصيرُ معاملةً واحدةً طويلةً تُقفِلُ صفوفاً ويكبرُ سجلُّها.
 * فالحلقةُ تحذفُ دفعةً محدودةً ثمّ تسألُ الجدولَ نفسَهُ: هل بقيَ منتهٍ؟ — فلا
 * حذفَ أكثرَ من الحاجةِ ولا معاملةَ أطولَ من دفعةٍ.
 *
 * ## ولماذا سقفٌ للدفعاتِ (`maxBatches`) لا حلقةً حتّى النظافةِ
 *
 * حلقةٌ تدورُ حتّى `remaining === 0` قد لا تنتهي أبداً: كتابةٌ جديدةٌ تنتهي
 * مدّتُها بينَ دفعتَينِ تُضيفُ عملاً، وجدولٌ تُكتَبُ فيهِ مفاتيحُ أسرعَ مِمّا
 * تُمسَحُ يجعلُ الماسحَ حلقةً لا تعودُ — أي مُكنسةً تحوّلَت إلى حِمْلٍ دائمٍ على
 * القاعدةِ. فالسقفُ يجعلُ كلَّ جَولةٍ **محدودةَ التكلفةِ** وتُكمِلُ الجَولةُ التاليةُ
 * ما بقيَ، ويُعادُ سببُ التوقُّفِ صريحاً (`stoppedBecause`) ليكونَ التراكُمُ
 * مقروءاً في السجلِّ لا مُستنتَجاً.
 *
 * وهذهِ الحالةُ (`max_batches`) ليست خطأً يُرمى: الصحيحُ أن تُقاسَ وتُعلَنَ،
 * وأن يقرِّرَ التشغيلُ رفعَ الحدِّ أو تقصيرَ المدّةِ. أمّا الرميُ فيوقفُ مُكنسةً
 * دَورِيّةً بسببِ عملٍ كثيرٍ — وهوَ آخرُ ما يُرادُ حينَ يكونُ العملُ كثيراً.
 */

import type { IdempotencyKeySweepPort } from "../ports.js";

/** الحدُّ الافتراضيُّ لدفعةٍ واحدةٍ. */
export const IDEMPOTENCY_SWEEP_BATCH_SIZE = 500;

/** الحدُّ الافتراضيُّ لعددِ الدفعاتِ في الجَولةِ الواحدةِ. */
export const IDEMPOTENCY_SWEEP_MAX_BATCHES = 20;

export interface SweepExpiredIdempotencyKeysInput {
  readonly sweepPort: IdempotencyKeySweepPort;
  /** حجمُ الدفعةِ (افتراضاً `IDEMPOTENCY_SWEEP_BATCH_SIZE`). */
  readonly batchSize?: number;
  /** سقفُ الدفعاتِ في الجَولةِ (افتراضاً `IDEMPOTENCY_SWEEP_MAX_BATCHES`). */
  readonly maxBatches?: number;
}

export interface SweepExpiredIdempotencyKeysResult {
  /** عددُ الدفعاتِ التي نُفِّذَت فعلاً. */
  readonly batches: number;
  /** مجموعُ المحذوفِ في الجَولةِ. */
  readonly deleted: number;
  /** ما بقيَ منتهياً بعدَ آخرِ دفعةٍ — كما قاسَتهُ القاعدةُ. */
  readonly remaining: number;
  /**
   * سببُ التوقُّفِ:
   *  - `drained`: لم يبقَ منتهٍ (الحالةُ السويّةُ).
   *  - `empty_batch`: دفعةٌ حذفَت صفراً وبقيَ منتهٍ — صفوفٌ مقفولةٌ تخطّاها
   *    `SKIP LOCKED`، فلا فائدةَ في دورةٍ أخرى الآنَ.
   *  - `max_batches`: بلغَت الجَولةُ سقفَها وبقيَ عملٌ — تراكُمٌ يُقرأُ لا يُرمى.
   */
  readonly stoppedBecause: "drained" | "empty_batch" | "max_batches";
}

export async function sweepExpiredIdempotencyKeys(
  input: SweepExpiredIdempotencyKeysInput,
): Promise<SweepExpiredIdempotencyKeysResult> {
  const batchSize = input.batchSize ?? IDEMPOTENCY_SWEEP_BATCH_SIZE;
  const maxBatches = input.maxBatches ?? IDEMPOTENCY_SWEEP_MAX_BATCHES;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`حجمُ الدفعةِ يجبُ أن يكونَ عدداً صحيحاً ≥ 1 (القيمةُ: ${batchSize})`);
  }
  if (!Number.isInteger(maxBatches) || maxBatches < 1) {
    throw new Error(`سقفُ الدفعاتِ يجبُ أن يكونَ عدداً صحيحاً ≥ 1 (القيمةُ: ${maxBatches})`);
  }

  let batches = 0;
  let deleted = 0;
  let remaining = 0;
  let stoppedBecause: SweepExpiredIdempotencyKeysResult["stoppedBecause"] = "max_batches";

  while (batches < maxBatches) {
    const batch = await input.sweepPort.deleteExpiredIdempotencyKeys(batchSize);
    batches += 1;
    deleted += batch.deleted;
    remaining = batch.remaining;

    if (batch.remaining === 0) {
      stoppedBecause = "drained";
      break;
    }
    // دفعةٌ فارغةٌ وبقيَ عملٌ: الباقي مقفولٌ لكاتبٍ الآنَ. والإصرارُ هنا حلقةٌ
    // مشغولةٌ (busy loop) تُنافِسُ مساراً في المقدّمةِ على القفلِ نفسِهِ.
    if (batch.deleted === 0) {
      stoppedBecause = "empty_batch";
      break;
    }
  }

  return { batches, deleted, remaining, stoppedBecause };
}
