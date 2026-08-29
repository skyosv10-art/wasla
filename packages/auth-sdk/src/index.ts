/**
 * @wasla/auth-sdk — الحدُّ الأمنيُّ المشتركُ: نموذجُ `Principal` الموحَّدُ،
 * قراءتُه، قراراتُ التفويضِ عليه، وتمثيلُه الآمنُ في السجلّات.
 *
 * عنصرُ العمل: **M1-01** · القرارُ الحاكم:
 * docs/15-decisions/ADR-018-unified-principal-model-and-user-service-boundary.md
 *
 * حدودُ هذه الحزمةِ بقصد:
 * - لا تُصدِر رموزاً ولا تتحقَّق من توقيعٍ (M1-02 للجلسةِ البشريّة، M1-03 لهويّةِ الخدمة).
 * - لا تعرف HTTP (الوسيطُ المركزيُّ M1-04 هو مَن يربطها بالطلب).
 * - لا تحمل مصفوفةَ «دور → صلاحيّات» (M1-05 عندَ المُصدِر).
 */

export type {
  AnonymousPrincipal,
  Principal,
  PrincipalChannel,
  PrincipalKind,
  ServicePrincipal,
  UserActorType,
  UserPrincipal,
} from "./principal.js";
export {
  anonymous,
  isAnonymousPrincipal,
  isServicePrincipal,
  isUserPrincipal,
} from "./principal.js";

export { parsePrincipal } from "./parse.js";

export {
  assertAudience,
  assertObjectOwner,
  assertScopes,
  assertTenant,
  hasAllScopes,
  hasRole,
  hasScope,
  isExpired,
  ownerPublicIdOf,
  scopesOf,
} from "./authorize.js";

export type { PrincipalDescription } from "./describe.js";
export { describePrincipal } from "./describe.js";

export type { AuthErrorCodeValue } from "./errors.js";
export {
  AuthErrorCode,
  AuthenticationError,
  AuthorizationError,
} from "./errors.js";
