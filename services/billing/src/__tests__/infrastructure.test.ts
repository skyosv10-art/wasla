import { describe, it, expect } from "vitest";
import { InMemoryInvoiceStore } from "../ports.js";
import { createInvoice, transitionInvoice, recordPayment } from "../domain/model.js";
import { validateStateTransition, validatePaymentAllowed, validateVoidAllowed } from "../infrastructure/constraints.js";


describe("infrastructure — in-memory invoice store", () => {
  const store = new InMemoryInvoiceStore();
  const now = new Date("2026-09-26T12:00:00Z");

  it("saves and retrieves an invoice", async () => {
    const invoice = createInvoice({
      id: "INV-000000001",
      store_public_id: "WS-000000001",
      period: "2026-09",
      fee_type: "store_fixed",
      amount_cents: 50000,
      now,
    });
    await store.save(invoice);

    const found = await store.findById("INV-000000001");
    expect(found).not.toBeNull();
    expect(found?.id).toBe("INV-000000001");
    expect(found?.state).toBe("draft");
  });

  it("returns null for unknown invoice", async () => {
    const found = await store.findById("INV-999999999");
    expect(found).toBeNull();
  });

  it("lists invoices by store with pagination", async () => {
    const store2 = new InMemoryInvoiceStore();
    for (let i = 1; i <= 5; i++) {
      const inv = createInvoice({
        id: `INV-PAG-${i}`,
        store_public_id: "WS-PAG-001",
        period: "2026-09",
        fee_type: "store_fixed",
        amount_cents: 10000 * i,
        now: new Date(2026, 8, 26, 12, i),
      });
      await store2.save(inv);
    }

    const page1 = await store2.findByStore("WS-PAG-001", 2);
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await store2.findByStore("WS-PAG-001", 2, page1.nextCursor!);
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = await store2.findByStore("WS-PAG-001", 2, page2.nextCursor!);
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();
  });

  it("updates an existing invoice (upsert)", async () => {
    const store3 = new InMemoryInvoiceStore();
    const invoice = createInvoice({
      id: "INV-UPS-001",
      store_public_id: "WS-UPS-001",
      period: "2026-09",
      fee_type: "store_fixed",
      amount_cents: 50000,
      now,
    });
    await store3.save(invoice);

    const issued = transitionInvoice(invoice, "issued", now);
    await store3.save(issued);

    const found = await store3.findById("INV-UPS-001");
    expect(found?.state).toBe("issued");
  });

  it("records payment and persists paid state", async () => {
    const store4 = new InMemoryInvoiceStore();
    const invoice = createInvoice({
      id: "INV-PAY-001",
      store_public_id: "WS-PAY-001",
      period: "2026-09",
      fee_type: "store_variable",
      amount_cents: 30000,
      now,
    });
    const issued = transitionInvoice(invoice, "issued", now);
    const paid = recordPayment(issued, 30000, "tap_ref_123", now);
    await store4.save(paid);

    const found = await store4.findById("INV-PAY-001");
    expect(found?.state).toBe("paid");
    expect(found?.paid_amount_cents).toBe(30000);
    expect(found?.payment_ref).toBe("tap_ref_123");
  });
});

describe("infrastructure — constraint validators", () => {
  it("allows valid state transition", () => {
    expect(() => validateStateTransition("draft", "issued")).not.toThrow();
  });

  it("rejects invalid state transition", () => {
    expect(() => validateStateTransition("draft", "paid")).toThrow("Invalid");
  });

  it("allows payment in issued state", () => {
    expect(() => validatePaymentAllowed("issued")).not.toThrow();
  });

  it("rejects payment in draft state", () => {
    expect(() => validatePaymentAllowed("draft")).toThrow("Invalid");
  });

  it("allows void from paid", () => {
    expect(() => validateVoidAllowed("paid")).not.toThrow();
  });

  it("rejects void from closed", () => {
    expect(() => validateVoidAllowed("closed")).toThrow("Invalid");
  });
});
