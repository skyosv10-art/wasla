/**
 * `@wasla/authz-policy` — مصفوفةُ سياساتِ التفويضِ (`M1-05`).
 *
 * مصدرٌ واحدٌ لثلاثةِ أسئلةٍ لم يكنْ لها موضعٌ في المستودعِ:
 *   1. **الدورُ**: أيُّ خدمةٍ يحقُّ لها أن تحملَ أيَّ صلاحيّةٍ على أيِّ حدٍّ؟
 *   2. **الملكيّةُ**: أيُّ العملياتِ تقرأُ مَورِداً مملوكاً، وبأيِّ قوّةِ ربطٍ؟
 *   3. **المستأجرُ**: السؤالُ نفسُهُ على مستوى المتجرِ لا الشخصِ.
 *
 * ولا تُصدِرُ هذهِ الحزمةُ رمزاً ولا تتحقَّقُ منه؛ ولا يعتمدُ عليها الحدُّ.
 * وموضعُ إنفاذِها **اثنانِ** بعدَ الموجةِ 3 من `M1-05B`: **البوّابةُ**
 * (`الفحصُ 16`) تقرأُ جذورَ التركيبِ ساكناً، و**المُوقِّعُ** يُنادي
 * `assertSignerComposition` في زمنِ التشغيلِ فيَموتُ تركيبٌ يطلبُ ما لا
 * يُمنَحُ — لأنَّ الساكنَ يقرأُ ما كُتِبَ لا ما يجري (ADR-030).
 *
 * المرجع: ADR-027 · docs/07-security/AUTHORIZATION_POLICY_MATRIX.md
 */

export { AuthzPolicyError, type AuthzPolicyDenialCode } from "./errors.js";

export {
  AUDIENCES,
  ENFORCED_OPERATIONS,
  allEnforcedScopes,
  enforcedScopesAt,
  operationsRequiring,
  type Audience,
  type EnforcedOperation,
  type HttpMethod,
} from "./operations.js";

export {
  FLEET_GRANTS,
  PRODUCTION_GRANTS,
  TEST_FLEET_ROLES,
  fleetGrantFor,
  grantFor,
  grantedAudiences,
  holdersOf,
  type FleetGrant,
  type Grant,
  type Role,
} from "./grants.js";

export {
  OPERATION_BINDINGS,
  TENANT_BOUND_OPERATION_COUNT,
  TOKEN_BOUND_OPERATION_COUNT,
  UNCLASSIFIED_OPERATION_COUNT,
  bindingFor,
  type BindingDimension,
  type BindingStrength,
  type OperationBinding,
} from "./bindings.js";

export {
  assertScopeRequest,
  evaluateOwnerBinding,
  evaluateScopeRequest,
  isScopeEnforcedAt,
  type OwnerCheck,
  type PolicyDecision,
  type ScopeRequest,
} from "./policy.js";

export {
  assertSignerComposition,
  evaluateSignerComposition,
  type SignerComposition,
} from "./signer.js";
