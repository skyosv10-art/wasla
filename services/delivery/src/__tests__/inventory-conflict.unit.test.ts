/**
 * كشفُ تضاربِ المخزونِ النشطِ — القرارُ وحدَهُ (المراجعةُ 16/N · ADR-026 §4.18 · رفعُ دَينِ §4.8).
 *
 * الدعوى المُختبَرةُ هنا ليست «هل يرفعُ الرايةَ» فقط، بل **أنَّ الرايةَ لا تُرفَعُ في
 * الحالةِ السليمةِ**: متجرٌ فيهِ ثلاثُ وحداتٍ وثلاثةُ حجوزٍ يجعلُ `quantity_after = 0`
 * وهوَ **صحّةٌ تامّةٌ** لا تضاربٌ — لأنَّ الحجزَ نفسَهُ فرقٌ سالبٌ في دفترِ السوقِ
 * (`services/marketplace/src/domain/reservation.ts`) فـ`quantity_after` مطروحٌ منهُ
 * حجوزُنا سلفاً. وقاعدةُ «تضاربٌ إذا كانَ الباقي أقلَّ من المحجوزِ» تُطلِقُ رايةً على
 * كلِّ طلبٍ سليمٍ، وأوّلُ مُشغِّلٍ يرى مئةَ رايةٍ في ساعةٍ يتوقّفُ عن قراءتِها كلِّها.
 *
 * فالسؤالُ ليسَ كميّةً في مقابلِ كميّةٍ، بل: **هل يُشكِّكُ سببُ الفرقِ في وحداتٍ
 * محجوزةٍ؟**
 */

import { describe, expect, it } from "vitest";

import {
  INVENTORY_CONFLICT_DISMISSALS,
  INVENTORY_CONFLICT_KINDS,
  assessInventoryConflict,
  type ActiveReservationLine,
} from "../domain/inventory-conflict.js";
import type { InventoryAdjustedData } from "../domain/marketplace-inventory-events.js";

const STORE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PRODUCT_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const ADJUSTMENT_ID = "cccccccc-0000-0000-0000-000000000003";
const DETECTED_AT = "2026-09-12T02:30:00.000Z";

function adjustment(overrides: Partial<InventoryAdjustedData> = {}): InventoryAdjustedData {
  return {
    adjustment_id: ADJUSTMENT_ID,
    product_id: PRODUCT_ID,
    store_id: STORE_ID,
    quantity_delta: -3,
    quantity_after: 4,
    reason_code: "correction",
    adjustment_sequence: 7,
    actor_public_id: "WS-0000000123",
    occurred_for: "2026-09-12T02:29:59.000Z",
    ...overrides,
  } as InventoryAdjustedData;
}

function line(overrides: Partial<ActiveReservationLine> = {}): ActiveReservationLine {
  return {
    orderId: "dddddddd-0000-0000-0000-000000000004",
    orderPublicId: "SO-0000000042",
    quantityReserved: 2,
    ...overrides,
  };
}

