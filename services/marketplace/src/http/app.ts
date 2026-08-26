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

import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";

import {
  MARKETPLACE_ROUTE_KEYS,
  fingerprint,
  type IdempotencyEnvelope,
  type MarketplaceCatalogService,
  type MarketplaceProductService,
  type MarketplaceStoreService,
  type StoredIdempotentResponse,
} from "../app/index.js";
import { marketplaceUnavailable } from "../domain/errors.js";
import { sendMarketplaceError } from "./errors.js";
import {
  toInventoryAdjustmentResource,
  toInventoryReadResponse,
  toProductResource,
  toProductReviewResource,
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
}

/**
 * يبني حدَّ السوق.
 *
 * و`services` اختياريّةٌ عن قصد: خدمةٌ بلا `DATABASE_URL` تبقى قائمةً وتُجيب `/health` بحالةٍ
 * صادقةٍ بدلَ أن تسقط عند الإقلاع. ومنسّقُ حاوياتٍ يرى وعاءً يسقط ويعيد تشغيلَه بلا نهايةٍ
 * لا يُعطي أحداً السببَ؛ ووعاءٌ قائمٌ يقول `unavailable` يُعطيه في أوّلِ نداء.
 */
export function createMarketplaceApp(options: MarketplaceAppOptions = {}): FastifyInstance {
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

  app.get("/health", async (_request, reply): Promise<FastifyReply> => {
    if (options.services === undefined) {
      return reply.status(200).send({ status: "unavailable", mode });
    }
    const health = await options.services.catalog.health();
    return reply.status(200).send({ status: health.status, mode });
  });

  app.get("/categories", async (request, reply): Promise<FastifyReply> => {
    const query = parseCategoryQuery(request.query);
    const { catalog } = deps();
    const index = await catalog.categorySlugIndex();
    const categories = await catalog.listCategories(query.activeOnly ?? false);
    return reply
      .status(200)
      .send({ categories: categories.map((category) => toStoreCategory(category, index)) });
  });

  // --- المتاجر ---------------------------------------------------------------

  app.post("/stores", async (request, reply): Promise<FastifyReply> => {
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

  app.get("/stores", async (request, reply): Promise<FastifyReply> => {
    const query = parseStoreQuery(request.query);
    const { stores, catalog } = deps();
    const index = await catalog.categorySlugIndex();
    const page = await stores.listStores(query);
    return reply.status(200).send({
      stores: page.items.map((store) => toStoreResource(store, index)),
      next_cursor: page.nextCursor ?? null,
    });
  });

  app.get("/stores/:storeSlug", async (request, reply): Promise<FastifyReply> => {
    const storeSlug = pathParam(request.params, "storeSlug");
    const { stores, catalog } = deps();
    const index = await catalog.categorySlugIndex();
    const store = await stores.getStore(storeSlug);
    return reply.status(200).send(toStoreResource(store, index));
  });

  app.post("/stores/:storeSlug/review-requests", async (request, reply): Promise<FastifyReply> => {
    const storeSlug = pathParam(request.params, "storeSlug");
    const input = parseReviewRequest(request.body);
    const { stores } = deps();
    const outcome = await stores.requestStoreReview(
      storeSlug,
      input.requestedByPublicId,
      envelope(request.headers, MARKETPLACE_ROUTE_KEYS.storeReviewRequest, input, (result) => ({
        responseStatus: 201,
        responseBody: toStoreReviewResource(result.review, storeSlug),
      })),
    );
    return reply.status(201).send(toStoreReviewResource(outcome.review, storeSlug));
  });

  app.post("/stores/:storeSlug/decisions", async (request, reply): Promise<FastifyReply> => {
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

  app.get("/stores/:storeSlug/reviews", async (request, reply): Promise<FastifyReply> => {
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

  app.get("/stores/:storeSlug/staff", async (request, reply): Promise<FastifyReply> => {
    const storeSlug = pathParam(request.params, "storeSlug");
    const { stores } = deps();
    const staff = await stores.listStaff(storeSlug);
    return reply.status(200).send({ staff: staff.map(toStoreStaffResource) });
  });

  app.post("/stores/:storeSlug/staff", async (request, reply): Promise<FastifyReply> => {
    const storeSlug = pathParam(request.params, "storeSlug");
    const input = parseAddStaff(request.body);
    const { stores } = deps();
    const member = await stores.addStaff(
      storeSlug,
      input,
      envelope(request.headers, MARKETPLACE_ROUTE_KEYS.storeStaffAdd, input, (outcome) => ({
        responseStatus: 201,
        responseBody: toStoreStaffResource(outcome),
      })),
    );
    return reply.status(201).send(toStoreStaffResource(member));
  });

  app.delete(
    "/stores/:storeSlug/staff/:memberPublicId",
    async (request, reply): Promise<FastifyReply> => {
      const storeSlug = pathParam(request.params, "storeSlug");
      const memberPublicId = pathParam(request.params, "memberPublicId");
      const input = parseRemoveStaff(request.body);
      const { stores } = deps();
      const removed = await stores.removeStaff(
        storeSlug,
        memberPublicId,
        input.removedByPublicId,
        envelope(request.headers, MARKETPLACE_ROUTE_KEYS.storeStaffRemove, input, (outcome) => ({
          responseStatus: 200,
          responseBody: toStoreStaffResource(outcome),
        })),
      );
      return reply.status(200).send(toStoreStaffResource(removed));
    },
  );

  // --- المنتجات -------------------------------------------------------------

  app.get("/stores/:storeSlug/products", async (request, reply): Promise<FastifyReply> => {
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

  app.post("/stores/:storeSlug/products", async (request, reply): Promise<FastifyReply> => {
    const storeSlug = pathParam(request.params, "storeSlug");
    const input = parseCreateProduct(request.body);
    const { products, catalog } = deps();
    const index = await catalog.categorySlugIndex();
    const view = await products.createProduct(
      storeSlug,
      input,
      envelope(request.headers, MARKETPLACE_ROUTE_KEYS.productCreate, input, (outcome) => ({
        responseStatus: 201,
        responseBody: toProductResource(outcome, index),
      })),
    );
    return reply.status(201).send(toProductResource(view, index));
  });

  app.get("/products/:productId", async (request, reply): Promise<FastifyReply> => {
    const productId = pathParam(request.params, "productId");
    const { products, catalog } = deps();
    const index = await catalog.categorySlugIndex();
    const view = await products.getProduct(productId);
    return reply.status(200).send(toProductResource(view, index));
  });

  app.post("/products/:productId/publish", async (request, reply): Promise<FastifyReply> => {
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

  app.post("/products/:productId/archive", async (request, reply): Promise<FastifyReply> => {
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

  app.post("/products/:productId/decisions", async (request, reply): Promise<FastifyReply> => {
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

  app.get("/products/:productId/inventory", async (request, reply): Promise<FastifyReply> => {
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

  app.post("/products/:productId/inventory", async (request, reply): Promise<FastifyReply> => {
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

  return app;
}
