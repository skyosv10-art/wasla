/**
 * تمثيلٌ آمنٌ للتسجيلِ والتدقيق. **البابُ الوحيدُ المسموحُ به لإخراجِ الـ`Principal`
 * إلى سجلٍّ أو أثر.** القاعدةُ: docs/00-rules/SECURITY_RULES.md §11 — لا يُسجَّل
 * معرِّفٌ داخليٌّ ولا معرِّفُ جلسةٍ خامٌّ ولا قائمةُ صلاحيّاتٍ كاملة.
 *
 * ولماذا لا نكتفي بالتوصية؟ لأنّ `JSON.stringify(principal)` يُسرِّب
 * `internalUuid` و`sessionId` بلا أيِّ إنذار. فوجودُ دالّةٍ واحدةٍ يمكن للحارسِ
 * أن يُلزِمَ بها أفضلُ من قاعدةٍ مكتوبةٍ لا يفرضها شيء.
 */

import type { Principal } from "./principal.js";

/** الشكلُ المسموحُ إخراجُه. لا حقلَ فيه يُعرِّف شخصاً أو يُعاد استخدامُه رمزاً. */
export interface PrincipalDescription {
  readonly kind: Principal["kind"];
  /** نوعُ الفاعلِ البشريِّ أو اسمُ الخدمة. */
  readonly actor?: string;
  /** المعرِّفُ العامُّ — الوحيدُ المسموحُ تسجيلُه. */
  readonly publicId?: string;
  /** عددُ الصلاحيّاتِ لا قائمتُها. */
  readonly scopeCount: number;
  /** بصمةٌ قصيرةٌ للجلسةِ تُمكِّن الربطَ بلا كشفِ المعرِّف. */
  readonly sessionFingerprint?: string;
  readonly expiresAt?: string;
}

/**
 * بصمةٌ حتميّةٌ قصيرةٌ لمعرِّفِ الجلسة. ليست تعميةً — غرضُها ربطُ سطورِ سجلٍّ
 * بجلسةٍ واحدةٍ بلا إمكانِ استعمالِ الناتجِ رمزاً. ولذلك تُقصَّر إلى 8 محارف.
 */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** يبني التمثيلَ الآمن. لا يُخرِج `internalUuid` بحالٍ من الأحوال. */
export function describePrincipal(principal: Principal): PrincipalDescription {
  switch (principal.kind) {
    case "anonymous":
      return { kind: "anonymous", scopeCount: 0 };
    case "user":
      return {
        kind: "user",
        actor: principal.actor,
        publicId: principal.waslaPublicId,
        scopeCount: principal.scopes.length,
        sessionFingerprint: fingerprint(principal.sessionId),
        expiresAt: principal.expiresAt,
      };
    case "service":
      return {
        kind: "service",
        actor: principal.serviceName,
        ...(principal.onBehalfOfPublicId === undefined
          ? {}
          : { publicId: principal.onBehalfOfPublicId }),
        scopeCount: principal.scopes.length,
        expiresAt: principal.expiresAt,
      };
  }
}
