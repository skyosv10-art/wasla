/**
 * أخطاءُ هويّةِ الخدمةِ (M1-03).
 *
 * الأكوادُ **ليست جديدةً**: تُعاد إلى أكوادِ [ADR-018](../../../docs/15-decisions/ADR-018-unified-principal-model-and-user-service-boundary.md)
 * نفسِها في `@wasla/auth-sdk` (`AUTHN_UNAUTHENTICATED` · `AUTHN_EXPIRED` ·
 * `AUTHN_AUDIENCE_MISMATCH`) كي لا يكون لكلِّ مُتحقِّقٍ قاموسُه — وهو عينُ ما
 * أنتجَ `AUD-004`. والجديدُ هنا **السببُ التشخيصيُّ** (`reason`) لا الكود.
 *
 * والفرقُ بينهما مقصودٌ: الكودُ ما يُرَدُّ على السلك، والسببُ ما يُكتَب في
 * السجلِّ الداخليِّ. فمَن أخفقَ في التوقيعِ يرى «مرفوض» ولا يرى **أيَّ** بابٍ
 * أخفقَ عليه، وإلّا صار الردُّ نفسُه أداةَ استكشافٍ للمُهاجم.
 */

import { AuthErrorCode, AuthenticationError } from "@wasla/auth-sdk";

/**
 * سببُ رفضِ رمزِ خدمة. يُسجَّل داخليّاً ولا يُرَدُّ على السلك.
 *
 * الترتيبُ هنا هو ترتيبُ الفحصِ نفسُه في `verifyServiceToken`، وهو مقصودٌ:
 * لا يُنطَق بسببٍ دلاليٍّ (انتهاءٌ · جمهورٌ · صلاحيّةٌ) قبلَ إثباتِ التوقيع.
 */
export type ServiceAuthRejection =
  /** لا ترويسةَ إثباتٍ إطلاقاً — طلبٌ مجهولٌ لا طلبٌ مرفوضٌ. */
  | "missing_credentials"
  /** البادئةُ ليست `wsvc1.` — نسخةٌ غيرُ مدعومةٍ أو نصٌّ غريبٌ. */
  | "unsupported_scheme"
  /** عددُ الأقسامِ أو ترميزُها أو صيغةُ الحِمْلِ غيرُ صالحةٍ. */
  | "malformed_token"
  /** حقلٌ إلزاميٌّ ناقصٌ أو نوعُه غيرُ متوقَّعٍ. */
  | "invalid_claims"
  /** المفتاحُ المُشار إليه بـ`kid` غيرُ معروفٍ لهذا المُتحقِّق. */
  | "unknown_key"
  /** التوقيعُ لا يُطابق. */
  | "bad_signature"
  /** `iat` في المستقبلِ أكثرَ من هامشِ الانحرافِ المسموح. */
  | "issued_in_future"
  /** `exp` بلغَ أو مضى (الحدُّ غيرُ شاملٍ — كـ`isExpired` في auth-sdk). */
  | "expired"
  /** عمرُ الرمزِ المُعلَنُ أطولُ من الحدِّ الأقصى المقبولِ عندَ المُتحقِّق. */
  | "lifetime_too_long"
  /** `aud` لا يُطابق اسمَ الخدمةِ المُتحقِّقةِ. */
  | "audience_mismatch"
  /** الرمزُ مربوطٌ بطلبٍ آخرَ (طريقةٌ أو مسارٌ مختلفٌ). */
  | "request_binding_mismatch";

/** رفضُ إثباتِ هويّةِ خدمة. يحمل كودَ ADR-018 وسبباً تشخيصيّاً داخليّاً. */
export class ServiceAuthError extends AuthenticationError {
  readonly reason: ServiceAuthRejection;

  constructor(
    reason: ServiceAuthRejection,
    message: string,
    options?: { cause?: unknown; traceId?: string },
  ) {
    super(codeFor(reason), message, options);
    this.reason = reason;
  }
}

/**
 * الكودُ المُرَدُّ لكلِّ سببٍ. **الغالبُ `AUTHN_UNAUTHENTICATED` بقصدٍ:**
 * تفصيلُ الأكوادِ على أبوابِ الفحصِ يُحوِّل الردَّ إلى خريطةٍ للمُهاجم.
 * ويُستثنى بابانِ لأنّ تمييزَهما **يخدم المُشغِّلَ الشريفَ** أكثرَ ممّا يخدم
 * المهاجم: انتهاءُ المدّةِ (يُقال للمُنادي «جدِّد» لا «أنتَ مرفوض») وعدمُ
 * مطابقةِ الجمهورِ (خطأُ إعدادٍ شائعٌ في النشرِ، وإخفاؤه يُكلِّف ساعاتِ تشخيصٍ).
 * وكلاهما لا يُنطَق به إلّا **بعدَ** إثباتِ التوقيعِ، فلا يستفيد منه مَن لا يملك مفتاحاً.
 */
function codeFor(reason: ServiceAuthRejection) {
  switch (reason) {
    case "expired":
      return AuthErrorCode.EXPIRED;
    case "audience_mismatch":
      return AuthErrorCode.AUDIENCE_MISMATCH;
    default:
      return AuthErrorCode.UNAUTHENTICATED;
  }
}
