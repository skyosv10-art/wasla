/**
 * طبقةُ HTTP: **إحدى عشرَ مساراً تحمل اثنتَي عشرةَ عمليّة**، ولا قاعدةَ عملٍ فيها.
 *
 * القاعدةُ التي يُقاس عليها هذا الملفُّ كلُّه: كلُّ معالجٍ ثلاثةُ أسطرٍ في معناه — يفحص
 * الحدَّ، ينادي عمليّةً واحدةً في `app/`، يُحوّل مخرجَها إلى السلك. ولا فرعَ قرارٍ واحدٌ
 * هنا: أوّلُ `if` على حالةِ اشتراكٍ في معالجٍ يعني أنّ قاعدةً صارت تسكن في موضعين، وأنّ
 * منادياً من داخل العمليّة (النبضةُ مثلاً) لا يخضع لها.
 *
 * ## لا `try`/`catch` في أيّ معالج
 *
 * `setErrorHandler` هو الموضعُ الوحيدُ الذي يصير فيه خطأٌ جواباً (`http/errors.ts`).
 * ومعالجٌ يلتقط خطأَه يستطيع أن يُخفيَه أو يُعيد تصنيفَه، فيصير رمزُ الحالةِ رأياً لا
 * كتالوجاً؛ ومعالجُ الخطأِ الواحدُ لا يستطيع ذلك أصلاً.
 *
 * ## و`probe` لا يُمرَّر من هنا أبداً
 *
 * `TransactionProbe` في `db/unit-of-work.ts` أداةُ اختبارٍ تُجهض معاملةً في نقطةٍ مُعلَنةٍ
 * لتُثبت الذرّية. وطريقٌ من السلك إليها هو طريقٌ لمُتَّصلٍ يُجهض معاملاتِنا عند الطلب.
 * و`__tests__/http-drift.test.ts` يحرس غيابَ الكلمةِ من هذا الملفّ نصّاً.
 *
 * ## وضعُ الذاكرة: `503` لكلّ عمليّة إلّا `GET /health`
 *
 * الخدمةُ بلا `DATABASE_URL` لا تستطيع أن تفي بشيء، والأسوأُ من الفشلِ هو أن **تبدو**
 * عاملةً: `POST /subscriptions` يُجيب `201` من ذاكرةٍ تُنسى عند إعادةِ التشغيل، فيظنّ سائقٌ
 * أنّ تجربتَه بدأت. فكلُّ عمليّةٍ تُجيب `SUBSCRIPTION_UNAVAILABLE`، ويبقى `/health` عاملاً
 * ليقول `degraded` + `memory` — لأنّ مسارَ الصحّةِ الذي يسقط مع القاعدةِ لا يُشخّص شيئاً.
 */

import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import {
  assertPlanCode,
  assertPlanVersion,
  assertReferralCode,
  assertWaslaPublicId,
} from "../domain/identifiers.js";
import { assertTimestamp } from "../domain/time.js";
import { subscriptionNotFound, subscriptionUnavailable } from "../domain/errors.js";
import type { ReferralFilter } from "../db/referrals.js";
import type { ReferralService } from "../app/referrals.js";
import type { SubscriptionService } from "../app/subscriptions.js";
import { fingerprint, type IdempotencyEnvelope } from "../app/idempotency.js";
import { sendSubscriptionError } from "./errors.js";
import {
  registerServiceIdentity,
  SUBSCRIPTIONS_SCOPES,
  type SubscriptionsRouteConfig,
  type SubscriptionsServiceIdentityOptions,
} from "./service-identity.js";
import {
  toGrantResultWire,
  toPeriodWire,
  toPlanWire,
  toRecomputeResultWire,
  toReferralClaimResultWire,
  toReferralCodeWire,
  toReferralWire,
  toStateWire,
  toTickWire,
  type HealthWire,
} from "./mappers.js";
import { ownerPublicIdOf } from "@wasla/auth-sdk";
import {
  assertEmptyPayload,
  assertRequestIdLength,
  pathParam,
  requireIdempotencyKey,
  toActivateInput,
  toPathPlanVersion,
  toQueryFrozenOnly,
  toReferralClaimInput,
  toReferralListFilter,
  toStartTrialInput,
} from "./requests.js";

/**
 * وضعُ الاستمرارية — يُحسب في `server.ts` من البيئةِ ويُمرَّر هنا معطىً لا يُكتشف.
 *
 * `memory` تعني «لا مخزنَ» لا «مخزنٌ في الذاكرة»: لا تنفيذَ بديلاً في هذه المراجعة، وبديلٌ
 * كهذا كان سيصير أخطرَ من غيابه (اختباراتٌ تمرّ عليه ثم سلوكٌ مختلفٌ في الإنتاج).
 */
