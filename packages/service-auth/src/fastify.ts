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

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ServicePrincipal } from "@wasla/auth-sdk";

import {
  enforceServiceIdentity,
  REPLAY_STORE_UNAVAILABLE_CODE,
  type ServiceIdentityDecision,
} from "./enforce.js";
import type { ServiceAuthKeyRegistry } from "./keys.js";
import type { ServiceTokenReplayGuard } from "./replay.js";
import {
  userAssertionDenialOf,
  userAssertionFromHeaders,
  verifyUserAssertion,
  type UserAssertionActor,
  type UserAssertionFailure,
  type UserAssertionMode,
  type UserAssertionPublicKeys,
  type UserDelegation,
} from "./user-assertion.js";

/**
 * تصنيفُ المسارِ. `"open"` تعني «لا هويّةَ خدمةٍ مطلوبةً» ولا تجوزُ إلّا لمسارٍ
 * لا يقرأُ ولا يكتبُ بياناتٍ مجاليّةً — وهو `/health` وحدَه اليومَ في كلِّ حدٍّ.
 */
export type ServiceIdentityRouteIdentity =
  | "open"
  | {
      readonly scopes: readonly string[];
      /**
       * `"required"` تعني أنَّ الرمزَ يجبُ أن يحملَ **هويّةَ الطرفِ
       * المُنتَفِعِ** (`obo`) وإلّا رُفِضَ الطلبُ 403 قبلَ أن يَبلُغَ المسارَ
       * (`M1-05B` · `RISK-0042`). وتُكتَبُ على كلِّ مسارٍ يمسُّ مَورِداً مملوكاً
       * لإنسانٍ بعينِهِ.
       *
       * **وغيابُها لا يُقرَأُ «لا مالكَ لهذا المَورِدِ» بل «لم يُسأَل»**
       * — والفرقُ مقيسٌ في `@wasla/authz-policy` لا متروكٌ للقراءةِ.
       */
      readonly beneficiary?: "required" | "asserted";
      /**
       * ADR-060: لِمَسارِ `beneficiary: "asserted"` — أنواعُ الفاعلِ المقبولةُ، والخدماتُ التي
       * يُسمَحُ لها أن تُمرِّرَ تأكيداً لم تطلبْهُ (مثلاً `drivers` إلى `matching`).
       */
      readonly actors?: readonly UserAssertionActor[];
      readonly forwarders?: readonly string[];
    };

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
  /**
   * ADR-060 · CLM-0440: التحقُّقُ من تأكيدِ المستخدمِ على مساراتِ `beneficiary: "asserted"`.
   * غيابُهُ أو `mode: "off"` ⇒ لا تحقُّقَ ولا تغيُّرَ في السلوكِ (الافتراضيُّ في الإنتاجِ).
   */
  readonly userAssertion?: {
    readonly mode: UserAssertionMode;
    readonly publicKeys: UserAssertionPublicKeys;
    readonly skewSeconds?: number;
    readonly denialBody?: (
      denial: { readonly status: 401 | 403; readonly code: string; readonly message: string },
      traceId: string,
    ) => unknown;
  };
}

declare module "fastify" {
  interface FastifyRequest {
    /** المنادي المُثبَتُ. يُملأُ على المسارَاتِ المفروضةِ وحدَها. */
    serviceCaller?: ServicePrincipal;
    /** المستخدمُ النهائيُّ المُتحقَّقُ منهُ (ADR-060) — على مساراتِ `asserted` في `observe`/`enforce`. */
    endUser?: VerifiedEndUser;
    /**
     * وضعُ التأكيدِ الفعّالُ على هذا الطلبِ (CLM-0448). يُقرأُ عبرَ `endUserOwnershipDenied`
     * فلا يرفضُ فحصُ الملكيّةِ في `observe` — يُسجِّلُ «كانَ سيُرفَض» فقط.
     */
    userAssertionMode?: UserAssertionMode;
  }
}

/** المستخدمُ النهائيُّ المُتحقَّقُ منهُ (ADR-060). لا يُوضَعُ إلّا بعدَ نجاحِ التحقُّقِ كاملاً. */
export interface VerifiedEndUser {
  readonly publicId: string;
  readonly actorType: UserAssertionActor;
  readonly via: string;
}

/**
 * ما يُمرِّرُهُ مُمرِّرٌ (ADR-060 §2.4، مثلاً `drivers`): التفويضُ الواردُ كما هوَ — `obo`
 * رمزِ الخدمةِ المُتحقَّقِ منهُ + رأسُ التأكيدِ بلا تعديلٍ. **لا تحقُّقَ هنا ولا ثقةَ**: المُستقبِلُ
 * النهائيُّ هوَ الذي يتحقّقُ. يُعيدُ `undefined` إن نقصَ أحدُهما.
 */
