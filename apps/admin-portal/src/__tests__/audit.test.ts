import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAuditStore } from "../store/audit";
import { useSessionStore } from "../store/session";
import type { AuditEvent } from "../types/audit";

const mockEvent: AuditEvent = {
  id: 1,
  actor_id: "USR-1234567890",
  actor_role: "operator",
  action: "user.suspended",
  resource_type: "user",
  resource_id: "USR-9876543210",
  metadata: { reason_code: "violation" },
  created_at: "2026-01-01T10:00:00Z",
};

const mockResponse = {
  events: [mockEvent],
  total: 1,
};

describe("audit store", () => {
  beforeEach(() => {
    useAuditStore.setState({
      events: [],
      total: 0,
      loading: false,
      error: null,
      filters: { limit: 50, offset: 0 },
    });
    useSessionStore.getState().setSession("test-token", "admin-1", "admin", Date.now() + 3600000);
    vi.restoreAllMocks();
  });

  it("has correct initial state", () => {
    const state = useAuditStore.getState();
    expect(state.events).toEqual([]);
    expect(state.total).toBe(0);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.filters.limit).toBe(50);
    expect(state.filters.offset).toBe(0);
  });

  it("fetchEvents stores events and total", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as Response);

    await useAuditStore.getState().fetchEvents();

    const state = useAuditStore.getState();
    expect(state.events).toHaveLength(1);
    expect(state.events[0].action).toBe("user.suspended");
    expect(state.total).toBe(1);
    expect(state.loading).toBe(false);
  });

  it("fetchEvents sets error on failure", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ code: "INTERNAL" }),
    } as Response);

    await useAuditStore.getState().fetchEvents();

    const state = useAuditStore.getState();
    expect(state.error).toBe("INTERNAL");
    expect(state.events).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("fetchEvents merges overrides into filters", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as Response);

    await useAuditStore.getState().fetchEvents({ action: "driver.suspended" });

    const state = useAuditStore.getState();
    expect(state.filters.action).toBe("driver.suspended");
  });

  it("setFilter updates a single filter", () => {
    useAuditStore.getState().setFilter("actor_id", "USR-123");
    expect(useAuditStore.getState().filters.actor_id).toBe("USR-123");
  });

  it("clearFilters resets to defaults", () => {
    useAuditStore.setState({
      filters: {
        from_date: "2026-01-01",
        actor_id: "USR-123",
        action: "user.suspended",
        limit: 10,
        offset: 20,
      },
    });

    useAuditStore.getState().clearFilters();

    const state = useAuditStore.getState();
    expect(state.filters.from_date).toBeUndefined();
    expect(state.filters.actor_id).toBeUndefined();
    expect(state.filters.action).toBeUndefined();
    expect(state.filters.limit).toBe(50);
    expect(state.filters.offset).toBe(0);
  });

  it("fetchEvents sets error when no session token", async () => {
    useSessionStore.getState().clearSession();
    await useAuditStore.getState().fetchEvents();
    expect(useAuditStore.getState().error).toBe("NO_SESSION");
  });
});