export type PersistenceMode = "postgres" | "memory";

export interface SubscriptionAppServices {
  readonly subscriptions: SubscriptionService;
  readonly referrals: ReferralService;
}

export interface CreateSubscriptionAppOptions {
  /** غائبةٌ ⇒ وضعُ الذاكرة: كلُّ عمليّةٍ `503` وتبقى الصحّةُ ناطقة. */
  readonly services?: SubscriptionAppServices;
  readonly mode?: PersistenceMode;
  readonly logger?: boolean;
  readonly serviceIdentity?: SubscriptionsServiceIdentityOptions;
}

const UNAVAILABLE_REASON = "الاستمرارية غير مهيّأة";

/** `/health` وحدَهُ: لا يقرأُ ولا يكتبُ بياناتٍ مجاليّةً. */
const OPEN: SubscriptionsRouteConfig = { serviceIdentity: "open" };

/**
 * مسارٌ يمسُّ مَورِداً **مملوكاً لإنسانٍ بعينِهِ** — وهوَ كلُّ مسارٍ يحملُ
 * `:driverPublicId` أو `:ownerPublicId`، أو يقرأُ المُنتَفِعَ من الجسمِ
 * (`driver_public_id` · `referee_public_id`). فـ`beneficiary: "required"`
 * يجعلُ الوسيطَ المركزيَّ يرفضُ كلَّ رمزٍ لا يحملُ هويّةَ المُنتَفِعِ **قبلَ** أن
 * يمسَّ المسارُ قاعدةَ البياناتِ.
 */
function ownerScoped(...scopes: readonly string[]): SubscriptionsRouteConfig {
  return { serviceIdentity: { scopes, beneficiary: "required" } };
}

/**
 * مسارُ عمليّاتٍ داخليٌّ لا مُنتَفِعَ إنسانٍ له: يفرضُ الصلاحيّةَ بلا مُنتَفِعٍ.
 */
function internalScoped(...scopes: readonly string[]): SubscriptionsRouteConfig {
  return { serviceIdentity: { scopes } };
}

/**
 * مساراتُ منعِ التكرار — عمودُ `route_key` في الجدول، لا جزءٌ من البصمة.
 *
 * أسماءٌ ثابتةٌ مكتوبةٌ هنا لا مبنيّةٌ من `request.url`: المسارُ يحمل مُعرّفَ سائقٍ، ولو دخل
 * في المفتاح لصار لكلّ سائقٍ «طريقٌ» جديد فانتفت فائدةُ العمود. والمُعرّفُ داخلٌ في البصمة
 * حيث يجب أن يكون: طلبٌ بنفسِ المفتاحِ لسائقٍ آخرَ اختلافُ **مُدخلٍ** لا اختلافُ طريق.
 */
const START_TRIAL_ROUTE_KEY = "subscriptions:start_trial";
const ACTIVATE_ROUTE_KEY = "subscriptions:activate";
const RECOMPUTE_ROUTE_KEY = "subscriptions:recompute";
const REFERRAL_CLAIM_ROUTE_KEY = "referrals:claim";

/**
 * بناءُ مِغلافِ الإعادةِ من مُدخلٍ **مُتحقَّقٍ منه** — لا من الجسمِ الخام.
 *
 * البصمةُ تُحسب على المُدخلِ الفعليِّ بعد التحقّق (حقولُ الجسمِ + مُعرّفُ السائقِ من المسار)
 * كي يكون «نفسُ الطلب» معناه نفسَ المعنى لا نفسَ البايتات: ترتيبُ مفاتيحِ JSON ومسافاتُه
 * تختلف بين مُتَّصلَين لنفسِ الطلب، وبصمةُ الخامِ كانت ستقول «طلبٌ مختلفٌ» فتُجيب `409`
 * على إعادةِ محاولةٍ سليمة. ولا ترويسةَ ولا لحظةَ وصولٍ في البصمة: إعادةُ الإرسالِ تحمل
 * `x-request-id` جديداً ولحظةً جديدةً وهي **نفسُ** الطلب.
 */
function replayEnvelope<T>(
  key: string,
  routeKey: string,
  traceId: string,
  input: unknown,
  present: (outcome: T) => { readonly responseStatus: number; readonly responseBody: unknown },
): IdempotencyEnvelope<T> {
  return { key, routeKey, requestHash: fingerprint(input), traceId, present };
}

