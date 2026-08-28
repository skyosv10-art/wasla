/**
 * حرسُ التزامنِ: **الدفترُ حقيقةٌ، والإسقاطُ دعوى** — وهذا الملفُّ يقيس الفرقَ بينهما.
 *
 * ولمَ ملفٌّ منفصلٌ عن `inventory.test.ts`؟ لأنّ ذاك يفحص **بناءَ** الرصيدِ من دفترٍ (وهو
 * سؤالُ صحّةِ الدفترِ في نفسِه)، وهذا يفحص **مقارنةَ** الدفترِ بعمودٍ مُشتَقٍّ مكتوبٍ في جدولٍ
 * آخر (وهو سؤالُ صحّةِ المُهاجرةِ والمعاملةِ). والسؤالان يسقطان لأسبابٍ مختلفةٍ تماماً: الأوّلُ
 * لعطبٍ في الكتابة، والثاني لمعاملةٍ لم تُغلق أو إسقاطٍ كُتب خارجَها.
 */
import { describe, expect, it } from "vitest";

import { MarketplaceError } from "../domain/errors.js";
import { reconcileInventory } from "../domain/inventory.js";
import type { InventoryAdjustmentEntry } from "../domain/model.js";

const ACTOR = "WS-0000000123";
const AT = "2026-03-01T10:00:00.000Z";

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
    occurredAt: AT,
  };
}

const LEDGER = Object.freeze([
  entry(1, 20, 20, "initial_stock"),
  entry(2, -5, 15, "shrinkage"),
  entry(3, 10, 25),
]);

describe("دفترٌ يطابق إسقاطَه", () => {
  it("لا انحرافَ في الرصيدِ ولا في العدد، فـ`inSync` صحيحة", () => {
    expect(reconcileInventory({ ledger: LEDGER, projectedQuantity: 25, projectedSequence: 3 })).toEqual({
      ledgerQuantity: 25,
      ledgerSequence: 3,
      projectedQuantity: 25,
      projectedSequence: 3,
      quantityDrift: 0,
      sequenceDrift: 0,
      inSync: true,
    });
  });

  it("ودفترٌ فارغٌ مع إسقاطٍ صفريٍّ متزامنٌ — لا حالةٌ خاصّةٌ تُستثنى", () => {
    const audit = reconcileInventory({ ledger: [], projectedQuantity: 0, projectedSequence: 0 });
    expect(audit.inSync).toBe(true);
    expect(audit.ledgerQuantity).toBe(0);
    expect(audit.ledgerSequence).toBe(0);
  });
});

describe("الانحرافُ يُقاس مُوقَّعاً لا مُطلَقاً", () => {
  it("إسقاطٌ يزيد على الدفترِ: انحرافٌ موجَبٌ يعني كتابةً لا سطرَ لها", () => {
    const audit = reconcileInventory({ ledger: LEDGER, projectedQuantity: 30, projectedSequence: 3 });
    expect(audit.quantityDrift).toBe(5);
    expect(audit.inSync).toBe(false);
  });

  it("وإسقاطٌ ينقص عن الدفترِ: انحرافٌ سالبٌ يعني سطراً لم يصل إلى الإسقاط", () => {
    const audit = reconcileInventory({ ledger: LEDGER, projectedQuantity: 15, projectedSequence: 2 });
    expect(audit.quantityDrift).toBe(-10);
    expect(audit.sequenceDrift).toBe(-1);
    expect(audit.inSync).toBe(false);
  });

  it("والاتّجاهُ يُقرأ من الإشارةِ: الفرقُ `إسقاطٌ − دفترٌ` لا العكس", () => {
    const ahead = reconcileInventory({ ledger: LEDGER, projectedQuantity: 26, projectedSequence: 4 });
    const behind = reconcileInventory({ ledger: LEDGER, projectedQuantity: 24, projectedSequence: 2 });
    expect([ahead.quantityDrift, ahead.sequenceDrift]).toEqual([1, 1]);
    expect([behind.quantityDrift, behind.sequenceDrift]).toEqual([-1, -1]);
  });
});

