/**
 * الوسيطُ المركزيُّ لفرضِ هويّةِ الخدمةِ على حدودِ Fastify (عنصرُ العمل **M1-04**).
 *
 * القراراتُ الحاكمةُ: [ADR-020](../../../docs/15-decisions/ADR-020-service-to-service-identity.md)
 * (الاختيارُ والحدُّ المعماريُّ) · [ADR-021](../../../docs/15-decisions/ADR-021-service-token-replay-policy.md)
 * (منعُ الإعادةِ) · [ADR-018](../../../docs/15-decisions/ADR-018-unified-principal-model-and-user-service-boundary.md)
 * (شكلُ الهويّةِ الموحَّدُ).
 *
 * ── لماذا يسكنُ هذا الملفُّ هذه الحزمةَ ────────────────────────────────────
 * `index.ts` كان يُعلِنُ حدّاً: «لا تعرف إطارَ ويبٍ … ورَبطُه بـFastify في طبقةِ
 * HTTP عندَ كلِّ خدمةٍ مفروضةٍ **حتّى يُوحِّده الوسيطُ المركزيُّ (`M1-04`)**».
 * فالحدُّ كان **مؤقَّتاً بنصِّه** لا مبدأً، وهذا الملفُّ هو الوسيطُ الذي انتظرَه.
 * ويبقى القلبُ (`enforce.ts` · `token.ts` · `keys.ts` · `replay.ts`) **جاهلاً
 * بـFastify تماماً**: هذا الملفُّ وحدَه يستوردُ أنواعَها، و`fastify` فيه
 * `peerDependency` لا `dependency` — فمن لا يستوردُ `./fastify.js` لا يحملُها.
 *
 * ── لماذا تُنسَخُ الحجَّةُ من `services/matching/src/http/service-identity.ts` ──
 * ذلك الحدُّ كان **الحدَّ الواحدَ المفروضَ ببرهانٍ** (M1-03)، وحُجَجُه الأربعُ
 * صحيحةٌ لكلِّ حدٍّ لا لحدِّه وحدَه، فنُقلت هنا حرفاً لا معنىً:
 *
 * 1. **التصنيفُ إلزاميٌّ على كلِّ مسارٍ.** لو كان الافتراضُ «مسارٌ بلا تصنيفٍ =
 *    مفتوحٌ» لصارَ كلُّ مسارٍ يُضافُ غداً ثغرةً صامتةً؛ ولو كان «مغلقٌ» وحدَه
 *    لظهرَ العطلُ أوّلَ مرّةٍ في الإنتاجِ على طلبٍ حقيقيٍّ. فيُفحَصُ التصنيفُ
 *    **عندَ تسجيلِ المسارِ** (`onRoute`) فيسقطُ التطبيقُ عندَ الإقلاعِ،
 *    ويُفرَضُ **عندَ الطلبِ** مغلقاً افتراضيّاً. الحاجزانِ معاً لا أحدُهما.
 * 2. **`503` عندَ تعذُّرِ مخزنِ الآثارِ** لأنَّ الطزاجةَ غيرُ مثبتةٍ، لا لأنَّ
 *    المنادي مزوَّرٌ: `200` يفتحُ بابَ الإعادةِ، و`401` يكذبُ على منادٍ شريفٍ.
 * 3. **السببُ يُسجَّلُ ولا يُرَدُّ**: الردُّ كودٌ ورسالةٌ عامّةٌ ومُعرِّفُ تتبُّعٍ.
 * 4. **المسارُ بلا سلسلةِ استعلامٍ** هو نفسُه ما وقَّعَه المنادي (ADR-021 §4).
 *
 * ── ما لا يفعلُه هذا الوسيطُ بقصدٍ ────────────────────────────────────────
 * - **لا يخترعُ جمهوراً ولا مغلَّفَ خطأٍ.** `audience` و`denialBody` **إلزاميّانِ
 *   بلا قيمةٍ افتراضيّةٍ**: قيمةٌ افتراضيّةٌ للجمهورِ تجعلُ خدمتَينِ تقبلانِ رمزَ
 *   بعضِهما، ومغلَّفٌ افتراضيٌّ يُخرِجُ من حدٍّ شكلَ خطأٍ لا يعرفُه عقدُه.
 * - **لا يُسجِّلُ مساراً ولا يُصنِّفُه.** التصنيفُ مفرداتُ الحدِّ: من يُصنِّفُ
 *   مساراً `"open"` يكتبُ ذلك في جذرِ تركيبِه بيدِه ويُراجَعُ عليه.
 * - **لا يحملُ مصفوفةَ «دورٌ → صلاحيّاتٌ»** (`M1-05`): يقرأُ الصلاحيّةَ المُعلَنةَ
 *   للمسارِ ولا يشتقُّ صلاحيّةً من دورٍ.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";

import type { ServicePrincipal } from "@wasla/auth-sdk";

import {
  enforceServiceIdentity,
  REPLAY_STORE_UNAVAILABLE_CODE,
  type ServiceIdentityDecision,
} from "./enforce.js";
import type { ServiceAuthKeyRegistry } from "./keys.js";
import type { ServiceTokenReplayGuard } from "./replay.js";

/**
 * تصنيفُ المسارِ. `"open"` تعني «لا هويّةَ خدمةٍ مطلوبةً» ولا تجوزُ إلّا لمسارٍ
 * لا يقرأُ ولا يكتبُ بياناتٍ مجاليّةً — وهو `/health` وحدَه اليومَ في كلِّ حدٍّ.
 */