export function incomingDelegationOf(request: FastifyRequest): UserDelegation | undefined {
  const publicId = request.serviceCaller?.onBehalfOfPublicId;
  const assertion = userAssertionFromHeaders(request.headers);
  if (publicId === undefined || assertion === undefined || assertion === "") return undefined;
  return { publicId, assertion };
}

/**
 * هدفُ الربطِ: **المسارُ مع سلسلةِ الاستعلامِ كما وصلَا** (`RISK-0026`).
 *
 * ولا يُقتَطع الاستعلامُ هنا لأنّ `canonicalRequestBinding` هي **الموضعُ الواحدُ**
 * الذي يُطبِّع الهدفَ عندَ المُوقِّعِ وعندَ المُتحقِّقِ معاً. فأيُّ اقتطاعٍ أو تطبيعٍ
 * في الحدِّ يصنعُ مصدرَ حقيقةٍ ثانياً — وأوّلُ اختلافٍ بينَ المصدرَينِ بابُ التفافٍ
 * أو رفضٌ كاذبٌ، وكلاهما يظهرُ في الإنتاجِ لا في المراجعةِ.
 */
function bindingTargetOf(request: FastifyRequest): string {
  return request.url;
}

/**
 * تسميةُ المسارِ **للسجلِّ** — بلا سلسلةِ استعلامٍ، وهذا مقصودٌ ولا يُخالِفُ
 * `bindingTargetOf`: الربطُ يحتاجُ الاستعلامَ كي يُقارَنَ، والسجلُّ لا يحتاجُه
 * كي يُحصى. وضمُّهُ هنا كانَ سيَسكُبَ معرِّفاتِ مَوارِدَ (`order_public_id`) في
 * سجلِّ الرفضِ ويُفجِّرَ عددَ التسمياتِ فيصيرَ العدُّ بلا معنىً — وكلاهما ضررٌ
 * بلا مقابلٍ أمنيٍّ.
 */
