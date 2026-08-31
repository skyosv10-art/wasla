/**
 * @wasla/service-auth — هويّةُ خدمةٍ إلى خدمة: المِنتاجُ والتحقُّقُ والفرض.
 *
 * عنصرُ العمل: **M1-03** · القراراتُ الحاكمة:
 * ADR-020 (الاختيارُ والحدُّ المعماريُّ) · ADR-021 (منعُ الإعادةِ) ·
 * ADR-022 (دورةُ حياةِ المفتاحِ).
 *
 * موضعُ هذه الحزمةِ بقصدٍ ([ADR-018](../../../docs/15-decisions/ADR-018-unified-principal-model-and-user-service-boundary.md)):
 * `@wasla/auth-sdk` **يُمنع** أن تُصدِر رموزاً أو تتحقَّق من توقيعٍ — فهي شكلُ
 * الهويّةِ وقراراتُ التفويضِ عليها لا وسيلةُ إثباتِها. فكما وُضِع تحقُّقُ
 * `init-data` في `telegram-adapter` (مفرداتُ تلغرام)، وُضِع إثباتُ هويّةِ
 * الخدمةِ هنا — ويُسلَّم المُخرَجُ بالشكلِ الموحَّدِ نفسِه `ServicePrincipal`.
 *
 * ── حدودُ هذه الحزمةِ، وما خرجَ منها ──────────────────────────────────────
 * - **لا تحمل مصفوفةَ «دور → صلاحيّات»** (`M1-05`). و`enforce.ts` يقرأ الصلاحيّةَ
 *   المُعلَنةَ للحدِّ ولا يشتقُّ صلاحيّةً من دورٍ.
 * - **لا تعرف إطارَ ويبٍ.** الفرضُ هنا قرارٌ يُرَدُّ، ورَبطُه بـFastify في طبقةِ
 *   HTTP عندَ كلِّ خدمةٍ مفروضةٍ حتّى يُوحِّده الوسيطُ المركزيُّ (`M1-04`).
 * - **صارت تمنع الإعادةَ** بعقدِ `ServiceTokenReplayGuard` و`jti` إلزاميٍّ
 *   (ADR-021) — وكان ذلك دَيناً مُعلَناً في ADR-020 §3، فأُغلِق.
 * - **مخزنُ الآثارِ في الذاكرةِ لا يكفي لعمليّاتٍ متعدِّدةٍ**، وهذا مقولٌ في
 *   `replay.ts` ومُسجَّلٌ خطراً (`RISK-0015`) لا مُفترَضٌ مَحلولاً.
 * - **HMAC ليس ثقةً مطلقةً**: كلُّ خدمةٍ تملك السرَّ تستطيع انتحالَ غيرِها،
 *   وحدُّ ذلك مكتوبٌ في ADR-020 §6 (الآنَ: هويّةٌ بـHMAC / لاحقاً: mTLS وهويّةُ
 *   حِمْلِ عملٍ). وليس ملغىً بل مُؤجَّلٌ لغيابِ طبقةِ نشرٍ في المستودع.
 */

export type { ServiceAuthRejection } from "./errors.js";
export { ServiceAuthError } from "./errors.js";

export type {
  ServiceAuthKey,
  ServiceAuthKeyDescription,
  ServiceAuthKeyRegistryOptions,
  ServiceAuthKeyResolution,
  ServiceAuthKeyStatus,
} from "./keys.js";
export {
  keyRegistryFromEnv,
  MIN_SECRET_BYTES,
  SERVICE_AUTH_KEY_STATUSES,
  ServiceAuthKeyError,
  ServiceAuthKeyRegistry,
} from "./keys.js";

export type {
  MintServiceTokenOptions,
  VerifiedServiceToken,
  VerifiedServiceTokenTrace,
  VerifyServiceTokenOptions,
} from "./token.js";
export {
  canonicalRequestBinding,
  DEFAULT_CLOCK_SKEW_SECONDS,
  DEFAULT_SERVICE_TOKEN_TTL_SECONDS,
  MAX_SERVICE_TOKEN_TTL_SECONDS,
  mintServiceToken,
  SERVICE_TOKEN_SCHEME,
  SUPERSEDED_TOKEN_SCHEMES,
  verifyServiceToken,
  verifyServiceTokenDetailed,
} from "./token.js";

export {
  authenticateServiceRequest,
  authenticateServiceRequestDetailed,
  requireServiceCaller,
  SERVICE_AUTH_HEADER,
  serviceAuthHeaders,
} from "./http.js";

export type {
  InMemoryReplayGuardOptions,
  ServiceTokenReplayDecision,
  ServiceTokenReplayGuard,
  ServiceTokenReplayRecord,
} from "./replay.js";
export {
  DEFAULT_MAX_REPLAY_ENTRIES,
  InMemoryServiceTokenReplayGuard,
  ServiceTokenReplayStoreUnavailableError,
} from "./replay.js";

export type {
  ServiceRequestSigner,
  ServiceRequestSignerOptions,
} from "./outbound.js";
export {
  createServiceRequestSigner,
  refusingServiceRequestSigner,
} from "./outbound.js";

export type {
  EnforcedRequest,
  ServiceIdentityDecision,
  ServiceIdentityEnforcementOptions,
} from "./enforce.js";
export {
  enforceServiceIdentity,
  REPLAY_STORE_UNAVAILABLE_CODE,
} from "./enforce.js";
