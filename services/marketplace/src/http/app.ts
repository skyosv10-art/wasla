/**
 * حدُّ HTTP لخدمةِ السوق — خمسةَ عشرَ مساراً وتسعَ عشرةَ عمليّةً على المنفذِ 8094.
 *
 * ## لا `try/catch` في أيّ مُعالِج
 *
 * مُعالِجُ خطأٍ **واحدٌ** (`setErrorHandler`) يترجم كلَّ ما يُرمى. و`try/catch` في مُعالِجٍ
 * يعني ترجمةً ثانيةً لنفسِ الخطأِ في موضعٍ لا يراه أحدٌ، وأوّلَ مسارٍ يُنسى فيه الالتزامُ
 * بالشكلِ يُعيد جسماً لا يطابق `ErrorResponse`. والمسارُ الواحدُ يجعل شكلَ الخطأِ حقيقةً
 * واحدةً في الخدمة.
 *
 * ## و`probe` لا يُمرَّر من هنا أبداً
 *
 * `TransactionProbe` أداةُ اختبارٍ تُوقف المعاملةَ بين الدفترِ وإسقاطِه لتُثبِت الذرّيّة.
 * وتمريرُها من الحدِّ كان سيجعل مسارَ إنتاجٍ يقبل خطّافاً يُبطئ معاملةً أو يُفشلها — فلا
 * تُذكَر في هذا الملفّ بحال.
 *
 * ## والحالةُ لا تُقبَل في جسمٍ
 *
 * لا مسارَ كتابةٍ هنا يقرأ `state` أو `moderation_state` من جسم. الحالةُ إسقاطُ دفترٍ
 * (`stores.state` · `products.moderation_state`)، والقرارُ هو ما يُرسَل: `decision` +
 * `actor_type`. والحالةُ تُقبَل مُرشِّحَ قراءةٍ في `GET` وحدَه.
 *
 * ## وسبقُ الجوابِ المحفوظِ على كلّ شيء
 *
 * كلُّ كتابةٍ تحمل `Idempotency-Key`، وحرسُ الإعادةِ أوّلُ جملةٍ في معاملتها، والتثبيتُ آخرُها.
 * و`present` تُكتب هنا لأنّ الحدَّ وحدَه يعرف رمزَ الحالة: `201` لإنشاءٍ وقرارٍ يُنشئ صفَّ
 * دفتر، و`200` لنشرٍ وأرشفةٍ وإزالةِ عضوٍ — ثلاثُ عمليّاتٍ تُغيّر موجوداً ولا تُنشئ مورِداً.
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

import { ownerPublicIdOf } from "@wasla/auth-sdk";

import {
  MARKETPLACE_ROUTE_KEYS,
  fingerprint,
  type IdempotencyEnvelope,
  type MarketplaceCatalogService,
  type MarketplaceProductService,
  type MarketplaceStoreService,
  type ReservationOutcome,
  type StoredIdempotentResponse,
} from "../app/index.js";
import { marketplaceUnavailable, storeNotFound } from "../domain/errors.js";
import { sendMarketplaceError } from "./errors.js";
import {
  MARKETPLACE_SCOPES,
  registerServiceIdentity,
  type MarketplaceRouteConfig,
  type MarketplaceServiceIdentityOptions,
} from "./service-identity.js";
import {
  toInventoryAdjustmentResource,
  toInventoryReadResponse,
  toProductResource,
  toProductReviewResource,
  toReservationResponse,
  toStoreCategory,
  toStoreResource,
  toStoreReviewResource,
  toStoreStaffResource,
} from "./mappers.js";
import {
  assertRequestIdLength,
  parseAddStaff,
  parseAdjustInventory,
  parseCategoryQuery,
  parseCreateProduct,
  parseInventoryQuery,
  parsePageQuery,
  parseProductAction,
  parseProductDecision,
  parseProductQuery,
  parseRegisterStore,
  parseRemoveStaff,
  parseReservation,
  parseReviewRequest,
  parseStoreDecision,
  parseStoreQuery,
  pathParam,
  requireIdempotencyKey,
} from "./requests.js";

/** الخدماتُ الثلاثُ التي يحتاجها الحدُّ — تُحقن ولا تُبنى هنا. */
export interface MarketplaceServices {
  readonly stores: MarketplaceStoreService;
  readonly products: MarketplaceProductService;
  readonly catalog: MarketplaceCatalogService;
}