/**
 * مالكُ المَورِدِ كما **يُثبِتُهُ الرمزُ**، مُطابَقاً بما كُتِبَ في المسارِ.
 *
 * `:driverPublicId` و`:ownerPublicId` قيمٌ **يكتبُها المُنادي**. فلو فُرِضَتِ الصلاحيّةُ
 * وحدَها لكانَ حاملُ `subscriptions:state:read` يقرأُ حالةَ كلِّ سائقٍ بتبديلِ حرفٍ في
 * المسارِ — وهذا وجهُ `RISK-0042` نفسُهُ الذي أُغلِقَ على حدِّ الطلباتِ في `M1-05B`،
 * ويُغلَقُ هنا في الدفعةِ التي تفرضُ الهويّةَ لا بعدَها.
 */
function requireBeneficiary(request: FastifyRequest): string {
  const caller = request.serviceCaller;
  const beneficiary = caller === undefined ? undefined : ownerPublicIdOf(caller);

  if (beneficiary === undefined || beneficiary.trim() === "") {
    throw new Error(
      'مسارٌ يمسُّ مَورِداً مملوكاً مُسجَّلٌ بلا beneficiary: "required" — راجِعِ ownerScoped().',
    );
  }

  return beneficiary;
}

/**
 * مطابقةُ المُنتَفِعِ المُوَقَّعِ مع `:driverPublicId` في المسارِ.
 * مخالفتُهُ تُرَدُّ `404` لا 403 — فلا يُفصَحُ لمن لا يملكُ عن وجودِ المعرِّفِ.
 */
function requireDriverBeneficiary(request: FastifyRequest): string {
  const beneficiary = requireBeneficiary(request);
  const driverPublicId = assertWaslaPublicId(pathParam(request.params, "driverPublicId"));
  if (driverPublicId !== beneficiary) {
    // `404` لا `403`: لا نكشفُ لمن لا يملكُ عن وجودِ الاشتراكِ.
    throw subscriptionNotFound();
  }
  return beneficiary;
}

/**
 * مطابقةُ المُنتَفِعِ المُوَقَّعِ مع `:ownerPublicId` في مسارِ رمزِ الإحالةِ.
 */
function requireOwnerBeneficiary(request: FastifyRequest): string {
  const beneficiary = requireBeneficiary(request);
  const ownerPublicId = assertWaslaPublicId(pathParam(request.params, "ownerPublicId"), "ownerPublicId");
  if (ownerPublicId !== beneficiary) {
    throw subscriptionNotFound();
  }
  return beneficiary;
}