describe("assessInventoryConflict — الرفضُ قبلَ الرايةِ", () => {
  it("لا حجزَ نشطاً ⇒ لا رايةَ بمفردةِ `no_active_reservation`", () => {
    const verdict = assessInventoryConflict({
      adjustment: adjustment({ reason_code: "shrinkage", quantity_after: 0 }),
      activeReservations: [],
      detectedAt: DETECTED_AT,
    });

    expect(verdict.conflict).toBe(false);
    if (verdict.conflict) throw new Error("unreachable");
    expect(verdict.dismissedBecause).toBe("no_active_reservation");
  });

  it("`reservation` أثرُنا نفسُهُ ⇒ لا رايةَ ولو صارَ الرصيدُ صفراً", () => {
    // هذا هوَ الطلبُ السليمُ الذي كانت القاعدةُ الساذجةُ ستُطلِقُ عليهِ رايةً:
    // ثلاثُ وحداتٍ · ثلاثةٌ محجوزةٌ · `quantity_after = 0`.
    const verdict = assessInventoryConflict({
      adjustment: adjustment({ reason_code: "reservation", quantity_delta: -3, quantity_after: 0 }),
      activeReservations: [line({ quantityReserved: 3 })],
      detectedAt: DETECTED_AT,
    });

    expect(verdict.conflict).toBe(false);
    if (verdict.conflict) throw new Error("unreachable");
    expect(verdict.dismissedBecause).toBe("delivery_own_reservation_flow");
  });

  it("`reservation_release` كذلكَ — الإفراجُ أثرُنا لا خطرٌ علينا", () => {
    const verdict = assessInventoryConflict({
      adjustment: adjustment({ reason_code: "reservation_release", quantity_delta: -1 }),
      activeReservations: [line()],
      detectedAt: DETECTED_AT,
    });

    expect(verdict.conflict).toBe(false);
    if (verdict.conflict) throw new Error("unreachable");
    expect(verdict.dismissedBecause).toBe("delivery_own_reservation_flow");
  });

  it("زيادةٌ ⇒ `quantity_increase` — لا وحدةَ محجوزةً يُشكِّكُ فيها إعادةُ تخزينٍ", () => {
    const verdict = assessInventoryConflict({
      adjustment: adjustment({ reason_code: "restock", quantity_delta: 20, quantity_after: 24 }),
      activeReservations: [line()],
      detectedAt: DETECTED_AT,
    });

    expect(verdict.conflict).toBe(false);
    if (verdict.conflict) throw new Error("unreachable");
    expect(verdict.dismissedBecause).toBe("quantity_increase");
  });

  it("نزولٌ بسببٍ غيرِ مُشكِّكٍ ⇒ `reason_not_conflicting`", () => {
    // `initial_stock` سالباً حالةٌ لا يُنتِجُها السوقُ عملاً، والقرارُ مع ذلكَ
    // مُصرَّحٌ: القائمةُ **مغلقةٌ إيجاباً** لا مفتوحةٌ بالاستثناءِ، فسببٌ جديدٌ
    // يُضيفُهُ السوقُ غداً لا يرفعُ رايةً حتّى نقرِّرَ نحنُ أنَّهُ يرفعُها.
    const verdict = assessInventoryConflict({
      adjustment: adjustment({ reason_code: "initial_stock", quantity_delta: -2 }),
      activeReservations: [line()],
      detectedAt: DETECTED_AT,
    });

    expect(verdict.conflict).toBe(false);
    if (verdict.conflict) throw new Error("unreachable");
    expect(verdict.dismissedBecause).toBe("reason_not_conflicting");
  });

  it("ترتيبُ الرفضِ جزءٌ من العقدِ: لا حجزَ + سببٌ غيرُ مُشكِّكٍ ⇒ `no_active_reservation`", () => {
    // الحالةُ تنطبقُ عليها مفردتانِ؛ والمفردةُ المُعلَنةُ هيَ الأولى في الترتيبِ.
    const verdict = assessInventoryConflict({
      adjustment: adjustment({ reason_code: "restock", quantity_delta: 5 }),
      activeReservations: [],
      detectedAt: DETECTED_AT,
    });

    expect(verdict.conflict).toBe(false);
    if (verdict.conflict) throw new Error("unreachable");
    expect(verdict.dismissedBecause).toBe("no_active_reservation");
  });
});