export interface MarketplaceAppOptions {
  readonly services?: MarketplaceServices;
  readonly mode?: "postgres" | "memory";
  readonly logger?: boolean;
  /**
   * هويّةُ الخدمةِ — **إلزاميّةٌ بلا قيمةٍ افتراضيّةٍ** (`M1-04` · المراجعةُ 29/N).
   *
   * وهذا الحقلُ وحدَه هوَ ما نزعَ الافتراضَ عن `options` كلِّها: كانت
   * `createMarketplaceApp()` تُستدعى بلا وسائطَ، فكانَ يكفي نسيانُ سطرٍ في
   * تركيبٍ جديدٍ لتقومَ خدمةٌ **مفتوحةُ الحدِّ** تُصدِّقُ كلَّ منادٍ. وقيمةٌ
   * افتراضيّةٌ هنا — ولو «آمنةٌ» — كانت ستجعلَ نشراً بلا
   * `WASLA_SERVICE_AUTH_KEYS` يعملُ بهدوءٍ، والهدوءُ هوَ العطبُ.
   *
   * فلا افتراضَ: نشرٌ ناقصُ المفاتيحِ **يسقطُ عندَ الإقلاعِ** فيُسمّى العطبُ في
   * موضعِه (`ADR-020` · `ADR-022`).
   */
  readonly serviceIdentity: MarketplaceServiceIdentityOptions;
}

/**
 * مسارٌ يمسُّ مُستأجِراً بعينِهِ (`M1-05B` الموجةُ 2 · `RISK-0042` البندُ 2).
 *
 * يُضيفُ `beneficiary: "required"` فيرفضُ الوسيطُ المركزيُّ كلَّ رمزٍ لا يحملُ
 * هويّةَ فاعلٍ إنسانٍ **قبلَ أن يُمسَّ المتجرُ**. والفرقُ عن `scoped` ليسَ
 * أنَّ هذا «أشدُّ حمايةً» بل أنَّ **الصلاحيّةَ وحدَها لا تقولُ أيُّ متجرٍ**:
 * حاملُ `marketplace:staff:write` كانَ يكتبُ في طاقمِ كلِّ متجرٍ بتبديلِ
 * حرفٍ في المسارِ.
 *
 * **وُكتبَ `function` لا سهماً عن قصدٍ**: حارسُ المصفوفةِ (البابُ 7 في
 * `scripts/checks/validate-authz-policy.sh`) يجردُ المساعدينَ المُنتِجينَ
 * للمطلبِ بمسحِ إعلاناتِ `function`، وسهمٌ مُسندٌ إلى `const` لا يُرى.
 * والعمى هنا **لا يمرُّ صامتاً**: المقابلةُ في الاتجاهَينِ، فمصفوفةٌ
 * تُعلِنُ سبعةً وشفرةٌ تُقاسُ اثنتَينِ تُسقِطُ البابَ لا تُخفيهِ. ومعَ ذلكَ
 * فالموافقةُ أصدقُ من الاعتمادِ على إسقاطٍ لاحقٍ — وهيَ نفسُ صيغةِ
 * `ownerScoped` في حدِّ الطلباتِ.
 *
 * **وفي نطاقِ الوَحدةِ لا داخلَ المصنعِ** — وهذا سببُهُ تغيّرَ، فيُصحَّحُ
 * بالإضافةِ لا بالمحوِ. كانَ مكتوباً هنا:
 *
 * > مِرساةُ الحارسِ تُغلِقُ جسمَ الدالّةِ بقوسٍ في أوّلِ العمودِ، فدالّةٌ
 * > مُعشَّشةٌ قوسُها مُزاحٌ لا تُرى. وهذا **قِيسَ** بإخفاقٍ حقيقيٍّ في
 * > البابِ 7 لا افتُرِضَ.
 *
 * وذاكَ صادقٌ في تاريخِهِ: البابُ 7 كانَ **يعمى عنِ المُعشَّشِ فعلاً**. لكنَّ
 * ذلكَ عطبُ الحارسِ لا قاعدةَ تنسيقٍ، وترضيةُ مِرساةٍ قاصرةٍ بتقييدِ شكلِ
 * الشفرةِ نقلٌ للمشكلةِ. فعُولِجَ **في الحارسِ**: مِرساتُهُ تلتقطُ العمقَ
 * وتطلبُ القوسَ الخاتمَ على عمقِ الإعلانِ نفسِهِ، ومعَها طفرتانِ (تعشيشٌ
 * وحدَهُ **يمرُّ** · تعشيشٌ معَ تفريغِ المطلبِ **يسقطُ**) تُثبِتانِ أنَّ المرورَ
 * قراءةٌ لا عمىً. فالبقاءُ في نطاقِ الوَحدةِ اليومَ **اختيارُ وضوحٍ** — مساعدٌ
 * لا يقرأُ حالةَ المصنعِ يُقرأُ مرّةً ويُستعملُ في خمسةِ مواضعَ — لا اضطرارٌ.
 */
