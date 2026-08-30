/**
 * @wasla/service-auth — هويّةُ خدمةٍ إلى خدمة: المِنتاجُ والتحقُّق.
 *
 * عنصرُ العمل: **M1-03** · القرارُ الحاكم:
 * docs/15-decisions/ADR-020-service-to-service-identity.md
 *
 * موضعُ هذه الحزمةِ بقصدٍ ([ADR-018](../../../docs/15-decisions/ADR-018-unified-principal-model-and-user-service-boundary.md)):
 * `@wasla/auth-sdk` **يُمنع** أن تُصدِر رموزاً أو تتحقَّق من توقيعٍ — فهي شكلُ
 * الهويّةِ وقراراتُ التفويضِ عليها لا وسيلةُ إثباتِها. فكما وُضِع تحقُّقُ
 * `init-data` في `telegram-adapter` (مفرداتُ تلغرام)، وُضِع إثباتُ هويّةِ
 * الخدمةِ هنا — ويُسلَّم المُخرَجُ بالشكلِ الموحَّدِ نفسِه `ServicePrincipal`.
 *
 * حدودُ هذه الحزمةِ:
 * - لا تعرف إطارَ ويبٍ (الفرضُ على الحدودِ عنصرُ `M1-04`).
 * - لا تحمل مصفوفةَ «دور → صلاحيّات» (`M1-05`).
 * - لا تمنع الإعادةَ داخلَ نافذةِ العمر (دَينٌ مُعلَنٌ في ADR-020 §3).
 */

export type {
  ServiceAuthRejection,
} from "./errors.js";
export { ServiceAuthError } from "./errors.js";

export type {
  ServiceAuthKey,
  ServiceAuthKeyDescription,
  ServiceAuthKeyRegistryOptions,
} from "./keys.js";
export {
  keyRegistryFromEnv,
  MIN_SECRET_BYTES,
  ServiceAuthKeyError,
  ServiceAuthKeyRegistry,
} from "./keys.js";

export type {
  MintServiceTokenOptions,
  VerifyServiceTokenOptions,
} from "./token.js";
export {
  canonicalRequestBinding,
  DEFAULT_CLOCK_SKEW_SECONDS,
  DEFAULT_SERVICE_TOKEN_TTL_SECONDS,
  MAX_SERVICE_TOKEN_TTL_SECONDS,
  mintServiceToken,
  SERVICE_TOKEN_SCHEME,
  verifyServiceToken,
} from "./token.js";

export {
  authenticateServiceRequest,
  requireServiceCaller,
  SERVICE_AUTH_HEADER,
  serviceAuthHeaders,
} from "./http.js";
