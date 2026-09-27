import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { createBillingApp } from "../http/app.js";
import {
  InMemoryInvoiceStore,
  InMemoryPaymentGateway,
  InMemoryEventPublisher,
  InMemorySettlement,
} from "../ports.js";

function buildApp(): FastifyInstance {
  return createBillingApp({
    store: new InMemoryInvoiceStore(),
    settlements: new InMemorySettlement(),
    paymentGateway: new InMemoryPaymentGateway(),
    publisher: new InMemoryEventPublisher(),
  });
}

describe("billing HTTP — health", () => {
  it("returns 200 on /billing/health", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/billing/health" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("ok");
    expect(body.service).toBe("billing");
    expect(body.port).toBe(8096);
  });
});

describe("billing HTTP — create invoice", () => {
  it("creates an invoice and returns 201", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/billing/invoices",
      payload: {
        store_public_id: "WS-000000001",
        period: "2026-09",
        fee_type: "store_fixed",
        amount_cents: 50000,
      },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.state).toBe("draft");
    expect(body.store_public_id).toBe("WS-000000001");
    expect(body.amount_cents).toBe(50000);
  });

  it("rejects missing fields with 422", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/billing/invoices",
      payload: { store_public_id: "WS-000000001" },
    });
    expect(response.statusCode).toBe(422);
  });

  it("rejects non-positive amount with 422", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/billing/invoices",
      payload: {
        store_public_id: "WS-000000001",
        period: "2026-09",
        fee_type: "store_fixed",
        amount_cents: 0,
      },
    });
    expect(response.statusCode).toBe(422);
  });
});

describe("billing HTTP — get invoice", () => {
  it("returns 404 for unknown invoice", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/billing/invoices/INV-999999999",
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns invoice by id", async () => {
    const app = buildApp();
    const create = await app.inject({
      method: "POST",
      url: "/billing/invoices",
      payload: {
        store_public_id: "WS-000000001",
        period: "2026-09",
        fee_type: "store_fixed",
        amount_cents: 50000,
      },
    });
    const { id } = JSON.parse(create.body);

    const response = await app.inject({
      method: "GET",
      url: `/billing/invoices/${id}`,
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).id).toBe(id);
  });
});

describe("billing HTTP — list invoices", () => {
  it("requires store_public_id query param", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/billing/invoices",
    });
    expect(response.statusCode).toBe(422);
  });

  it("lists invoices by store", async () => {
    const app = buildApp();
    await app.inject({
      method: "POST",
      url: "/billing/invoices",
      payload: {
        store_public_id: "WS-LIST-001",
        period: "2026-09",
        fee_type: "store_fixed",
        amount_cents: 10000,
      },
    });
    await app.inject({
      method: "POST",
      url: "/billing/invoices",
      payload: {
        store_public_id: "WS-LIST-001",
        period: "2026-09",
        fee_type: "store_variable",
        amount_cents: 20000,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/billing/invoices?store_public_id=WS-LIST-001",
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.items).toHaveLength(2);
  });
});

describe("billing HTTP — issue invoice", () => {
  it("transitions draft → issued", async () => {
    const app = buildApp();
    const create = await app.inject({
      method: "POST",
      url: "/billing/invoices",
      payload: {
        store_public_id: "WS-ISSUE-001",
        period: "2026-09",
        fee_type: "store_fixed",
        amount_cents: 50000,
      },
    });
    const { id } = JSON.parse(create.body);

    const response = await app.inject({
      method: "POST",
      url: `/billing/invoices/${id}/issue`,
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).state).toBe("issued");
  });
});

describe("billing HTTP — record payment", () => {
  it("records payment and transitions to paid", async () => {
    const app = buildApp();
    const create = await app.inject({
      method: "POST",
      url: "/billing/invoices",
      payload: {
        store_public_id: "WS-PAY-001",
        period: "2026-09",
        fee_type: "store_fixed",
        amount_cents: 30000,
      },
    });
    const { id } = JSON.parse(create.body);

    await app.inject({ method: "POST", url: `/billing/invoices/${id}/issue` });

    const response = await app.inject({
      method: "POST",
      url: `/billing/invoices/${id}/payment`,
      payload: { amount_cents: 30000, payment_ref: "tap_ref_123" },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).state).toBe("paid");
  });

  it("rejects payment on draft invoice", async () => {
    const app = buildApp();
    const create = await app.inject({
      method: "POST",
      url: "/billing/invoices",
      payload: {
        store_public_id: "WS-PAY-002",
        period: "2026-09",
        fee_type: "store_fixed",
        amount_cents: 30000,
      },
    });
    const { id } = JSON.parse(create.body);

    const response = await app.inject({
      method: "POST",
      url: `/billing/invoices/${id}/payment`,
      payload: { amount_cents: 30000, payment_ref: "tap_ref_123" },
    });
    expect(response.statusCode).toBe(409);
  });
});

describe("billing HTTP — void invoice", () => {
  it("voids a draft invoice", async () => {
    const app = buildApp();
    const create = await app.inject({
      method: "POST",
      url: "/billing/invoices",
      payload: {
        store_public_id: "WS-VOID-001",
        period: "2026-09",
        fee_type: "store_fixed",
        amount_cents: 50000,
      },
    });
    const { id } = JSON.parse(create.body);

    const response = await app.inject({
      method: "POST",
      url: `/billing/invoices/${id}/void`,
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).state).toBe("void");
  });
});

describe("billing HTTP — list settlements", () => {
  it("returns 200 with empty list when no settlements", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/billing/settlements",
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.items).toEqual([]);
    expect(body.next_cursor).toBeNull();
  });

  it("returns settlements after they are created", async () => {
    const settlements = new InMemorySettlement();
    await settlements.settle({
      invoice_id: "inv_001",
      fee_type: "store_variable",
      amount_cents: 2500,
      period: "2026-09",
    });
    // Rebuild app with the populated settlements
    const app2 = createBillingApp({
      store: new InMemoryInvoiceStore(),
      settlements,
      paymentGateway: new InMemoryPaymentGateway(),
      publisher: new InMemoryEventPublisher(),
    });
    const response = await app2.inject({
      method: "GET",
      url: "/billing/settlements",
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].invoice_id).toBe("inv_001");
    expect(body.items[0].fee_type).toBe("store_variable");
    expect(body.items[0].amount_cents).toBe(2500);
    expect(body.items[0].state).toBe("settled");
  });

  it("filters by state", async () => {
    const settlements = new InMemorySettlement();
    await settlements.settle({
      invoice_id: "inv_001",
      fee_type: "store_variable",
      amount_cents: 2500,
      period: "2026-09",
    });
    await settlements.settle({
      invoice_id: "inv_002",
      fee_type: "store_fixed",
      amount_cents: 5000,
      period: "2026-09",
    });
    const app = createBillingApp({
      store: new InMemoryInvoiceStore(),
      settlements,
      paymentGateway: new InMemoryPaymentGateway(),
      publisher: new InMemoryEventPublisher(),
    });
    const response = await app.inject({
      method: "GET",
      url: "/billing/settlements?state=settled",
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.items).toHaveLength(2);
    expect(body.items.every((s: { state: string }) => s.state === "settled")).toBe(true);
  });

  it("returns 422 when settlements not configured", async () => {
    const app = createBillingApp({
      store: new InMemoryInvoiceStore(),
      paymentGateway: new InMemoryPaymentGateway(),
      publisher: new InMemoryEventPublisher(),
    });
    const response = await app.inject({
      method: "GET",
      url: "/billing/settlements",
    });
    expect(response.statusCode).toBe(422);
  });
});
