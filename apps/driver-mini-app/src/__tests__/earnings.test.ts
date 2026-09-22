import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiClient } from "../api/client";
import { useEarningsStore } from "../store/earnings";
import { useSessionStore } from "../store/session";

vi.mock("../api/client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock("../store/session", () => ({
  useSessionStore: {
    getState: vi.fn(),
  },
}));

describe("Earnings store", () => {
  const mockApi = vi.mocked(apiClient);
  const mockGetState = vi.mocked(useSessionStore.getState);

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state
    useEarningsStore.setState({
      period: "today",
      jobs: [],
      summary: null,
      loading: false,
      error: null,
    });
    mockGetState.mockReturnValue({
      token: "test-token",
      driverId: "drv_test_123",
      
      expiresAt: Date.now() + 3600000,
      setSession: vi.fn(),
      clearSession: vi.fn(),
      isAuthenticated: () => true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches earnings successfully", async () => {
    const mockJobs = [
      {
        order_public_id: "ORD-0000000001",
        order_type: "ride",
        vehicle_class: "sedan",
        status: "completed",
        agreed_price: { amount_minor: 2500, currency: "SAR" },
        agreed_at: "2026-09-22T10:00:00Z",
        completed_at: "2026-09-22T10:30:00Z",
        pickup_label: "A",
        dropoff_label: "B",
      },
    ];
    mockApi.get.mockResolvedValue({ jobs: mockJobs });

    await useEarningsStore.getState().fetchEarnings("today");

    const state = useEarningsStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.jobs).toHaveLength(1);
    expect(state.summary).not.toBeNull();
    expect(state.summary?.job_count).toBe(1);
    expect(state.summary?.total_amount.amount_minor).toBe(2500);
    expect(state.summary?.total_amount.currency).toBe("SAR");
  });

  it("handles fetch error", async () => {
    mockApi.get.mockRejectedValue(new Error("network_error"));

    await useEarningsStore.getState().fetchEarnings();

    const state = useEarningsStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toBe("network_error");
    expect(state.jobs).toEqual([]);
  });

  it("sets error when no driver session", async () => {
    mockGetState.mockReturnValue({
      token: null,
      driverId: null,
      
      expiresAt: null,
      setSession: vi.fn(),
      clearSession: vi.fn(),
      isAuthenticated: () => false,
    });

    await useEarningsStore.getState().fetchEarnings();

    const state = useEarningsStore.getState();
    expect(state.error).toBe("no_driver_session");
    expect(state.loading).toBe(false);
  });

  it("calls correct API path with period query", async () => {
    mockApi.get.mockResolvedValue({ jobs: [] });

    await useEarningsStore.getState().fetchEarnings("week");

    expect(mockApi.get).toHaveBeenCalledWith(
      "/drivers/drv_test_123/jobs?status=completed&period=week",
    );
  });

  it("computes summary with zero jobs", async () => {
    mockApi.get.mockResolvedValue({ jobs: [] });

    await useEarningsStore.getState().fetchEarnings("month");

    const state = useEarningsStore.getState();
    expect(state.summary?.job_count).toBe(0);
    expect(state.summary?.total_amount.amount_minor).toBe(0);
    expect(state.summary?.total_amount.currency).toBe("SAR");
  });

  it("clears errors", () => {
    useEarningsStore.setState({ error: "some_error" });
    useEarningsStore.getState().clearErrors();
    expect(useEarningsStore.getState().error).toBeNull();
  });

  it("sets period", () => {
    useEarningsStore.getState().setPeriod("month");
    expect(useEarningsStore.getState().period).toBe("month");
  });
});
