/**
 * **إعادةُ الإرسالِ تُعيد نفسَ البايتات** — جدولُ منعِ التكرارِ موصولٌ بمساراتِ الكتابةِ العشرِ.
 *
 * ## ما يُثبته هذا الملفُّ ولا يُثبته غيرُه
 *
 * `db/idempotency.ts` يعرف كيف يحفظ جواباً ويُعيده، و`http/requests.ts` يُلزم المفتاحَ ويفحص
 * طولَه، و`http.integration` يُثبت أنّ الرحلةَ تمرّ **بمفتاحٍ جديدٍ في كلّ نداء**. وبين هذه
 * الثلاثةِ فجوةٌ لا يراها أحدُها: **هل يُقرأ الجدولُ فعلاً؟** مُتَّصلٌ انقطعت عنه الشبكةُ بعد
 * أن التزمت المعاملةُ يُعيد الطلبَ — فإن لم يُقرأ الجدولُ صار صفُّ دفترٍ ثانياً بتسلسلٍ ثانٍ،
 * وحدثٌ ثانٍ في الصادر، ومخزونٌ يقول ما لم يُورَّد. وهذا الملفُّ يُثبت أنّ الفجوةَ مُغلقةٌ في
 * كلِّ مسارٍ يكتب، لا في المسارِ الأوّلِ وحدَه.
 *
 * ## وأربعةُ فروقٍ يفحصها كلُّ اختبارٍ هنا
 *
 *  1. **نفسُ الحالةِ**: المحفوظُ هو حالةُ الجوابِ الأوّلِ كما كانت — `201` تبقى `201`،
 *     و`200` تبقى `200`. وجوابٌ يُعاد حسابُه كان سيقول `409` أو `422` في المرّةِ الثانية.
 *  2. **نفسُ الجسمِ بايتاً بايتاً**: `toEqual` على الجسمِ كلِّه لا على حقلٍ منه. جوابٌ
 *     يُعاد حسابُه يتّفق في الحالةِ ويختلف في `state_sequence` أو `decided_at`، والمُتَّصلُ
 *     الذي يقارن يرى اضطراباً لا يُفسَّر.
 *  3. **لا صفَّ ثانياً**: عددُ صفوفِ الجداولِ العشرةِ قبلَ الإعادةِ وبعدَها. جوابٌ صحيحٌ فوقَ
 *     كتابةٍ مُضاعَفةٍ أسوأُ من خطأٍ صريح.
 *  4. **ولا حدثَ ثانياً**: `marketplace_outbox` لا ينمو. مستهلكٌ واحدٌ يُضاعِف أثراً كافٍ
 *     ليصير الخللُ ماليّاً في مرحلةٍ لاحقة.
 *
 * ## وفرقٌ خامسٌ يُفحَص مرّةً لكلِّ مسار
 *
 * **نفسُ المفتاحِ لمُدخلٍ آخرَ ⇒ `409 MARKETPLACE_IDEMPOTENCY_KEY_REUSED`** لا جوابُ الأوّلِ
 * ولا تنفيذُ الثاني. وإعادةُ جوابِ الأوّلِ هنا أخطرُ من الخطأِ: المُتَّصلُ يقرأ نجاحاً لطلبٍ
 * لم يُنفَّذ قطّ، فيبني عليه.
 *
 * ## قواعدُ الكتابة
 *
 * ساعةٌ ثابتةٌ (`NOW`)، وجوابٌ يُقرأ من السلكِ لا من كائنِ المجال، ومفتاحٌ **مُعلَنٌ باسمِه**
 * في كلّ نداءٍ (لا مُولَّدٌ تلقائيّاً) لأنّ المفتاحَ نفسَه هو موضوعُ الاختبار. وترتيبُ
 * التهيئةِ في كلّ اختبارٍ يستخدم مفاتيحَ `setup-*` كي لا يتقاطعَ مع المفتاحِ المفحوص.
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
  TABLES,
  countRows,
  resetData,
  seedLeafCategory,
  setupPostgres,
  type PgFixture,
} from "./pg-harness.js";

const NOW = "2026-06-01T00:00:00.000Z";
const fixedClock: Clock = { now: () => NOW };

const CATEGORY = "electronics-phones";
const SLUG = "madinah-electronics";

const JSON_HEADERS = { "content-type": "application/json" };

/** مفتاحٌ صالحُ الطولِ (8..128) ومقروءٌ في رسالةِ فشلٍ حين تُقرأ. */
const keyOf = (label: string) => `idem-replay-${label}`;

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

