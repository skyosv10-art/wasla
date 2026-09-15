/**
 * دوالُّ القرارِ (`M1-05`) — **نقيّةٌ**: لا شبكةَ ولا ساعةَ ولا حالةَ.
 *
 * ── لِمَ دوالُّ نقيّةٌ لا وسيطٌ في مسارِ الطلبِ ────────────────────────────
 * لأنَّ موضعَ الاستدعاءِ ليسَ واحداً: المصفوفةُ تُسألُ في **جذرِ التركيبِ**
 * (أيَحقُّ لهذهِ الخدمةِ أن تُوقِّعَ بهذهِ الصلاحيّاتِ؟) وفي **البوّابةِ**
 * (أيُطابِقُ الإعدادُ المُعلَنَ؟) وفي **الاختبارِ السلبيِّ** (أيُرفَضُ الدورُ
 * الخاطئُ؟). ودالّةٌ نقيّةٌ تُسألُ في الثلاثةِ بالجوابِ نفسِه؛ ووسيطٌ يُسألُ
 * في موضعٍ واحدٍ ثمَّ تُكتَبُ لهُ نسخةٌ للبوّابةِ فتتباعدُ النسختانِ.
 *
 * ── وما لا تفعلُهُ هذهِ الدوالُّ ──────────────────────────────────────────
 * لا تُصدِرُ رمزاً ولا تتحقَّقُ من توقيعٍ — ذاكَ `@wasla/service-auth` وحدَه
 * (`ADR-020`). وهذهِ الحزمةُ **لا تعتمدُ عليهِ**، والاتجاهُ مقصودٌ: المصفوفةُ
 * بياناتٌ وقرارٌ، والتوقيعُ آلةٌ؛ ولو اعتمدتِ الآلةُ على القرارِ وقرارُها عليها
 * لَصارَ الرسمُ حلقةً ولَتعذَّرَ اختبارُ أحدِهما بلا الآخر.
 *
 * المرجع: ADR-027
 */

import { AuthzPolicyError } from "./errors.js";
import { PRODUCTION_GRANTS, grantFor, type Role } from "./grants.js";
import { enforcedScopesAt, type Audience } from "./operations.js";
import { bindingFor, type BindingDimension } from "./bindings.js";

export interface ScopeRequest {
  readonly role: Role;
  readonly audience: Audience;
  readonly scopes: readonly string[];
}

/** نتيجةُ قرارٍ — تُقرأُ في سجلٍّ بلا تحليلِ نصِّ استثناءٍ. */
export type PolicyDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly error: AuthzPolicyError };

/**
 * أيَحقُّ لهذا الدورِ أن يحملَ هذهِ الصلاحيّاتِ على هذا الجمهورِ؟
 *
 * المنحُ **سقفٌ لا أمرٌ**: طلبُ أقلَّ منهُ مسموحٌ ومحمودٌ، وطلبُ صلاحيّةٍ
 * خارجَهُ مرفوضٌ. والمجموعةُ الفارغةُ مسموحةٌ إذا وُجِدَ منحٌ على الجمهورِ —
 * فمِجَسُّ صحّةٍ يُوقِّعُ بلا صلاحيّةٍ (`DELIVERY_MARKETPLACE_PROBE_SCOPES`)
 * سلوكٌ صحيحٌ لا نقصُ إعدادٍ.
 */
