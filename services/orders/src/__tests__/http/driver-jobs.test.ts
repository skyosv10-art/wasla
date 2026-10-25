/**
 * Tests for `GET /orders/drivers/:driverPublicId/jobs` — the M3-02 gap closure.
 *
 * The earnings screen calls this route to list a driver's completed (or
 * cancelled) jobs within a period. The route is beneficiary-scoped: the `obo`
 * claim in the service token must name the same driver as the path parameter.
 *
 * Setup uses the harness's real use cases (not HTTP) to drive an order to
 * `completed` with a known driver assignment, then tests the HTTP route via
 * `rawInject` with signed headers — because the route's beneficiary check and
 * period computation are HTTP-layer concerns that a repository test would not
 * exercise.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import {
  createOrderHttpHarness,
  type OrderHttpHarness,
} from "./support.js";
import {
  createOrder,
  driveTo,
  publicId,
} from "../harness.js";

const DRIVER = publicId(42);
const OTHER_DRIVER = publicId(99);

describe("GET /orders/drivers/:driverPublicId/jobs", () => {
  let h: OrderHttpHarness;

  beforeEach(() => {
    h = createOrderHttpHarness();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an empty list for a driver with no completed jobs", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: `/orders/drivers/${DRIVER}/jobs?period=today`,
      headers: { "X-Customer-Public-Id": DRIVER },
    });

    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.jobs).toEqual([]);
  });

  it("rejects a token whose beneficiary is a different driver (404, not 403)", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: `/orders/drivers/${DRIVER}/jobs?period=today`,
      headers: { "X-Customer-Public-Id": OTHER_DRIVER },
    });

    // 404, not 403: the route must not be an existence oracle.
    expect(res.statusCode, res.body).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("ORDER_NOT_FOUND");
  });

  it("rejects an unsigned request (401)", async () => {
    const res = await h.rawInject({
      method: "GET",
      url: `/orders/drivers/${DRIVER}/jobs?period=today`,
    });

    expect(res.statusCode).toBe(401);
  });

  it("validates the driver_public_id path parameter shape", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: `/orders/drivers/not-a-valid-id/jobs?period=today`,
      headers: { "X-Customer-Public-Id": DRIVER },
    });

    expect(res.statusCode, res.body).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("ORDER_VALIDATION_FAILED");
  });

  it("returns a completed job for the driver", async () => {
    // The harness's FixedClock starts at 2026-01-01T00:00:00Z, so the order's
    // `completedAt` lands there. The route computes its period cutoff from the
    // real wall clock, so the test must align the system clock to a date near
    // the fixed clock's start for the "month" window to include the order.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T00:00:00.000Z"));

    // Set up a completed order with a driver assignment using the harness's
    // real use cases directly (not via HTTP).
    const orderId = await createOrder(h.harness);
    await driveTo(h.harness, orderId, "completed");

    // Find the driver who was assigned (driveTo uses bindAcceptedAssignment
    // which uses publicId(counter)).
    const order = await h.harness.repository.findOrderById(orderId);
    expect(order, "order should exist").not.toBeNull();
    const assignments = await h.harness.repository.listAssignments(orderId);
    const acceptedAssignment = assignments.find((a) => a.state === "accepted");
    expect(acceptedAssignment, "should have an accepted assignment").toBeDefined();
    const driverPublicId = acceptedAssignment!.driverPublicId;

    // Test the HTTP route via the harness's signed inject.
    const res = await h.app.inject({
      method: "GET",
      url: `/orders/drivers/${driverPublicId}/jobs?period=month`,
      headers: { "X-Customer-Public-Id": driverPublicId },
    });

    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].order_public_id).toBe(order!.orderPublicId);
    expect(body.jobs[0].status).toBe("completed");
    expect(body.jobs[0].completed_at).toBeTruthy();
  });

  // ── G-S13 (CLM-0614) ─────────────────────────────────────────────────────
  async function assignedDriver(orderId: string): Promise<string> {
    const assignments = await h.harness.repository.listAssignments(orderId);
    const accepted = assignments.find((a) => a.state === "accepted");
    expect(accepted, "should have an accepted assignment").toBeDefined();
    return accepted!.driverPublicId;
  }

  async function jobs(driver: string, query: string) {
    return h.app.inject({
      method: "GET",
      url: `/orders/drivers/${driver}/jobs${query}`,
      headers: { "X-Customer-Public-Id": driver },
    });
  }

  it("refuses an absent or out-of-enum period with 400 ORDER_VALIDATION_FAILED naming period", async () => {
    for (const q of ["?period=decade", "?period=", "?period=TODAY", ""]) {
      const res = await jobs(DRIVER, q);
      expect(res.statusCode, `${q} → ${res.body}`).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("ORDER_VALIDATION_FAILED");
      // The orders envelope is {code, message, trace_id} — no details by contract.
      expect(body.message).toContain("period");
    }
  });

  it("checks ownership before the period: a foreign driver with a bad period still gets 404", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: `/orders/drivers/${DRIVER}/jobs?period=decade`,
      headers: { "X-Customer-Public-Id": OTHER_DRIVER },
    });
    expect(res.statusCode, res.body).toBe(404);
  });

  it("applies the today / week / month windows to completed_at (2026-01-01T00:00Z)", async () => {
    const orderId = await createOrder(h.harness);
    await driveTo(h.harness, orderId, "completed");
    const driver = await assignedDriver(orderId);
    const count = async (period: string) => JSON.parse((await jobs(driver, `?period=${period}`)).body).jobs.length;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z")); // 12 h later
    expect([await count("today"), await count("week"), await count("month")]).toEqual([1, 1, 1]);
    vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z")); // 2 days later
    expect([await count("today"), await count("week"), await count("month")]).toEqual([0, 1, 1]);
    vi.setSystemTime(new Date("2026-01-20T00:00:00.000Z")); // 19 days later
    expect([await count("today"), await count("week"), await count("month")]).toEqual([0, 0, 1]);
    vi.setSystemTime(new Date("2026-02-15T00:00:00.000Z")); // 45 days later
    expect([await count("today"), await count("week"), await count("month")]).toEqual([0, 0, 0]);
  });

  it("returns cancelled jobs too, labelled by status (the contract: completed or cancelled)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    const orderId = await createOrder(h.harness);
    await driveTo(h.harness, orderId, "driver_cancelled");
    const driver = await assignedDriver(orderId);
    const res = await jobs(driver, "?period=today");
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.jobs.map((j: { status: string }) => j.status)).toEqual(["driver_cancelled"]);
  });
});
