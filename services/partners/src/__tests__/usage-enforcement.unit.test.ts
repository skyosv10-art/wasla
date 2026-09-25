/**
 * Unit tests for usage enforcement module.
 *
 * Tests:
 * - Current window computation (hourly alignment)
 * - Usage check with no prior usage → full quota remaining
 * - Usage check with existing usage → remaining computed correctly
 * - Usage check at limit → allowed=false
 * - Increment API call
 * - Increment webhook delivery
 */

import { describe, it, expect, vi } from "vitest";
import {
  currentWindowStart,
  checkUsage,
  incrementApiCall,
  incrementWebhookDelivery,
  DEFAULT_API_CALL_LIMIT,
  DEFAULT_WEBHOOK_DELIVERY_LIMIT,
  type UsageStore,
  type UsageCounter,
} from "../domain/usage-enforcement";

const mockStore = (counter: UsageCounter | null): UsageStore => ({
  async get() { return counter; },
  async incrementApiCalls() { return counter ?? { tenantStoreId: "", windowStart: "", apiCalls: 1, webhookDeliveries: 0 }; },
  async incrementWebhookDeliveries() { return counter ?? { tenantStoreId: "", windowStart: "", apiCalls: 0, webhookDeliveries: 1 }; },
});

describe("currentWindowStart", () => {
  it("aligns to the top of the hour", () => {
    const result = currentWindowStart(new Date("2026-01-15T10:35:42Z"));
    expect(result).toBe("2026-01-15T10:00:00.000Z");
  });

  it("aligns to the top of the next hour", () => {
    const result = currentWindowStart(new Date("2026-01-15T10:59:59Z"));
    expect(result).toBe("2026-01-15T10:00:00.000Z");
  });

  it("rolls over to a new hour", () => {
    const result = currentWindowStart(new Date("2026-01-15T11:00:01Z"));
    expect(result).toBe("2026-01-15T11:00:00.000Z");
  });
});

describe("checkUsage", () => {
  it("returns full quota when no prior usage", async () => {
    const store = mockStore(null);
    const result = await checkUsage(store, "store-1");
    expect(result.allowed).toBe(true);
    expect(result.apiCallsRemaining).toBe(DEFAULT_API_CALL_LIMIT);
    expect(result.webhookDeliveriesRemaining).toBe(DEFAULT_WEBHOOK_DELIVERY_LIMIT);
  });

  it("computes remaining from existing usage", async () => {
    const store = mockStore({
      tenantStoreId: "store-1",
      windowStart: "2026-01-15T10:00:00.000Z",
      apiCalls: 750,
      webhookDeliveries: 50,
    });
    const result = await checkUsage(store, "store-1");
    expect(result.apiCallsRemaining).toBe(250);
    expect(result.webhookDeliveriesRemaining).toBe(50);
  });

  it("reports not allowed when at limit", async () => {
    const store = mockStore({
      tenantStoreId: "store-1",
      windowStart: "2026-01-15T10:00:00.000Z",
      apiCalls: DEFAULT_API_CALL_LIMIT,
      webhookDeliveries: 0,
    });
    const result = await checkUsage(store, "store-1");
    expect(result.allowed).toBe(false);
    expect(result.apiCallsRemaining).toBe(0);
  });

  it("respects custom limits", async () => {
    const store = mockStore({
      tenantStoreId: "store-1",
      windowStart: "2026-01-15T10:00:00.000Z",
      apiCalls: 500,
      webhookDeliveries: 0,
    });
    const result = await checkUsage(store, "store-1", {
      apiCallsPerWindow: 500,
      webhookDeliveriesPerWindow: 50,
    });
    expect(result.allowed).toBe(false);
  });
});

describe("incrementApiCall", () => {
  it("calls store.incrementApiCalls with the correct window", async () => {
    const incrementSpy = vi.fn();
    const store: UsageStore = {
      get: async () => null,
      incrementApiCalls: async () => {
        incrementSpy();
        return { tenantStoreId: "", windowStart: "", apiCalls: 1, webhookDeliveries: 0 };
      },
      incrementWebhookDeliveries: async () => ({ tenantStoreId: "", windowStart: "", apiCalls: 0, webhookDeliveries: 1 }),
    };

    await incrementApiCall(store, "store-1", new Date("2026-01-15T10:35:42Z"));
    expect(incrementSpy).toHaveBeenCalledTimes(1);
  });
});

describe("incrementWebhookDelivery", () => {
  it("calls store.incrementWebhookDeliveries with the correct window", async () => {
    const incrementSpy = vi.fn();
    const store: UsageStore = {
      get: async () => null,
      incrementApiCalls: async () => ({ tenantStoreId: "", windowStart: "", apiCalls: 1, webhookDeliveries: 0 }),
      incrementWebhookDeliveries: async () => {
        incrementSpy();
        return { tenantStoreId: "", windowStart: "", apiCalls: 0, webhookDeliveries: 1 };
      },
    };

    await incrementWebhookDelivery(store, "store-1", new Date("2026-01-15T10:35:42Z"));
    expect(incrementSpy).toHaveBeenCalledTimes(1);
  });
});
