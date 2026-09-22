import { describe, it, expect, beforeEach, vi } from "vitest";
import { useOrdersStore } from "../store/orders";
import { useSessionStore } from "../store/session";

const mockOrderSummary = {
  order_public_id: "ORD-1234567890",
  order_id: 1,
  status: "pending_acceptance" as const,
  price_mode: "fixed" as const,
  order_type: "ride" as const,
  vehicle_class: "sedan" as const,
  agreed_price: null,
  agreed_at: null,
  agreed_negotiation_id: null,
};

const mockOrderDetail = {
  id: 1,
  order_public_id: "ORD-1234567890",
  order_request_id: "req-1",
  customer_public_id: "CUS-1234567890",
  order_type: "ride" as const,
  vehicle_class: "sedan" as const,
  status: "assigned" as const,
  status_reason_code: null,
  price_mode: "negotiated" as const,
  offered_price: { amount_minor: 5000, currency: "SAR" },
  agreed_price: { amount_minor: 4500, currency: "SAR" },
  agreed_at: "2026-01-01T10:00:00Z",
  agreed_negotiation_id: "neg-1",
  stops: [
    { sequence: 1, kind: "pickup" as const, latitude: 24.7, longitude: 46.7, short_address: "Riyadh", full_address: null },
  ],
  shipment: null,
  notes: "Test order",
  active_assignment: null,
  requested_at: "2026-01-01T09:00:00Z",
  accepted_at: null,
  created_at: "2026-01-01T08:00:00Z",
  updated_at: "2026-01-01T09:30:00Z",
};

const mockHistory = {
  items: [
    {
      sequence: 1,
      from_status: null,
      to_status: "pending_acceptance" as const,
      reason_code: null,
      actor_type: "customer" as const,
      actor_ref: "CUS-1234567890",
      occurred_at: "2026-01-01T08:00:00Z",
      trace_id: "trace-1",
    },
    {
      sequence: 2,
      from_status: "pending_acceptance" as const,
      to_status: "assigned" as const,
      reason_code: "driver_accepted",
      actor_type: "system" as const,
      actor_ref: "dispatch",
      occurred_at: "2026-01-01T09:00:00Z",
      trace_id: "trace-2",
    },
  ],
};

describe("orders store", () => {
  beforeEach(() => {
    useOrdersStore.setState({
      searchResults: [],
      searchLoading: false,
      searchError: null,
      detail: null,
      detailLoading: false,
      detailError: null,
      history: [],
      historyLoading: false,
      historyError: null,
    });
    useSessionStore.getState().setSession("test-token", "admin-1", "admin", Date.now() + 3600000);
    vi.restoreAllMocks();
  });

  it("has correct initial state", () => {
    const state = useOrdersStore.getState();
    expect(state.searchResults).toEqual([]);
    expect(state.detail).toBeNull();
    expect(state.history).toEqual([]);
    expect(state.searchLoading).toBe(false);
    expect(state.detailLoading).toBe(false);
    expect(state.historyLoading).toBe(false);
  });

  it("searchByPublicId sets loading then stores result", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockOrderSummary,
    } as Response);

    const store = useOrdersStore.getState();
    await store.searchByPublicId("ORD-1234567890");

    const state = useOrdersStore.getState();
    expect(state.searchResults).toHaveLength(1);
    expect(state.searchResults[0].order_public_id).toBe("ORD-1234567890");
    expect(state.searchLoading).toBe(false);
    expect(state.searchError).toBeNull();
  });

  it("searchByPublicId sets error on failure", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ code: "ORDER_NOT_FOUND" }),
    } as Response);

    await useOrdersStore.getState().searchByPublicId("ORD-9999999999");

    const state = useOrdersStore.getState();
    expect(state.searchError).toBe("ORDER_NOT_FOUND");
    expect(state.searchResults).toEqual([]);
    expect(state.searchLoading).toBe(false);
  });

  it("fetchDetail stores order detail", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockOrderDetail,
    } as Response);

    await useOrdersStore.getState().fetchDetail(1);

    const state = useOrdersStore.getState();
    expect(state.detail).not.toBeNull();
    expect(state.detail?.order_public_id).toBe("ORD-1234567890");
    expect(state.detail?.status).toBe("assigned");
    expect(state.detailLoading).toBe(false);
  });

  it("fetchDetail sets error on failure", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ code: "FORBIDDEN" }),
    } as Response);

    await useOrdersStore.getState().fetchDetail(999);

    const state = useOrdersStore.getState();
    expect(state.detailError).toBe("FORBIDDEN");
    expect(state.detail).toBeNull();
  });

  it("fetchHistory stores status history entries", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockHistory,
    } as Response);

    await useOrdersStore.getState().fetchHistory(1);

    const state = useOrdersStore.getState();
    expect(state.history).toHaveLength(2);
    expect(state.history[0].to_status).toBe("pending_acceptance");
    expect(state.history[1].to_status).toBe("assigned");
    expect(state.historyLoading).toBe(false);
  });

  it("fetchHistory sets error on failure", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ code: "INTERNAL" }),
    } as Response);

    await useOrdersStore.getState().fetchHistory(999);

    const state = useOrdersStore.getState();
    expect(state.historyError).toBe("INTERNAL");
    expect(state.history).toEqual([]);
  });

  it("clearSearch resets search state", () => {
    useOrdersStore.setState({
      searchResults: [mockOrderSummary],
      searchError: "some_error",
    });

    useOrdersStore.getState().clearSearch();

    const state = useOrdersStore.getState();
    expect(state.searchResults).toEqual([]);
    expect(state.searchError).toBeNull();
  });

  it("clearDetail resets detail and history state", () => {
    useOrdersStore.setState({
      detail: mockOrderDetail,
      detailError: "err",
      history: mockHistory.items,
      historyError: "err",
    });

    useOrdersStore.getState().clearDetail();

    const state = useOrdersStore.getState();
    expect(state.detail).toBeNull();
    expect(state.detailError).toBeNull();
    expect(state.history).toEqual([]);
    expect(state.historyError).toBeNull();
  });

  it("searchByPublicId sets error when no session token", async () => {
    useSessionStore.getState().clearSession();
    await useOrdersStore.getState().searchByPublicId("ORD-1234567890");
    expect(useOrdersStore.getState().searchError).toBe("NO_SESSION");
  });
});
