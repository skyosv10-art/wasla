/**
 * التسعَ عشرةَ عمليّةً فوق **قاعدةٍ حقيقيّة** — لا مُضاعِفَ مخزنٍ ولا وضعَ ذاكرة.
 *
 * ## ما يُثبته هذا الملفُّ ولا يُثبته غيرُه
 *
 * `http-degraded` يُثبت أنّ الحدَّ يردّ `503` بلا قاعدةٍ بلا أن يُوهم بعملٍ وقع، و`http-drift`
 * يُثبت أنّ المساراتَ والحقولَ هي التي في الورقة. وكلاهما لا يُثبت الشيءَ الذي يهمّ
 * المُتكامِل: أنّ **الرحلةَ** تمرّ — تسجيلُ متجرٍ في `draft`، ثمّ طلبةُ مراجعةٍ تكتب صفَّ دفترٍ
 * بتسلسلٍ 2، ثمّ قرارُ موافقةٍ يُعيد بناءَ الإسقاط، ثمّ منتجٌ في `draft` معتدلُه `pending`
 * وظهورُه `false`، ثمّ اعتدالٌ ومخزونٌ ونشرٌ يجعل الظهورَ `true`، ثمّ أرشفةٌ تُعيده `false`.
 * وأيُّ خطأٍ في الترجمةِ بين المجالِ والمخزنِ والسلكِ يظهر هنا وحدَه.
 *
 * ## وقواعدُ الكتابةِ في هذا الملفّ
 *
 *  1. **ساعةٌ ثابتةٌ متأخّرةٌ** (`NOW`): ساعةُ النظامِ كانت ستجعل الحزمةَ تحمرّ بعد سنةٍ من
 *     كتابتها، وحارسُ النقاءِ يمنع `new Date()` أصلاً.
 *  2. **الجوابُ يُقرأ من السلك** (`response.json()`) لا من كائنِ المجال: ما يراه العميلُ هو
 *     العقد، وقراءةُ ما تُعيده الخدمةُ داخليّاً تُثبت أنّها متّسقةٌ مع نفسِها فقط.
 *  3. **مفتاحُ تفرّدٍ جديدٌ في كلّ كتابة**: الحدُّ يُلزمه، ومَن كتب اختباراً بلا مفتاحٍ سيُثبت
 *     `400` ويحسبه نجاحاً. ومفتاحٌ ثابتٌ في نداءَين مختلفَي المُدخلِ يعني `409` مقصوداً —
 *     وذلك ملكُ `idempotency-replay.integration.test.ts`.
 *  4. **الظهورُ لا يُقرأ من عمود**: كلُّ تأكيدٍ على `is_visible` يقابله تغييرُ أحدِ الشروطِ
 *     الأربعةِ في الطلبِ السابقِ له — وهذا هو الدليلُ على أنّه محسوبٌ لحظةَ القراءة.
 *  5. كلُّ اختبارٍ يبدأ بجدولٍ نظيفٍ (`resetData`)، والتصنيفُ يُزرَع في كلِّ مرّةٍ لأنّه ليس
 *     كتالوجَ مُهاجرةٍ في هذه الخدمة.
 */

import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MarketplaceCatalogService } from "../app/catalog.js";
import { MarketplaceProductService } from "../app/products.js";
import { MarketplaceStoreService } from "../app/stores.js";
import { MarketplaceUnitOfWork } from "../db/unit-of-work.js";
import type { Clock } from "../domain/time.js";
import { createMarketplaceApp } from "../http/app.js";
import {
  MEMBER,
  MODERATOR,
  OTHER_OWNER,
  OWNER,
  PG_ENABLED,
  countRows,
  resetData,
  seedLeafCategory,
  setupPostgres,
  type PgFixture,
} from "./pg-harness.js";

/** ساعةُ الخدمةِ: لحظةٌ ثابتةٌ يقرؤها كلُّ ختمٍ يُكتب في هذا الملفّ. */
const NOW = "2026-06-01T00:00:00.000Z";
const fixedClock: Clock = { now: () => NOW };

const CATEGORY = "electronics-phones";
const SLUG = "madinah-electronics";

