/**
 * اختباراتُ العقدِ — تُثبتُ **ما لا يجوزُ أن يتسرَّبَ** لا مجرَّدَ وجودِ الأشكالِ.
 */
import { describe, expect, it } from "vitest";
import {
  DELIVERY_ACTOR_KINDS,
  DELIVERY_REF_PATTERNS,
  DELIVERY_EVENT_TYPES,
  DELIVERY_FAILURE_REASON_CODES,
  DELIVERY_STATES,
  type DeliveryStateChangedPayload,
} from "../index.js";

describe("عقودُ الوفاءِ", () => {
  it("عشرُ حالاتٍ لا غيرُ، بلا تكرارٍ", () => {
    expect(DELIVERY_STATES).toHaveLength(10);
    expect(new Set(DELIVERY_STATES).size).toBe(10);
  });

  it("لا حدثَ نيّةٍ ولا حدثَ مالٍ في قائمةِ الأحداثِ", () => {
    for (const t of DELIVERY_EVENT_TYPES) {
      expect(t).not.toMatch(/requested_by|will_|intent|payment|invoice|fee|price/);
    }
  });

  it("حمولةُ تغيُّرِ الحالةِ لا تحملُ مالاً ولا اسماً ولا هاتفاً ولا إحداثيّةً", () => {
    const payload: DeliveryStateChangedPayload = {
      fulfilment_ref: "WS-1000000001",
      order_ref: "ORD-1000000002",
      store_ref: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      driver_ref: null,
      from_state: "requested",
      to_state: "accepted",
      sequence: 1,
      actor_kind: "store",
      actor_ref: "WS-0000000001",
      failure_reason: null,
    };
    const forbidden = ["amount", "price", "fee", "currency", "total", "name", "phone", "lat", "lng", "address"];
    for (const key of Object.keys(payload)) {
      expect(forbidden).not.toContain(key);
    }
  });

  it("صيغةُ كلِّ مرجعٍ أجنبيٍّ صيغةُ مالكِه لا صيغتُنا", () => {
    expect(DELIVERY_REF_PATTERNS.order.test("ORD-1000000002")).toBe(true);
    expect(DELIVERY_REF_PATTERNS.order.test("WS-1000000002")).toBe(false);
    expect(DELIVERY_REF_PATTERNS.store.test("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
    expect(DELIVERY_REF_PATTERNS.store.test("WS-0000000001")).toBe(false);
    expect(DELIVERY_REF_PATTERNS.fulfilment.test("WS-1000000001")).toBe(true);
  });

  it("أصنافُ الفاعلينَ خمسةٌ وأسبابُ الإخفاقِ ثمانيةٌ — قوائمُ مغلقةٌ تُعَدُّ", () => {
    expect(DELIVERY_ACTOR_KINDS).toHaveLength(5);
    expect(DELIVERY_FAILURE_REASON_CODES).toHaveLength(8);
  });
});
