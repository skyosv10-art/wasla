/**
 * حرسُ الحجزِ والإفراج: فروقٌ سالبةٌ للحجزِ وموجبةٌ للإفراج، والفاعلُ `system:delivery`.
 */
import { describe, expect, it } from "vitest";

import { MarketplaceError } from "../domain/errors.js";
import {
  RESERVATION_ACTOR_PUBLIC_ID,
  buildReleaseAdjustments,
  buildReservationAdjustments,
  toReservationResults,
} from "../domain/reservation.js";

const OCCURRED_AT = "2026-09-01T00:00:00.000Z";
const PRODUCT_A = "00000000-0000-4000-8000-000000000001";
const PRODUCT_B = "00000000-0000-4000-8000-000000000002";

describe("بناءُ فروقِ الحجز", () => {
  it("فروقٌ سالبةٌ بسبَب `reservation` وفاعلُها `system:delivery`", () => {
    const inventories = new Map([
      [PRODUCT_A, { quantityOnHand: 10, lastAdjustmentSequence: 1 }],
    ]);
    const entries = buildReservationAdjustments(
      [{ productId: PRODUCT_A, quantity: 3 }],
      inventories,
      OCCURRED_AT,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.quantityDelta).toBe(-3);
    expect(entries[0]!.quantityAfter).toBe(7);
    expect(entries[0]!.reasonCode).toBe("reservation");
    expect(entries[0]!.actorPublicId).toBe(RESERVATION_ACTOR_PUBLIC_ID);
    expect(entries[0]!.adjustmentSequence).toBe(2);
    expect(entries[0]!.occurredAt).toBe(OCCURRED_AT);
  });

  it("أصنافٌ متعدّدةٌ تأخذُ التسلسلَ من إسقاطِ كلِّ صنفٍ على حدة", () => {
    const inventories = new Map([
      [PRODUCT_A, { quantityOnHand: 10, lastAdjustmentSequence: 1 }],
      [PRODUCT_B, { quantityOnHand: 5, lastAdjustmentSequence: 3 }],
    ]);
    const entries = buildReservationAdjustments(
      [
        { productId: PRODUCT_A, quantity: 2 },
        { productId: PRODUCT_B, quantity: 4 },
      ],
      inventories,
      OCCURRED_AT,
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]!.adjustmentSequence).toBe(2);
    expect(entries[0]!.quantityAfter).toBe(8);
    expect(entries[1]!.adjustmentSequence).toBe(4);
    expect(entries[1]!.quantityAfter).toBe(1);
  });

  it("صنفٌ بلا إسقاطٍ يبدأ من الصفرِ — فيرفع `INVENTORY_INSUFFICIENT_QUANTITY`", () => {
    const inventories = new Map<string, { quantityOnHand: number; lastAdjustmentSequence: number }>();
    expect(() =>
      buildReservationAdjustments(
        [{ productId: PRODUCT_A, quantity: 1 }],
        inventories,
        OCCURRED_AT,
      ),
    ).toThrowError(MarketplaceError);
  });

  it("كميّةٌ أكبرُ من الرصيدِ ترفع `INVENTORY_INSUFFICIENT_QUANTITY`", () => {
    const inventories = new Map([
      [PRODUCT_A, { quantityOnHand: 3, lastAdjustmentSequence: 1 }],
    ]);
    try {
      buildReservationAdjustments(
        [{ productId: PRODUCT_A, quantity: 5 }],
        inventories,
        OCCURRED_AT,
      );
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MarketplaceError);
      expect((error as MarketplaceError).code).toBe("INVENTORY_INSUFFICIENT_QUANTITY");
      expect((error as MarketplaceError).details?.quantity_on_hand).toBe(3);
    }
  });

  it("الحجزُ إلى الصفرِ مقبولٌ — الرصيدُ صفرٌ ليس سالباً", () => {
    const inventories = new Map([
      [PRODUCT_A, { quantityOnHand: 5, lastAdjustmentSequence: 1 }],
    ]);
    const entries = buildReservationAdjustments(
      [{ productId: PRODUCT_A, quantity: 5 }],
      inventories,
      OCCURRED_AT,
    );
    expect(entries[0]!.quantityAfter).toBe(0);
  });
});

describe("بناءُ فروقِ الإفراج", () => {
  it("فروقٌ موجبةٌ بسبَب `reservation_release` وفاعلُها `system:delivery`", () => {
    const inventories = new Map([
      [PRODUCT_A, { quantityOnHand: 7, lastAdjustmentSequence: 2 }],
    ]);
    const entries = buildReleaseAdjustments(
      [{ productId: PRODUCT_A, quantity: 3 }],
      inventories,
      OCCURRED_AT,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.quantityDelta).toBe(3);
    expect(entries[0]!.quantityAfter).toBe(10);
    expect(entries[0]!.reasonCode).toBe("reservation_release");
    expect(entries[0]!.actorPublicId).toBe(RESERVATION_ACTOR_PUBLIC_ID);
    expect(entries[0]!.adjustmentSequence).toBe(3);
  });

  it("الإفراجُ لا يفحصُ الكفايةَ — زيادةٌ لا سحب", () => {
    const inventories = new Map([
      [PRODUCT_A, { quantityOnHand: 0, lastAdjustmentSequence: 1 }],
    ]);
    const entries = buildReleaseAdjustments(
      [{ productId: PRODUCT_A, quantity: 10 }],
      inventories,
      OCCURRED_AT,
    );
    expect(entries[0]!.quantityAfter).toBe(10);
  });

  it("صنفٌ بلا إسقاطٍ يبدأ من الصفرِ في الإفراج", () => {
    const inventories = new Map<string, { quantityOnHand: number; lastAdjustmentSequence: number }>();
    const entries = buildReleaseAdjustments(
      [{ productId: PRODUCT_A, quantity: 5 }],
      inventories,
      OCCURRED_AT,
    );
    expect(entries[0]!.quantityDelta).toBe(5);
    expect(entries[0]!.quantityAfter).toBe(5);
  });
});

describe("تحويلُ النتائج", () => {
  it("يُحوّل الفروقَ المكتوبةَ إلى نتائجَ مُنتقاة", () => {
    const adjustments = [
      {
        productId: PRODUCT_A,
        quantityDelta: -3,
        quantityAfter: 7,
        adjustmentSequence: 2,
        reasonCode: "reservation" as const,
      },
      {
        productId: PRODUCT_B,
        quantityDelta: 3,
        quantityAfter: 8,
        adjustmentSequence: 4,
        reasonCode: "reservation_release" as const,
      },
    ];
    const results = toReservationResults(adjustments);
    expect(results).toHaveLength(2);
    expect(results[0]!.productId).toBe(PRODUCT_A);
    expect(results[0]!.quantityDelta).toBe(-3);
    expect(results[0]!.reasonCode).toBe("reservation");
    expect(results[1]!.productId).toBe(PRODUCT_B);
    expect(results[1]!.quantityDelta).toBe(3);
    expect(results[1]!.reasonCode).toBe("reservation_release");
  });
});
