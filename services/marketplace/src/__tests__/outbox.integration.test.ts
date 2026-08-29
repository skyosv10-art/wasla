/**
 * صندوقُ الصادرِ على قاعدةٍ حقيقيّة: **الحدثُ والقرارُ يستقرّان معاً أو لا يستقرّ أحدُهما**.
 *
 * ## ما يُثبته هذا الملفُّ ولا يُثبته `events.test.ts`
 *
 * ذاك يفحص **شكلَ** الحمولةِ في مقابلِ `contracts/events.json` بلا قاعدةٍ ولا معاملة. وهذا
 * يفحص ثلاثةَ أشياءَ يستحيل إثباتُها بدالّةٍ صرفة:
 *
 *  1. **الذرّيّة**: قرارٌ يسقط بعد كتابةِ حدثِه لا يُبقي حدثاً في الجدول — لا صفَّ صادرٍ بلا
 *     قرارٍ، ولا قرارَ بلا صفِّ صادر. وهذا هو الفرقُ بين صندوقِ صادرٍ حقيقيٍّ وسطرٍ يُرسَل بعد
 *     `commit` فيضيع مع أوّلِ سقوطِ عمليّة.
 *  2. **الرحلةُ كاملةً**: عمليّاتُ الحدِّ الخمسَ عشرةَ تُنتج الأنواعَ المُعلَنةَ بالترتيبِ
 *     المُعلَن، لا نوعاً ناقصاً ولا نوعاً مُكرَّراً — وترتيبُ الأنواعِ هنا هو ما سيراه المُستهلك.
 *  3. **الاستدارةُ عبر JSONB**: ما كُتب هو ما يُقرَأ. حمولةٌ فيها `null` صريحٌ أو رقمٌ سالبٌ أو
 *     منطقيٌّ تعود بنفسِ الأنواعِ لا نصّاً — وهذا ما يجعل `envelopeOf` كافياً للناقلِ غداً.
 *
 * ## وإعادةُ الإرسالِ لا تُنتج حدثاً ثانياً
 *
 * أخطرُ عطبٍ في صندوقِ صادرٍ ليس ضياعَ حدثٍ بل **تكرارُه**: نداءٌ يُعاد بنفسِ مفتاحِ التفرّدِ
 * يُعيد الجوابَ المحفوظَ، فلو كُتب الحدثُ قبلَ حارسِ الإعادةِ لصار كلُّ تكرارِ شبكةٍ إشعاراً
 * ثانياً للمالك. ولذلك يُفحَص هنا أنّ عددَ صفوفِ الصندوقِ **لا ينمو** عند الإعادة.
 *
 * ## ما لا يُفحَص هنا بقصد
 *
 * لا ختمَ نشرٍ ولا ناقل: `markPublished` غيرُ موجودةٍ في المخزنِ بقرارٍ مُعلَنٍ في
 * `db/outbox.ts` (دَينُ المرحلة 09). فيُفحَص **غيابُها** صراحةً بدل أن يُقرأ سهواً.
 */

