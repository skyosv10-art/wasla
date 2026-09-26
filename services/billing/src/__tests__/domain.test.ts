import { describe, it, expect } from "vitest";
import {
  INVOICE_STATES,
  INVOICE_TRANSITIONS,
  canTransition,
  nextStates,
  isTerminal,
  allowsPayment,
  allowsVoid,
  requiresSettlement,
  createInvoice,
  transitionInvoice,
  recordPayment,
} from "../domain/model.js";

describe("invoice states (ADR-050 §2)", () => {
  it("has exactly 6 states", () => {
    expect(INVOICE_STATES).toHaveLength(6);
  });

  it("includes all required states", () => {
    expect([...INVOICE_STATES]).toContain("draft");
    expect([...INVOICE_STATES]).toContain("issued");
    expect([...INVOICE_STATES]).toContain("paid");
    expect([...INVOICE_STATES]).toContain("partially_paid");
    expect([...INVOICE_STATES]).toContain("closed");
    expect([...INVOICE_STATES]).toContain("void");
  });
});

describe("invoice transitions (ADR-050 §2)", () => {
  it("has exactly 9 transitions", () => {
    expect(INVOICE_TRANSITIONS).toHaveLength(9);
  });

  it("allows draft → issued", () => {
    expect(canTransition("draft", "issued")).toBe(true);
  });

  it("allows issued → paid", () => {
    expect(canTransition("issued", "paid")).toBe(true);
  });

  it("allows issued → partially_paid", () => {
    expect(canTransition("issued", "partially_paid")).toBe(true);
  });

  it("allows partially_paid → paid", () => {
    expect(canTransition("partially_paid", "paid")).toBe(true);
  });

  it("allows paid → closed", () => {
    expect(canTransition("paid", "closed")).toBe(true);
  });

  it("allows void from draft, issued, partially_paid, paid", () => {
    expect(canTransition("draft", "void")).toBe(true);
    expect(canTransition("issued", "void")).toBe(true);
    expect(canTransition("partially_paid", "void")).toBe(true);
    expect(canTransition("paid", "void")).toBe(true);
  });

  it("forbids skipping (draft → paid)", () => {
    expect(canTransition("draft", "paid")).toBe(false);
  });

  it("forbids reverse transitions (paid → issued)", () => {
    expect(canTransition("paid", "issued")).toBe(false);
  });

  it("forbids void from closed", () => {
    expect(canTransition("closed", "void")).toBe(false);
  });

  it("forbids void from void", () => {
    expect(canTransition("void", "void")).toBe(false);
  });

  it("forbids same-state transitions", () => {
    for (const state of INVOICE_STATES) {
      expect(canTransition(state, state)).toBe(false);
    }
  });
});

describe("nextStates", () => {
  it("draft has 2 targets: issued, void", () => {
    expect(nextStates("draft")).toEqual(["issued", "void"]);
  });

  it("issued has 3 targets: paid, partially_paid, void", () => {
    expect(nextStates("issued")).toEqual(["paid", "partially_paid", "void"]);
  });

  it("partially_paid has 2 targets: paid, void", () => {
    expect(nextStates("partially_paid")).toEqual(["paid", "void"]);
  });

  it("paid has 2 targets: closed, void", () => {
    expect(nextStates("paid")).toEqual(["closed", "void"]);
  });

  it("closed is terminal", () => {
    expect(isTerminal("closed")).toBe(true);
  });

  it("void is terminal", () => {
    expect(isTerminal("void")).toBe(true);
  });
});

describe("allowsPayment (ADR-050 §4)", () => {
  it("allows payment in issued state", () => {
    expect(allowsPayment("issued")).toBe(true);
  });

  it("allows payment in partially_paid state", () => {
    expect(allowsPayment("partially_paid")).toBe(true);
  });

  it("forbids payment in draft state", () => {
    expect(allowsPayment("draft")).toBe(false);
  });

  it("forbids payment in paid state", () => {
    expect(allowsPayment("paid")).toBe(false);
  });

  it("forbids payment in closed state", () => {
    expect(allowsPayment("closed")).toBe(false);
  });

  it("forbids payment in void state", () => {
    expect(allowsPayment("void")).toBe(false);
  });
});

describe("allowsVoid (ADR-050 §2)", () => {
  it("allows void from draft", () => {
    expect(allowsVoid("draft")).toBe(true);
  });

  it("allows void from issued", () => {
    expect(allowsVoid("issued")).toBe(true);
  });

  it("allows void from partially_paid", () => {
    expect(allowsVoid("partially_paid")).toBe(true);
  });

  it("allows void from paid", () => {
    expect(allowsVoid("paid")).toBe(true);
  });

  it("forbids void from closed", () => {
    expect(allowsVoid("closed")).toBe(false);
  });

  it("forbids void from void", () => {
    expect(allowsVoid("void")).toBe(false);
  });
});

describe("requiresSettlement", () => {
  it("paid requires settlement before closing", () => {
    expect(requiresSettlement("paid")).toBe(true);
  });

  it("draft does not require settlement", () => {
    expect(requiresSettlement("draft")).toBe(false);
  });
});