export function evaluateScopeRequest(request: ScopeRequest): PolicyDecision {
  const { role, audience, scopes } = request;

  if (PRODUCTION_GRANTS[role] === undefined) {
    return {
      allowed: false,
      error: new AuthzPolicyError(
        "ROLE_NOT_DECLARED",
        `الدورُ «${role}» غيرُ مُعلَنٍ في مصفوفةِ M1-05 — دورٌ بلا إعلانٍ لا يُمنَحُ شيئاً.`,
        { role, audience, offendingScopes: scopes },
      ),
    };
  }

  const grant = grantFor(role, audience);
  if (grant === undefined) {
    return {
      allowed: false,
      error: new AuthzPolicyError(
        "AUDIENCE_NOT_GRANTED",
        `الدورُ «${role}» مُعلَنٌ ولا منحَ لهُ على الحدِّ «${audience}» في مصفوفةِ M1-05.`,
        { role, audience, offendingScopes: scopes },
      ),
    };
  }

  const ungranted = scopes.filter((s) => !grant.scopes.includes(s));
  if (ungranted.length > 0) {
    return {
      allowed: false,
      error: new AuthzPolicyError(
        "SCOPE_NOT_GRANTED",
        `الدورُ «${role}» يطلبُ على «${audience}» صلاحيّاتٍ خارجَ منحِه: ${ungranted.join(", ")}.`,
        { role, audience, offendingScopes: ungranted },
      ),
    };
  }

  return { allowed: true };
}

/** الصيغةُ الرامية — تُستعملُ في جذرِ التركيبِ حيثُ الرفضُ يجبُ أن يكونَ عطلاً مرئيّاً. */
export function assertScopeRequest(request: ScopeRequest): void {
  const decision = evaluateScopeRequest(request);
  if (!decision.allowed) throw decision.error;
}

/**
 * أصلاحيّةٌ مفروضةٌ فعلاً على هذا الحدِّ؟
 *
 * **ليسَ هذا سؤالَ تفويضٍ** بل سؤالُ صدقِ مصفوفةٍ: منحٌ يُشيرُ إلى اسمٍ لا
 * يفرضُهُ أيُّ مسارٍ في الحدِّ هوَ إمّا خطأٌ مطبعيٌّ صامتٌ (فيُقرأُ المنحُ
 * أوسعَ مِمّا هوَ) وإمّا بقيّةُ صلاحيّةٍ ماتتْ في الشفرةِ وبقيتْ في المصفوفةِ.
 * والفحصُ 16 يُسقِطُ الدفعةَ في الحالَتَين.
 */
export function isScopeEnforcedAt(audience: Audience, scope: string): boolean {
  return enforcedScopesAt(audience).includes(scope);
}

export interface OwnerCheck {
  readonly audience: Audience;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly dimension: BindingDimension;
  /** المالكُ أو المستأجرُ كما يدَّعيهِ المُنادي. */
  readonly claimed: string;
  /** المالكُ أو المستأجرُ كما هوَ مُسجَّلٌ على المَورِدِ. */
  readonly actual: string;
}

/**
 * أيَملِكُ المُدَّعي هذا المَورِدَ؟ — قرارٌ نقيٌّ يُعبِّرُ عن **قوّةِ** الربطِ
 * لا عن نجاحِ مقارنةٍ فقط.
 *
 * والفرقُ جوهريٌّ: مقارنةٌ ناجحةٌ على قيمةٍ يكتبُها المُنادي **ليست إثباتَ
 * ملكيّةٍ**. فالدالّةُ تردُّ الرفضَ عندَ عدمِ التطابقِ، وتردُّ القبولَ عندَ
 * التطابقِ، **ولا تدَّعي في الحالَتَين أنَّ الملكيّةَ أُثبِتَتْ** إذا كانَ
 * الربطُ `caller-asserted` — وقوّةُ الربطِ مقروءةٌ من `bindingFor`.
 */
export function evaluateOwnerBinding(check: OwnerCheck): PolicyDecision {
  if (check.claimed === check.actual) return { allowed: true };

  const binding = bindingFor(check.audience, check.method, check.path, check.dimension);
  const strength = binding?.strength ?? "none";
  const code = check.dimension === "owner" ? "OWNER_BINDING_VIOLATED" : "TENANT_BINDING_VIOLATED";

  return {
    allowed: false,
    error: new AuthzPolicyError(
      code,
      `الفاعلُ «${check.claimed}» ليسَ ${check.dimension === "owner" ? "مالكَ" : "مستأجرَ"} المَورِدِ ` +
        `في «${check.method} ${check.path}» (المُسجَّلُ: «${check.actual}» · قوّةُ الربطِ: ${strength}).`,
      { role: check.claimed, audience: check.audience },
    ),
  };
}
