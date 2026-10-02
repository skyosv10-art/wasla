/**
 * التفويضُ الواردُ الذي **يُمرِّرُهُ** `drivers` إلى `matching` (ADR-060 §2.4 · CLM-0440).
 *
 * `drivers` مُمرِّرٌ لا مُصدِرٌ: لا يملكُ مفتاحاً خاصّاً، ولا يصنعُ تأكيداً، ولا يتحقّقُ منهُ في P1
 * (التحقُّقُ عندَ المُستقبِلِ النهائيِّ). يحفظُ ما وصلَ — `obo` رمزِ الخدمةِ المُتحقَّقِ منهُ وترويسةَ
 * `x-wasla-user-assertion` كما هيَ — في سياقِ الطلبِ، فيقرؤهُ مُهايِئُ الترشيحِ عندَ النداءِ الصادرِ.
 *
 * ولماذا `AsyncLocalStorage` لا تمريرٌ صريحٌ: عشرةُ مساراتٍ تصلُ إلى `recomputeEligibility` عبرَ
 * حالاتِ استعمالٍ لا تعرفُ HTTP؛ وإدخالُ ترويسةٍ في توقيعِ كلِّ حالةِ استعمالٍ يُسرِّبُ النقلَ إلى
 * النطاقِ. والنبضةُ (بلا طلبِ مستخدمٍ) لا سياقَ لها ⇒ نداءٌ نظاميٌّ بلا `obo` كما كانَ.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { UserDelegation } from "@wasla/service-auth";

const storage = new AsyncLocalStorage<UserDelegation>();

/** يُشغِّلُ `fn` والتفويضُ الواردُ في سياقِها. */
export function runWithForwardedDelegation<T>(delegation: UserDelegation, fn: () => T): T {
  return storage.run(delegation, fn);
}

/**
 * التفويضُ الواردُ **إن كانَ لصاحبِ المَورِدِ نفسِهِ**. نداءٌ عن سائقٍ آخرَ (مثلاً قرارُ مشرفٍ)
 * لا يحملُ تفويضَ المُنادي — يذهبُ نظاميّاً، فلا يُنسَبُ إلى مستخدمٍ فعلٌ على غيرِ مَورِدِهِ.
 */
export function forwardedDelegationFor(subjectPublicId: string): UserDelegation | undefined {
  const delegation = storage.getStore();
  return delegation !== undefined && delegation.publicId === subjectPublicId ? delegation : undefined;
}
