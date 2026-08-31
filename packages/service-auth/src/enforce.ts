/**
 * نقطةُ الفرضِ: من «الحزمةُ تعمل» إلى «الحدُّ يمنع» (M1-03 · الفجوةُ الثالثة).
 *
 * الخريطةُ والحدودُ المفروضةُ في
 * [SERVICE_AUTH_ENFORCEMENT](../../../docs/07-security/SERVICE_AUTH_ENFORCEMENT.md).
 *
 * ── لِمَ قرارٌ يُرَدُّ ولا استثناءٌ يُرمى ────────────────────────────────────
 * هذه الدالّةُ تردُّ **قراراً معلوماً** (`allowed` أو `denied` بحالةٍ وكودٍ) ولا
 * ترمي. والسببُ أنّ الاستثناءَ يُلتقَط في مكانٍ آخرَ ويُترجَم هناك، فيصير لكلِّ
 * خدمةٍ ترجمتُها الخاصّةُ لنفسِ الرفضِ — وهو أصلُ `AUD-004` نفسُه. والقرارُ
 * المُعاد يُختبَر بلا إطارٍ ولا مقبسٍ، ويُترجَم في موضعٍ واحدٍ لكلِّ خدمةٍ.
 *
 * ── ثلاثُ نتائجَ لا اثنتانِ، والتمييزُ مقصودٌ ───────────────────────────────
 * - **401**: لا هويّةَ، أو هويّةٌ لم تُثبَت (توقيعٌ · انتهاءٌ · جمهورٌ · ربطٌ ·
 *   مفتاحٌ مسحوبٌ · رمزٌ مُعادٌ). المُنادي **ليس مَن يقول إنّه هو**.
 * - **403**: الهويّةُ مُثبَتةٌ والصلاحيّةُ المُعلَنةُ على الحدِّ ناقصةٌ. **ولا
 *   مصفوفةَ أدوارٍ هنا**: الحدُّ يُعلِن صلاحيّتَه، والدالّةُ تقرأ ما في الرمزِ
 *   بـ`hasAllScopes` من `@wasla/auth-sdk`. ومصفوفةُ «دور → صلاحيّات» هي `M1-05`
 *   ومكانُها مُصدِرُ الرمزِ لا نقطةُ الفرض.
 * - **503**: مخزنُ آثارِ الإعادةِ لا يُجيب. **لا 200 ولا 401**: الأوّلُ يفتح
 *   البابَ على مصراعَيه، والثاني يكذب على مُنادٍ شريفٍ فيُرسِله يبحث في
 *   مفاتيحِه ساعةً والعِلّةُ في مخزنٍ (ADR-021 §5).
 *
 * ── وما لا تفعله ───────────────────────────────────────────────────────────
 * لا تعرف Fastify ولا Express ولا أيَّ إطارٍ: تأخذ طريقةً ومساراً وترويسات.
 * والوسيطُ المركزيُّ (`M1-04`) هو مَن يجعل هذا الفرضَ افتراضيّاً في كلِّ خدمةٍ؛
 * وحتّى ذلك الحينِ تربطه كلُّ خدمةٍ مفروضةٍ في طبقةِ HTTP عندَها، **وعددُها
 * مُعلَنٌ في سجلِّ التغطيةِ** لا مُقدَّرٌ.
 */

import { AuthErrorCode, hasAllScopes } from "@wasla/auth-sdk";
import type { AuthErrorCodeValue, ServicePrincipal } from "@wasla/auth-sdk";

import type { ServiceAuthRejection } from "./errors.js";
import { ServiceAuthError } from "./errors.js";
import { authenticateServiceRequestDetailed } from "./http.js";
import type { ServiceAuthKeyRegistry } from "./keys.js";
import type { ServiceTokenReplayGuard } from "./replay.js";
import { ServiceTokenReplayStoreUnavailableError } from "./replay.js";

/** كودُ عدمِ توفُّرِ مخزنِ الآثار. ليس كودَ مصادقةٍ لأنّه ليس فشلَ إثباتٍ. */
export const REPLAY_STORE_UNAVAILABLE_CODE = "SERVICE_AUTH_REPLAY_STORE_UNAVAILABLE";

