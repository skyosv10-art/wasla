/**
 * اختباراتُ آلةِ حالةِ الوفاءِ — تُثبتُ **الحكمَ** لا الشكلَ:
 * ما لا جدولَ له مرفوضٌ، والفاعلُ جزءٌ من الجدولِ، والمنتهي لا يُغادَرُ.
 */
import { describe, expect, it } from "vitest";
import {
  FULFILMENT_STATES,
  type Actor,
  type Fulfilment,
  type FulfilmentState,
  isOrderRef,
  isStoreRef,
  isTerminal,
  isWaslaPublicId,
  isWellFormedActor,
} from "../domain/model.js";
import {
  allowedTransitions,
  transition,
  type TransitionCommand,
} from "../domain/state-machine.js";

const STORE: Actor = { kind: "store", ref: "WS-0000000001" };
const DRIVER: Actor = { kind: "driver", ref: "WS-0000000002" };
const CUSTOMER: Actor = { kind: "customer", ref: "WS-0000000003" };
const SYSTEM: Actor = { kind: "system", ref: null };
const OPERATOR: Actor = { kind: "operator", ref: "WS-0000000009" };

function base(overrides: Partial<Fulfilment> = {}): Fulfilment {
  return {
    fulfilment_ref: "WS-1000000001",
    order_ref: "ORD-1000000002",
    store_ref: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    driver_ref: null,
    state: "requested",
    sequence: 0,
    failure_reason: null,
    ...overrides,
  };
}

function cmd(overrides: Partial<TransitionCommand> & Pick<TransitionCommand, "to" | "actor">): TransitionCommand {
  return { expected_sequence: 0, ...overrides };
}