describe("assessInventoryConflict — الرايةُ وأنواعُها الثلاثةُ", () => {
  it("`correction` تُبقي وسادةً ⇒ `downward_correction_while_reserved`", () => {
    const verdict = assessInventoryConflict({
      adjustment: adjustment({ reason_code: "correction", quantity_delta: -3, quantity_after: 4 }),
      activeReservations: [line({ quantityReserved: 2 })],
      detectedAt: DETECTED_AT,
    });

    expect(verdict.conflict).toBe(true);
    if (!verdict.conflict) throw new Error("unreachable");
    expect(verdict.report.kind).toBe("downward_correction_while_reserved");
    expect(verdict.report.reasonCode).toBe("correction");
  });

  it("`shrinkage` مع وسادةٍ ⇒ `shrinkage_while_reserved`", () => {
    const verdict = assessInventoryConflict({
      adjustment: adjustment({ reason_code: "shrinkage", quantity_delta: -1, quantity_after: 2 }),
      activeReservations: [line()],
      detectedAt: DETECTED_AT,
    });

    expect(verdict.conflict).toBe(true);
    if (!verdict.conflict) throw new Error("unreachable");
    expect(verdict.report.kind).toBe("shrinkage_while_reserved");
  });

  it("الصفرُ يسبقُ السببَ: `shrinkage` إلى صفرٍ ⇒ `stock_zeroed_while_reserved` والسببُ محفوظٌ", () => {
    const verdict = assessInventoryConflict({
      adjustment: adjustment({ reason_code: "shrinkage", quantity_delta: -2, quantity_after: 0 }),
      activeReservations: [line()],
      detectedAt: DETECTED_AT,
    });

    expect(verdict.conflict).toBe(true);
    if (!verdict.conflict) throw new Error("unreachable");
    // الأشدُّ في الرأسِ…
    expect(verdict.report.kind).toBe("stock_zeroed_while_reserved");
    // …والأصلُ لم يُفقَدْ.
    expect(verdict.report.reasonCode).toBe("shrinkage");
  });

  it("`archive_zeroed` ⇒ رايةٌ بصفرٍ لا رفضٌ", () => {
    const verdict = assessInventoryConflict({
      adjustment: adjustment({ reason_code: "archive_zeroed", quantity_delta: -6, quantity_after: 0 }),
      activeReservations: [line({ quantityReserved: 6 })],
      detectedAt: DETECTED_AT,
    });

    expect(verdict.conflict).toBe(true);
    if (!verdict.conflict) throw new Error("unreachable");
    expect(verdict.report.kind).toBe("stock_zeroed_while_reserved");
    expect(verdict.report.reasonCode).toBe("archive_zeroed");
  });

  it("`correction` إلى صفرٍ ⇒ الصفرُ يسبقُ كذلكَ", () => {
    const verdict = assessInventoryConflict({
      adjustment: adjustment({ reason_code: "correction", quantity_delta: -4, quantity_after: 0 }),
      activeReservations: [line()],
      detectedAt: DETECTED_AT,
    });

    expect(verdict.conflict).toBe(true);
    if (!verdict.conflict) throw new Error("unreachable");
    expect(verdict.report.kind).toBe("stock_zeroed_while_reserved");
  });
});

describe("assessInventoryConflict — الأرقامُ في التقريرِ", () => {
  it("ثلاثةُ طلباتٍ ⇒ عددٌ ومجموعٌ ومراجعُ مرتَّبةٌ، والحقولُ منقولةٌ من الفرقِ", () => {
    const verdict = assessInventoryConflict({
      adjustment: adjustment({
        reason_code: "shrinkage",
        quantity_delta: -5,
        quantity_after: 1,
        adjustment_sequence: 19,
      }),
      activeReservations: [
        line({ orderId: "o-3", orderPublicId: "SO-0000000300", quantityReserved: 1 }),
        line({ orderId: "o-1", orderPublicId: "SO-0000000100", quantityReserved: 4 }),
        line({ orderId: "o-2", orderPublicId: "SO-0000000200", quantityReserved: 2 }),
      ],
      detectedAt: DETECTED_AT,
    });

    expect(verdict.conflict).toBe(true);
    if (!verdict.conflict) throw new Error("unreachable");
    const report = verdict.report;
    expect(report.affectedOrderCount).toBe(3);
    expect(report.affectedUnitsTotal).toBe(7);
    // مرتَّبةٌ لا بترتيبِ المُدخَلِ — سطرٌ قابلٌ للمقارنةِ بينَ تسليمَينِ.
    expect(report.affectedOrderPublicIds).toEqual([
      "SO-0000000100",
      "SO-0000000200",
      "SO-0000000300",
    ]);
    expect(report.storeId).toBe(STORE_ID);
    expect(report.productId).toBe(PRODUCT_ID);
    expect(report.adjustmentId).toBe(ADJUSTMENT_ID);
    expect(report.adjustmentSequence).toBe(19);
    expect(report.quantityDelta).toBe(-5);
    expect(report.observedQuantityAfter).toBe(1);
    expect(report.detectedAt).toBe(DETECTED_AT);
  });

  it("صفّانِ لطلبٍ واحدٍ ⇒ عددُ الطلباتِ واحدٌ والمجموعُ يجمعُ الصفَّينِ", () => {
    // القيدُ `UNIQUE (order_id, product_id)` يمنعُ هذا اليومَ؛ والعَدُّ متمايزٌ رغمَ
    // ذلكَ لأنَّ أوّلَ توسيعٍ في الاستعلامِ يُعيدُ صفَّينِ، وعددٌ مضاعفٌ في رايةٍ
    // أسوأُ من لا رايةَ.
    const verdict = assessInventoryConflict({
      adjustment: adjustment({ reason_code: "correction", quantity_delta: -1 }),
      activeReservations: [
        line({ orderId: "o-1", orderPublicId: "SO-0000000100", quantityReserved: 2 }),
        line({ orderId: "o-1", orderPublicId: "SO-0000000100", quantityReserved: 3 }),
      ],
      detectedAt: DETECTED_AT,
    });

    expect(verdict.conflict).toBe(true);
    if (!verdict.conflict) throw new Error("unreachable");
    expect(verdict.report.affectedOrderCount).toBe(1);
    expect(verdict.report.affectedUnitsTotal).toBe(5);
    expect(verdict.report.affectedOrderPublicIds).toEqual(["SO-0000000100"]);
  });

  it("`changesOrderState` ثابتٌ `false` — تُعلِمُ ولا تحكُمُ", () => {
    const verdict = assessInventoryConflict({
      adjustment: adjustment({ reason_code: "archive_zeroed", quantity_delta: -9, quantity_after: 0 }),
      activeReservations: [line({ quantityReserved: 9 })],
      detectedAt: DETECTED_AT,
    });

    expect(verdict.conflict).toBe(true);
    if (!verdict.conflict) throw new Error("unreachable");
    expect(verdict.report.changesOrderState).toBe(false);
  });
});