function tenantScoped(...scopes: readonly string[]): MarketplaceRouteConfig {
  return { serviceIdentity: { scopes, beneficiary: "required" } };
}

/**
 * الفاعلُ كما **يُثبِتُهُ الرمزُ** — لا كما يدّعيهِ الجسمُ (`M1-05B`).
 *
 * ── ما كانَ ─────────────────────────────────────────────────────────
 * كلُّ كتابةٍ في هذا الحدِّ تقرأُ الفاعلَ من **جسمِ الطلبِ**
 * (`added_by_public_id` · `removed_by_public_id` · `created_by_public_id` ·
 * `requested_by_public_id` · `actor_public_id`) — **ثمانيةُ حقولٍ مقيسةٌ** لا
 * الحقلانِ اللذانِ سمّاهما `RISK-0042` البندُ 3. فكانَ مَن يكتبُ يُسمّي
 * نفسَهُ، والدفترُ يُوقِّعُ على تلكَ التسميةِ.
 *
 * ── ولمَ بقيَ الحقلُ إلزاميّاً ──────────────────────────────────
 * حذفُهُ من العقدِ تغييرُ عقدٍ على مُنادٍ لم يُستشار، وإبقاءُهُ حَكَماً هوَ
 * العطبُ نفسُهُ. فصارَ **مُتحَقَّقاً من تناسقِهِ معَ `obo`**، وهوَ عينُ ما فُعِلَ
 * بترويسةِ `X-Customer-Public-Id` في الموجةِ الأولى (`ADR-028`).
 *
 * والرفضُ `STORE_NOT_FOUND`: المُنادي أعلنَ فاعلَينِ مختلفَينِ فلا يُفصَحُ لهُ
 * أيُّهما عضوٌ في المتجرِ — وهوَ ما يمنعُ **النائبَ المُرتبِكَ**: بوّابةٌ
 * تُوَقِّعُ لإنسانٍ ثمَّ تُمرِّرُ جسماً يُسمّي إنساناً آخرَ.
 */
function tenantActor(request: FastifyRequest, claimedInBody?: string): string {
  const caller = request.serviceCaller;
  const actor = caller === undefined ? undefined : ownerPublicIdOf(caller);

  // لا يُبلَغُ من مسارٍ مُصنَّفٍ بـ`tenantScoped`: الوسيطُ رفضَ قبلَهُ.
  // وهوَ حارسُ تركيبٍ: مَن نسِيَ `tenantScoped` على مسارٍ جديدٍ يرى
  // انكساراً في الاختبارِ لا `201` بمُستأجِرٍ غيرِ مفحوصٍ.
  if (actor === undefined || actor.trim() === "") {
    throw new Error(
      "مسارٌ يمسُّ مُستأجِراً مُسجَّلٌ بلا beneficiary: \"required\" — راجِعِ tenantScoped().",
    );
  }
  if (claimedInBody !== undefined && claimedInBody !== actor) {
    throw storeNotFound(pathParam(request.params, "storeSlug"));
  }
  return actor;
}

