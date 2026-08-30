/**
 * جسرُ الرمزِ إلى الترويسات (M1-03).
 *
 * هذا الملفُّ **لا يعرف إطارَ ويبٍ بعينِه**: يأخذ خريطةَ ترويساتٍ ويردُّ خريطةَ
 * ترويسات. فالوسيطُ المركزيُّ (`M1-04`) هو مَن يربطه بـFastify، والعملاءُ
 * الخارجونَ في `services/<name>/src/infrastructure/http-<peer>.ts` هم مَن
 * يستدعي المُنتِج.
 * وسببُ هذا الحدِّ أنّ ADR-018 يُلزِم بقاءَ منطقِ الهويّةِ بعيداً عن HTTP كي
 * يكون قابلاً للاختبارِ بلا مقبسٍ — والاختبارُ عبرَ مقبسٍ حقيقيٍّ موجودٌ فوقَه
 * لا بدلاً منه.
 */

import { anonymous } from "@wasla/auth-sdk";
import type { Principal, ServicePrincipal } from "@wasla/auth-sdk";

import { ServiceAuthError } from "./errors.js";
import type { MintServiceTokenOptions, VerifyServiceTokenOptions } from "./token.js";
import { mintServiceToken, verifyServiceToken } from "./token.js";

/**
 * ترويسةُ إثباتِ هويّةِ الخدمة. **ليست `Authorization`** بقصدٍ: `Authorization`
 * محلُّ جلسةِ المستخدمِ (`M1-02`)، وخلطُ الاثنَينِ في ترويسةٍ واحدةٍ يُنتِج
 * سؤالاً لا جوابَ له عندَ نداءٍ يحمل الهويّتَين — خدمةٌ تُنادي نيابةً عن مستخدم.
 * فالفصلُ يجعل «مَن يُنادي» و«لمَن يُنادي» حقلَينِ مستقلَّينِ لا حقلاً واحداً متنازعاً.
 */
export const SERVICE_AUTH_HEADER = "x-wasla-service-auth";

/** ترويساتُ نداءٍ صادرٍ موقَّعٍ. */
export function serviceAuthHeaders(
  options: MintServiceTokenOptions,
): Record<string, string> {
  return { [SERVICE_AUTH_HEADER]: mintServiceToken(options) };
}

/** يقرأ الترويسةَ بلا حساسيّةٍ لحالةِ الأحرفِ، ويرفض التكرار. */
function readHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): string | undefined {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== SERVICE_AUTH_HEADER) continue;
    if (Array.isArray(value)) {
      // ترويسةٌ مكرَّرةٌ: لا يُقرأ «آخرُها» ولا «أوّلُها». اختيارُ أحدِهما هو
      // بابُ تهريبِ ترويساتٍ (header smuggling): وسيطٌ يقرأ الأولى وخدمةٌ
      // تقرأ الأخيرة. فالغموضُ يُرفَض بوصفِه غموضاً.
      throw new ServiceAuthError(
        "malformed_token",
        "ترويسةُ إثباتِ الخدمةِ مكرَّرةٌ.",
      );
    }
    if (value === undefined) continue;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  return undefined;
}

/**
 * يتحقَّق من طلبٍ واردٍ ويردُّ `Principal` **دائماً**: `ServicePrincipal` عندَ
 * النجاحِ، و`AnonymousPrincipal` عندَ غيابِ الترويسةِ أو فشلِ التحقُّق.
 *
 * **ولا يردُّ `undefined` أبداً، وهذا هو جوهرُ ADR-018:** غيابُ الإثباتِ يُمثَّل
 * صراحةً كي لا يكون موضعٌ نسيَ الفحصَ بابَ تجاوزٍ صامتاً — وهو الشكلُ النمطيُّ
 * لثغرةِ الحدودِ `AUD-004`. ويُفرَّق بين `no_credentials` (لا ترويسةَ) و
 * `unverified_credentials` (ترويسةٌ أخفقَت) لأنّ الأوّلَ حالٌ متوقَّعةٌ في
 * نداءٍ عامٍّ، والثانيَ **حدثٌ أمنيٌّ يجب أن يُرصَد**.
 *
 * ويُعاد الخطأُ في `rejection` كي يُسجِّله المُشغِّلُ داخليّاً بلا أن يُرَدَّ
 * تفصيلُه على السلك.
 */
export function authenticateServiceRequest(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  options: VerifyServiceTokenOptions,
): { principal: Principal; rejection?: ServiceAuthError } {
  let token: string | undefined;
  try {
    token = readHeader(headers);
  } catch (error) {
    return {
      principal: anonymous("unverified_credentials"),
      rejection: error as ServiceAuthError,
    };
  }

  if (token === undefined) {
    return { principal: anonymous("no_credentials") };
  }

  try {
    return { principal: verifyServiceToken(token, options) };
  } catch (error) {
    if (error instanceof ServiceAuthError) {
      return {
        principal: anonymous("unverified_credentials"),
        rejection: error,
      };
    }
    throw error;
  }
}

/**
 * الصورةُ الصارمةُ: تردُّ `ServicePrincipal` أو ترمي. تُستخدَم على الحدودِ
 * الداخليّةِ التي **لا معنى** لنداءٍ مجهولٍ عليها إطلاقاً.
 */
export function requireServiceCaller(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  options: VerifyServiceTokenOptions,
): ServicePrincipal {
  const result = authenticateServiceRequest(headers, options);
  if (result.principal.kind === "service") return result.principal;
  throw (
    result.rejection ??
    new ServiceAuthError("missing_credentials", "لا إثباتَ هويّةِ خدمةٍ في الطلب.")
  );
}
