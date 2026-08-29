/**
 * قراراتُ التفويضِ على `Principal`. **دوالٌّ نقيّةٌ بلا حالةٍ ولا وقتٍ ضمنيّ:**
 * الوقتُ يُمرَّر صراحةً كي يكون الانتهاءُ قابلاً للاختبارِ بلا مؤقّتاتٍ زائفة
 * (نفسُ قاعدةِ الوقتِ المُمرَّرِ في ADR-011/ADR-013).
 *
 * ما لا تفعله هذه الوحدةُ بقصد: لا تُشتَقُّ صلاحيّةٌ من دورٍ هنا. مصفوفةُ
 * «دور → صلاحيّات» هي M1-05، ومكانُها مُصدِرُ الرمزِ لا نقطةُ الفرض — كي لا
 * تُصبح لكلِّ خدمةٍ نسختُها من المصفوفةِ فتتفارق.
 */

import { AuthErrorCode, AuthorizationError, AuthenticationError } from "./errors.js";
import type { Principal, UserPrincipal } from "./principal.js";
import { isAnonymousPrincipal, isUserPrincipal } from "./principal.js";

/** صلاحيّاتُ الـ`Principal`، وقائمةٌ فارغةٌ للمجهولِ دائماً. */
export function scopesOf(principal: Principal): readonly string[] {
  return isAnonymousPrincipal(principal) ? [] : principal.scopes;
}

/**
 * هل انتهت مدّةُ الإثبات؟ المجهولُ لا ينتهي (لا إثباتَ له). الحدُّ **حصريّ**:
 * لحظةُ الانتهاءِ نفسُها لا تُعَدّ منتهيةً — ونفسُ الحدِّ مُثبَّتٌ باختبار.
 */
export function isExpired(principal: Principal, now: Date): boolean {
  if (isAnonymousPrincipal(principal)) return false;
  if (principal.expiresAt === undefined) return true;
  return Date.parse(principal.expiresAt) < now.getTime();
}

/**
 * مطابقةُ صلاحيّةٍ واحدةٍ. يُدعَم حرفُ البدلِ `*` في **الجزءِ الأخيرِ فقط**
 * (`orders:order:*`) — ولا يُدعَم `*` مطلقٌ يمنح كلَّ شيء، كي لا يوجد رمزٌ
 * واحدٌ يفتح النظامَ كلَّه.
 */
export function hasScope(principal: Principal, required: string): boolean {
  const granted = scopesOf(principal);
  if (granted.includes(required)) return true;
  const parts = required.split(":");
  if (parts.length !== 3) return false;
  return granted.includes(`${parts[0]}:${parts[1]}:*`);
}

/** هل يملك الـ`Principal` كلَّ الصلاحيّاتِ المطلوبة؟ (اقتران «و» لا «أو»). */
export function hasAllScopes(
  principal: Principal,
  required: readonly string[],
): boolean {
  return required.every((scope) => hasScope(principal, scope));
}

export function hasRole(principal: Principal, role: string): boolean {
  return isUserPrincipal(principal) && principal.roles.includes(role);
}

/**
 * البابُ الإلزاميُّ قبلَ أيِّ عمليّة: يرفع 401 لغيابِ/انتهاءِ الإثبات،
 * و403 لنقصِ الصلاحيّة. الترتيبُ مقصودٌ: الهويّةُ تُفحَص قبلَ الصلاحيّة كي لا
 * يُخبَر المجهولُ بأنّ الصلاحيّةَ هي الناقصة.
 */
export function assertScopes(
  principal: Principal,
  required: readonly string[],
  now: Date,
): void {
  if (isAnonymousPrincipal(principal)) {
    throw new AuthenticationError(
      AuthErrorCode.UNAUTHENTICATED,
      "الطلبُ بلا إثباتِ هويّةٍ مقبول",
    );
  }
  if (isExpired(principal, now)) {
    throw new AuthenticationError(
      AuthErrorCode.EXPIRED,
      "انتهت مدّةُ إثباتِ الهويّة",
    );
  }
  if (!hasAllScopes(principal, required)) {
    throw new AuthorizationError(
      AuthErrorCode.FORBIDDEN,
      "الصلاحيّةُ المطلوبةُ غيرُ ممنوحة",
    );
  }
}

/**
 * يتحقَّق أنّ رمزَ الخدمةِ مُوجَّهٌ إلى هذه الخدمةِ بعينها. يمنع أخذَ رمزٍ
 * صالحٍ لخدمةٍ وإعادةَ استخدامِه على خدمةٍ أخرى.
 */
export function assertAudience(
  principal: Principal,
  expectedAudience: string,
): void {
  if (principal.kind === "service" && principal.audience !== expectedAudience) {
    throw new AuthenticationError(
      AuthErrorCode.AUDIENCE_MISMATCH,
      "الرمزُ مُوجَّهٌ إلى خدمةٍ أخرى",
    );
  }
}

/**
 * منعُ IDOR على مستوى الكائن: صاحبُ الكائنِ يُقارَن بالمعرِّفِ العامِّ للفاعل.
 * الفاعلُ الإداريُّ لا يُستثنى ضمنيّاً — استثناؤه يحتاج صلاحيّةً صريحةً
 * (`<service>:<resource>:read_any`) يُمرِّرها المُنادي.
 */
export function assertObjectOwner(
  principal: Principal,
  ownerPublicId: string,
  overrideScope?: string,
): void {
  if (overrideScope !== undefined && hasScope(principal, overrideScope)) return;
  const actorPublicId = ownerPublicIdOf(principal);
  if (actorPublicId === undefined || actorPublicId !== ownerPublicId) {
    throw new AuthorizationError(
      AuthErrorCode.NOT_OWNER,
      "الكائنُ لا يملكه صاحبُ الطلب",
    );
  }
}

/**
 * المعرِّفُ العامُّ الذي تُنسَب إليه المِلكيّة: معرِّفُ المستخدمِ نفسِه، أو
 * مَن تنوب عنه الخدمةُ في سلسلةِ طلبٍ بشريّةِ المنشأ.
 */
export function ownerPublicIdOf(principal: Principal): string | undefined {
  if (principal.kind === "user") return principal.waslaPublicId;
  if (principal.kind === "service") return principal.onBehalfOfPublicId;
  return undefined;
}

/** الفاعلُ المرتبطُ بمستأجرٍ واحدٍ لا يرى غيرَه. */
export function assertTenant(
  principal: UserPrincipal,
  tenantId: string,
): void {
  if (principal.tenantId !== tenantId) {
    throw new AuthorizationError(
      AuthErrorCode.NOT_OWNER,
      "الكائنُ يتبع مستأجراً آخر",
    );
  }
}