export function createSubscriptionApp(
  options: CreateSubscriptionAppOptions = {},
): FastifyInstance {
  const services = options.services;
  const mode: PersistenceMode = options.mode ?? (services === undefined ? "memory" : "postgres");
  // `requestIdHeader` يجعل `x-request-id` القادمَ من المُتَّصل هو `request.id`، فيسري مُعرّفٌ
  // واحدٌ في سجلّاته وسجلّاتنا وفي `trace_id` من كلّ جواب. ويُولّد Fastify واحداً حين تغيب
  // الترويسة، فلا يكون `trace_id` فارغاً أبداً.
  const app = Fastify({ logger: options.logger ?? false, requestIdHeader: "x-request-id" });

  /**
   * حمولةٌ فارغةٌ مع `content-type: application/json` **ليست** خطأً في هذه الخدمة.
   *
   * `POST …/recompute` و`POST /subscriptions/tick` لا تُعلنان حمولةً في العقد، وأكثرُ
   * العملاءِ يضع الترويسةَ افتراضياً على كلّ `POST` ولو بلا حمولة. و
   * `FST_ERR_CTP_EMPTY_JSON_BODY` كان سيردّ `400` على طلبٍ **مطابقٍ للعقد تماماً**، فيصير
   * أوّلُ ما يجرّبه المُتكامِلُ فشلاً لا يفهم سببَه ثم يُرسل `{}` ليُسكته — أي يتعلّم أن
   * يخالف العقدَ ليعمل. والحمولةُ غيرُ الفارغةِ على تلك المساراتِ تبقى مرفوضةً في
   * `assertEmptyPayload`.
   */
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, payload, done) => {
    const raw = typeof payload === "string" ? payload.trim() : "";
    if (raw === "") {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(raw) as unknown);
    } catch {
      // `statusCode: 400` يقرؤه `http/errors.ts` فيصير `SUBSCRIPTION_VALIDATION_FAILED`:
      // «JSON مكسور» و«حقلٌ غيرُ صالح» تعليمةٌ واحدةٌ من جهةِ المُرسِل.
      done(Object.assign(new Error("JSON غير صالح"), { statusCode: 400 }), undefined);
    }
  });

  app.setErrorHandler((error, request, reply) => {
    sendSubscriptionError(reply, error, request.id);
  });

  /** الحدُّ الذي يمنع خدمةً بلا مخزنٍ من أن تبدو عاملة. */
  function deps(): SubscriptionAppServices {
    if (services === undefined) throw subscriptionUnavailable(UNAVAILABLE_REASON);
    return services;
  }

  // قبلَ تسجيلِ أيِّ مسارٍ بقصدٍ: حاجزُ التصنيفِ يرى ما يُسجَّلُ بعدَهُ وحدَهُ،
  // فمسارٌ يُسجَّلُ قبلَ هذا السطرِ يمرُّ بلا فرضٍ ولا يُكشَفُ.
  if (options.serviceIdentity !== undefined) {
    registerServiceIdentity(app, options.serviceIdentity);
  }

  // 1 — GET /health
  app.get("/health", { config: OPEN }, async (_request, reply) => {
    const wire: HealthWire = {
      // `degraded` لا `unavailable`: العمليّةُ حيّةٌ وتردّ، وعجزُها مُعلَنٌ في `mode`.
      // و`unavailable` محفوظةٌ لحالةٍ تعرفها العمليّةُ عن نفسِها ولا تستطيع خدمةَ الصحّة
      // ذاتَها — فلا تُكتب من هنا بحسنِ نيّة.
      status: mode === "postgres" ? "ok" : "degraded",
      mode,
      last_tick_at: services?.subscriptions.lastTickAt ?? null,
    };
    return reply.status(200).send(wire);
  });

  // 2 — GET /subscriptions/plans
  app.get("/subscriptions/plans", { config: internalScoped(SUBSCRIPTIONS_SCOPES.plansRead) }, async (request, reply) => {
    assertRequestIdLength(request.headers);
    const frozenOnly = toQueryFrozenOnly(request.query);
    // الكتالوجُ يُقرأ من القاعدةِ لا من ثابتِ `PLAN_CATALOG` (قرارُ المراجعة 3/6): الثابتُ
    // بذرةٌ، والحقيقةُ ما استقرّ في الصفوف — وخدمةٌ تُعلن خطّةً لا تملكها القاعدةُ تمنح
    // مدّةً تسقط على مفتاحٍ أجنبيّ.
    const plans = await deps().subscriptions.listPlans(frozenOnly);
    return reply.status(200).send({ plans: plans.map(toPlanWire) });
  });

  // 3 — GET /subscriptions/plans/{planCode}/{planVersion}
  app.get("/subscriptions/plans/:planCode/:planVersion", { config: internalScoped(SUBSCRIPTIONS_SCOPES.plansRead) }, async (request, reply) => {
    assertRequestIdLength(request.headers);
    // حرّاسُ المجال تُنادى من الحدّ ولا تُنسَخ فيه: `assertPlanCode` هي نفسُها التي تخضع
    // لها طبقةُ التطبيق، فلا تصير قاعدةُ الشكلِ رأيَين على موضعين.
    const planCode = assertPlanCode(pathParam(request.params, "planCode"), "planCode");
    const planVersion = toPathPlanVersion(request.params);
    // `getPlan` لا `getGrantablePlan`: من يقرأ نسخةً للمراجعة يحتاج أن يرى ما فيها بما فيه
    // `is_frozen: false`؛ والتجميدُ شرطُ المنحِ لا شرطُ النظر.
    const plan = await deps().subscriptions.getPlan(planCode, planVersion);
    return reply.status(200).send(toPlanWire(plan));
  });

  // 4 — POST /subscriptions
  app.post("/subscriptions", { config: ownerScoped(SUBSCRIPTIONS_SCOPES.subscriptionsWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const wire = toStartTrialInput(request.body);
    const input = {
      driverPublicId: assertWaslaPublicId(wire.driverPublicId),
      planCode: assertPlanCode(wire.planCode),
      planVersion: assertPlanVersion(wire.planVersion),
      requestedAt: assertTimestamp(wire.requestedAt, "requested_at"),
    };
    // المُنتَفِعُ من الجسمِ لا من المسارِ: مطابقةُ `driver_public_id` مع `obo` المُوَقَّعِ.
    const beneficiary = requireBeneficiary(request);
    if (input.driverPublicId !== beneficiary) {
      throw subscriptionNotFound();
    }
    const outcome = await deps().subscriptions.startTrial({
      ...input,
      trace: { traceId },
      // نفسُ الحالةِ ونفسُ الجسمِ اللذَين يُرسَلان أدناه — مكتوبةً مرّتَين بقصد: صيغةُ
      // الإرسالِ في المعالجِ هي ما يحرسه `__tests__/http-drift.test.ts` بالنصّ، ودالّةٌ
      // مشتركةٌ كانت ستُخفي أخصَّ سطرٍ في المسار عن حارسه.
      idempotency: replayEnvelope(idempotencyKey, START_TRIAL_ROUTE_KEY, traceId, input, (result) => ({
        responseStatus: result.duplicate ? 200 : 201,
        responseBody: toGrantResultWire(result),
      })),
    });
    // `201` للإنشاء و`200` للإعادة — كما يُعلن العقد. وبدءٌ ثانٍ لسائقٍ له اشتراكٌ ليس
    // إعادةً بل `409 SUBSCRIPTION_ALREADY_EXISTS` من `app/`، فلا يمرّ من هنا.
    return reply.status(outcome.duplicate ? 200 : 201).send(toGrantResultWire(outcome));
  });

  // 5 — GET /subscriptions/{driverPublicId}
  app.get("/subscriptions/:driverPublicId", { config: ownerScoped(SUBSCRIPTIONS_SCOPES.stateRead) }, async (request, reply) => {
    assertRequestIdLength(request.headers);
    requireDriverBeneficiary(request);
    const driver = assertWaslaPublicId(pathParam(request.params, "driverPublicId"));
    // قراءةٌ لا تشتقّ ولا تكتب (القرار 2): تُعيد الصفَّ المُتحقِّقَ وتُعلن `is_stale` إن
    // تجاوز الزمنُ نهايتَه. واشتقاقٌ صامتٌ هنا كان سيجعل كلَّ قراءةٍ كتابةً محتملةً وكلَّ
    // `GET` معاملةً على مسارٍ يُنادى في كلّ شاشة.
    const view = await deps().subscriptions.getState(driver);
    return reply.status(200).send(toStateWire(view));
  });

  // 6 — POST /subscriptions/{driverPublicId}/activate
  app.post("/subscriptions/:driverPublicId/activate", { config: ownerScoped(SUBSCRIPTIONS_SCOPES.activateWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    requireDriverBeneficiary(request);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const driver = assertWaslaPublicId(pathParam(request.params, "driverPublicId"));
    const wire = toActivateInput(request.body);
    const input = {
      driverPublicId: driver,
      paymentReference: wire.paymentReference,
      planCode: assertPlanCode(wire.planCode),
      planVersion: assertPlanVersion(wire.planVersion),
      activatedAt: assertTimestamp(wire.activatedAt, "activated_at"),
    };
    const outcome = await deps().subscriptions.activate({
      ...input,
      trace: { traceId },
      idempotency: replayEnvelope(idempotencyKey, ACTIVATE_ROUTE_KEY, traceId, input, (result) => ({
        responseStatus: 200,
        responseBody: toGrantResultWire(result),
      })),
    });
    // `200` دائماً — العقدُ لا يُعلن `201` لهذا المسار: المُنشأُ مدّةٌ داخليّةٌ لا موردٌ
    // بعنوان، والحالةُ المُعادةُ هي المورد وقد كان موجوداً قبل النداء.
    return reply.status(200).send(toGrantResultWire(outcome));
  });

  // 7 — POST /subscriptions/{driverPublicId}/recompute
  app.post("/subscriptions/:driverPublicId/recompute", { config: ownerScoped(SUBSCRIPTIONS_SCOPES.recomputeWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    requireDriverBeneficiary(request);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const driver = assertWaslaPublicId(pathParam(request.params, "driverPublicId"));
    assertEmptyPayload(request.body);
    // لا جسمَ لهذا الطلب، فالمُدخلُ الفعليُّ هو مُعرّفُ السائقِ وحدَه.
    const outcome = await deps().subscriptions.recompute(
      driver,
      { traceId },
      replayEnvelope(idempotencyKey, RECOMPUTE_ROUTE_KEY, traceId, { driverPublicId: driver }, (result) => ({
        responseStatus: 200,
        responseBody: toRecomputeResultWire(result),
      })),
    );
    return reply.status(200).send(toRecomputeResultWire(outcome));
  });

  // 8 — GET /subscriptions/{driverPublicId}/periods
  app.get("/subscriptions/:driverPublicId/periods", { config: ownerScoped(SUBSCRIPTIONS_SCOPES.periodsRead) }, async (request, reply) => {
    assertRequestIdLength(request.headers);
    requireDriverBeneficiary(request);
    const driver = assertWaslaPublicId(pathParam(request.params, "driverPublicId"));
    const periods = await deps().subscriptions.listPeriods(driver);
    return reply.status(200).send({ periods: periods.map(toPeriodWire) });
  });

  // 9 — POST /subscriptions/tick
  app.post("/subscriptions/tick", { config: internalScoped(SUBSCRIPTIONS_SCOPES.tickRun) }, async (request, reply) => {
    assertRequestIdLength(request.headers);
    requireIdempotencyKey(request.headers);
    assertEmptyPayload(request.body);
    // لا حدَّ من السلك: مُتَّصلٌ يختار كم سائقاً تُعيد نبضةٌ واحدةٌ حسابَه يختار عمليّاً
    // طولَ معاملةٍ على قاعدةٍ مشتركة (`TICK_BATCH_LIMIT` في `app/`).
    const outcome = await deps().subscriptions.tick();
    return reply.status(200).send(toTickWire(outcome));
  });

  // 10 — POST /referrals
  app.post("/referrals", { config: ownerScoped(SUBSCRIPTIONS_SCOPES.referralsWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const wire = toReferralClaimInput(request.body);
    const input = {
      referralCode: assertReferralCode(wire.referralCode),
      refereePublicId: assertWaslaPublicId(wire.refereePublicId, "referee_public_id"),
      claimedAt: assertTimestamp(wire.claimedAt, "claimed_at"),
    };
    // المُنتَفِعُ من الجسمِ لا من المسارِ: مطابقةُ `referee_public_id` مع `obo` المُوَقَّعِ.
    const beneficiary = requireBeneficiary(request);
    if (input.refereePublicId !== beneficiary) {
      throw subscriptionNotFound();
    }
    const outcome = await deps().referrals.claim({
      ...input,
      traceId,
      idempotency: replayEnvelope(idempotencyKey, REFERRAL_CLAIM_ROUTE_KEY, traceId, input, (result) => ({
        responseStatus: result.duplicate ? 200 : 201,
        responseBody: toReferralClaimResultWire(result),
      })),
    });
    return reply.status(outcome.duplicate ? 200 : 201).send(toReferralClaimResultWire(outcome));
  });

  // 11 — GET /referrals
  app.get("/referrals", { config: internalScoped(SUBSCRIPTIONS_SCOPES.referralsRead) }, async (request, reply) => {
    assertRequestIdLength(request.headers);
    const selected = toReferralListFilter(request.query);
    // نمطُ المُعرّفِ يفحصه المجالُ هنا أيضاً: مُرشِّحٌ بمُعرّفٍ مشوّهٍ يُعيد `[]` بصمتٍ
    // فيُقرأ «لا إحالات» وهو خطأُ إملاءٍ في نصِّ استعلام.
    const filter: ReferralFilter =
      selected.kind === "referrer"
        ? { referrerPublicId: assertWaslaPublicId(selected.value, "referrer_public_id") }
        : selected.kind === "referee"
          ? { refereePublicId: assertWaslaPublicId(selected.value, "referee_public_id") }
          : { state: selected.value as ReferralFilter["state"] };
    const referrals = await deps().referrals.list(filter);
    return reply.status(200).send({ referrals: referrals.map(toReferralWire) });
  });

  // 12 — GET /referrals/codes/{ownerPublicId}
  app.get("/referrals/codes/:ownerPublicId", { config: ownerScoped(SUBSCRIPTIONS_SCOPES.referralsRead) }, async (request, reply) => {
    assertRequestIdLength(request.headers);
    requireOwnerBeneficiary(request);
    const owner = assertWaslaPublicId(pathParam(request.params, "ownerPublicId"), "ownerPublicId");
    // قراءةٌ محضة: الرمزُ يُزرع داخلَ معاملةِ بدءِ التجربة، ولا يُولَّد في `GET`.
    // و`errors.md` يمنع الإنشاءَ الضمنيَّ في قراءةٍ صراحةً، فمن لا رمزَ له يستلم `404`.
    const code = await deps().referrals.getCode(owner);
    return reply.status(200).send(toReferralCodeWire(code));
  });

  return app;
}
