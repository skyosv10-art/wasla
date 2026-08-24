/**
 * المخزونُ على قاعدةٍ حقيقيّة: دفترُ فروقٍ موقَّعةٍ، والرصيدُ نسخةٌ منه لا مصدرٌ ثانٍ.
 *
 * والاختبارُ الحاكمُ هنا **حارسُ الانحراف بين الدفترِ والرصيد**: يُطوى الدفترُ بـ
 * `deriveQuantityOnHand` ويُقارن بـ`product_inventory.quantity_on_hand` بعد كلِّ فرق. ولو دخل
 * يوماً مسارٌ يجمع في SQL (`quantity_on_hand + :delta`) بدل نسخِ `quantity_after` المحسوبِ في
 * المجالِ، لانحرف الرقمانِ عند أوّلِ إعادةِ إرسالٍ — وهذا الملفُّ يُمسك ذلك في الدقيقةِ لا في
 * جردٍ بعد شهر.
 *
 * ويُفحَص كذلك أنّ الرفضَ عند نقصِ الكمّيّةِ يقع **مرّتين**: في المجالِ برمزٍ مُعلَنٍ، وفي
 * القاعدةِ بقيدِ `quantity_after >= 0` إن مرّ فرقٌ من مسارٍ لا يعرف الدالّة. وقيدٌ واحدٌ منهما
 * لا يكفي: الأوّلُ يُعطي رسالةً مفهومةً، والثاني يمنع الرقمَ السالبَ من الاستقرارِ في الجدول.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyInventoryAdjustment, deriveQuantityOnHand } from "../domain/inventory.js";
import { deriveStoreState } from "../domain/state.js";
import { draftProduct, draftStore } from "../domain/catalog.js";
import { MarketplaceUnitOfWork } from "../db/unit-of-work.js";
import {
  MODERATOR,
  OWNER,
  PG_ENABLED,
  T0,
  countRows,
  rejectingConstraint,
  resetData,
  seedLeafCategory,
  setupPostgres,
  type PgFixture,
} from "./pg-harness.js";

const CATEGORY = { slug: "electronics-phones", depth: 2, isActive: true } as const;

describe.runIf(PG_ENABLED)("استمراريّةُ المخزون", () => {
  let pg: PgFixture;
  let productId: string;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(async () => {
    await resetData(pg.pool);
    const categoryId = await seedLeafCategory(pg.stores);
    const store = await pg.stores.resources.insertStore(
      draftStore({
        ownerPublicId: OWNER,
        slug: "medina-dates",
        titleAr: "متجرُ تمورِ المدينة",
        categoryId,
        category: CATEGORY,
        activeStoreCount: 0,
      }),
    );
    await pg.stores.ledger.appendStoreReview(store.storeId, {
      decision: "review_requested",
      actorType: "owner",
      actorPublicId: OWNER,
      fromState: "draft",
      toState: "pending_review",
      stateSequence: 2,
      decidedAt: T0,
    });
    await pg.stores.ledger.appendStoreReview(store.storeId, {
      decision: "approved",
      actorType: "moderator",
      actorPublicId: MODERATOR,
      fromState: "pending_review",
      toState: "approved",
      stateSequence: 3,
      decidedAt: T0,
    });
    await pg.stores.projection.projectStoreState(
      store.storeId,
      deriveStoreState(await pg.stores.ledger.listStoreReviews(store.storeId)),
    );
    const product = await pg.stores.resources.insertProduct(
      draftProduct({
        storeId: store.storeId,
        storeState: "approved",
        sku: "SKU-0001",
        titleAr: "عجوةُ المدينةِ كيلو",
        categoryId,
        category: CATEGORY,
        priceMinorUnits: 4500,
        createdByPublicId: OWNER,
      }),
    );
    productId = product.productId;
  });

  /** فرقٌ واحدٌ في معاملةٍ واحدةٍ: دفترٌ ثمّ إسقاطٌ — وهو ما ستفعله طبقةُ 4/6 بحرفه. */
  async function adjust(delta: number, reasonCode: "initial_stock" | "restock" | "correction" | "shrinkage") {
    const uow = new MarketplaceUnitOfWork(pg.db);
    return uow.write(async ({ stores }) => {
      const ledger = await stores.ledger.listInventoryAdjustments(productId);
      const entry = applyInventoryAdjustment({
        quantityOnHand: deriveQuantityOnHand(ledger),
        quantityDelta: delta,
        reasonCode,
        actorPublicId: OWNER,
        adjustmentSequence: ledger.length + 1,
        occurredAt: T0,
      });
      await stores.ledger.appendInventoryAdjustment(productId, entry);
      return stores.projection.applyInventoryProjection(productId, entry);
    });
  }

  it("أوّلُ فرقٍ يُنشئ صفَّ رصيدٍ لا يُحدّثه", async () => {
    expect(await pg.stores.projection.findInventory(productId)).toBeUndefined();
    const { value } = await adjust(20, "initial_stock");
    expect(value?.quantityOnHand).toBe(20);
    expect(value?.lastAdjustmentSequence).toBe(1);
    expect(await countRows(pg.pool, "product_inventory")).toBe(1);
  });

  it("والرصيدُ يساوي طيَّ الدفترِ عند كلِّ خطوة — لا عند النهايةِ فقط", async () => {
    for (const step of [
      { delta: 20, reason: "initial_stock" as const, expected: 20 },
      { delta: 5, reason: "restock" as const, expected: 25 },
      { delta: -3, reason: "shrinkage" as const, expected: 22 },
      { delta: -22, reason: "correction" as const, expected: 0 },
    ]) {
      await adjust(step.delta, step.reason);
      const ledger = await pg.stores.ledger.listInventoryAdjustments(productId);
      const inventory = await pg.stores.projection.findInventory(productId);
      expect(deriveQuantityOnHand(ledger)).toBe(step.expected);
      expect(inventory?.quantityOnHand).toBe(step.expected);
      expect(inventory?.lastAdjustmentSequence).toBe(ledger.length);
    }
  });

  it("وفرقٌ يُنزل الرصيدَ تحت الصفرِ يُرفَض برمزٍ مُعلَنٍ ولا يُكتب سطرٌ", async () => {
    await adjust(5, "initial_stock");
    await expect(adjust(-6, "correction")).rejects.toMatchObject({
      code: "INVENTORY_INSUFFICIENT_QUANTITY",
    });
    expect(await countRows(pg.pool, "inventory_adjustments")).toBe(1);
    expect((await pg.stores.projection.findInventory(productId))?.quantityOnHand).toBe(5);
  });

  it("والقاعدةُ ترفض رصيداً سالباً حتى لو تجاوزَ مسارٌ دالّةَ المجال", async () => {
    await expect(
      pg.stores.ledger.appendInventoryAdjustment(productId, {
        quantityDelta: -4,
        quantityAfter: -4,
        reasonCode: "correction",
        actorPublicId: OWNER,
        adjustmentSequence: 1,
        occurredAt: T0,
      }),
    ).rejects.toThrow(/quantity_after/u);
    expect(await countRows(pg.pool, "inventory_adjustments")).toBe(0);
  });

  it("وفرقٌ صفريٌّ مرفوضٌ: حركةٌ لا تُحرّك ليست بياناً بل ضجيجٌ في الدفتر", async () => {
    expect(() =>
      applyInventoryAdjustment({
        quantityOnHand: 5,
        quantityDelta: 0,
        reasonCode: "correction",
        actorPublicId: OWNER,
        adjustmentSequence: 1,
        occurredAt: T0,
      }),
    ).toThrow();
  });

  it("وإسقاطٌ بتسلسلٍ مُعادٍ لا يُغيّر الرصيدَ ولا يُنشئ صفّاً ثانياً", async () => {
    await adjust(10, "initial_stock");
    const ledger = await pg.stores.ledger.listInventoryAdjustments(productId);
    const replayed = ledger[0]!;
    const again = await pg.stores.projection.applyInventoryProjection(productId, replayed);
    expect(again).toBeUndefined();
    expect((await pg.stores.projection.findInventory(productId))?.quantityOnHand).toBe(10);
    expect(await countRows(pg.pool, "product_inventory")).toBe(1);
  });

  it("وسباقُ تسلسلِ فرقٍ يسقط باسمِ الفهرس", async () => {
    const entry = {
      quantityDelta: 3,
      quantityAfter: 3,
      reasonCode: "initial_stock" as const,
      actorPublicId: OWNER,
      adjustmentSequence: 1,
      occurredAt: T0,
    };
    await pg.stores.ledger.appendInventoryAdjustment(productId, entry);
    expect(
      await rejectingConstraint(pg.stores.ledger.appendInventoryAdjustment(productId, entry)),
    ).toBe("ux_inventory_adjustments_sequence");
  });
});