export type ServiceIdentityRouteIdentity =
  | "open"
  | { readonly scopes: readonly string[] };

/** الشكلُ الذي يقرأُه الوسيطُ من `config` المسارِ. */
export interface ServiceIdentityRouteConfig {
  readonly serviceIdentity: ServiceIdentityRouteIdentity;
}

/** قرارُ الرفضِ كما يُسلَّمُ إلى مغلَّفِ خطأِ الحدِّ. */
export type ServiceIdentityDenial = Extract<
  ServiceIdentityDecision,
  { outcome: "denied" }
>;

export interface FastifyServiceIdentityOptions {
  /**
   * جمهورُ الرمزِ الذي يقبلُه هذا الحدُّ، يطابقُ `aud` عندَ المنادي.
   * **إلزاميٌّ بلا قيمةٍ افتراضيّةٍ بقصدٍ** (انظر رأسَ الملفِّ).
   */
  readonly audience: string;
  readonly keys: ServiceAuthKeyRegistry;
  readonly replayGuard: ServiceTokenReplayGuard;
  /**
   * مغلَّفُ خطأِ الحدِّ. **إلزاميٌّ**: كلُّ حدٍّ يملكُ شكلَ خطئِه في عقدِه،
   * وهذا الوسيطُ لا يعرفُه ولا يخترعُه.
   */
  readonly denialBody: (denial: ServiceIdentityDenial, traceId: string) => unknown;
  /**
   * اسمُ الحدِّ في نصِّ السجلِّ وحدَه — لا يدخلُ في أيِّ قرارٍ أمنيٍّ ولا يُرَدُّ
   * إلى المنادي.
   */
  readonly boundaryLabel: string;
  readonly now?: () => Date;
  readonly clockSkewSeconds?: number;
  readonly maxTtlSeconds?: number;
}

declare module "fastify" {
  interface FastifyRequest {
    /** المنادي المُثبَتُ. يُملأُ على المسارَاتِ المفروضةِ وحدَها. */
    serviceCaller?: ServicePrincipal;
  }
}

/** المسارُ بلا سلسلةِ استعلامٍ: هو نفسُه ما وقَّعَه المنادي في الربطِ بالطلبِ. */
function pathOf(request: FastifyRequest): string {
  const url = request.url;
  const separator = url.indexOf("?");
  return separator < 0 ? url : url.slice(0, separator);
}