/**
 * يبني حدَّ السوق.
 *
 * و`services` اختياريّةٌ عن قصد: خدمةٌ بلا `DATABASE_URL` تبقى قائمةً وتُجيب `/health` بحالةٍ
 * صادقةٍ بدلَ أن تسقط عند الإقلاع. ومنسّقُ حاوياتٍ يرى وعاءً يسقط ويعيد تشغيلَه بلا نهايةٍ
 * لا يُعطي أحداً السببَ؛ ووعاءٌ قائمٌ يقول `unavailable` يُعطيه في أوّلِ نداء.
 */
export function createMarketplaceApp(options: MarketplaceAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: "x-request-id",
  });
  const mode = options.mode ?? (options.services === undefined ? "memory" : "postgres");

  /**
   * مُحلِّلُ جسمٍ صريحٌ: جسمٌ فارغٌ `undefined` لا خطأٌ، وجسمٌ مُشوَّهٌ `400` لا `500`.
   *
   * ومُحلِّلُ Fastify الافتراضيُّ يرفض الجسمَ الفارغَ في `POST`، وثلاثةُ مساراتٍ في العقدِ
   * (`publish` · `archive`) تُرسِل حمولةً صغيرةً وقد يُرسلها عميلٌ فارغةً — فالتمييزُ لازم.
   */
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, rawBody, done) => {
      const text = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
      if (text.trim().length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch {
        done(Object.assign(new Error("malformed JSON body"), { statusCode: 400 }), undefined);
      }
    },
  );

  /** الخدماتُ أو خطأُ تعذُّرٍ مُسمّىً — ولا `!` ولا تأكيدُ نوعٍ يُخفي الغياب. */
  function deps(): MarketplaceServices {
    if (options.services === undefined) {
      throw marketplaceUnavailable("the service is running without a database connection");
    }
    return options.services;
  }

  /** مِغلافُ كتابةٍ: المفتاحُ من الترويسةِ والبصمةُ من المُدخلِ **المُتحقَّقِ منه** لا الخامّ. */
  function envelope<TOutcome>(
    headers: Record<string, string | string[] | undefined>,
    routeKey: string,
    input: unknown,
    present: (outcome: TOutcome) => StoredIdempotentResponse,
  ): IdempotencyEnvelope<TOutcome> {
    assertRequestIdLength(headers);
    return {
      key: requireIdempotencyKey(headers),
      routeKey,
      requestHash: fingerprint(input),
      present,
    };
  }

  /**
   * تصنيفُ المساراتِ (`M1-04` · المراجعةُ 29/N).
   *
   * `/health` وحدَهُ مفتوحٌ، وهوَ مفتوحٌ **عن قرارٍ لا عن سهوٍ**: منسّقُ
   * الحاوياتِ ومسبارُ التسليمِ يقرآنِهِ قبلَ أن يملكا رمزاً، وجاهزيّةٌ تُجيبُ
   * `401` تُوقِفُ النشرَ لا المهاجمَ. وما يُعادُ فيهِ محصورٌ مقيساً: `status`
   * و`mode` — **لا مُعرِّفَ متجرٍ ولا منتجٍ ولا رصيدَ مخزونٍ**.
   *
   * وكلُّ ما بعدَهُ مُغلَقٌ بصلاحيّةٍ مُعلَنةٍ. **ومسارٌ يُسجَّلُ بلا تصنيفٍ
   * يُسقِطُ الإقلاعَ** — فالمسارُ الثاني والعشرونَ، إن أُضيفَ غداً، لا يمرُّ
   * صامتاً.
   */
  const OPEN: MarketplaceRouteConfig = { serviceIdentity: "open" };
  const scoped = (...scopes: readonly string[]): MarketplaceRouteConfig => ({
    serviceIdentity: { scopes },
  });

  /**
   * قبلَ أوّلِ مسارٍ وقبلَ خطّافِ مفتاحِ التفرُّدِ أدناهُ — والترتيبُ مقصودٌ
   * مرّتَين:
   *
   * 1. حاجزُ التصنيفِ عندَ `onRoute` يرى ما يُسجَّلُ **بعدَهُ** لا ما قبلَهُ.
   * 2. خطّافاتُ `onRequest` تجري بترتيبِ تسجيلِها، فمنادٍ **بلا هويّةٍ** يُرَدُّ
   *    `401` قبلَ أن يُقالَ لهُ «مفتاحُ تفرُّدِكَ ناقصٌ». وعكسُ الترتيبِ كانَ
   *    يُعطي مجهولاً خريطةَ شروطِ الحدِّ نداءً بعدَ نداءٍ.
   */
  registerServiceIdentity(app, options.serviceIdentity);

  /**
   * حدُّ الطلبِ يُفحَص **قبل** كلِّ شيء — لا في وسطِ معالجٍ.
   *
   * وترتيبُ الفحصِ ليس تفصيلاً: خدمةٌ بلا قاعدةٍ كانت تُجيب `503` على `POST` ناقصِ
   * `Idempotency-Key`، فيقرأ المُتَّصلُ «الخدمةُ متعذّرة» ويُعيد **نفسَ** الطلبِ المخالفِ
   * إلى الأبد. وخطأُ المُتَّصلِ يُقال له كما هو حتى لو كانت القاعدةُ غائبة.
   *
   * ولمَ خطّافٌ واحدٌ لا سطرٌ في كلِّ معالج؟ لأنّ إحدى عشرَ كتابةً تحتاج الفحصَ نفسَه،
   * وسطرٌ منسيٌّ في معالجٍ واحدٍ كان سيجعل عمليّةً تُنفَّذ مرّتَين على إعادةِ محاولة. والعقدُ
   * يُلزم `Idempotency-Key` في كلِّ `POST` و`DELETE` بلا استثناء، فالشرطُ يُقرأ من الطريقةِ
   * وحدَها ولا يحتاج قائمةَ مساراتٍ تُصان.
   */
  app.addHook("onRequest", async (request) => {
    assertRequestIdLength(request.headers);
    if (request.method === "POST" || request.method === "DELETE") {
      requireIdempotencyKey(request.headers);
    }
  });

  app.setErrorHandler((error, request, reply) =>
    sendMarketplaceError(reply, error, String(request.id)),
  );

  // --- الصحّةُ والتصنيفات -----------------------------------------------------

  app.get("/health", { config: OPEN }, async (_request, reply): Promise<FastifyReply> => {
    if (options.services === undefined) {
      return reply.status(200).send({ status: "unavailable", mode });
    }
    const health = await options.services.catalog.health();
    return reply.status(200).send({ status: health.status, mode });
  });

  app.get("/categories", { config: scoped(MARKETPLACE_SCOPES.categoryRead) }, async (request, reply): Promise<FastifyReply> => {
    const query = parseCategoryQuery(request.query);
    const { catalog } = deps();
    const index = await catalog.categorySlugIndex();
    const categories = await catalog.listCategories(query.activeOnly ?? false);
    return reply
      .status(200)
      .send({ categories: categories.map((category) => toStoreCategory(category, index)) });
  });

  // --- المتاجر ---------------------------------------------------------------

  app.post("/stores", { config: scoped(MARKETPLACE_SCOPES.storeWrite) }, async (request, reply): Promise<FastifyReply> => {
    const input = parseRegisterStore(request.body);
    const { stores, catalog } = deps();
    const index = await catalog.categorySlugIndex();
    const store = await stores.registerStore(
      input,
      envelope(request.headers, MARKETPLACE_ROUTE_KEYS.storeRegister, input, (outcome) => ({
        responseStatus: 201,
        responseBody: toStoreResource(outcome, index),
      })),
    );
    return reply.status(201).send(toStoreResource(store, index));
  });

  app.get("/stores", { config: scoped(MARKETPLACE_SCOPES.storeRead) }, async (request, reply): Promise<FastifyReply> => {
    const query = parseStoreQuery(request.query);
    const { stores, catalog } = deps();
    const index = await catalog.categorySlugIndex();
    const page = await stores.listStores(query);
    return reply.status(200).send({
      stores: page.items.map((store) => toStoreResource(store, index)),
      next_cursor: page.nextCursor ?? null,
    });
  });

  app.get("/stores/:storeSlug", { config: scoped(MARKETPLACE_SCOPES.storeRead) }, async (request, reply): Promise<FastifyReply> => {
    const storeSlug = pathParam(request.params, "storeSlug");
    const { stores, catalog } = deps();
    const index = await catalog.categorySlugIndex();
    const store = await stores.getStore(storeSlug);
    return reply.status(200).send(toStoreResource(store, index));
  });

  app.post("/stores/:storeSlug/review-requests", { config: tenantScoped(MARKETPLACE_SCOPES.storeReviewRequest) }, async (request, reply): Promise<FastifyReply> => {
    const storeSlug = pathParam(request.params, "storeSlug");
    const input = parseReviewRequest(request.body);
    const actorPublicId = tenantActor(request, input.requestedByPublicId);
    const { stores } = deps();
    const outcome = await stores.requestStoreReview(
      storeSlug,
      actorPublicId,
      envelope(request.headers, MARKETPLACE_ROUTE_KEYS.storeReviewRequest, input, (result) => ({
        responseStatus: 201,
        responseBody: toStoreReviewResource(result.review, storeSlug),
      })),
    );
    return reply.status(201).send(toStoreReviewResource(outcome.review, storeSlug));
  });

  app.post("/stores/:storeSlug/decisions", { config: scoped(MARKETPLACE_SCOPES.storeReviewDecide) }, async (request, reply): Promise<FastifyReply> => {
    const storeSlug = pathParam(request.params, "storeSlug");
    const input = parseStoreDecision(request.body);
    const { stores } = deps();
    const outcome = await stores.decideStore(
      storeSlug,
      input,
      envelope(request.headers, MARKETPLACE_ROUTE_KEYS.storeDecide, input, (result) => ({
        responseStatus: 201,
        responseBody: toStoreReviewResource(result.review, storeSlug),
      })),
    );
    return reply.status(201).send(toStoreReviewResource(outcome.review, storeSlug));
  });

  app.get("/stores/:storeSlug/reviews", { config: scoped(MARKETPLACE_SCOPES.storeReviewRead) }, async (request, reply): Promise<FastifyReply> => {
    const storeSlug = pathParam(request.params, "storeSlug");
    const query = parsePageQuery(request.query);
    const { stores } = deps();
    const page = await stores.listStoreReviews(storeSlug, {
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    return reply.status(200).send({
      reviews: page.items.map((review) => toStoreReviewResource(review, storeSlug)),
      next_cursor: page.nextCursor ?? null,
    });
  });

  // --- الطاقم ---------------------------------------------------------------

  app.get("/stores/:storeSlug/staff", { config: tenantScoped(MARKETPLACE_SCOPES.staffRead) }, async (request, reply): Promise<FastifyReply> => {
    const storeSlug = pathParam(request.params, "storeSlug");
    const actorPublicId = tenantActor(request);
    const { stores } = deps();
    const staff = await stores.listStaff(storeSlug, actorPublicId);
    return reply.status(200).send({ staff: staff.map(toStoreStaffResource) });
  });

  app.post("/stores/:storeSlug/staff", { config: tenantScoped(MARKETPLACE_SCOPES.staffWrite) }, async (request, reply): Promise<FastifyReply> => {
    const storeSlug = pathParam(request.params, "storeSlug");
    const input = parseAddStaff(request.body);
    const actorPublicId = tenantActor(request, input.addedByPublicId);
    const { stores } = deps();
    const member = await stores.addStaff(
      storeSlug,
      input,
      envelope(request.headers, MARKETPLACE_ROUTE_KEYS.storeStaffAdd, input, (outcome) => ({
        responseStatus: 201,
        responseBody: toStoreStaffResource(outcome),
      })),
      actorPublicId,
    );
    return reply.status(201).send(toStoreStaffResource(member));
  });

  app.delete(
    "/stores/:storeSlug/staff/:memberPublicId",
    { config: tenantScoped(MARKETPLACE_SCOPES.staffWrite) },
    async (request, reply): Promise<FastifyReply> => {
      const storeSlug = pathParam(request.params, "storeSlug");
      const memberPublicId = pathParam(request.params, "memberPublicId");
      const input = parseRemoveStaff(request.body);
      const actorPublicId = tenantActor(request, input.removedByPublicId);
      const { stores } = deps();
      const removed = await stores.removeStaff(
        storeSlug,
        memberPublicId,
        actorPublicId,
        envelope(request.headers, MARKETPLACE_ROUTE_KEYS.storeStaffRemove, input, (outcome) => ({
          responseStatus: 200,
          responseBody: toStoreStaffResource(outcome),
        })),
      );
      return reply.status(200).send(toStoreStaffResource(removed));
    },
  );

  // --- المنتجات -------------------------------------------------------------

  app.get("/stores/:storeSlug/products", { config: scoped(MARKETPLACE_SCOPES.productRead) }, async (request, reply): Promise<FastifyReply> => {
    const storeSlug = pathParam(request.params, "storeSlug");
    const query = parseProductQuery(request.query);
    const { products, catalog } = deps();
    const index = await catalog.categorySlugIndex();
    const page = await products.listProducts(storeSlug, query);
    return reply.status(200).send({
      products: page.items.map((view) => toProductResource(view, index)),
      next_cursor: page.nextCursor ?? null,
    });
  });

  app.post("/stores/:storeSlug/products", { config: tenantScoped(MARKETPLACE_SCOPES.productWrite) }, async (request, reply): Promise<FastifyReply> => {
    const storeSlug = pathParam(request.params, "storeSlug");
    const input = parseCreateProduct(request.body);
    const actorPublicId = tenantActor(request, input.createdByPublicId);
    const { products, catalog } = deps();
    const index = await catalog.categorySlugIndex();
    const view = await products.createProduct(
      storeSlug,
      input,
      envelope(request.headers, MARKETPLACE_ROUTE_KEYS.productCreate, input, (outcome) => ({
        responseStatus: 201,
        responseBody: toProductResource(outcome, index),
      })),
      actorPublicId,
    );
    return reply.status(201).send(toProductResource(view, index));
  });

  app.get("/products/:productId", { config: scoped(MARKETPLACE_SCOPES.productRead) }, async (request, reply): Promise<FastifyReply> => {
    const productId = pathParam(request.params, "productId");
    const { products, catalog } = deps();
    const index = await catalog.categorySlugIndex();
    const view = await products.getProduct(productId);
    return reply.status(200).send(toProductResource(view, index));
  });

  app.post("/products/:productId/publish", { config: scoped(MARKETPLACE_SCOPES.productLifecycle) }, async (request, reply): Promise<FastifyReply> => {
    const productId = pathParam(request.params, "productId");
    const input = parseProductAction(request.body);
    const { products, catalog } = deps();
    const index = await catalog.categorySlugIndex();
    const view = await products.publishProduct(
      productId,
      input.actorPublicId,
      envelope(request.headers, MARKETPLACE_ROUTE_KEYS.productPublish, input, (outcome) => ({
        responseStatus: 200,
        responseBody: toProductResource(outcome, index),
      })),
    );
    return reply.status(200).send(toProductResource(view, index));
  });

  app.post("/products/:productId/archive", { config: scoped(MARKETPLACE_SCOPES.productLifecycle) }, async (request, reply): Promise<FastifyReply> => {
    const productId = pathParam(request.params, "productId");
    const input = parseProductAction(request.body);
    const { products, catalog } = deps();
    const index = await catalog.categorySlugIndex();
    const view = await products.archiveProduct(
      productId,
      input.actorPublicId,
      envelope(request.headers, MARKETPLACE_ROUTE_KEYS.productArchive, input, (outcome) => ({
        responseStatus: 200,
        responseBody: toProductResource(outcome, index),
      })),
    );
    return reply.status(200).send(toProductResource(view, index));
  });

  app.post("/products/:productId/decisions", { config: scoped(MARKETPLACE_SCOPES.productReviewDecide) }, async (request, reply): Promise<FastifyReply> => {
    const productId = pathParam(request.params, "productId");
    const input = parseProductDecision(request.body);
    const { products } = deps();
    const outcome = await products.decideProduct(
      productId,
      input,
      envelope(request.headers, MARKETPLACE_ROUTE_KEYS.productDecide, input, (result) => ({
        responseStatus: 201,
        responseBody: toProductReviewResource(result),
      })),
    );
    return reply.status(201).send(toProductReviewResource(outcome));
  });

  // --- المخزون --------------------------------------------------------------

  app.get("/products/:productId/inventory", { config: scoped(MARKETPLACE_SCOPES.inventoryRead) }, async (request, reply): Promise<FastifyReply> => {
    const productId = pathParam(request.params, "productId");
    const query = parseInventoryQuery(request.query);
    const { products } = deps();
    const view = await products.readInventory(productId, query);
    return reply.status(200).send(
      toInventoryReadResponse(view, (adjustment) =>
        toInventoryAdjustmentResource({ adjustment, storeId: view.storeId }),
      ),
    );
  });

  app.post("/products/:productId/inventory", { config: scoped(MARKETPLACE_SCOPES.inventoryAdjust) }, async (request, reply): Promise<FastifyReply> => {
    const productId = pathParam(request.params, "productId");
    const input = parseAdjustInventory(request.body);
    const { products } = deps();
    const outcome = await products.adjustInventory(
      productId,
      input,
      envelope(request.headers, MARKETPLACE_ROUTE_KEYS.inventoryAdjust, input, (result) => ({
        responseStatus: 201,
        responseBody: toInventoryAdjustmentResource(result),
      })),
    );
    return reply.status(201).send(toInventoryAdjustmentResource(outcome));
  });

  // --- الحجزُ والإفراجُ (الطور 13) ------------------------------------------------

  app.post("/stores/:storeSlug/inventory/reserve", { config: scoped(MARKETPLACE_SCOPES.inventoryReserve) }, async (request, reply): Promise<FastifyReply> => {
    const storeSlug = pathParam(request.params, "storeSlug");
    const input = parseReservation(request.body);
    const { products } = deps();
    const outcome = await products.reserveInventory(
      storeSlug,
      input,
      envelope(request.headers, MARKETPLACE_ROUTE_KEYS.inventoryReserve, input, (result: ReservationOutcome) => ({
        responseStatus: 201,
        responseBody: toReservationResponse(result),
      })),
    );
    return reply.status(201).send(toReservationResponse(outcome));
  });

  app.post("/stores/:storeSlug/inventory/release", { config: scoped(MARKETPLACE_SCOPES.inventoryRelease) }, async (request, reply): Promise<FastifyReply> => {
    const storeSlug = pathParam(request.params, "storeSlug");
    const input = parseReservation(request.body);
    const { products } = deps();
    const outcome = await products.releaseInventory(
      storeSlug,
      input,
      envelope(request.headers, MARKETPLACE_ROUTE_KEYS.inventoryRelease, input, (result: ReservationOutcome) => ({
        responseStatus: 200,
        responseBody: toReservationResponse(result),
      })),
    );
    return reply.status(200).send(toReservationResponse(outcome));
  });

  return app;
}

export {
  MARKETPLACE_SCOPES,
  MARKETPLACE_SERVICE_AUDIENCE,
  registerServiceIdentity,
} from "./service-identity.js";
export type {
  MarketplaceRouteConfig,
  MarketplaceRouteIdentity,
  MarketplaceServiceDenialBody,
  MarketplaceServiceIdentityOptions,
} from "./service-identity.js";