describe("المفرداتُ المغلقةُ", () => {
  it("الأنواعُ ثلاثةٌ بأسمائِها — قائمةٌ يقرؤُها قيدُ `CHECK` في القاعدةِ", () => {
    expect([...INVENTORY_CONFLICT_KINDS]).toEqual([
      "stock_zeroed_while_reserved",
      "downward_correction_while_reserved",
      "shrinkage_while_reserved",
    ]);
  });

  it("مفرداتُ الرفضِ أربعٌ بترتيبِها — الترتيبُ هوَ ترتيبُ التقييمِ", () => {
    expect([...INVENTORY_CONFLICT_DISMISSALS]).toEqual([
      "no_active_reservation",
      "delivery_own_reservation_flow",
      "quantity_increase",
      "reason_not_conflicting",
    ]);
  });

  it("كلُّ نوعٍ يُنتَجُ فعلاً من مُدخَلٍ — لا نوعٌ ميتٌ في القائمةِ", () => {
    const produced = new Set<string>();
    const cases: readonly InventoryAdjustedData[] = [
      adjustment({ reason_code: "archive_zeroed", quantity_delta: -3, quantity_after: 0 }),
      adjustment({ reason_code: "correction", quantity_delta: -3, quantity_after: 5 }),
      adjustment({ reason_code: "shrinkage", quantity_delta: -3, quantity_after: 5 }),
    ];
    for (const adj of cases) {
      const verdict = assessInventoryConflict({
        adjustment: adj,
        activeReservations: [line()],
        detectedAt: DETECTED_AT,
      });
      if (verdict.conflict) produced.add(verdict.report.kind);
    }

    expect([...produced].sort()).toEqual([...INVENTORY_CONFLICT_KINDS].sort());
  });

  it("كلُّ مفردةِ رفضٍ تُنتَجُ فعلاً — ولا مفردةٌ ميتةٌ كذلكَ", () => {
    const produced = new Set<string>();
    const cases: readonly {
      readonly adjustment: InventoryAdjustedData;
      readonly reservations: readonly ActiveReservationLine[];
    }[] = [
      { adjustment: adjustment(), reservations: [] },
      { adjustment: adjustment({ reason_code: "reservation" }), reservations: [line()] },
      { adjustment: adjustment({ reason_code: "restock", quantity_delta: 4 }), reservations: [line()] },
      { adjustment: adjustment({ reason_code: "initial_stock", quantity_delta: -1 }), reservations: [line()] },
    ];
    for (const item of cases) {
      const verdict = assessInventoryConflict({
        adjustment: item.adjustment,
        activeReservations: item.reservations,
        detectedAt: DETECTED_AT,
      });
      if (!verdict.conflict) produced.add(verdict.dismissedBecause);
    }

    expect([...produced].sort()).toEqual([...INVENTORY_CONFLICT_DISMISSALS].sort());
  });
});
