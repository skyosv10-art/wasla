/**
 * فرض هوية الخدمة على حد المطابقة (M1-03 · الفجوة الثالثة).
 *
 * هذا الملف هو **الحد الواحد المفروض ببرهان** في هذه الدفعة. والتغطية الكاملة
 * لبقية الحدود بوابة مستقلة (M1-04)، ويمنع حارس التغطية
 * `scripts/checks/validate-service-auth-coverage.sh` إضافة عميل جديد غير موقّع
 * بلا إعلان. الخريطة في docs/07-security/SERVICE_AUTH_ENFORCEMENT.md.
 *
 * ── لماذا التصنيف إلزامي على كل مسار ──────────────────────────────────────
 * لو كان الافتراض «مسار بلا تصنيف = مفتوح» لصار كل مسار يُضاف غداً ثغرة صامتة،
 * ولو كان «مسار بلا تصنيف = مغلق» فقط لصار العطل يظهر أول مرة في الإنتاج على
 * طلب حقيقي. فالتصنيف يُفحص **عند تسجيل المسار** (onRoute) فيسقط التطبيق عند
 * الإقلاع، ويُفرض **عند الطلب** مغلقاً افتراضياً. الحاجزان معاً لا أحدهما.
 *
 * ── لماذا 503 عند تعذّر مخزن الآثار ───────────────────────────────────────
 * لأن الطزاجة غير مثبتة، لا لأن المنادي مزوّر. الرد 200 يفتح باب الإعادة على
 * مصراعيه، والرد 401 يكذب على منادٍ شريف فيرسله يفحص مفاتيحه والعلة في مخزن.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  enforceServiceIdentity,
  REPLAY_STORE_UNAVAILABLE_CODE,
  type ServiceAuthKeyRegistry,
  type ServiceIdentityDecision,
  type ServiceTokenReplayGuard,
} from "@wasla/service-auth";
import type { ServicePrincipal } from "@wasla/auth-sdk";

import type { MatchingErrorBody } from "./errors.js";

/** جمهور الرمز الذي تقبله هذه الخدمة. يطابق aud عند المنادي. */
export const MATCHING_SERVICE_AUDIENCE = "matching";

/**
 * تصنيف المسار. `"open"` يعني «لا هوية خدمة مطلوبة» ولا يجوز إلا لمسار لا يقرأ
 * ولا يكتب بيانات مجالية — وهو `/health` وحده اليوم.
 */
export type MatchingRouteIdentity = "open" | { readonly scopes: readonly string[] };

/**
 * مفردات الصلاحيات على هذا الحد. **ليست مصفوفة أدوار**: الحد يعلن ما يطلبه،
 * ومن يمنح الصلاحية لأي خدمة قرار M1-05 عند مُصدر الرمز.
 */
export const MATCHING_SCOPES = {
  candidatesEvaluate: "matching:candidates:evaluate",
  candidacyRead: "matching:candidacy:read",
  candidacyWrite: "matching:candidacy:write",
  rulesetsRead: "matching:rulesets:read",
  decisionsRead: "matching:decisions:read",
} as const;

export interface MatchingRouteConfig {
  readonly serviceIdentity: MatchingRouteIdentity;
}

export interface MatchingServiceIdentityOptions {
  readonly keys: ServiceAuthKeyRegistry;
  readonly replayGuard: ServiceTokenReplayGuard;
  readonly audience?: string;
  readonly now?: () => Date;
  readonly clockSkewSeconds?: number;
  readonly maxTtlSeconds?: number;
}

declare module "fastify" {
  interface FastifyRequest {
    /** المنادي المثبت. يُملأ على المسارات المفروضة وحدها. */
    serviceCaller?: ServicePrincipal;
  }
}

/** الرد الذي يراه المنادي المرفوض: كود ورسالة عامة ومُعرّف تتبع، لا سبب. */
function denialBody(decision: Extract<ServiceIdentityDecision, { outcome: "denied" }>, traceId: string): MatchingErrorBody {
  return { code: decision.code, message: decision.message, trace_id: traceId };
}

/** المسار بلا سلسلة استعلام: هو نفسه ما وقّعه المنادي في الربط بالطلب. */
function pathOf(request: FastifyRequest): string {
  const url = request.url;
  const separator = url.indexOf("?");
  return separator < 0 ? url : url.slice(0, separator);
}

function readConfig(request: FastifyRequest): MatchingRouteIdentity | undefined {
  const config = request.routeOptions?.config as Partial<MatchingRouteConfig> | undefined;
  return config?.serviceIdentity;
}

/**
 * يركّب الفرض على التطبيق. يُستدعى مرة واحدة **قبل** تسجيل المسارات كي يرى
 * حاجز التصنيف كل مسار يُسجّل بعده.
 */
export function registerServiceIdentity(
  app: FastifyInstance,
  options: MatchingServiceIdentityOptions,
): void {
  const audience = options.audience ?? MATCHING_SERVICE_AUDIENCE;
  const now = options.now ?? (() => new Date());

  // حاجز الإقلاع: مسار بلا تصنيف يُسقط التطبيق عند التسجيل لا عند أول طلب.
  app.addHook("onRoute", (route) => {
    if (route.method === "HEAD" && route.path === "/*") return;
    const identity = (route.config as Partial<MatchingRouteConfig> | undefined)?.serviceIdentity;
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

    // مغلق افتراضياً: مسار غير معروف أو غير مصنف يُطالب بهوية مثبتة بلا صلاحية
    // معلنة، فلا يصير غياب التصنيف بابَ تجاوز.
    const requiredScopes = identity === undefined ? [] : identity.scopes;

    const decision = await enforceServiceIdentity(
      { method: request.method, path: pathOf(request), headers: request.headers },
      {
        audience,
        keys: options.keys,
        replayGuard: options.replayGuard,
        requiredScopes,
        now,
        ...(options.clockSkewSeconds === undefined ? {} : { clockSkewSeconds: options.clockSkewSeconds }),
        ...(options.maxTtlSeconds === undefined ? {} : { maxTtlSeconds: options.maxTtlSeconds }),
      },
    );

    if (decision.outcome === "allowed") {
      request.serviceCaller = decision.principal;
      return;
    }

    // السبب يُسجّل ولا يُرَدّ. وتعذّر المخزن حدث تشغيلي لا حدث أمني، فيُسجّل
    // بمستوى error كي يُنبّه، أما الرفض الأمني فبمستوى warn كي يُرصد ويُحصى.
    const logged = {
      reason: decision.logReason,
      status: decision.status,
      route: `${request.method} ${pathOf(request)}`,
      ...(decision.missingScopes === undefined ? {} : { missing_scopes: decision.missingScopes }),
    };
    if (decision.code === REPLAY_STORE_UNAVAILABLE_CODE) {
      request.log.error(logged, "تعذّر إثبات طزاجة طلب خدمة");
    } else {
      request.log.warn(logged, "رُفض طلب خدمة على حد المطابقة");
    }

    await reply.status(decision.status).send(denialBody(decision, request.id));
  });
}
