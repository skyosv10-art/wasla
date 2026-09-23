/**
 * Admin route tests for M3-04 (customers admin routes).
 *
 * Tests GET /customers (list), GET /customers/:id (detail),
 * POST /customers/:id/suspend, POST /customers/:id/reinstate.
 *
 * Admin routes use adminScoped (no beneficiary), so the service token
 * is signed without onBehalfOfPublicId — unlike owner-scoped routes
 * where the beneficiary is derived from the URL path.
 */

import { describe, expect, it } from "vitest";

import { CUSTOMER, OTHER_CUSTOMER, makeContext, seedProfile } from "../helpers.js";
import {
  buildSignedCustomerApp,
  signFor,
  type CustomerAppHarness,
} from "../service-identity-support.js";

async function harness(): Promise<CustomerAppHarness> {
  const ctx = makeContext();
  await seedProfile(ctx);
  return buildSignedCustomerApp({ deps: ctx });
}

/** Sign an admin call — no beneficiary, explicit admin scopes. */
function adminSign(
  method: string,
  url: string,
  harness: CustomerAppHarness,
): Record<string, string> {
  return signFor(method, url, {
    keys: harness.keys,
    scopes: [
      "customers:admin:read",
      "customers:admin:suspend",
      "customers:admin:reinstate",
    ],
    onBehalfOfPublicId: null,
  });
}

describe("GET /customers (admin list)", () => {
  it("returns empty list when no profiles exist", async () => {
    const h = buildSignedCustomerApp({ deps: makeContext() });
    const response = await h.app.inject({
      method: "GET",
      url: "/customers",
      headers: adminSign("GET", "/customers", h),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.customers).toEqual([]);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  it("returns seeded customers", async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: "GET",
      url: "/customers",
      headers: adminSign("GET", "/customers", h),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.customers).toHaveLength(1);
    expect(body.customers[0].wasla_public_id).toBe(CUSTOMER);
    expect(body.customers[0].status).toBe("active");
    expect(body.customers[0].suspension_reason_code).toBeNull();
    expect(body.customers[0].phone_number).toBeNull();
    expect(body.customers[0].order_count).toBe(0);
  });

  it("filters by status", async () => {
    const h = await harness();
    // Suspend the customer first
    await h.app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/suspend`,
      headers: adminSign("POST", `/customers/${CUSTOMER}/suspend`, h),
      payload: { reason_code: "FRAUD" },
    });

    const response = await h.app.inject({
      method: "GET",
      url: "/customers?status=suspended",
      headers: adminSign("GET", "/customers?status=suspended", h),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.customers).toHaveLength(1);
    expect(body.customers[0].status).toBe("suspended");
  });

  it("filters by search query", async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: "GET",
      url: `/customers?q=${CUSTOMER.slice(-4)}`,
      headers: adminSign("GET", `/customers?q=${CUSTOMER.slice(-4)}`, h),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.customers).toHaveLength(1);
  });
});

describe("GET /customers/:id (admin detail)", () => {
  it("returns customer detail with admin fields", async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: "GET",
      url: `/customers/${CUSTOMER}`,
      headers: adminSign("GET", `/customers/${CUSTOMER}`, h),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.wasla_public_id).toBe(CUSTOMER);
    expect(body.status).toBe("active");
    expect(body.suspension_reason_code).toBeNull();
    expect(body.rating_avg).toBeNull();
    expect(body.rating_count).toBe(0);
    expect(body.recent_orders).toEqual([]);
  });

  it("returns 404 for unknown customer", async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: "GET",
      url: `/customers/${OTHER_CUSTOMER}`,
      headers: adminSign("GET", `/customers/${OTHER_CUSTOMER}`, h),
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("POST /customers/:id/suspend", () => {
  it("suspends an active customer", async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/suspend`,
      headers: adminSign("POST", `/customers/${CUSTOMER}/suspend`, h),
      payload: { reason_code: "FRAUD_SUSPICION" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("suspended");
    expect(body.suspension_reason_code).toBe("FRAUD_SUSPICION");
  });

  it("is idempotent — suspending an already-suspended customer returns 200", async () => {
    const h = await harness();
    // First suspend
    await h.app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/suspend`,
      headers: adminSign("POST", `/customers/${CUSTOMER}/suspend`, h),
      payload: { reason_code: "FRAUD" },
    });
    // Second suspend with same reason
    const response = await h.app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/suspend`,
      headers: adminSign("POST", `/customers/${CUSTOMER}/suspend`, h),
      payload: { reason_code: "FRAUD" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("suspended");
    expect(body.suspension_reason_code).toBe("FRAUD");
  });

  it("rejects empty reason_code", async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/suspend`,
      headers: adminSign("POST", `/customers/${CUSTOMER}/suspend`, h),
      payload: { reason_code: "" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 404 for unknown customer", async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: "POST",
      url: `/customers/${OTHER_CUSTOMER}/suspend`,
      headers: adminSign("POST", `/customers/${OTHER_CUSTOMER}/suspend`, h),
      payload: { reason_code: "FRAUD" },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("POST /customers/:id/reinstate", () => {
  it("reinstates a suspended customer", async () => {
    const h = await harness();
    // Suspend first
    await h.app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/suspend`,
      headers: adminSign("POST", `/customers/${CUSTOMER}/suspend`, h),
      payload: { reason_code: "FRAUD" },
    });
    // Reinstate
    const response = await h.app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/reinstate`,
      headers: adminSign("POST", `/customers/${CUSTOMER}/reinstate`, h),
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("active");
    expect(body.suspension_reason_code).toBeNull();
  });

  it("is idempotent — reinstating an already-active customer returns 200", async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/reinstate`,
      headers: adminSign("POST", `/customers/${CUSTOMER}/reinstate`, h),
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("active");
  });

  it("returns 404 for unknown customer", async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: "POST",
      url: `/customers/${OTHER_CUSTOMER}/reinstate`,
      headers: adminSign("POST", `/customers/${OTHER_CUSTOMER}/reinstate`, h),
      payload: {},
    });

    expect(response.statusCode).toBe(404);
  });
});