/** الطلبُ كما تراه نقطةُ الفرضِ — ثلاثةُ حقولٍ لا كائنُ إطارٍ. */
export interface EnforcedRequest {
  readonly method: string;
  /** المسارُ بلا سلسلةِ استعلامٍ — كما في الربطِ بالطلبِ عندَ التوقيع. */
  readonly path: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

export interface ServiceIdentityEnforcementOptions {
  /** اسمُ الخدمةِ المُتحقِّقةِ — يجب أن يُطابق `aud` في الرمز. */
  readonly audience: string;
  readonly keys: ServiceAuthKeyRegistry;
  /** حارسُ الإعادةِ. **إلزاميٌّ**: حدٌّ بلا حارسٍ حدٌّ بلا طزاجة. */
  readonly replayGuard: ServiceTokenReplayGuard;
  /**
   * الصلاحيّةُ المُعلَنةُ للحدِّ. قائمةٌ فارغةٌ تعني «هويّةٌ مُثبَتةٌ تكفي»،
   * وهي حالٌ مشروعةٌ **إن كُتِبت صراحةً** لا سهواً.
   */
  readonly requiredScopes: readonly string[];
  /** اللحظةُ الحاضرةُ — تُمرَّر ولا تُقرأ من الساعةِ العامّة. */
  readonly now: () => Date;
  readonly maxTtlSeconds?: number;
  readonly clockSkewSeconds?: number;
}

export type ServiceIdentityDecision =
  | {
      readonly outcome: "allowed";
      readonly principal: ServicePrincipal;
    }
  | {
      readonly outcome: "denied";
      readonly status: 401 | 403 | 503;
      /** الكودُ الذي يُرَدُّ على السلك. */
      readonly code: AuthErrorCodeValue | typeof REPLAY_STORE_UNAVAILABLE_CODE;
      /** رسالةٌ عامّةٌ لا تُسمّي البابَ الذي أخفقَ عليه المُنادي. */
      readonly message: string;
      /** السببُ التشخيصيُّ — **للسجلِّ الداخليِّ فقط**، لا يُرَدُّ على السلك. */
      readonly logReason: ServiceAuthRejection | "insufficient_scope" | "replay_store_unavailable";
      /** الصلاحيّاتُ الناقصةُ — تُسجَّل داخليّاً وتُعين المُشغِّلَ على الإعداد. */
      readonly missingScopes?: readonly string[];
    };

/**
 * يفرض هويّةَ الخدمةِ على طلبٍ واحدٍ. الترتيبُ: إثباتُ الهويّةِ ← الطزاجةُ ←
 * الصلاحيّةُ. وهو ترتيبٌ أمنيٌّ: لا يُنطَق بنقصِ صلاحيّةٍ لمَن لم يُثبِت هويّتَه
 * (وإلّا صار الردُّ خريطةَ صلاحيّاتٍ للمجهول)، ولا يُحفَظ أثرُ رمزٍ لم يُثبَت
 * توقيعُه (وإلّا صار المخزنُ قابلاً للإغراقِ من الخارج).
 */
export async function enforceServiceIdentity(
  request: EnforcedRequest,
  options: ServiceIdentityEnforcementOptions,
): Promise<ServiceIdentityDecision> {
  const { audience, keys, replayGuard, requiredScopes, now } = options;

  const authenticated = authenticateServiceRequestDetailed(request.headers, {
    audience,
    method: request.method,
    path: request.path,
    keys,
    now: now(),
    ...(options.maxTtlSeconds === undefined ? {} : { maxTtlSeconds: options.maxTtlSeconds }),
    ...(options.clockSkewSeconds === undefined
      ? {}
      : { clockSkewSeconds: options.clockSkewSeconds }),
  });

  if (authenticated.principal.kind !== "service" || authenticated.trace === undefined) {
    const rejection =
      authenticated.rejection ??
      new ServiceAuthError("missing_credentials", "لا إثباتَ هويّةِ خدمةٍ في الطلب.");
    return unauthenticated(rejection);
  }

  // ── الطزاجةُ: بعدَ التوقيعِ لا قبلَه ──
  let replayDecision: string;
  try {
    replayDecision = await replayGuard.remember(authenticated.trace);
  } catch (error) {
    if (error instanceof ServiceTokenReplayStoreUnavailableError) {
      return {
        outcome: "denied",
        status: 503,
        code: REPLAY_STORE_UNAVAILABLE_CODE,
        message: "لا يمكن إثباتُ طزاجةِ الطلبِ حالياً.",
        logReason: "replay_store_unavailable",
      };
    }
    throw error;
  }
  if (replayDecision === "replayed") {
    return unauthenticated(
      new ServiceAuthError("replayed_token", "رمزُ الخدمةِ مُستعمَلٌ من قبلُ."),
    );
  }

  // ── الصلاحيّةُ المُعلَنةُ للحدِّ ──
  if (!hasAllScopes(authenticated.principal, requiredScopes)) {
    const missing = requiredScopes.filter(
      (scope) => !hasAllScopes(authenticated.principal, [scope]),
    );
    return {
      outcome: "denied",
      status: 403,
      code: AuthErrorCode.FORBIDDEN,
      message: "الصلاحيّةُ المطلوبةُ غيرُ ممنوحة.",
      logReason: "insufficient_scope",
      missingScopes: missing,
    };
  }

  return { outcome: "allowed", principal: authenticated.principal };
}

/**
 * كلُّ فشلِ إثباتٍ يُرَدُّ 401 برسالةٍ **واحدةٍ** لا تتغيَّر بتغيُّرِ السببِ.
 * والكودُ يتبع ADR-018 (فيَبين الانتهاءُ وخطأُ الجمهورِ لأنّهما يخدمانِ
 * المُشغِّلَ الشريفَ)، أمّا `logReason` فداخليٌّ.
 */
function unauthenticated(rejection: ServiceAuthError): ServiceIdentityDecision {
  return {
    outcome: "denied",
    status: 401,
    code: rejection.code as AuthErrorCodeValue,
    message: "الطلبُ بلا إثباتِ هويّةِ خدمةٍ مقبول.",
    logReason: rejection.reason,
  };
}