describe("الشاهدان معاً: رصيدٌ وعدد", () => {
  /**
   * هذا هو الاختبارُ الذي يُبرّر وجودَ `sequenceDrift` أصلاً: لو قِيس الرصيدُ وحدَه لمرّ
   * إسقاطٌ فقد سطرَين متعادلَين (`+5` ثمّ `-5`) بوصفِه متزامناً. فالحارسُ الذي يقيس شاهداً
   * واحداً كان سيقول «سليمٌ» عن إسقاطٍ ناقصٍ سطرَين — وهو أسوأُ من غيابِ الحارس.
   */
  it("انحرافٌ متعادلٌ في الرصيدِ يُكشَف بالعدد", () => {
    const audit = reconcileInventory({ ledger: LEDGER, projectedQuantity: 25, projectedSequence: 1 });
    expect(audit.quantityDrift).toBe(0);
    expect(audit.sequenceDrift).toBe(-2);
    expect(audit.inSync).toBe(false);
  });

  it("وانحرافٌ في الرصيدِ بعددٍ مطابقٍ يُكشَف بالرصيد", () => {
    const audit = reconcileInventory({ ledger: LEDGER, projectedQuantity: 99, projectedSequence: 3 });
    expect(audit.sequenceDrift).toBe(0);
    expect(audit.quantityDrift).toBe(74);
    expect(audit.inSync).toBe(false);
  });
});

describe("دفترٌ متناقضٌ في نفسِه يُرفَع لا يُقاس", () => {
  it("ثغرةٌ في التسلسلِ: استثناءٌ لا حُكمُ انحراف", () => {
    expect(() =>
      reconcileInventory({ ledger: [entry(2, 5, 5)], projectedQuantity: 5, projectedSequence: 1 }),
    ).toThrowError(MarketplaceError);
  });

  it("ورصيدٌ لا يتّفق مع الجمعِ الجاري: استثناءٌ كذلك", () => {
    expect(() =>
      reconcileInventory({
        ledger: [entry(1, 10, 12)],
        projectedQuantity: 12,
        projectedSequence: 1,
      }),
    ).toThrowError(MarketplaceError);
  });
});

describe("إسقاطٌ مُخالفٌ للعقدِ مرفوضٌ قبلَ القياس", () => {
  it("رصيدٌ سالبٌ في الإسقاطِ لا يُقاس: العقدُ يمنعه أصلاً", () => {
    expect(() =>
      reconcileInventory({ ledger: LEDGER, projectedQuantity: -1, projectedSequence: 3 }),
    ).toThrowError(MarketplaceError);
  });

  it("وتسلسلٌ سالبٌ أو كسريٌّ مرفوضٌ — والصفرُ مقبولٌ لأنّه حالةُ منتَجٍ بلا فرق", () => {
    expect(() =>
      reconcileInventory({ ledger: LEDGER, projectedQuantity: 25, projectedSequence: -1 }),
    ).toThrowError(MarketplaceError);
    expect(() =>
      reconcileInventory({ ledger: LEDGER, projectedQuantity: 25, projectedSequence: 1.5 }),
    ).toThrowError(MarketplaceError);
    expect(
      reconcileInventory({ ledger: [], projectedQuantity: 0, projectedSequence: 0 }).inSync,
    ).toBe(true);
  });
});

describe("الدالّةُ صرفةٌ: لا تلمس ما أُعطيت", () => {
  it("الدفترُ المُمرَّرُ لا يتغيّر، والحُكمُ المُعادُ لا يحمل مرجعاً إليه", () => {
    const before = JSON.stringify(LEDGER);
    const audit = reconcileInventory({ ledger: LEDGER, projectedQuantity: 25, projectedSequence: 3 });
    expect(JSON.stringify(LEDGER)).toBe(before);
    expect(Object.values(audit).every((value) => typeof value === "number" || typeof value === "boolean")).toBe(
      true,
    );
  });

  it("ونداءان بنفسِ المُدخلِ يُعطيان نفسَ الحُكمِ حرفاً", () => {
    const input = { ledger: LEDGER, projectedQuantity: 20, projectedSequence: 2 } as const;
    expect(reconcileInventory(input)).toEqual(reconcileInventory(input));
  });
});
