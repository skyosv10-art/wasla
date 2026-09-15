/**
 * قرارُ **تركيبِ المُوقِّعِ** — الموجةُ 3 من `M1-05B`.
 *
 * ── ما الذي تغيَّرَ ولِمَ ملفٌّ ثالثٌ ──────────────────────────────────────
 * حتّى الموجةِ 2 كانتِ المصفوفةُ تُنفَذُ في **البوّابةِ** وحدَها (الفحصُ 16
 * يقرأُ جذورَ التركيبِ ساكناً). وحارسٌ ساكنٌ يقرأُ ما كُتِبَ، لا ما يجري: دورٌ
 * يُبنى باسمٍ مُتغيِّرٍ أو صلاحيّاتٍ تأتي وسيطاً لا يراهُ الحارسُ أصلاً —
 * فكانَ معيارُ خروجِ `M1-05B` يطلبُ **رفضاً حيّاً عندَ الإصدارِ** لا خضرةَ
 * بوّابةٍ. وهذا الملفُّ هوَ ذلكَ القرارُ، ويُنادَى من
 * `createServiceRequestSigner` في `@wasla/service-auth`.
 *
 * ── ولِمَ لا يُنادَى من `mintServiceToken` نفسِهِ ─────────────────────────
 * لأنَّ `mintServiceToken` هوَ **البدائيُّ** الذي تحتاجُهُ الاختباراتُ السلبيّةُ
 * لتصنعَ رمزاً زائدَ الصلاحيّةِ ثمَّ تقيسَ رفضَ الحدِّ لهُ. فلو أُنفِذَتِ
 * المصفوفةُ فيهِ لَاستحالَ قياسُ رفضِ الحدِّ أصلاً — ولَصارَ الخضرةُ عمىً.
 * ولئلّا يصيرَ البدائيُّ باباً خلفيّاً للإنتاجِ، **يُسَيَّجُ ساكناً**: البابُ 9
 * في الفحصِ 16 يرفضُ ذكرَ `mintServiceToken` أو `serviceAuthHeaders` في أيِّ
 * ملفٍّ خارجَ `packages/service-auth/` وخارجَ ملفّاتِ الاختبارِ. فالمسارُ
 * الإنتاجيُّ الوحيدُ إلى رمزٍ هوَ المُوقِّعُ، والمُوقِّعُ يمرُّ من هنا.
 *
 * ── وأمّا أدوارُ الأسطولِ ─────────────────────────────────────────────────
 * فسقفُها `FLEET_GRANTS` جمهورٌ لا صلاحيّةٌ (والسببُ مكتوبٌ هناك)، وحمايةُ
 * الإنتاجِ منها ليست في هذا الملفِّ بل في البابِ 5: اسمُ أسطولٍ في ملفٍّ
 * إنتاجيٍّ يُسقِطُ الدفعةَ.
 *
 * المرجع: ADR-030 · ADR-027 §3
 */

import { AuthzPolicyError } from "./errors.js";
import { PRODUCTION_GRANTS, fleetGrantFor } from "./grants.js";
import type { Audience } from "./operations.js";
import { evaluateScopeRequest, type PolicyDecision } from "./policy.js";

export interface SignerComposition {
  readonly role: string;
  readonly audience: string;
  readonly scopes: readonly string[];
}

/**
 * أيَحقُّ لهذا التركيبِ أن يُصدِرَ رمزاً؟
 *
 * ثلاثُ حالاتٍ لا رابعَ لها: دورُ إنتاجٍ ⇒ يُقاسُ بسقفِ منحِهِ صلاحيّةً
 * صلاحيّةً؛ دورُ أسطولٍ مُعلَنٌ ⇒ يُقاسُ بجمهورِهِ؛ دورٌ لا إعلانَ لهُ ⇒
 * رفضٌ. **والمجهولُ لا يُقرأُ سماحاً.**
 */
export function evaluateSignerComposition(composition: SignerComposition): PolicyDecision {
  const { role, audience, scopes } = composition;

  if (PRODUCTION_GRANTS[role] !== undefined) {
    return evaluateScopeRequest({ role, audience: audience as Audience, scopes });
  }

  const fleet = fleetGrantFor(role);
  if (fleet === undefined) {
    return {
      allowed: false,
      error: new AuthzPolicyError(
        "ROLE_NOT_DECLARED",
        `الدورُ «${role}» غيرُ مُعلَنٍ في «PRODUCTION_GRANTS» ولا في «FLEET_GRANTS» — ` +
          "ولا يُصدَرُ رمزٌ لدورٍ بلا إعلانٍ.",
        { role, audience, offendingScopes: scopes },
      ),
    };
  }

  if (fleet.audiences !== "any-audience" && !fleet.audiences.includes(audience)) {
    return {
      allowed: false,
      error: new AuthzPolicyError(
        "AUDIENCE_NOT_GRANTED",
        `دورُ الأسطولِ «${role}» مُعلَنٌ ولا جمهورَ لهُ باسمِ «${audience}» — ` +
          `المُعلَنُ: ${fleet.audiences.join(", ")}.`,
        { role, audience, offendingScopes: scopes },
      ),
    };
  }

  if (fleet.scopes !== "any-scope") {
    const ungranted = scopes.filter((s) => !fleet.scopes.includes(s));
    if (ungranted.length > 0) {
      return {
        allowed: false,
        error: new AuthzPolicyError(
          "SCOPE_NOT_GRANTED",
          `دورُ الأسطولِ «${role}» يطلبُ على «${audience}» صلاحيّاتٍ خارجَ سقفِهِ: ${ungranted.join(", ")}.`,
          { role, audience, offendingScopes: ungranted },
        ),
      };
    }
  }

  return { allowed: true };
}

/** الصيغةُ الرامية — تُنادَى في بناءِ المُوقِّعِ فيصيرُ الرفضُ عطلاً مرئيّاً لا رمزاً زائداً. */
export function assertSignerComposition(composition: SignerComposition): void {
  const decision = evaluateSignerComposition(composition);
  if (!decision.allowed) throw decision.error;
}
