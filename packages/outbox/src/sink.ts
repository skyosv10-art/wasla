/**
 * منفذُ التسليم وحدُّه — مُستخرَجٌ من reputation (ADR-042 · موجة 1).
 *
 * الناقلُ في وصلة قرارُ منصّةٍ لم يُتّخذ بعد: لا ADR يُسمّي ناقلاً. فمُهيئٌ
 * شبكيٌّ هنا كان سيُلزم المنصّةَ بمكتبةٍ قبل قرارها.
 *
 * Scope: مشترك · صندوقُ الصادر
 * Last Updated: 2026-09-20
 * Status: Active
 */

import type { EventSinkPort } from "./types.js";

/**
 * خطأُ منفذٍ غيرِ مُهيَّأ — يُرفَع باسمه ولا يُبلَع.
 */
export class EventSinkUnconfiguredError extends Error {
  constructor(reason: string) {
    super(`event sink is not configured: ${reason}`);
    this.name = "EventSinkUnconfiguredError";
  }
}

/**
 * منفذٌ يُعلن أنّه غيرُ مُهيَّأ في كل نداء.
 *
 * التصريفُ يفشل تسليمَ كلِّ صفٍّ ويُسجّل السببَ في `DrainReport.failed`،
 * ويبقى `published_at` فارغاً — فلا حدثَ يُفقَد.
 */
export function unconfiguredEventSink(reason: string): EventSinkPort {
  return {
    async deliver(): Promise<void> {
      throw new EventSinkUnconfiguredError(reason);
    },
  };
}