describe("model", () => {
  it("المراجعُ المُعتِمةُ تُقبَلُ بصيغتِها وحدَها", () => {
    expect(isWaslaPublicId("WS-0000000001")).toBe(true);
    expect(isWaslaPublicId("WS-1")).toBe(false);
    expect(isWaslaPublicId("+966500000000")).toBe(false);
  });

  it("المرجعُ الأجنبيُّ بصيغةِ مالكِه لا بصيغتِنا — وإلّا لم يستوفِ العقدَ زوجٌ حقيقيٌّ", () => {
    // محرّكُ الطلبِ يُصدرُ ORD-، والسوقُ يُعرِّفُ المتجرَ بـUUID.
    expect(isOrderRef("ORD-1000000002")).toBe(true);
    expect(isOrderRef("WS-1000000002")).toBe(false);
    expect(isStoreRef("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
    expect(isStoreRef("WS-0000000001")).toBe(false);
  });

  it("`system` وحدَه بلا مرجعٍ، ومن سواه بمرجعٍ إجباراً", () => {
    expect(isWellFormedActor({ kind: "system", ref: null })).toBe(true);
    expect(isWellFormedActor({ kind: "system", ref: "WS-0000000001" })).toBe(false);
    expect(isWellFormedActor({ kind: "store", ref: null })).toBe(false);
    expect(isWellFormedActor({ kind: "store", ref: "WS-0000000001" })).toBe(true);
  });

  it("ثلاثُ حالاتٍ منتهيةٍ لا غيرُ", () => {
    const terminal = FULFILMENT_STATES.filter(isTerminal);
    expect(terminal).toEqual(["completed", "cancelled", "failed"]);
  });

  it("لا حالةَ خارجَ الجدولِ — كلُّ حالةٍ لها مدخلٌ", () => {
    for (const s of FULFILMENT_STATES) {
      expect(Array.isArray(allowedTransitions(s))).toBe(true);
    }
  });
});

describe("المسارُ السعيدُ الكاملُ", () => {
  it("شراءٌ ⇐ تجهيزٌ ⇐ إسنادٌ ⇐ التقاطٌ ⇐ تسليمٌ ⇐ إتمامٌ", () => {
    let f = base();
    const steps: Array<[FulfilmentState, Actor, Partial<TransitionCommand>]> = [
      ["accepted", STORE, {}],
      ["preparing", STORE, {}],
      ["ready_for_pickup", STORE, {}],
      ["assigned", SYSTEM, { driver_ref: "WS-0000000002" }],
      ["picked_up", DRIVER, {}],
      ["delivered", DRIVER, {}],
      ["completed", CUSTOMER, {}],
    ];
    for (const [to, actor, extra] of steps) {
      const r = transition(f, { to, actor, expected_sequence: f.sequence, ...extra });
      expect(r.ok, `${f.state} ⇒ ${to}`).toBe(true);
      if (!r.ok) return;
      expect(r.transition.from_state).toBe(f.state);
      expect(r.transition.to_state).toBe(to);
      expect(r.transition.sequence).toBe(f.sequence + 1);
      f = r.next;
    }
    expect(f.state).toBe("completed");
    expect(f.sequence).toBe(7);
    expect(f.driver_ref).toBe("WS-0000000002");
  });
});

describe("ما لا جدولَ له مرفوضٌ", () => {
  it("قفزٌ من الطلبِ إلى التسليمِ يُرفَضُ", () => {
    const r = transition(base(), cmd({ to: "delivered", actor: DRIVER }));
    expect(r).toEqual({ ok: false, code: "DELIVERY_TRANSITION_NOT_ALLOWED" });
  });

  it("الرجوعُ إلى الخلفِ يُرفَضُ", () => {
    const r = transition(
      base({ state: "picked_up", sequence: 5, driver_ref: "WS-0000000002" }),
      cmd({ to: "preparing", actor: STORE, expected_sequence: 5 }),
    );
    expect(r).toEqual({ ok: false, code: "DELIVERY_TRANSITION_NOT_ALLOWED" });
  });

  it("المنتهي لا يُغادَرُ ولو كانَ الفاعلُ مشغّلاً", () => {
    for (const s of ["completed", "cancelled", "failed"] as const) {
      const r = transition(
        base({ state: s, sequence: 9, failure_reason: s === "completed" ? null : "operator_intervention" }),
        cmd({ to: "preparing", actor: OPERATOR, expected_sequence: 9 }),
      );
      expect(r).toEqual({ ok: false, code: "DELIVERY_TERMINAL_STATE" });
    }
  });
});

describe("الفاعلُ جزءٌ من الجدولِ لا من طبقةِ HTTP", () => {
  it("السائقُ لا يقبلُ الطلبَ نيابةً عن المتجرِ", () => {
    const r = transition(base(), cmd({ to: "accepted", actor: DRIVER }));
    expect(r).toEqual({ ok: false, code: "DELIVERY_ACTOR_NOT_PERMITTED" });
  });

  it("المتجرُ لا يُعلنُ الالتقاطَ نيابةً عن السائقِ", () => {
    const r = transition(
      base({ state: "assigned", sequence: 4, driver_ref: "WS-0000000002" }),
      cmd({ to: "picked_up", actor: STORE, expected_sequence: 4 }),
    );
    expect(r).toEqual({ ok: false, code: "DELIVERY_ACTOR_NOT_PERMITTED" });
  });

  it("العميلُ لا يُلغي بعدَ التجهيزِ — المشغّلُ وحدَه", () => {
    const f = base({ state: "preparing", sequence: 3 });
    const byCustomer = transition(
      f,
      cmd({ to: "cancelled", actor: CUSTOMER, expected_sequence: 3, failure_reason: "customer_cancelled" }),
    );
    expect(byCustomer).toEqual({ ok: false, code: "DELIVERY_ACTOR_NOT_PERMITTED" });
    const byOperator = transition(
      f,
      cmd({ to: "cancelled", actor: OPERATOR, expected_sequence: 3, failure_reason: "operator_intervention" }),
    );
    expect(byOperator.ok).toBe(true);
  });
});

describe("سطرُ التدقيقِ يجبُ أن يُجيبَ: من فعلَ هذا؟", () => {
  it("متجرٌ بلا مرجعٍ يُرفَضُ ولو كانَ الانتقالُ مسموحاً", () => {
    const r = transition(base(), cmd({ to: "accepted", actor: { kind: "store", ref: null } }));
    expect(r).toEqual({ ok: false, code: "DELIVERY_ACTOR_REF_INVALID" });
  });

  it("`system` بمرجعِ شخصٍ يُرفَضُ — لا يُنسَبُ إلى إنسانٍ فعلٌ لم يفعلْه", () => {
    const r = transition(
      base({ state: "ready_for_pickup", sequence: 3 }),
      cmd({
        to: "assigned",
        actor: { kind: "system", ref: "WS-0000000009" },
        expected_sequence: 3,
        driver_ref: "WS-0000000002",
      }),
    );
    expect(r).toEqual({ ok: false, code: "DELIVERY_ACTOR_REF_INVALID" });
  });
});

describe("السائقُ والسببُ: حضورٌ إجباريٌّ وغيابٌ إجباريٌّ", () => {
  it("الإسنادُ بلا سائقٍ يُرفَضُ", () => {
    const r = transition(
      base({ state: "ready_for_pickup", sequence: 3 }),
      cmd({ to: "assigned", actor: SYSTEM, expected_sequence: 3 }),
    );
    expect(r).toEqual({ ok: false, code: "DELIVERY_DRIVER_REQUIRED" });
  });

  it("سائقٌ يُمرَّرُ في انتقالٍ لا يعنيه يُرفَضُ", () => {
    const r = transition(
      base({ state: "requested" }),
      cmd({ to: "accepted", actor: STORE, driver_ref: "WS-0000000002" }),
    );
    expect(r).toEqual({ ok: false, code: "DELIVERY_DRIVER_NOT_EXPECTED" });
  });

  it("سقوطُ الإسنادِ يُعيدُ الانتظارَ ويَنزعُ السائقَ — لا يُلغي شحنةً جُهِّزت", () => {
    const r = transition(
      base({ state: "assigned", sequence: 4, driver_ref: "WS-0000000002" }),
      cmd({ to: "ready_for_pickup", actor: SYSTEM, expected_sequence: 4 }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next.driver_ref).toBeNull();
    expect(r.next.state).toBe("ready_for_pickup");
  });

  it("الإخفاقُ بلا سببٍ مرفوضٌ، والنجاحُ بسببٍ مرفوضٌ", () => {
    const noReason = transition(base(), cmd({ to: "failed", actor: SYSTEM }));
    expect(noReason).toEqual({ ok: false, code: "DELIVERY_REASON_REQUIRED" });

    const extraReason = transition(
      base(),
      cmd({ to: "accepted", actor: STORE, failure_reason: "out_of_stock" }),
    );
    expect(extraReason).toEqual({ ok: false, code: "DELIVERY_REASON_NOT_EXPECTED" });
  });
});

describe("التسلسلُ يمنعُ الكتابةَ المتزامنةَ", () => {
  it("تسلسلٌ متقادمٌ يُرفَضُ قبلَ أيِّ حكمٍ آخرَ", () => {
    const r = transition(
      base({ state: "requested", sequence: 2 }),
      cmd({ to: "accepted", actor: STORE, expected_sequence: 1 }),
    );
    expect(r).toEqual({ ok: false, code: "DELIVERY_SEQUENCE_CONFLICT" });
  });

  it("كلُّ انتقالٍ ناجحٍ يزيدُ التسلسلَ واحداً", () => {
    const r = transition(base(), cmd({ to: "accepted", actor: STORE }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next.sequence).toBe(1);
  });
});

describe("لا مالَ ولا بياناً شخصيّاً في نواةِ المجالِ", () => {
  it("مفاتيحُ الشحنةِ مغلقةٌ ولا تحملُ مبلغاً ولا اسماً", () => {
    const r = transition(base(), cmd({ to: "accepted", actor: STORE }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.next).sort()).toEqual(
      [
        "driver_ref",
        "failure_reason",
        "fulfilment_ref",
        "order_ref",
        "sequence",
        "state",
        "store_ref",
      ].sort(),
    );
  });
});
