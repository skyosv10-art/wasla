/**
 * `GET /drivers` — admin list route.
 *
 * Not owner-scoped: returns all drivers with pagination.
 * The `adminScoped` config requires `drivers:admin:read` but no beneficiary.
 */

import { describe, expect, it } from "vitest";

import { DRIVER, httpHarness, key, registration } from "./http-harness.js";

describe("GET /drivers — admin list", () => {
  it("returns an empty list when no drivers are registered", async () => {
    const { app } = httpHarness();
    const res = await app.inject({ method: "GET", url: "/drivers" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.drivers).toEqual([]);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    await app.close();
  });

  it("returns registered drivers", async () => {
    const { app } = httpHarness();
    await app.inject({
      method: "POST",
      url: "/drivers",
      headers: { "idempotency-key": key() },
      payload: registration(DRIVER),
    });
    const res = await app.inject({ method: "GET", url: "/drivers" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.drivers).toHaveLength(1);
    expect(body.drivers[0].wasla_public_id).toBe(DRIVER);
    await app.close();
  });

  it("respects limit and offset query parameters", async () => {
    const { app } = httpHarness();
    // Register two drivers
    await app.inject({
      method: "POST",
      url: "/drivers",
      headers: { "idempotency-key": key() },
      payload: registration("WS-1000000100"),
    });
    await app.inject({
      method: "POST",
      url: "/drivers",
      headers: { "idempotency-key": key() },
      payload: registration("WS-1000000101"),
    });
    // Limit 1, offset 0 — should return first driver only
    const page1 = await app.inject({
      method: "GET",
      url: "/drivers?limit=1&offset=0",
    });
    expect(page1.statusCode).toBe(200);
    expect(page1.json().drivers).toHaveLength(1);
    expect(page1.json().limit).toBe(1);
    expect(page1.json().offset).toBe(0);
    // Limit 1, offset 1 — should return second driver only
    const page2 = await app.inject({
      method: "GET",
      url: "/drivers?limit=1&offset=1",
    });
    expect(page2.statusCode).toBe(200);
    expect(page2.json().drivers).toHaveLength(1);
    expect(page2.json().limit).toBe(1);
    expect(page2.json().offset).toBe(1);
    await app.close();
  });
});