import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MarketplaceCatalogService } from "../app/catalog.js";
import { MarketplaceProductService } from "../app/products.js";
import { MarketplaceStoreService } from "../app/stores.js";
import { envelopeOf, OUTBOX_BATCH_LIMIT_MAX } from "../db/outbox.js";
import { MarketplaceUnitOfWork } from "../db/unit-of-work.js";
import { MarketplaceError } from "../domain/errors.js";
import {
  MARKETPLACE_EVENT_PRODUCER,
  MARKETPLACE_EVENT_VERSION,
  storeRegisteredEvent,
} from "../domain/events.js";
import type { Clock } from "../domain/time.js";
import { createMarketplaceApp } from "../http/app.js";
import {
  MEMBER,
  MODERATOR,
  OWNER,
  PG_ENABLED,
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

let keySeed = 0;
const write = () => ({
  "idempotency-key": `idem-outbox-${String(++keySeed).padStart(8, "0")}`,
  "content-type": "application/json",
});

class ProbeFailure extends Error {}

describe.skipIf(!PG_ENABLED)("صندوقُ الصادرِ فوق Postgres", () => {
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

  async function post(
    url: string,
    payload: Record<string, unknown> = {},
    headers = write(),
  ): Promise<LightMyRequestResponse> {
    return await app.inject({ method: "POST", url, headers, payload });
  }

  async function registerStore(slug = SLUG): Promise<void> {
    const response = await post("/stores", {
      owner_public_id: OWNER,
      store_slug: slug,
      title_ar: "إلكترونيّاتُ المدينة",
      category_slug: CATEGORY,
    });
    expect(response.statusCode, response.body).toBe(201);
  }

  async function approveStore(slug = SLUG): Promise<void> {
    const requested = await post(`/stores/${slug}/review-requests`, {
      requested_by_public_id: OWNER,
    });
    expect(requested.statusCode, requested.body).toBe(201);
    const decided = await post(`/stores/${slug}/decisions`, {
      decision: "approved",
      actor_type: "moderator",
      actor_public_id: MODERATOR,
    });
    expect(decided.statusCode, decided.body).toBe(201);
  }

  async function createProduct(sku = "SKU-001", initialQuantity?: number): Promise<string> {
    const response = await post(`/stores/${SLUG}/products`, {
      sku,
      title_ar: "هاتف",
      category_slug: CATEGORY,
      price_minor_units: 249900,
      currency_code: "SAR",
      created_by_public_id: OWNER,
      ...(initialQuantity === undefined ? {} : { initial_quantity: initialQuantity }),
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { readonly product_id: string }).product_id;
  }

  /** أنواعُ ما في الصندوقِ بترتيبِ استقرارِه — الشاهدُ الأساسيُّ في هذا الملفّ. */
  async function eventTypes(): Promise<readonly string[]> {
    const rows = await pg.stores.outbox.listUnpublished();
    return rows.map((row) => row.eventType);
  }

  describe("حدثٌ واحدٌ لكلِّ قرارٍ، بحمولةٍ تعود كما كُتبت", () => {
    it("تسجيلُ متجرٍ يكتب صفّاً واحداً: `store_registered` جذرُه المتجر", async () => {
      await registerStore();
      const rows = await pg.stores.outbox.listUnpublished();
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row!.eventType).toBe("marketplace.store_registered");
      expect(row!.eventVersion).toBe(MARKETPLACE_EVENT_VERSION);
      expect(row!.aggregateType).toBe("store");
      expect(row!.publishedAt).toBeUndefined();
      expect(row!.payload).toMatchObject({
        store_slug: SLUG,
        owner_public_id: OWNER,
        category_slug: CATEGORY,
        from_state: null,
        to_state: "draft",
        state_sequence: 1,
        actor_type: "owner",
        reason_code: null,
      });
      expect(row!.payload.store_id).toBe(row!.aggregateId);
    });

    it("والأنواعُ في الصندوقِ هي أنواعُ الحمولةِ نفسِها بعد JSONB — لا نصٌّ بدل رقمٍ ولا `null` ضائع", async () => {
      await registerStore();
      const [row] = await pg.stores.outbox.listUnpublished();
      expect(typeof row!.payload.state_sequence).toBe("number");
      expect(row!.payload.from_state).toBeNull();
      expect(Object.keys(row!.payload).includes("reason_code")).toBe(true);
    });

    it("والغلافُ المُعادُ من الصفِّ كاملٌ: مُعرِّفُه مُعرِّفُ الصفِّ ومُنتِجُه مُعلَن", async () => {
      await registerStore();
      const [row] = await pg.stores.outbox.listUnpublished();
      const envelope = envelopeOf(row!);
      expect(envelope.event_id).toBe(row!.outboxId);
      expect(envelope.producer).toBe(MARKETPLACE_EVENT_PRODUCER);
      expect(envelope.aggregate).toEqual({ type: "store", id: row!.aggregateId });
      expect(envelope.data).toEqual(row!.payload);
      expect(Object.keys(envelope).sort()).toEqual([
        "aggregate",
        "data",
        "event_id",
        "event_type",
        "event_version",
        "occurred_at",
        "producer",
      ]);
    });
  });

  describe("الرحلةُ كاملةً: كلُّ قرارٍ حدثُه، بالترتيب", () => {
    it("متجرٌ ثمّ طلبةٌ ثمّ اعتمادٌ ثمّ طاقمٌ: خمسةُ أحداثٍ بالترتيبِ المُعلَن", async () => {
      await registerStore();
      await approveStore();
      const added = await post(`/stores/${SLUG}/staff`, {
        member_public_id: MEMBER,
        role: "manager",
        added_by_public_id: OWNER,
      });
      expect(added.statusCode, added.body).toBe(201);
      const removed = await app.inject({
        method: "DELETE",
        url: `/stores/${SLUG}/staff/${MEMBER}`,
        headers: write(),
        payload: { removed_by_public_id: OWNER },
      });
      expect(removed.statusCode, removed.body).toBe(200);

      expect(await eventTypes()).toEqual([
        "marketplace.store_registered",
        "marketplace.store_review_requested",
        "marketplace.store_approved",
        "marketplace.store_staff_added",
        "marketplace.store_staff_removed",
      ]);
    });

    it("والاعتمادُ الأوّلُ يحمل `is_first_approval` صحيحاً، والإعادةُ بعد إيقافٍ تحمله خطأً", async () => {
      await registerStore();
      await approveStore();
      const suspended = await post(`/stores/${SLUG}/decisions`, {
        decision: "suspended",
        actor_type: "moderator",
        actor_public_id: MODERATOR,
        reason_code: "policy_violation",
      });
      expect(suspended.statusCode, suspended.body).toBe(201);
      const reinstated = await post(`/stores/${SLUG}/decisions`, {
        decision: "reinstated",
        actor_type: "moderator",
        actor_public_id: MODERATOR,
      });
      expect(reinstated.statusCode, reinstated.body).toBe(201);

      const rows = await pg.stores.outbox.listUnpublished();
      const approvals = rows.filter((row) => row.eventType === "marketplace.store_approved");
      expect(approvals.map((row) => row.payload.is_first_approval)).toEqual([true, false]);
      expect(approvals.every((row) => !("reason_code" in row.payload))).toBe(true);
      expect(rows.map((row) => row.eventType)).toEqual([
        "marketplace.store_registered",
        "marketplace.store_review_requested",
        "marketplace.store_approved",
        "marketplace.store_suspended",
        "marketplace.store_approved",
      ]);
    });

    it("ومنتجٌ بمخزونٍ أوّليٍّ يكتب حدثَ إنشاءٍ وحدثَ فرقٍ معاً في معاملةٍ واحدة", async () => {
      await registerStore();
      await approveStore();
      const productId = await createProduct("SKU-001", 5);

      const rows = await pg.stores.outbox.listUnpublished();
      expect(rows.slice(3).map((row) => row.eventType)).toEqual([
        "marketplace.product_created",
        "marketplace.inventory_adjusted",
      ]);
      const adjustment = rows.at(-1)!;
      expect(adjustment.aggregateType).toBe("inventory");
      expect(adjustment.aggregateId).toBe(productId);
      expect(adjustment.payload).toMatchObject({
        product_id: productId,
        quantity_delta: 5,
        quantity_after: 5,
        reason_code: "initial_stock",
        adjustment_sequence: 1,
      });
    });

    /**
     * هذا الاختبارُ **وُلد من إخفاقٍ حقيقيٍّ لا من تخطيطٍ**: أوّلُ تشغيلٍ لهذه المجموعةِ على
     * Postgres حقيقيٍّ (2026-08-29 · بوّابةُ خروجِ الطورِ) أسقطَ تأكيدَ الترتيبِ فوقَه — جاءَ
     * `inventory_adjusted` **قبلَ** `product_created` رغمَ أنّ الكودَ يُلحِقهما بهذا الترتيبِ.
     * والسببُ أنّ `created_at` كان `DEFAULT now()`، و`now()` لحظةُ **بدءِ المعاملةِ** فتتساوى
     * في كلِّ صفوفِها، فيسقط الترتيبُ على `outbox_id` وهو مُعرِّفٌ عشوائيّ. فكان تأكيدُ ترتيبِ
     * الأرشفةِ أدناه ينجح **بحظِّ مقارنةِ مُعرِّفَينِ** لا بضمان.
     *
     * فلا يكفي أن يعودَ الترتيبُ صحيحاً — يجب أن يُثبَت **سببُ** صحّتِه: أنّ الطابعَينِ
     * مختلفانِ فعلاً على دقّةِ المحرّكِ. ولذلك يُقرأ العمودُ خاماً: `OutboxRecord.createdAt`
     * سلسلةُ `Date` بدقّةِ الميلي، والمحرّكُ يرتّب بالميكرو — فتأكيدٌ على السلسلةِ يُخفي
     * الفرقَ الذي نُثبِته.
     */
    it("والطابعُ داخلَ المعاملةِ الواحدةِ يتقدّم فعلاً — لا ترتيبَ بحظِّ مُعرِّفٍ عشوائيّ", async () => {
      await registerStore();
      await approveStore();
      await createProduct("SKU-ORD", 7);

      const raw = await pg.pool.query<{
        readonly event_type: string;
        readonly created_at: string;
        readonly same_as_txn_start: boolean;
      }>(
        `SELECT event_type,
                created_at::text AS created_at,
                created_at = now() AS same_as_txn_start
           FROM marketplace_outbox
          WHERE event_type IN ('marketplace.product_created', 'marketplace.inventory_adjusted')
          ORDER BY created_at ASC`,
      );

      expect(raw.rows.map((row) => row.event_type)).toEqual([
        "marketplace.product_created",
        "marketplace.inventory_adjusted",
      ]);
      // طابعانِ متمايزانِ: هذا هو الضمانُ، لا مجرّدُ ترتيبٍ عادَ صحيحاً هذه المرّة.
      expect(new Set(raw.rows.map((row) => row.created_at)).size).toBe(2);
      // ولا واحدٌ منهما يساوي لحظةَ بدءِ معاملةِ هذا الاستعلامِ — أي ليس `now()` مُجمَّدةً.
      expect(raw.rows.every((row) => row.same_as_txn_start === false)).toBe(true);
    });

    it("ومنتجٌ بلا مخزونٍ أوّليٍّ لا يكتب حدثَ فرقٍ — لا فرقَ صفريٌّ يُنشَر", async () => {
      await registerStore();
      await approveStore();
      await createProduct("SKU-002");
      expect((await eventTypes()).filter((type) => type.endsWith("inventory_adjusted"))).toEqual([]);
    });

    it("واعتدالٌ ثمّ فرقٌ ثمّ نشرٌ ثمّ أرشفةٌ: أربعةُ أحداثٍ بالترتيبِ وحمولاتٌ متّسقة", async () => {
      await registerStore();
      await approveStore();
      const productId = await createProduct("SKU-003");

      const moderated = await post(`/products/${productId}/decisions`, {
        decision: "approved",
        actor_type: "moderator",
        actor_public_id: MODERATOR,
      });
      expect(moderated.statusCode, moderated.body).toBe(201);
      const adjusted = await post(`/products/${productId}/inventory`, {
        quantity_delta: 3,
        reason_code: "restock",
        actor_public_id: OWNER,
      });
      expect(adjusted.statusCode, adjusted.body).toBe(201);
      const published = await post(`/products/${productId}/publish`, { actor_public_id: OWNER });
      expect(published.statusCode, published.body).toBe(200);
      const archived = await post(`/products/${productId}/archive`, { actor_public_id: OWNER });
      expect(archived.statusCode, archived.body).toBe(200);

      const rows = await pg.stores.outbox.listUnpublished();
      /**
       * والتصفيرُ **قبلَ** حدثِ الأرشفةِ لا بعده: مَن قرأ الأرشفةَ ثمّ رأى فرقاً بعدها ظنّ
       * أنّ مخزوناً تحرّك في منتجٍ مُؤرشَفٍ. والترتيبُ هنا هو ترتيبُ `archiveProduct` نفسِه.
       */
      expect(rows.slice(4).map((row) => row.eventType)).toEqual([
        "marketplace.product_moderated",
        "marketplace.inventory_adjusted",
        "marketplace.product_published",
        "marketplace.inventory_adjusted",
        "marketplace.product_archived",
      ]);

      const publishedEvent = rows.find((row) => row.eventType === "marketplace.product_published")!;
      expect(publishedEvent.payload).toMatchObject({
        from_state: "draft",
        to_state: "published",
        store_state: "approved",
        quantity_on_hand: 3,
        category_slug: CATEGORY,
      });
      expect("is_visible" in publishedEvent.payload).toBe(false);

      /** الأرشفةُ تُصفِّر المخزونَ، فيُنشَر فرقٌ سالبٌ بسببٍ مُعلَنٍ لا حذفٌ صامت. */
      const zeroing = rows.at(-2)!;
      expect(zeroing.payload).toMatchObject({
        quantity_delta: -3,
        quantity_after: 0,
        reason_code: "archive_zeroed",
      });
    });
  });

  describe("الذرّيّة: لا حدثَ يُفلت من معاملةٍ ساقطة", () => {
    it("سقوطٌ بعد كتابةِ الحدثِ لا يُبقي حدثاً ولا قراراً", async () => {
      const failing = new MarketplaceUnitOfWork(pg.db, async (stage) => {
        if (stage === "after-outbox") throw new ProbeFailure();
      });
      await expect(
        failing.write(async ({ stores, probe }) => {
          await stores.outbox.appendEvent(
            storeRegisteredEvent({
              storeId: "11111111-1111-4111-8111-111111111111",
              storeSlug: SLUG,
              ownerPublicId: OWNER,
              categorySlug: CATEGORY,
              stateSequence: 1,
              occurredFor: NOW,
              occurredAt: NOW,
            }),
          );
          await probe?.("after-outbox");
          return undefined;
        }),
      ).rejects.toBeInstanceOf(ProbeFailure);
      expect(await countRows(pg.pool, "marketplace_outbox")).toBe(0);
    });

    it("وقرارٌ يُرفَض في الحدِّ لا يكتب حدثاً: الرفضُ قبلَ المعاملةِ لا بعدها", async () => {
      await registerStore();
      const before = await countRows(pg.pool, "marketplace_outbox");
      const rejected = await post(`/stores/${SLUG}/decisions`, {
        decision: "approved",
        actor_type: "moderator",
        actor_public_id: MODERATOR,
      });
      expect(rejected.statusCode).toBeGreaterThanOrEqual(400);
      expect(await countRows(pg.pool, "marketplace_outbox")).toBe(before);
    });

    it("وإعادةُ إرسالٍ بنفسِ المفتاحِ لا تُنتج حدثاً ثانياً", async () => {
      const headers = write();
      const payload = {
        owner_public_id: OWNER,
        store_slug: SLUG,
        title_ar: "إلكترونيّاتُ المدينة",
        category_slug: CATEGORY,
      };
      const first = await post("/stores", payload, headers);
      expect(first.statusCode, first.body).toBe(201);
      const afterFirst = await countRows(pg.pool, "marketplace_outbox");

      const replay = await post("/stores", payload, headers);
      expect(replay.statusCode).toBe(201);
      expect(replay.json()).toEqual(first.json());
      expect(await countRows(pg.pool, "marketplace_outbox")).toBe(afterFirst);
    });
  });

  describe("قراءةُ غيرِ المنشورِ: سقفٌ مُعلَنٌ وترتيبُ استقرار", () => {
    it("كلُّ ما في الجدولِ غيرُ منشورٍ — ولا ناشرَ في هذه المراجعة", async () => {
      await registerStore();
      await approveStore();
      const rows = await pg.stores.outbox.listUnpublished();
      expect(rows).toHaveLength(await countRows(pg.pool, "marketplace_outbox"));
      expect(rows.every((row) => row.publishedAt === undefined)).toBe(true);
    });

    it("والحدُّ يُقصّ الدفعةَ ولا يُعيد ترتيبَها", async () => {
      await registerStore();
      await approveStore();
      const all = await pg.stores.outbox.listUnpublished();
      expect(all.length).toBeGreaterThanOrEqual(3);
      const capped = await pg.stores.outbox.listUnpublished(2);
      expect(capped.map((row) => row.outboxId)).toEqual(
        all.slice(0, 2).map((row) => row.outboxId),
      );
    });

    it("وحدٌّ خارجَ المدى مرفوضٌ: صفرٌ أو كسريٌّ أو فوقَ السقفِ المُعلَن", async () => {
      await expect(pg.stores.outbox.listUnpublished(0)).rejects.toBeInstanceOf(MarketplaceError);
      await expect(pg.stores.outbox.listUnpublished(1.5)).rejects.toBeInstanceOf(MarketplaceError);
      await expect(
        pg.stores.outbox.listUnpublished(OUTBOX_BATCH_LIMIT_MAX + 1),
      ).rejects.toBeInstanceOf(MarketplaceError);
      await expect(pg.stores.outbox.listUnpublished(OUTBOX_BATCH_LIMIT_MAX)).resolves.toEqual([]);
    });

    /**
     * غيابُ الختمِ مفحوصٌ لا مقروءٌ سهواً: يومَ يُكتب الناقلُ سيُضاف `markPublished` بقرارٍ،
     * وسيسقط هذا الاختبارُ فيُقرأ القرارُ في مراجعةٍ — وهذا هو المطلوب.
     */
    it("ولا ختمَ نشرٍ في سطحِ المخزنِ: دَينُ المرحلة 09 مُعلَنٌ لا مُنفَّذٌ نصفَ تنفيذ", async () => {
      expect("markPublished" in pg.stores.outbox).toBe(false);
      expect(Object.getOwnPropertyNames(Object.getPrototypeOf(pg.stores.outbox)).sort()).toEqual([
        "appendEvent",
        "constructor",
        "listUnpublished",
      ]);
    });
  });
});