function routeLabelOf(request: FastifyRequest): string {
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

  // CLM-0448: one boot line per receiver so a Render activation is checkable from the
  // logs alone — the mode and the kid list, never key material. `off` logs too.
  app.addHook("onReady", async () => {
    const ua = options.userAssertion;
    app.log.info(
      {
        event: "user_assertion_config",
        audience,
        mode: ua?.mode ?? "off",
        kids: ua === undefined ? [] : [...ua.publicKeys.keys()].sort(),
      },
      "user assertion receiver config",
    );
  });

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
    // ومطلبُ المُنتَفِعِ **لا يُعمَّمُ على المسارِ المجهولِ** — والسببُ مقيسٌ
    // لا ذوقٌ: `identity === undefined` **لا تقعُ إلّا على مسارٍ غيرِ مُسجَّلٍ**،
    // لأنَّ حاجزَ الإقلاعِ (`onRoute`) يُسقِطُ التطبيقَ على أيِّ مسارٍ مُسجَّلٍ بلا
    // تصنيفٍ. ففرضُ المُنتَفِعِ هنا **لا يحمي مَورِداً واحداً** ويُبدِلُ 404
    // الصادقَ بـ403 كاذبٍ — فيصيرُ خطأُ مطبعيٌّ في مسارٍ ورفضٌ أمنيٌّ حدثاً
    // واحداً في سجلِّ المُشغِّلِ. وهذا هوَ الفرقُ بينَ «مغلقٌ افتراضيّاً» و«مغلقٌ
    // حيثُ لا بابَ»: الأوّلُ أمنٌ، والثاني تعميةُ تشخيصٍ تلبسُ ثوبَ الأمنِ.
    // (وحاجزُ الصلاحيّةِ المغلقُ افتراضيّاً أعلاهُ سابقٌ لهذهِ الدفعةِ ولم يُمَسْ.)
    const requireBeneficiary =
      identity === undefined ? false : identity.beneficiary === "required";

    const decision = await enforceServiceIdentity(
      { method: request.method, path: bindingTargetOf(request), headers: request.headers },
      {
        audience,
        keys: options.keys,
        replayGuard: options.replayGuard,
        requiredScopes,
        requireBeneficiary,
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
      if (identity !== undefined && identity.beneficiary === "asserted") {
        await applyUserAssertion(request, reply, identity, decision.principal, options, now);
      }
      return;
    }

    // السببُ يُسجَّلُ ولا يُرَدُّ. وتعذُّرُ المخزنِ حدثٌ تشغيليٌّ لا حدثٌ أمنيٌّ،
    // فيُسجَّلُ بمستوى `error` كي يُنبِّهَ، أمّا الرفضُ الأمنيُّ فبمستوى `warn`
    // كي يُرصَدَ ويُحصى.
    const logged = {
      reason: decision.logReason,
      status: decision.status,
      route: `${request.method} ${routeLabelOf(request)}`,
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

const USER_ASSERTION_PUBLIC_MESSAGE: Readonly<Record<401 | 403, string>> = {
  401: "user assertion required or invalid",
  403: "user assertion does not match this request",
};

/**
 * ADR-060 §2.3/§2.6. `off` ⇒ لا شيء. `observe` ⇒ يتحقّقُ ويُسجِّلُ ولا يرفضُ أبداً.
 * `enforce` ⇒ يرفضُ بـ401/403 ويُسجِّلُ السببَ الدقيقَ داخليّاً.
 * السجلُّ لا يحملُ التأكيدَ نفسَهُ ولا أيَّ مفتاحٍ — المعرّفُ العامُّ وحدَهُ.
 */
async function applyUserAssertion(
  request: FastifyRequest,
  reply: FastifyReply,
  identity: Exclude<ServiceIdentityRouteIdentity, "open">,
  principal: ServicePrincipal,
  options: FastifyServiceIdentityOptions,
  now: () => Date,
): Promise<void> {
  const config = options.userAssertion;
  if (config === undefined || config.mode === "off") return;
  request.userAssertionMode = config.mode;
  const verdict = verifyUserAssertion(userAssertionFromHeaders(request.headers), {
    publicKeys: config.publicKeys,
    audience: options.audience,
    onBehalfOfPublicId: principal.onBehalfOfPublicId,
    callerService: principal.serviceName,
    ...(identity.forwarders === undefined ? {} : { forwarders: identity.forwarders }),
    ...(identity.actors === undefined ? {} : { actors: identity.actors }),
    now: now(),
    ...(config.skewSeconds === undefined ? {} : { skewSeconds: config.skewSeconds }),
  });
  const route = `${request.method} ${routeLabelOf(request)}`;
  if (verdict.ok) {
    request.endUser = { publicId: verdict.payload.sub, actorType: verdict.payload.act, via: verdict.payload.via };
    request.log.info(
      {
        event: "user_assertion_outcome",
        mode: config.mode,
        outcome: "valid",
        route,
        sub: verdict.payload.sub,
        act: verdict.payload.act,
        via: verdict.payload.via,
        caller: principal.serviceName,
      },
      "user assertion verified",
    );
    return;
  }
  const reason: UserAssertionFailure = verdict.reason;
  request.log.warn(
    { event: "user_assertion_outcome", mode: config.mode, outcome: "invalid", reason, route, caller: principal.serviceName },
    config.mode === "enforce" ? "user assertion rejected" : "user assertion would be rejected (observe)",
  );
  if (config.mode !== "enforce") return;
  const denial = userAssertionDenialOf(reason);
  const body = { status: denial.status, code: denial.code, message: USER_ASSERTION_PUBLIC_MESSAGE[denial.status] };
  await reply
    .status(denial.status)
    .send(
      config.denialBody
        ? config.denialBody(body, request.id)
        : { error: { code: body.code, message: body.message }, trace_id: request.id },
    );
}


/**
 * ADR-060 §2.3 · CLM-0448: الحكمُ الوحيدُ على فحصِ ملكيّةٍ مبنيٍّ على `endUser`.
 *
 * قِيسَ قبلَ التغيير: في `observe` يضعُ المُتحقِّقُ `endUser` للتأكيدِ الصالحِ، وكانت
 * فحوصُ الملكيّةِ في الخدماتِ ترفضُ (404) على التنافُرِ — فكانَ `observe` يرفضُ طلباتٍ
 * إنتاجيّةً، خلافاً لعقدِهِ «يتحقّقُ ويُسجِّلُ ولا يرفضُ أبداً».
 *
 * يُعيدُ `true` فقط إن وُجدَ `endUser` وتنافرَ والوضعُ `enforce`. وفي `observe` يُسجِّلُ
 * `user_assertion_ownership` بنتيجةِ `would_reject` ويُعيدُ `false`. بلا `endUser` ⇒ `false`.
 * السجلُّ لا يحملُ إلّا اسمَ الفحصِ والمسارَ والمنادي — لا تأكيدَ ولا معرّفاً مُقارَناً.
 */
export function endUserOwnershipDenied(request: FastifyRequest, matches: boolean, check: string): boolean {
  if (request.endUser === undefined || matches) return false;
  if (request.userAssertionMode === "enforce") return true;
  request.log.warn(
    {
      event: "user_assertion_ownership",
      mode: request.userAssertionMode ?? "observe",
      outcome: "would_reject",
      check,
      route: `${request.method} ${routeLabelOf(request)}`,
      caller: request.serviceCaller?.serviceName,
      act: request.endUser.actorType,
    },
    "ownership mismatch would be rejected (observe)",
  );
  return false;
}