describe("createInvoice", () => {
  const now = new Date("2026-09-26T12:00:00Z");

  it("creates an invoice in draft state", () => {
    const invoice = createInvoice({
      id: "INV-000000001",
      store_public_id: "WS-000000001",
      period: "2026-09",
      fee_type: "store_fixed",
      amount_cents: 50000,
      now,
    });

    expect(invoice.state).toBe("draft");
    expect(invoice.id).toBe("INV-000000001");
    expect(invoice.store_public_id).toBe("WS-000000001");
    expect(invoice.period).toBe("2026-09");
    expect(invoice.fee_type).toBe("store_fixed");
    expect(invoice.amount_cents).toBe(50000);
    expect(invoice.paid_amount_cents).toBe(0);
    expect(invoice.payment_ref).toBeNull();
    expect(invoice.created_at).toBe(now);
    expect(invoice.updated_at).toBe(now);
  });

  it("rejects zero amount", () => {
    expect(() =>
      createInvoice({
        id: "INV-000000001",
        store_public_id: "WS-000000001",
        period: "2026-09",
        fee_type: "store_fixed",
        amount_cents: 0,
        now,
      }),
    ).toThrow("amount_cents must be positive");
  });

  it("rejects negative amount", () => {
    expect(() =>
      createInvoice({
        id: "INV-000000001",
        store_public_id: "WS-000000001",
        period: "2026-09",
        fee_type: "store_fixed",
        amount_cents: -100,
        now,
      }),
    ).toThrow("amount_cents must be positive");
  });

  it("rejects empty store_public_id", () => {
    expect(() =>
      createInvoice({
        id: "INV-000000001",
        store_public_id: "",
        period: "2026-09",
        fee_type: "store_fixed",
        amount_cents: 50000,
        now,
      }),
    ).toThrow("store_public_id is required");
  });

  it("rejects empty period", () => {
    expect(() =>
      createInvoice({
        id: "INV-000000001",
        store_public_id: "WS-000000001",
        period: "",
        fee_type: "store_fixed",
        amount_cents: 50000,
        now,
      }),
    ).toThrow("period is required");
  });
});

describe("transitionInvoice", () => {
  const now = new Date("2026-09-26T12:00:00Z");

  it("transitions draft → issued", () => {
    const invoice = createInvoice({
      id: "INV-000000001",
      store_public_id: "WS-000000001",
      period: "2026-09",
      fee_type: "store_fixed",
      amount_cents: 50000,
      now,
    });

    const updated = transitionInvoice(invoice, "issued", now);
    expect(updated.state).toBe("issued");
  });

  it("rejects invalid transition draft → paid", () => {
    const invoice = createInvoice({
      id: "INV-000000001",
      store_public_id: "WS-000000001",
      period: "2026-09",
      fee_type: "store_fixed",
      amount_cents: 50000,
      now,
    });

    expect(() => transitionInvoice(invoice, "paid", now)).toThrow(
      "Invalid transition: draft → paid",
    );
  });
});

describe("recordPayment", () => {
  const now = new Date("2026-09-26T12:00:00Z");

  it("records full payment and transitions to paid", () => {
    const invoice = createInvoice({
      id: "INV-000000001",
      store_public_id: "WS-000000001",
      period: "2026-09",
      fee_type: "store_fixed",
      amount_cents: 50000,
      now,
    });
    const issued = transitionInvoice(invoice, "issued", now);

    const paid = recordPayment(issued, 50000, "tap_ref_123", now);
    expect(paid.state).toBe("paid");
    expect(paid.paid_amount_cents).toBe(50000);
    expect(paid.payment_ref).toBe("tap_ref_123");
  });

  it("records partial payment and transitions to partially_paid", () => {
    const invoice = createInvoice({
      id: "INV-000000001",
      store_public_id: "WS-000000001",
      period: "2026-09",
      fee_type: "store_fixed",
      amount_cents: 50000,
      now,
    });
    const issued = transitionInvoice(invoice, "issued", now);

    const partial = recordPayment(issued, 20000, "tap_ref_123", now);
    expect(partial.state).toBe("partially_paid");
    expect(partial.paid_amount_cents).toBe(20000);
  });

  it("completes payment from partially_paid", () => {
    const invoice = createInvoice({
      id: "INV-000000001",
      store_public_id: "WS-000000001",
      period: "2026-09",
      fee_type: "store_fixed",
      amount_cents: 50000,
      now,
    });
    const issued = transitionInvoice(invoice, "issued", now);
    const partial = recordPayment(issued, 20000, "tap_ref_123", now);

    const paid = recordPayment(partial, 30000, "tap_ref_456", now);
    expect(paid.state).toBe("paid");
    expect(paid.paid_amount_cents).toBe(50000);
  });

  it("rejects payment in draft state", () => {
    const invoice = createInvoice({
      id: "INV-000000001",
      store_public_id: "WS-000000001",
      period: "2026-09",
      fee_type: "store_fixed",
      amount_cents: 50000,
      now,
    });

    expect(() => recordPayment(invoice, 50000, "tap_ref_123", now)).toThrow(
      "Payment not allowed in state draft",
    );
  });

  it("rejects payment in paid state", () => {
    const invoice = createInvoice({
      id: "INV-000000001",
      store_public_id: "WS-000000001",
      period: "2026-09",
      fee_type: "store_fixed",
      amount_cents: 50000,
      now,
    });
    const issued = transitionInvoice(invoice, "issued", now);
    const paid = recordPayment(issued, 50000, "tap_ref_123", now);

    expect(() => recordPayment(paid, 10000, "tap_ref_456", now)).toThrow(
      "Payment not allowed in state paid",
    );
  });
});

describe("boundary — port 8096 uniqueness (ADR-050 §6)", () => {
  it("contracts define port 8096", async () => {
    const contracts = await import("@wasla/contracts-billing");
    expect(contracts.BILLING_SERVICE_PORT).toBe(8096);
  });
});