function readConfig(request: FastifyRequest): ServiceIdentityRouteIdentity | undefined {
  const config = request.routeOptions?.config as
    | Partial<ServiceIdentityRouteConfig>
    | undefined;
  return config?.serviceIdentity;
}

/**
 * يُركِّبُ الفرضَ على التطبيقِ. **يُستدعى مرّةً واحدةً قبلَ تسجيلِ المسارَاتِ**
 * كي يرى حاجزُ التصنيفِ كلَّ مسارٍ يُسجَّلُ بعدَه.
 */
export function registerServiceIdentityOnFastify(
  app: FastifyInstance,
  options: FastifyServiceIdentityOptions,
): void {
  const { audience, boundaryLabel, denialBody } = options;
  const now = options.now ?? (() => new Date());

  // حاجزُ الإقلاعِ: مسارٌ بلا تصنيفٍ يُسقِطُ التطبيقَ عندَ التسجيلِ لا عندَ أوّلِ طلبٍ.
  app.addHook("onRoute", (route) => {
    if (route.method === "HEAD" && route.path === "/*") return;
    const identity = (route.config as Partial<ServiceIdentityRouteConfig> | undefined)
      ?.serviceIdentity;
    if (identity === undefined) {
      throw new Error(
        `المسار ${String(route.method)} ${route.path} مُسجّل بلا تصنيف هوية خدمة. ` +
          `أضف config.serviceIdentity: "open" أو { scopes: [...] }.`,
      );
    }
    if (identity !== "open" && !Array.isArray(identity.scopes)) {
      throw new Error(`تصنيف المسار ${String(route.method)} ${route.path} غير صالح.`);
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    const identity = readConfig(request);
    if (identity === "open") return;

    // مغلقٌ افتراضيّاً: مسارٌ غيرُ معروفٍ أو غيرُ مصنَّفٍ يُطالَبُ بهويّةٍ مثبتةٍ
    // بلا صلاحيّةٍ مُعلَنةٍ، فلا يصيرُ غيابُ التصنيفِ بابَ تجاوزٍ.
    const requiredScopes = identity === undefined ? [] : identity.scopes;

    const decision = await enforceServiceIdentity(
      { method: request.method, path: pathOf(request), headers: request.headers },
      {
        audience,
        keys: options.keys,
        replayGuard: options.replayGuard,
        requiredScopes,
        now,
        ...(options.clockSkewSeconds === undefined
          ? {}
          : { clockSkewSeconds: options.clockSkewSeconds }),
        ...(options.maxTtlSeconds === undefined
          ? {}
          : { maxTtlSeconds: options.maxTtlSeconds }),
      },
    );

    if (decision.outcome === "allowed") {
      request.serviceCaller = decision.principal;
      return;
    }

    // السببُ يُسجَّلُ ولا يُرَدُّ. وتعذُّرُ المخزنِ حدثٌ تشغيليٌّ لا حدثٌ أمنيٌّ،
    // فيُسجَّلُ بمستوى `error` كي يُنبِّهَ، أمّا الرفضُ الأمنيُّ فبمستوى `warn`
    // كي يُرصَدَ ويُحصى.
    const logged = {
      reason: decision.logReason,
      status: decision.status,
      route: `${request.method} ${pathOf(request)}`,
      ...(decision.missingScopes === undefined
        ? {}
        : { missing_scopes: decision.missingScopes }),
    };
    if (decision.code === REPLAY_STORE_UNAVAILABLE_CODE) {
      request.log.error(logged, "تعذّر إثبات طزاجة طلب خدمة");
    } else {
      request.log.warn(logged, `رُفض طلب خدمة على ${boundaryLabel}`);
    }

    await reply.status(decision.status).send(denialBody(decision, request.id));
  });
}
