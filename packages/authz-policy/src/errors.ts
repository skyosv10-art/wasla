/**
 * أخطاءُ مصفوفةِ التفويض (`M1-05`).
 *
 * ── لِمَ خطأٌ خاصٌّ لا `Error` عامٌّ ───────────────────────────────────────
 * موضعُ الرفضِ هنا **جذرُ التركيبِ** لا مسارُ الطلبِ: خدمةٌ رُكِّبت لتطلبَ
 * صلاحيّةً لا تملكُها تموتُ عندَ الإقلاعِ. ورسالةٌ عامّةٌ في الإقلاعِ تُقرأُ
 * «تعذَّرَ التشغيلُ» فيُبحَثُ عن العلّةِ في الشبكةِ وقواعدِ البياناتِ، والعلّةُ
 * قرارُ تفويضٍ مكتوبٌ في ملفٍّ واحدٍ. فاسمُ الخطأِ ورمزُهُ **يدلّانِ على الملفِّ**.
 *
 * ولا يُشتَقُّ من `@wasla/errors` لأنّ ذاك سجلُّ أخطاءِ **الحدِّ** (يُترجَمُ إلى
 * جسمِ جوابٍ ورمزِ حالةٍ)، وهذا خطأُ **تركيبٍ** لا يصلُ عميلاً أبداً: من رآهُ
 * فقد رآهُ في سجلِّ الإقلاعِ لا في جوابِ HTTP.
 */

/** رمزُ الرفضِ — مغلقٌ كي تُقرأَ الحالاتُ في السجلِّ بلا تحليلِ نصٍّ. */
export type AuthzPolicyDenialCode =
  /** الدورُ نفسُه غيرُ معروفٍ في المصفوفة. */
  | "ROLE_NOT_DECLARED"
  /** الدورُ معروفٌ ولا منحَ له على هذا الجمهور. */
  | "AUDIENCE_NOT_GRANTED"
  /** الدورُ يطلبُ صلاحيّةً خارجَ منحِه على هذا الجمهور. */
  | "SCOPE_NOT_GRANTED"
  /** الصلاحيّةُ ليست صلاحيّةً مفروضةً على أيِّ عمليّةٍ في الجمهورِ المقصود. */
  | "SCOPE_NOT_ENFORCED_AT_AUDIENCE"
  /** الفاعلُ ليس مالكَ المَورِدِ في عمليّةٍ مربوطةٍ بالملكيّة. */
  | "OWNER_BINDING_VIOLATED"
  /** الفاعلُ خارجَ المستأجرِ في عمليّةٍ مربوطةٍ بالمستأجر. */
  | "TENANT_BINDING_VIOLATED";

export class AuthzPolicyError extends Error {
  readonly code: AuthzPolicyDenialCode;
  readonly role: string;
  readonly audience: string | undefined;
  readonly offendingScopes: readonly string[];

  constructor(
    code: AuthzPolicyDenialCode,
    message: string,
    context: {
      readonly role: string;
      readonly audience?: string;
      readonly offendingScopes?: readonly string[];
    },
  ) {
    super(message);
    this.name = "AuthzPolicyError";
    this.code = code;
    this.role = context.role;
    this.audience = context.audience;
    this.offendingScopes = context.offendingScopes ?? [];
  }
}