describe.skipIf(!PG_ENABLED)("إعادةُ الإرسالِ فوق Postgres — الجوابُ المحفوظُ حرفاً بحرف", () => {
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

  /** نداءُ كتابةٍ بمفتاحٍ **مُعلَنٍ** — والجسمُ يُمرَّر دائماً ولو فارغاً. */
  async function write(
    method: "POST" | "DELETE",
    url: string,
    key: string,
    payload: Record<string, unknown> = {},
  ): Promise<LightMyRequestResponse> {
    return await app.inject({
      method,
      url,
      headers: { ...JSON_HEADERS, "idempotency-key": key },
      payload,
    });
  }

  /**
   * لقطةُ عددِ الصفوفِ في **كلّ** جدول.
   *
   * وفحصُ الجداولِ كلِّها لا الجدولِ المتوقَّعِ وحدَه مقصود: خللٌ في الإعادةِ قد يكتب حيث لا
   * يُنتظَر — صفَّ دفترِ منتجٍ عند إعادةِ نشرٍ، أو صفَّ صادرٍ بلا صفِّ مَورِد. ولقطةٌ شاملةٌ
   * تُمسك ذلك بلا أن يُخمِّن كاتبُ الاختبارِ مكانَ الخلل.
   */
  async function snapshot(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of TABLES) {
      counts[table] = await countRows(pg.pool, table);
    }
    return counts;
  }

  /**
   * القاعدةُ الواحدةُ لكلِّ مسارٍ كاتب: يُنفَّذ مرّةً، ثمّ يُعاد بنفسِ المفتاحِ ونفسِ الجسمِ
   * فيُعاد الجوابُ المحفوظُ ولا ينمو جدولٌ، ثمّ يُعاد بنفسِ المفتاحِ لجسمٍ **آخرَ** فيُرفض
   * بـ`409` — وما بعدَ الرفضِ لا كتابةَ أيضاً.
   */
  async function expectReplay(input: {
    method?: "POST" | "DELETE";
    url: string;
    key: string;
    payload: Record<string, unknown>;
    /** جسمٌ يختلف عن الأوّلِ اختلافاً يراه تجزيءُ المُدخل. */
    otherPayload: Record<string, unknown>;
    expectedStatus: number;
  }): Promise<void> {
    const method = input.method ?? "POST";
    const first = await write(method, input.url, input.key, input.payload);
    expect(first.statusCode, first.body).toBe(input.expectedStatus);

    const afterFirst = await snapshot();

    const replay = await write(method, input.url, input.key, input.payload);
    expect(replay.statusCode, replay.body).toBe(input.expectedStatus);
    expect(replay.json()).toEqual(first.json());
    expect(await snapshot()).toEqual(afterFirst);

    const reused = await write(method, input.url, input.key, input.otherPayload);
    expect(reused.statusCode, reused.body).toBe(409);
    expect(reused.json().error.code).toBe("MARKETPLACE_IDEMPOTENCY_KEY_REUSED");
    expect(await snapshot()).toEqual(afterFirst);
  }

  /** يُوصل متجراً إلى `approved` بمفاتيحِ تهيئةٍ لا تتقاطع مع المفتاحِ المفحوص. */
  async function approvedStore(slug = SLUG, owner = OWNER): Promise<void> {
    expect(
      (await write("POST", "/stores", keyOf(`setup-store-${slug}`), registerBody(slug, owner)))
        .statusCode,
    ).toBe(201);
    expect(
      (
        await write("POST", `/stores/${slug}/review-requests`, keyOf(`setup-req-${slug}`), {
          requested_by_public_id: owner,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await write("POST", `/stores/${slug}/decisions`, keyOf(`setup-dec-${slug}`), {
          decision: "approved",
          actor_type: "moderator",
          actor_public_id: MODERATOR,
        })
      ).statusCode,
    ).toBe(201);
  }

  async function seedProduct(sku = "SKU-001", initialQuantity?: number): Promise<string> {
    const created = await write(
      "POST",
      `/stores/${SLUG}/products`,
      keyOf(`setup-product-${sku}`),
      productBody(sku, initialQuantity),
    );
    expect(created.statusCode, created.body).toBe(201);
    return created.json().product_id as string;
  }

  async function moderateProduct(productId: string): Promise<void> {
    expect(
      (
        await write("POST", `/products/${productId}/decisions`, keyOf(`setup-mod-${productId}`), {
          decision: "approved",
          actor_type: "moderator",
          actor_public_id: MODERATOR,
        })
      ).statusCode,
    ).toBe(201);
  }

  describe("مساراتُ المتجرِ الأربعة", () => {
    it("`POST /stores`: نفسُ المفتاحِ ⇒ نفسُ المتجرِ لا متجرٌ ثانٍ", async () => {
      await expectReplay({
        url: "/stores",
        key: keyOf("register"),
        payload: registerBody(),
        // مالكٌ آخرُ ولاحقةٌ أخرى: لو نُفِّذ الثاني لَظهر متجرانِ ولمالكَين.
        otherPayload: registerBody("other-store", OTHER_OWNER),
        expectedStatus: 201,
      });
      const listed = await app.inject({ method: "GET", url: `/stores?owner_public_id=${OWNER}` });
      expect(listed.json().stores).toHaveLength(1);
    });

    it("`POST /review-requests`: لا طلبةٌ ثانيةٌ ولا تسلسلٌ ثالث", async () => {
      expect(
        (await write("POST", "/stores", keyOf("setup-store-req"), registerBody())).statusCode,
      ).toBe(201);
      await expectReplay({
        url: `/stores/${SLUG}/review-requests`,
        key: keyOf("request"),
        payload: { requested_by_public_id: OWNER },
        otherPayload: { requested_by_public_id: OTHER_OWNER },
        expectedStatus: 201,
      });
      // الدفترُ صفٌّ واحدٌ بتسلسلٍ 2: الإنشاءُ 1 ولا صفَّ له، والطلبةُ 2 مرّةً واحدة.
      expect(await countRows(pg.pool, "store_reviews")).toBe(1);
    });

    it("`POST /decisions`: لا قرارٌ ثانٍ ولا إسقاطٌ يُعاد بناؤه مرّتَين", async () => {
      expect(
        (await write("POST", "/stores", keyOf("setup-store-dec"), registerBody())).statusCode,
      ).toBe(201);
      expect(
        (
          await write("POST", `/stores/${SLUG}/review-requests`, keyOf("setup-req-dec"), {
            requested_by_public_id: OWNER,
          })
        ).statusCode,
      ).toBe(201);
      await expectReplay({
        url: `/stores/${SLUG}/decisions`,
        key: keyOf("decision"),
        payload: { decision: "approved", actor_type: "moderator", actor_public_id: MODERATOR },
        // رفضٌ لا موافقةٌ: لو نُفِّذ الثاني لصارت الحالةُ `rejected` بعد `approved`.
        otherPayload: {
          decision: "rejected",
          actor_type: "moderator",
          actor_public_id: MODERATOR,
          reason_code: "incomplete_profile",
        },
        expectedStatus: 201,
      });
      const store = await app.inject({ method: "GET", url: `/stores/${SLUG}` });
      expect(store.json().state).toBe("approved");
      expect(store.json().state_sequence).toBe(3);
    });

    it("`POST /staff` و`DELETE /staff/:member`: عضوٌ واحدٌ وختمٌ واحد", async () => {
      await approvedStore();
      await expectReplay({
        url: `/stores/${SLUG}/staff`,
        key: keyOf("staff-add"),
        payload: { member_public_id: MEMBER, role: "manager", added_by_public_id: OWNER },
        otherPayload: { member_public_id: MEMBER, role: "staff", added_by_public_id: OWNER },
        expectedStatus: 201,
      });
      expect(await countRows(pg.pool, "store_staff")).toBe(1);

      await expectReplay({
        method: "DELETE",
        url: `/stores/${SLUG}/staff/${MEMBER}`,
        key: keyOf("staff-remove"),
        payload: { removed_by_public_id: OWNER },
        otherPayload: { removed_by_public_id: MODERATOR },
        expectedStatus: 200,
      });
      // الإزالةُ ختمٌ لا حذف: الصفُّ باقٍ، وإعادةُ الإرسالِ لا تُنشئ صفّاً ثانياً مختوماً.
      expect(await countRows(pg.pool, "store_staff")).toBe(1);
    });
  });

  describe("مساراتُ المنتجِ والمخزونِ الخمسة", () => {
    beforeEach(async () => {
      await approvedStore();
    });

    it("`POST /products`: منتجٌ واحدٌ ولا صفَّ مخزونٍ مُضاعَف", async () => {
      await expectReplay({
        url: `/stores/${SLUG}/products`,
        key: keyOf("product-create"),
        payload: productBody("SKU-001", 3),
        otherPayload: productBody("SKU-002", 3),
        expectedStatus: 201,
      });
      expect(await countRows(pg.pool, "products")).toBe(1);
      // ورصيدُ الافتتاحِ صفٌّ واحدٌ في الدفتر: إعادةٌ مُنفَّذةٌ كانت ستجعله 6 لا 3.
      expect(await countRows(pg.pool, "inventory_adjustments")).toBe(1);
    });

    it("`POST /products/:id/decisions`: اعتدالٌ واحدٌ لا تسلسلانِ في دفترِ المنتج", async () => {
      const productId = await seedProduct();
      await expectReplay({
        url: `/products/${productId}/decisions`,
        key: keyOf("product-decision"),
        payload: { decision: "approved", actor_type: "moderator", actor_public_id: MODERATOR },
        otherPayload: {
          decision: "rejected",
          actor_type: "moderator",
          actor_public_id: MODERATOR,
          reason_code: "prohibited_item",
        },
        expectedStatus: 201,
      });
      expect(await countRows(pg.pool, "product_reviews")).toBe(1);
    });

    it("`POST /publish` ثمّ `POST /archive`: انتقالٌ واحدٌ لكلٍّ منهما", async () => {
      const productId = await seedProduct("SKU-PUB", 2);
      await moderateProduct(productId);

      await expectReplay({
        url: `/products/${productId}/publish`,
        key: keyOf("publish"),
        payload: { actor_public_id: OWNER },
        otherPayload: { actor_public_id: MEMBER },
        expectedStatus: 200,
      });
      const published = await app.inject({ method: "GET", url: `/products/${productId}` });
      expect(published.json().state).toBe("published");
      expect(published.json().is_visible).toBe(true);

      /**
       * والأرشفةُ بعدَها بمفتاحٍ آخرَ: مفتاحٌ لكلّ **قصدٍ** لا مفتاحٌ لكلّ مَورِد.
       *
       * ولو كان الحفظُ بالمَورِدِ لا بالمفتاحِ لأعادت الأرشفةُ جوابَ النشرِ — وذلك أخطرُ
       * صمتاً في هذا الجدول: عمليّةٌ لم تقع وجوابُها يقول إنّها وقعت.
       */
      await expectReplay({
        url: `/products/${productId}/archive`,
        key: keyOf("archive"),
        payload: { actor_public_id: OWNER },
        otherPayload: { actor_public_id: MEMBER },
        expectedStatus: 200,
      });
      const archived = await app.inject({ method: "GET", url: `/products/${productId}` });
      expect(archived.json().state).toBe("archived");
      expect(archived.json().is_visible).toBe(false);
    });

    it("`POST /inventory`: فرقٌ يُطبَّق مرّةً — الرصيدُ لا يتضاعف بانقطاعِ شبكة", async () => {
      const productId = await seedProduct("SKU-INV");
      await expectReplay({
        url: `/products/${productId}/inventory`,
        key: keyOf("inventory"),
        payload: { quantity_delta: 5, reason_code: "restock", actor_public_id: OWNER },
        otherPayload: { quantity_delta: 7, reason_code: "restock", actor_public_id: OWNER },
        expectedStatus: 201,
      });
      const read = await app.inject({ method: "GET", url: `/products/${productId}/inventory` });
      // 5 لا 10 ولا 12: هذا هو الرقمُ الذي يجعل الجدولَ يستحقُّ وجودَه.
      expect(read.json().quantity_on_hand).toBe(5);
      expect(read.json().last_adjustment_sequence).toBe(1);
    });
  });

  describe("حدودُ الجدولِ نفسِه", () => {
    it("مفتاحٌ آخرُ لنفسِ الطلبِ يُنفَّذ ثانيةً — فيردُّه المجالُ لا المفتاح", async () => {
      expect(
        (await write("POST", "/stores", keyOf("scope-a"), registerBody())).statusCode,
      ).toBe(201);

      /**
       * مفتاحٌ جديدٌ ⇒ لا جوابَ محفوظٌ ⇒ يمرّ الطلبُ إلى العمليّةِ فيصطدم بحارسِ اللاحقة.
       * وهذا هو الفرقُ بين الطبقتَين: المفتاحُ يحرس **التسليمَ** والمجالُ يحرس **الحقيقة**.
       * ولو حرس المفتاحُ الحقيقةَ لصار كلُّ خطأِ عميلٍ نجاحاً مُعاداً.
       */
      const second = await write("POST", "/stores", keyOf("scope-b"), registerBody());
      expect(second.statusCode).toBe(409);
      /**
       * والرمزُ `STORE_OWNER_LIMIT_REACHED` لا `STORE_SLUG_TAKEN`: الطلبُ يخرق الحقيقتَين،
       * والفحصُ المجاليُّ لحدِّ المالكِ يسبق قيدَ اللاحقةِ في القاعدةِ — فأوّلُ جوابٍ صادقٍ
       * يُقال هو الذي يُقال. وترتيبُ الرمزَين هنا مرصودٌ لا مُصادفةٌ: مَن غيَّره غيَّر رمزاً
       * يقرؤه العميل.
       */
      expect(second.json().error.code).toBe("STORE_OWNER_LIMIT_REACHED");
      expect(await countRows(pg.pool, "stores")).toBe(1);
    });

    it("والجوابُ الفاشلُ لا يُحفَظ: الإصلاحُ بنفسِ المفتاحِ يمرّ", async () => {
      /**
       * تصنيفٌ مجهولٌ ⇒ `404`، ثمّ نفسُ المفتاحِ بجسمٍ صحيح.
       *
       * حفظُ الفشلِ كان سيسجن المُتَّصلَ في خطئه: يُصلِح جسمَه فيُعاد إليه الخطأُ نفسُه،
       * أو يُقال له `409` لطلبٍ لم ينجح قطّ. والحرسُ يُحفَظ **بعدَ** النجاحِ في المعاملةِ
       * نفسِها، فالفشلُ يُلغي حفظَه معه.
       */
      const key = keyOf("failed-not-saved");
      const rejected = await write("POST", "/stores", key, {
        ...registerBody(),
        category_slug: "no-such-category",
      });
      expect(rejected.statusCode).toBe(404);
      expect(rejected.json().error.code).toBe("STORE_CATEGORY_NOT_FOUND");
      expect(await countRows(pg.pool, "marketplace_idempotency")).toBe(0);

      const fixed = await write("POST", "/stores", key, registerBody());
      expect(fixed.statusCode, fixed.body).toBe(201);
      expect(await countRows(pg.pool, "marketplace_idempotency")).toBe(1);
    });

    it("والمفتاحُ مُقيَّدٌ بالمسارِ: نفسُ النصِّ في مسارٍ آخرَ ليس إعادةَ إرسال", async () => {
      const key = keyOf("shared-text");
      expect((await write("POST", "/stores", key, registerBody())).statusCode).toBe(201);

      /**
       * نفسُ نصِّ المفتاحِ على `review-requests` يجب أن يُنفَّذ لا أن يُعاد ولا أن يُرفض:
       * `MARKETPLACE_ROUTE_KEYS` تدخل في تجزيءِ الحرس، لأنّ عميلاً يُولّد مفتاحاً واحداً
       * لرحلةٍ كاملةٍ ليس خطأً يستحقُّ `409` — وإعادةُ جوابِ المتجرِ لطلبةِ مراجعةٍ أسوأ.
       */
      const requested = await write("POST", `/stores/${SLUG}/review-requests`, key, {
        requested_by_public_id: OWNER,
      });
      expect(requested.statusCode, requested.body).toBe(201);
      expect(await countRows(pg.pool, "store_reviews")).toBe(1);
      expect(await countRows(pg.pool, "marketplace_idempotency")).toBe(2);
    });
  });
});
