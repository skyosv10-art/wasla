/**
 * حرسُ المخزون: فرقٌ موقَّعٌ غيرُ صفريٍّ، رصيدٌ لا ينزل تحت الصفر، وطيٌّ يُقارَن بكلِّ سطر.
 */
import { describe, expect, it } from "vitest";

import { INVENTORY_DELTA_ABS_MAX } from "../domain/contract-sets.js";
import { MarketplaceError } from "../domain/errors.js";
import {
  INVENTORY_INITIAL_QUANTITY,
  applyInventoryAdjustment,
  assertQuantityDelta,
  deriveQuantityOnHand,
} from "../domain/inventory.js";
import type { InventoryAdjustmentEntry } from "../domain/model.js";

const ACTOR = "WS-0000000123";

function entry(
  sequence: number,
  delta: number,
  quantityAfter: number,
  reasonCode: InventoryAdjustmentEntry["reasonCode"] = "restock",
): InventoryAdjustmentEntry {
  return {
    quantityDelta: delta,
    quantityAfter,
    reasonCode,
    actorPublicId: ACTOR,
    adjustmentSequence: sequence,
    occurredAt: `2026-03-1${sequence}T09:00:00.000Z`,
  };
}

describe("الفرقُ الموقَّع", () => {
  it("يرفض الصفرَ والكسرَ وما ليس عدداً", () => {
    for (const bad of [0, 1.5, Number.NaN, "3", null, undefined]) {
      expect(() => assertQuantityDelta(bad)).toThrowError(MarketplaceError);
    }
  });

  it("يقبل السالبَ والموجبَ في حدِّ المقدارِ المطلق", () => {
    expect(assertQuantityDelta(5)).toBe(5);
    expect(assertQuantityDelta(-5)).toBe(-5);
    expect(assertQuantityDelta(INVENTORY_DELTA_ABS_MAX)).toBe(INVENTORY_DELTA_ABS_MAX);
    expect(assertQuantityDelta(-INVENTORY_DELTA_ABS_MAX)).toBe(-INVENTORY_DELTA_ABS_MAX);
    expect(() => assertQuantityDelta(INVENTORY_DELTA_ABS_MAX + 1)).toThrowError(MarketplaceError);
    expect(() => assertQuantityDelta(-INVENTORY_DELTA_ABS_MAX - 1)).toThrowError(MarketplaceError);
  });
});

describe("سطرُ التعديل", () => {
  it("يحسب `quantity_after` من الرصيدِ الحاضرِ لا من رقمٍ يُرسَل", () => {
    const row = applyInventoryAdjustment({
      quantityOnHand: 10,
      quantityDelta: -4,
      reasonCode: "shrinkage",
      actorPublicId: ACTOR,
      adjustmentSequence: 3,
      occurredAt: "2026-03-11T09:00:00.000Z",
    });
    expect(row.quantityAfter).toBe(6);
    expect(row.quantityDelta).toBe(-4);
    expect(row.reasonCode).toBe("shrinkage");
  });

  it("يسمح بالوصولِ إلى الصفرِ ويرفض ما تحته برمزِ `INVENTORY_INSUFFICIENT_QUANTITY`", () => {
    expect(
      applyInventoryAdjustment({
        quantityOnHand: 4,
        quantityDelta: -4,
        reasonCode: "correction",
        actorPublicId: ACTOR,
        adjustmentSequence: 2,
        occurredAt: "2026-03-11T09:00:00.000Z",
      }).quantityAfter,
    ).toBe(0);

    try {
      applyInventoryAdjustment({
        quantityOnHand: 4,
        quantityDelta: -5,
        reasonCode: "correction",
        actorPublicId: ACTOR,
        adjustmentSequence: 2,
        occurredAt: "2026-03-11T09:00:00.000Z",
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MarketplaceError);
      expect((error as MarketplaceError).code).toBe("INVENTORY_INSUFFICIENT_QUANTITY");
      expect((error as MarketplaceError).details?.quantity_on_hand).toBe(4);
      expect((error as MarketplaceError).httpStatus).toBe(422);
    }
  });

  it("يرفض تسلسلاً أصغرَ من واحدٍ ورصيداً سالباً", () => {
    expect(() =>
      applyInventoryAdjustment({
        quantityOnHand: 1,
        quantityDelta: 1,
        reasonCode: "restock",
        actorPublicId: ACTOR,
        adjustmentSequence: 0,
        occurredAt: "2026-03-11T09:00:00.000Z",
      }),
    ).toThrowError(MarketplaceError);

    expect(() =>
      applyInventoryAdjustment({
        quantityOnHand: -1,
        quantityDelta: 1,
        reasonCode: "restock",
        actorPublicId: ACTOR,
        adjustmentSequence: 1,
        occurredAt: "2026-03-11T09:00:00.000Z",
      }),
    ).toThrowError(MarketplaceError);
  });
});

describe("طيُّ دفترِ المخزون", () => {
  it("دفترٌ فارغٌ ⇒ صفر", () => {
    expect(deriveQuantityOnHand([])).toBe(INVENTORY_INITIAL_QUANTITY);
  });

  it("يُعيد بناءَ الرصيدِ بلا خسارة", () => {
    const ledger = [
      entry(1, 20, 20, "initial_stock"),
      entry(2, -5, 15, "shrinkage"),
      entry(3, 10, 25),
      entry(4, -25, 0, "archive_zeroed"),
    ];
    expect(deriveQuantityOnHand(ledger)).toBe(0);
    expect(deriveQuantityOnHand(ledger.slice(0, 3))).toBe(25);
  });

  it("يرفض ثغرةً في التسلسل", () => {
    expect(() => deriveQuantityOnHand([entry(2, 5, 5)])).toThrowError(MarketplaceError);
  });

  it("يرفض سطراً لا يتّفق رصيدُه مع الجمعِ الجاري — حتى لو صحَّ المجموعُ الأخير", () => {
    const cancellingErrors = [entry(1, 10, 12), entry(2, 5, 15)];
    expect(() => deriveQuantityOnHand(cancellingErrors)).toThrowError(MarketplaceError);
  });

  it("يرفض دفتراً ينزل بالرصيدِ تحت الصفرِ في المنتصف", () => {
    expect(() => deriveQuantityOnHand([entry(1, 3, 3), entry(2, -5, -2)])).toThrowError(
      MarketplaceError,
    );
  });

  it("يرفض سطراً بفرقِ صفرٍ في الدفتر", () => {
    expect(() => deriveQuantityOnHand([entry(1, 0, 0)])).toThrowError(MarketplaceError);
  });
});