/** ترويساتُ كتابةٍ بمفتاحٍ **جديدٍ في كلّ نداء** — الطولُ في 8..128 كما يُلزم العقد. */
let keySeed = 0;
const write = () => ({
  "idempotency-key": `idem-http-${String(++keySeed).padStart(8, "0")}`,
  "content-type": "application/json",
});

const registerBody = (slug = SLUG, owner = OWNER) => ({
  owner_public_id: owner,
  store_slug: slug,
  title_ar: "إلكترونيّات المدينة",
  category_slug: CATEGORY,
});

const productBody = (sku = "SKU-001", initialQuantity?: number) => ({
  sku,
  title_ar: "هاتف",
  category_slug: CATEGORY,
  price_minor_units: 249900,
  currency_code: "SAR",
  created_by_public_id: OWNER,
  ...(initialQuantity === undefined ? {} : { initial_quantity: initialQuantity }),
});

describe.skipIf(!PG_ENABLED)("التسعَ عشرةَ عمليّةً فوق Postgres", () => {
  let pg: PgFixture;
  let app: FastifyInstance;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  beforeEach(async () => {
    await resetData(pg.pool);
    await seedLeafCategory(pg.stores, CATEGORY);
    const uow = new MarketplaceUnitOfWork(pg.db);
    const deps = { uow, clock: fixedClock };
    app = createMarketplaceApp({
      mode: "postgres",
      services: {
        stores: new MarketplaceStoreService(deps),
        products: new MarketplaceProductService(deps),
        catalog: new MarketplaceCatalogService(deps),
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
  });

  afterAll(async () => {
    await pg?.close();
  });

  /** يُسجّل متجراً ويُعيد جوابَه المقروءَ من السلك. */
  async function registerStore(slug = SLUG, owner = OWNER): Promise<LightMyRequestResponse> {
    return await app.inject({
      method: "POST",
      url: "/stores",
      headers: write(),
      payload: registerBody(slug, owner),
    });
  }

  /** يُوصل متجراً إلى `approved` بالطريقِ المُعلَنِ: طلبةٌ ثمّ قرار. */
  async function approveStore(slug = SLUG): Promise<void> {
    const requested = await app.inject({
      method: "POST",
      url: `/stores/${slug}/review-requests`,
      headers: write(),
      payload: { requested_by_public_id: OWNER },
    });
    expect(requested.statusCode, requested.body).toBe(201);
    const decided = await app.inject({
      method: "POST",
      url: `/stores/${slug}/decisions`,
      headers: write(),
      payload: { decision: "approved", actor_type: "moderator", actor_public_id: MODERATOR },
    });
    expect(decided.statusCode, decided.body).toBe(201);
  }

  /** يُنشئ منتجاً في متجرٍ مُوافَقٍ عليه ويُعيد مُعرِّفَه. */
  async function createProduct(sku = "SKU-001", initialQuantity?: number): Promise<string> {
    const created = await app.inject({
      method: "POST",
      url: `/stores/${SLUG}/products`,
      headers: write(),
      payload: productBody(sku, initialQuantity),
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json().product_id as string;
  }

  describe("الصحّةُ والتصنيفات", () => {
    it("`/health` تقول `ok` و`postgres` — لا `unavailable` مع قاعدةٍ حاضرة", async () => {
      const response = await app.inject({ method: "GET", url: "/health" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ok", mode: "postgres" });
    });

    it("والتصنيفاتُ تُعاد بشجرتِها: جذرٌ وورقةٌ باسمِ أبيها", async () => {
      const response = await app.inject({ method: "GET", url: "/categories" });
      expect(response.statusCode).toBe(200);
      const categories = response.json().categories as ReadonlyArray<Record<string, unknown>>;
      expect(categories).toHaveLength(2);
      const leaf = categories.find((category) => category["category_slug"] === CATEGORY);
      expect(leaf?.["depth"]).toBe(2);
      expect(leaf?.["parent_slug"]).toBe(`${CATEGORY}-parent`);
      expect(leaf?.["is_active"]).toBe(true);
    });
  });

  describe("رحلةُ المتجر: تسجيلٌ ثمّ طلبةٌ ثمّ قرار", () => {
    it("التسجيلُ يُنشئ `draft` ولا يكتب صفَّ دفتر — الإنشاءُ ليس قراراً", async () => {
      const response = await registerStore();
      expect(response.statusCode, response.body).toBe(201);
      const store = response.json();
      expect(store.store_slug).toBe(SLUG);
      expect(store.state).toBe("draft");
      expect(store.state_sequence).toBe(1);
      expect(store.owner_public_id).toBe(OWNER);
      /**
       * ختمُ `created_at` من **القاعدة** (`defaultNow()`) لا من ساعةِ الخدمةِ المحقونة.
       *
       * وهذا ميراثُ المراجعة 3/6 لا سهوٌ هنا: صفوفُ المَوارِدِ تُختَم بساعةِ القاعدةِ، وصفوفُ
       * الدفاترِ (`decided_at` · `occurred_at`) بالساعةِ المحقونة — وهو فرقٌ مرصودٌ في سجلِّ
       * العمل. ولذلك يُفحَص الشكلُ لا القيمة: تثبيتُ القيمةِ كان يُلزم هذه المراجعةَ بتغييرِ
       * دلالةِ الاستمرارِ في مراجعةٍ لا تملكها.
       */
      expect(store.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
      // ولا صفَّ دفترٍ للإنشاء: `from_state: null` و`decision` مُصطنَعٌ كانا سيُدخلان قيمةً
      // ليست في العقد، ولذلك أوّلُ صفٍّ في الدفترِ تسلسلُه 2 لا 1.
      expect(await countRows(pg.pool, "store_reviews")).toBe(0);
    });

    it("وطلبةُ المراجعةِ أوّلُ صفِّ دفترٍ بتسلسلٍ 2 و`from_state: draft`", async () => {
      await registerStore();
      const response = await app.inject({
        method: "POST",
        url: `/stores/${SLUG}/review-requests`,
        headers: write(),
        payload: { requested_by_public_id: OWNER },
      });
      expect(response.statusCode, response.body).toBe(201);
      const review = response.json();
      expect(review.decision).toBe("review_requested");
      expect(review.from_state).toBe("draft");
      expect(review.to_state).toBe("pending_review");
      expect(review.state_sequence).toBe(2);
      expect(review.actor_type).toBe("owner");
      expect(review.decided_at).toBe(NOW);

      const store = await app.inject({ method: "GET", url: `/stores/${SLUG}` });
      expect(store.json().state).toBe("pending_review");
      expect(store.json().state_sequence).toBe(2);
    });

    it("وطلبةٌ ثانيةٌ فوق طلبةٍ قائمةٍ `409` — لا طابورٌ يتنازعه مُراجعان", async () => {
      await registerStore();
      const headers = write();
      await app.inject({
        method: "POST",
        url: `/stores/${SLUG}/review-requests`,
        headers,
        payload: { requested_by_public_id: OWNER },
      });
      const again = await app.inject({
        method: "POST",
        url: `/stores/${SLUG}/review-requests`,
        headers: write(),
        payload: { requested_by_public_id: OWNER },
      });
      expect(again.statusCode).toBe(409);
      expect(again.json().error.code).toBe("STORE_REVIEW_ALREADY_PENDING");
    });

    it("والقرارُ يكتب صفّاً ثالثاً ويُعيد بناءَ الإسقاطِ إلى `approved`", async () => {
      await registerStore();
      await approveStore();

      const store = await app.inject({ method: "GET", url: `/stores/${SLUG}` });
      expect(store.json().state).toBe("approved");
      expect(store.json().state_sequence).toBe(3);

      const reviews = await app.inject({ method: "GET", url: `/stores/${SLUG}/reviews` });
      expect(reviews.statusCode).toBe(200);
      const rows = reviews.json().reviews as ReadonlyArray<Record<string, unknown>>;
      expect(rows.map((row) => row["state_sequence"])).toEqual([2, 3]);
      expect(rows.map((row) => row["decision"])).toEqual(["review_requested", "approved"]);
      expect(reviews.json().next_cursor).toBeNull();
    });

    it("ورفضٌ بلا سببٍ مرفوضٌ — القرارُ الذي يُؤلم يجب أن يُفسَّر", async () => {
      await registerStore();
      await app.inject({
        method: "POST",
        url: `/stores/${SLUG}/review-requests`,
        headers: write(),
        payload: { requested_by_public_id: OWNER },
      });
      const rejected = await app.inject({
        method: "POST",
        url: `/stores/${SLUG}/decisions`,
        headers: write(),
        payload: { decision: "rejected", actor_type: "moderator", actor_public_id: MODERATOR },
      });
      expect(rejected.statusCode, rejected.body).toBe(422);
      expect(rejected.json().error.code).toBe("STORE_REJECTION_REASON_REQUIRED");
    });

    it("والرابطُ المأخوذُ `409` — والقيدُ في القاعدةِ هو الذي يقولها", async () => {
      await registerStore(SLUG);
      const taken = await app.inject({
        method: "POST",
        url: "/stores",
        headers: write(),
        payload: registerBody(SLUG, OTHER_OWNER),
      });
      expect(taken.statusCode, taken.body).toBe(409);
      expect(taken.json().error.code).toBe("STORE_SLUG_TAKEN");
    });

    it("وحرفٌ كبيرٌ في الرابطِ يُرفض في الحدِّ `400` قبل أن يُسأل القيد", async () => {
      /**
       * `ux_stores_slug_lower` يجعل التفرّدَ غيرَ حسّاسٍ لحالةِ الأحرفِ في القاعدة، وهو
       * دفاعٌ ثانٍ لا أوّل: نمطُ `StoreSlug` في العقدِ صغيرُ الأحرفِ حصراً، فـ`MADINAH`
       * يُرفض عند الحدِّ برمزِ تحقُّقٍ ولا يصل إلى القاعدةِ أصلاً. وهذان السطران معاً هما
       * ما يمنع قراءةَ `400` هنا خللاً في القيد.
       */
      const response = await app.inject({
        method: "POST",
        url: "/stores",
        headers: write(),
        payload: registerBody(SLUG.toUpperCase(), OTHER_OWNER),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.details.field).toBe("store_slug");
    });

    it("ومتجرٌ نشطٌ ثانٍ لنفسِ المالكِ `409`", async () => {
      await registerStore(SLUG, OWNER);
      const second = await app.inject({
        method: "POST",
        url: "/stores",
        headers: write(),
        payload: registerBody("madinah-second", OWNER),
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe("STORE_OWNER_LIMIT_REACHED");
    });

    it("ومتجرٌ مجهولٌ `404` باسمِ رابطِه في التفاصيل", async () => {
      const response = await app.inject({ method: "GET", url: "/stores/no-such-store" });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("STORE_NOT_FOUND");
      expect(response.json().error.details.store_slug).toBe("no-such-store");
    });
  });

  describe("قراءةُ المتاجر: مُرشِّحٌ إلزاميٌّ وترقيمٌ بمفتاحٍ ثابت", () => {
    it("قراءةٌ بلا مُرشِّحٍ `400` — لا مسحَ جدولٍ كامل", async () => {
      const response = await app.inject({ method: "GET", url: "/stores" });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("MARKETPLACE_FILTER_REQUIRED");
    });

    it("والترشيحُ بالحالةِ وبالمالكِ وبالتصنيفِ يُعيد ما يُطابق وحدَه", async () => {
      await registerStore("store-alpha", OWNER);
      await registerStore("store-beta", OTHER_OWNER);
      await approveStore("store-alpha");

      const drafts = await app.inject({ method: "GET", url: "/stores?state=draft" });
      expect(drafts.json().stores.map((store: { store_slug: string }) => store.store_slug)).toEqual(
        ["store-beta"],
      );

      const approved = await app.inject({ method: "GET", url: "/stores?state=approved" });
      expect(
        approved.json().stores.map((store: { store_slug: string }) => store.store_slug),
      ).toEqual(["store-alpha"]);

      const byOwner = await app.inject({ method: "GET", url: `/stores?owner_public_id=${OWNER}` });
      expect(byOwner.json().stores).toHaveLength(1);

      const byCategory = await app.inject({
        method: "GET",
        url: `/stores?category_slug=${CATEGORY}`,
      });
      expect(byCategory.json().stores).toHaveLength(2);
    });

    it("والصفحةُ الثانيةُ تُقرأ بالموضعِ المُعاد ولا تُكرِّر صفّاً ولا تُسقطه", async () => {
      // مالكٌ مختلفٌ لكلّ متجرٍ: `ux_stores_owner_active` يمنع متجراً نشطاً ثانياً لمالكٍ
      // واحد، فهويّاتٌ مُلفَّقةٌ كانت ستجعل صفحةً تُقرأ ناقصةً لسببٍ لا علاقةَ له بالترقيم.
      const owners = ["WS-1000000011", "WS-1000000012", "WS-1000000013"] as const;
      for (const [index, slug] of ["store-one", "store-two", "store-three"].entries()) {
        const created = await registerStore(slug, owners[index] as string);
        expect(created.statusCode, created.body).toBe(201);
      }
      const first = await app.inject({ method: "GET", url: `/stores?state=draft&limit=2` });
      expect(first.statusCode, first.body).toBe(200);
      const firstSlugs = first.json().stores.map((store: { store_slug: string }) => store.store_slug);
      expect(firstSlugs).toHaveLength(2);
      const cursor = first.json().next_cursor as string;
      expect(cursor).not.toBeNull();

      const second = await app.inject({
        method: "GET",
        url: `/stores?state=draft&limit=2&cursor=${encodeURIComponent(cursor)}`,
      });
      const secondSlugs = second
        .json()
        .stores.map((store: { store_slug: string }) => store.store_slug);
      expect(secondSlugs).toHaveLength(1);
      // ولا تقاطعَ بين الصفحتَين: الإزاحةُ كانت تُكرِّر صفّاً وتُسقط آخرَ عند كتابةٍ بينهما.
      expect(firstSlugs.filter((slug: string) => secondSlugs.includes(slug))).toEqual([]);
      expect(new Set([...firstSlugs, ...secondSlugs]).size).toBe(3);
    });

    it("وموضعٌ مُشوَّهٌ `400` لا `500` ولا صفحةٌ كاملةٌ بلا شرط", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/stores?state=draft&cursor=not-a-cursor",
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("MARKETPLACE_VALIDATION_FAILED");
    });

    it("ومُرشِّحٌ مجهولٌ يُرفض بالاسمِ ولا يُهمَل بصمت", async () => {
      const response = await app.inject({ method: "GET", url: "/stores?statee=draft" });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.details.field).toBe("statee");
    });
  });

  describe("الطاقم: إضافةٌ وقراءةٌ وإزالةٌ بختمٍ لا بحذف", () => {
    beforeEach(async () => {
      await registerStore();
      await approveStore();
    });

    it("العضوُ يُضاف بدورٍ من قائمةٍ مغلقةٍ ويُقرأ في القائمة", async () => {
      const added = await app.inject({
        method: "POST",
        url: `/stores/${SLUG}/staff`,
        headers: write(),
        payload: { member_public_id: MEMBER, role: "manager", added_by_public_id: OWNER },
      });
      expect(added.statusCode, added.body).toBe(201);
      expect(added.json().role).toBe("manager");
      expect(added.json().removed_at).toBeNull();
      expect(added.json().added_at).toBe(NOW);

      const listed = await app.inject({ method: "GET", url: `/stores/${SLUG}/staff` });
      expect(listed.json().staff).toHaveLength(1);
    });

    it("ودورُ المالكِ مرفوضٌ من هذا المسار — المالكُ يُنشأ مع المتجرِ لا بطلب", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/stores/${SLUG}/staff`,
        headers: write(),
        payload: { member_public_id: MEMBER, role: "owner", added_by_public_id: OWNER },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.details.field).toBe("role");
    });

    it("وعضويّةٌ نشطةٌ ثانيةٌ لنفسِ الشخصِ `409` — لا تحديثَ دورٍ في موضعِه", async () => {
      const payload = { member_public_id: MEMBER, role: "staff", added_by_public_id: OWNER };
      await app.inject({ method: "POST", url: `/stores/${SLUG}/staff`, headers: write(), payload });
      const again = await app.inject({
        method: "POST",
        url: `/stores/${SLUG}/staff`,
        headers: write(),
        payload: { ...payload, role: "manager" },
      });
      expect(again.statusCode).toBe(409);
      expect(again.json().error.code).toBe("STORE_STAFF_ALREADY_MEMBER");
    });

    it("والإزالةُ تكتب `removed_at` ولا تحذف صفّاً — والعودةُ بعدَها ليست تعارضاً", async () => {
      const payload = { member_public_id: MEMBER, role: "staff", added_by_public_id: OWNER };
      await app.inject({ method: "POST", url: `/stores/${SLUG}/staff`, headers: write(), payload });

      const removed = await app.inject({
        method: "DELETE",
        url: `/stores/${SLUG}/staff/${MEMBER}`,
        headers: write(),
        payload: { removed_by_public_id: OWNER },
      });
      expect(removed.statusCode, removed.body).toBe(200);
      expect(removed.json().removed_at).toBe(NOW);
      expect(removed.json().removed_by_public_id).toBe(OWNER);
      // الصفُّ باقٍ: «مَن أضاف هذا المنتج؟» يجب أن يبقى له جوابٌ بعد الإزالة.
      expect(await countRows(pg.pool, "store_staff")).toBe(1);

      const rejoined = await app.inject({
        method: "POST",
        url: `/stores/${SLUG}/staff`,
        headers: write(),
        payload,
      });
      expect(rejoined.statusCode, rejoined.body).toBe(201);
      expect(await countRows(pg.pool, "store_staff")).toBe(2);
    });

    it("وعضوٌ مجهولٌ يُزال `404`", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/stores/${SLUG}/staff/${MEMBER}`,
        headers: write(),
        payload: { removed_by_public_id: OWNER },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("STORE_STAFF_NOT_FOUND");
    });
  });

  describe("رحلةُ المنتج: اعتدالٌ ومخزونٌ ثمّ ظهورٌ محسوب", () => {
    beforeEach(async () => {
      await registerStore();
      await approveStore();
    });

    it("المنتجُ يُنشأ `draft` معتدلُه `pending` وظهورُه `false`", async () => {
      const created = await app.inject({
        method: "POST",
        url: `/stores/${SLUG}/products`,
        headers: write(),
        payload: productBody(),
      });
      expect(created.statusCode, created.body).toBe(201);
      const product = created.json();
      expect(product.state).toBe("draft");
      expect(product.moderation_state).toBe("pending");
      expect(product.quantity_on_hand).toBe(0);
      expect(product.is_visible).toBe(false);
      expect(product.price_minor_units).toBe(249900);
      expect(product.currency_code).toBe("SAR");
      expect(product.store_slug).toBe(SLUG);
    });

    it("والنشرُ قبل الاعتدالِ `422` — والقيدُ في القاعدةِ لا رجاءٌ في الكود", async () => {
      const productId = await createProduct();
      const response = await app.inject({
        method: "POST",
        url: `/products/${productId}/publish`,
        headers: write(),
        payload: { actor_public_id: OWNER },
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error.code).toBe("PRODUCT_NOT_MODERATED");
    });

    it("والظهورُ يصير `true` بعد اعتدالٍ ومخزونٍ ونشرٍ — بالشروطِ الأربعةِ مجتمعةً", async () => {
      const productId = await createProduct();

      const decided = await app.inject({
        method: "POST",
        url: `/products/${productId}/decisions`,
        headers: write(),
        payload: { decision: "approved", actor_type: "moderator", actor_public_id: MODERATOR },
      });
      expect(decided.statusCode, decided.body).toBe(201);
      expect(decided.json().to_state).toBe("approved");
      expect(decided.json().moderation_sequence).toBe(2);

      // معتدَلٌ ومخزونُه صفرٌ: ثلاثةٌ من أربعةٍ لا تكفي — وهذا هو الفرقُ بين النشرِ والظهور.
      const afterModeration = await app.inject({ method: "GET", url: `/products/${productId}` });
      expect(afterModeration.json().is_visible).toBe(false);

      const stocked = await app.inject({
        method: "POST",
        url: `/products/${productId}/inventory`,
        headers: write(),
        payload: { quantity_delta: 5, reason_code: "restock", actor_public_id: OWNER },
      });
      expect(stocked.statusCode, stocked.body).toBe(201);

      const published = await app.inject({
        method: "POST",
        url: `/products/${productId}/publish`,
        headers: write(),
        payload: { actor_public_id: OWNER },
      });
      expect(published.statusCode, published.body).toBe(200);
      expect(published.json().state).toBe("published");
      expect(published.json().is_visible).toBe(true);
      expect(published.json().quantity_on_hand).toBe(5);
    });

    it("والأرشفةُ تُعيد الظهورَ `false` بلا أن تمسّ الاعتدالَ", async () => {
      const productId = await createProduct("SKU-ARCH", 3);
      await app.inject({
        method: "POST",
        url: `/products/${productId}/decisions`,
        headers: write(),
        payload: { decision: "approved", actor_type: "moderator", actor_public_id: MODERATOR },
      });
      await app.inject({
        method: "POST",
        url: `/products/${productId}/publish`,
        headers: write(),
        payload: { actor_public_id: OWNER },
      });
      const archived = await app.inject({
        method: "POST",
        url: `/products/${productId}/archive`,
        headers: write(),
        payload: { actor_public_id: OWNER },
      });
      expect(archived.statusCode, archived.body).toBe(200);
      expect(archived.json().state).toBe("archived");
      expect(archived.json().is_visible).toBe(false);
      expect(archived.json().moderation_state).toBe("approved");
    });

    it("و`visible_only` يُحسَب لحظةَ القراءةِ لا يُقرأ من عمود", async () => {
      const visibleId = await createProduct("SKU-VIS", 4);
      await createProduct("SKU-HIDDEN");
      await app.inject({
        method: "POST",
        url: `/products/${visibleId}/decisions`,
        headers: write(),
        payload: { decision: "approved", actor_type: "moderator", actor_public_id: MODERATOR },
      });
      await app.inject({
        method: "POST",
        url: `/products/${visibleId}/publish`,
        headers: write(),
        payload: { actor_public_id: OWNER },
      });

      const all = await app.inject({ method: "GET", url: `/stores/${SLUG}/products` });
      expect(all.json().products).toHaveLength(2);

      const visible = await app.inject({
        method: "GET",
        url: `/stores/${SLUG}/products?visible_only=true`,
      });
      expect(visible.json().products).toHaveLength(1);
      expect(visible.json().products[0].sku).toBe("SKU-VIS");

      // ثمّ يُوقَف المتجرُ: نفسُ المنتجِ نفسُه، والظهورُ يسقط بلا كتابةِ صفٍّ في المنتج.
      const suspended = await app.inject({
        method: "POST",
        url: `/stores/${SLUG}/decisions`,
        headers: write(),
        payload: {
          decision: "suspended",
          actor_type: "moderator",
          actor_public_id: MODERATOR,
          reason_code: "policy_violation",
        },
      });
      expect(suspended.statusCode, suspended.body).toBe(201);
      const afterSuspension = await app.inject({
        method: "GET",
        url: `/stores/${SLUG}/products?visible_only=true`,
      });
      expect(afterSuspension.json().products).toEqual([]);
    });

    it("ورابطُ تصنيفٍ ليس ورقةً مرفوضٌ `422`", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/stores/${SLUG}/products`,
        headers: write(),
        payload: { ...productBody(), category_slug: `${CATEGORY}-parent` },
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error.code).toBe("PRODUCT_CATEGORY_NOT_LEAF");
    });

    it("و`sku` مأخوذٌ في المتجرِ نفسِه `409`", async () => {
      await createProduct("SKU-DUP");
      const again = await app.inject({
        method: "POST",
        url: `/stores/${SLUG}/products`,
        headers: write(),
        payload: productBody("SKU-DUP"),
      });
      expect(again.statusCode).toBe(409);
      expect(again.json().error.code).toBe("PRODUCT_SKU_TAKEN");
    });

    it("ومنتجٌ مجهولٌ `404`", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/products/00000000-0000-4000-8000-000000000000",
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("PRODUCT_NOT_FOUND");
    });
  });

  describe("المخزون: فروقٌ تتراكمُ ودفترٌ يحكيها", () => {
    let productId: string;

    beforeEach(async () => {
      await registerStore();
      await approveStore();
      productId = await createProduct("SKU-INV", 2);
    });

    it("الرصيدُ الابتدائيُّ يُكتب في الدفترِ لا في عمودٍ وحدَه", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/products/${productId}/inventory?include_ledger=true`,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().quantity_on_hand).toBe(2);
      const ledger = response.json().adjustments as ReadonlyArray<Record<string, unknown>>;
      expect(ledger).toHaveLength(1);
      expect(ledger[0]?.["reason_code"]).toBe("initial_stock");
      expect(ledger[0]?.["quantity_delta"]).toBe(2);
      expect(ledger[0]?.["adjustment_sequence"]).toBe(1);
    });

    it("والفروقُ تتراكم: زيادةٌ ثمّ نقصٌ يُنتجان رصيداً واحداً وثلاثةَ صفوف", async () => {
      await app.inject({
        method: "POST",
        url: `/products/${productId}/inventory`,
        headers: write(),
        payload: { quantity_delta: 5, reason_code: "restock", actor_public_id: OWNER },
      });
      const shrinkage = await app.inject({
        method: "POST",
        url: `/products/${productId}/inventory`,
        headers: write(),
        payload: { quantity_delta: -3, reason_code: "shrinkage", actor_public_id: OWNER },
      });
      expect(shrinkage.statusCode, shrinkage.body).toBe(201);
      expect(shrinkage.json().adjustment_sequence).toBe(3);

      const read = await app.inject({
        method: "GET",
        url: `/products/${productId}/inventory?include_ledger=true`,
      });
      expect(read.json().quantity_on_hand).toBe(4);
      expect(read.json().adjustments).toHaveLength(3);
    });

    it("وفرقٌ يُنزل الرصيدَ تحت الصفرِ `422` ولا يكتب صفّاً", async () => {
      const before = await countRows(pg.pool, "inventory_adjustments");
      const response = await app.inject({
        method: "POST",
        url: `/products/${productId}/inventory`,
        headers: write(),
        payload: { quantity_delta: -9, reason_code: "correction", actor_public_id: OWNER },
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error.code).toBe("INVENTORY_INSUFFICIENT_QUANTITY");
      expect(await countRows(pg.pool, "inventory_adjustments")).toBe(before);
    });

    it("و`include_ledger` غائبةً لا يُعاد الدفترُ — القراءةُ لا تدفع ثمنَ ما لم يُطلَب", async () => {
      const response = await app.inject({ method: "GET", url: `/products/${productId}/inventory` });
      expect(response.statusCode).toBe(200);
      expect(response.json().quantity_on_hand).toBe(2);
      // الوثيقةُ تُلزم `adjustments` في كلّ جواب: الفراغُ «لم يُطلَب الدفترُ» لا «لا دفترَ له».
      // وحقلٌ يغيب أحياناً يجعل المستهلكَ الصارمَ يرفض جواباً صحيحاً.
      expect(response.json().adjustments).toEqual([]);
      expect(response.json().last_adjustment_sequence).toBe(1);
    });
  });

  describe("حدُّ الطلب: ما يُرفض قبل أن يمسّ المخزن", () => {
    it("كتابةٌ بلا مفتاحِ تفرّدٍ `400` برمزِه الخاصّ", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/stores",
        headers: { "content-type": "application/json" },
        payload: registerBody(),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("MARKETPLACE_IDEMPOTENCY_KEY_REQUIRED");
      expect(await countRows(pg.pool, "stores")).toBe(0);
    });

    it("ومفتاحٌ أقصرُ من ثمانيةٍ `400` برمزِ تحقّقٍ — الغيابُ ليس كالطولِ المخالف", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/stores",
        headers: { "idempotency-key": "short", "content-type": "application/json" },
        payload: registerBody(),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("MARKETPLACE_VALIDATION_FAILED");
      expect(response.json().error.details.field).toBe("Idempotency-Key");
    });

    it("وجسمٌ مُشوَّهٌ `400` لا `500`", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/stores",
        headers: write(),
        payload: "{ not json",
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.details.field).toBe("payload");
    });

    it("ومفتاحٌ مجهولٌ في جسمٍ يُرفض بالاسم — لا حقلَ يُهمَل بصمت", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/stores",
        headers: write(),
        payload: { ...registerBody(), state: "approved" },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.details.field).toBe("state");
      // القاعدةُ الأولى في هذا الطور: الحالةُ إسقاطٌ ولا تُقبَل من عميلٍ بحال.
      expect(await countRows(pg.pool, "stores")).toBe(0);
    });

    it("و`x-request-id` تُعاد في `trace_id` كما وصلت", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/stores/no-such-store",
        headers: { "x-request-id": "trace-from-gateway" },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().trace_id).toBe("trace-from-gateway");
    });

    it("وترويسةُ تتبُّعٍ أطولُ من الحدِّ `400` — لا سجلٌّ بلا حدّ", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/stores/${SLUG}`,
        headers: { "x-request-id": "x".repeat(129) },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.details.field).toBe("x-request-id");
    });
  });
});
