import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDispatchStore } from "../store/dispatch";
import { useSessionStore } from "../store/session";
import { apiClient, ApiError } from "../api/client";
import type { DispatchOffer, DispatchJob } from "../types/dispatch";

// Mock the API client
vi.mock("../api/client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class extends Error {
    constructor(public status: number, message: string) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

const mockApi = vi.mocked(apiClient);

const mockOffer: DispatchOffer = {
  id: "offer-1",
  job_id: "job-1",
  wave_id: "wave-1",
  driver_public_id: "drv-123",
  status: "pending",
  reason_code: null,
  offered_at: new Date(Date.now() - 30_000).toISOString(),
  expires_at: new Date(Date.now() + 120_000).toISOString(),
  responded_at: null,
  resolved_at: null,
  created_at: new Date(Date.now() - 30_000).toISOString(),
};

const mockJob: DispatchJob = {
  id: "job-1",
  order_id: "order-uuid-1",
  order_public_id: "ORD-001",
  zone_id: "zone-1",
  order_type: "ride",
  vehicle_class: "car",
  status: "assigned",
  status_reason_code: null,
  rules: {
    ruleset_version: "v1",
    wave_size: 5,
    offer_timeout_seconds: 120,
    max_waves: 3,
    escalation_timeout_seconds: 300,
  },
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  escalation_expires_at: new Date(Date.now() + 1_200_000).toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("dispatchStore — fetchOffers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().clearSession();
    useSessionStore.getState().setSession("token-123", "drv-123", Date.now() + 3_600_000);
    useDispatchStore.setState({
      offers: [],
      offersJobId: null,
      offersLoading: false,
      offersError: null,
      actionLoading: false,
      actionError: null,
    });
  });

  it("fetches offers and populates the list", async () => {
    mockApi.get.mockResolvedValue({ items: [mockOffer] });

    const { result } = renderHook(() => useDispatchStore());

    await act(async () => {
      await result.current.fetchOffers("job-1");
    });

    expect(result.current.offers).toHaveLength(1);
    expect(result.current.offers[0].id).toBe("offer-1");
    expect(result.current.offersJobId).toBe("job-1");
    expect(result.current.offersLoading).toBe(false);
    expect(result.current.offersError).toBeNull();
  });

  it("handles API errors gracefully", async () => {
    mockApi.get.mockRejectedValue(new ApiError(403, "Forbidden"));

    const { result } = renderHook(() => useDispatchStore());

    await act(async () => {
      await result.current.fetchOffers("job-1");
    });

    expect(result.current.offers).toHaveLength(0);
    expect(result.current.offersLoading).toBe(false);
    expect(result.current.offersError).toBe("Forbidden");
  });
});

describe("dispatchStore — acceptOffer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().setSession("token-123", "drv-123", Date.now() + 3_600_000);
    useDispatchStore.setState({
      offers: [],
      actionLoading: false,
      actionError: null,
    });
  });

  it("accepts an offer and updates the list", async () => {
    const acceptedOffer: DispatchOffer = { ...mockOffer, status: "accepted" };
    mockApi.post.mockResolvedValue(acceptedOffer);

    const { result } = renderHook(() => useDispatchStore());

    // Pre-populate offers
    await act(async () => {
      result.current.fetchOffers = vi.fn();
    });

    // Set offers directly via the store
    act(() => {
      useDispatchStore.setState({ offers: [mockOffer] });
    });

    await act(async () => {
      const success = await result.current.acceptOffer("offer-1");
      expect(success).toBe(true);
    });

    expect(result.current.offers[0].status).toBe("accepted");
    expect(result.current.actionLoading).toBe(false);
    expect(mockApi.post).toHaveBeenCalledWith(
      "/dispatch/offers/offer-1/accept",
      undefined,
      expect.objectContaining({ "Idempotency-Key": expect.any(String) })
    );
  });

  it("returns false on API error", async () => {
    mockApi.post.mockRejectedValue(new ApiError(409, "Already accepted"));

    act(() => {
      useDispatchStore.setState({ offers: [mockOffer] });
    });

    const { result } = renderHook(() => useDispatchStore());

    await act(async () => {
      const success = await result.current.acceptOffer("offer-1");
      expect(success).toBe(false);
    });

    expect(result.current.actionError).toBe("Already accepted");
  });
});

describe("dispatchStore — transitionOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().setSession("token-123", "drv-123", Date.now() + 3_600_000);
    useDispatchStore.setState({ actionLoading: false, actionError: null });
  });

  it("calls the order transition endpoint with driver actor", async () => {
    mockApi.post.mockResolvedValue({ id: "order-1" });

    const { result } = renderHook(() => useDispatchStore());

    await act(async () => {
      const success = await result.current.transitionOrder("order-uuid-1", "driver_en_route");
      expect(success).toBe(true);
    });

    expect(mockApi.post).toHaveBeenCalledWith(
      "/orders/order-uuid-1/transitions",
      {
        to_status: "driver_en_route",
        actor_type: "driver",
        actor_ref: "drv-123",
      },
      expect.objectContaining({ "Idempotency-Key": expect.any(String) })
    );
  });

  it("includes reason_code for terminal transitions", async () => {
    mockApi.post.mockResolvedValue({ id: "order-1" });

    const { result } = renderHook(() => useDispatchStore());

    await act(async () => {
      await result.current.transitionOrder("order-1", "completed", "delivery_complete");
    });

    expect(mockApi.post).toHaveBeenCalledWith(
      "/orders/order-1/transitions",
      {
        to_status: "completed",
        actor_type: "driver",
        actor_ref: "drv-123",
        reason_code: "delivery_complete",
      },
      expect.objectContaining({ "Idempotency-Key": expect.any(String) })
    );
  });
});

describe("dispatchStore — cancelJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().setSession("token-123", "drv-123", Date.now() + 3_600_000);
    useDispatchStore.setState({ activeJob: null, actionLoading: false, actionError: null });
  });

  it("cancels a job and updates activeJob", async () => {
    const cancelledJob: DispatchJob = { ...mockJob, status: "cancelled" };
    mockApi.post.mockResolvedValue(cancelledJob);

    const { result } = renderHook(() => useDispatchStore());

    act(() => {
      useDispatchStore.setState({ activeJob: mockJob });
    });

    await act(async () => {
      const success = await result.current.cancelJob("job-1", "driver_cancelled");
      expect(success).toBe(true);
    });

    expect(result.current.activeJob?.status).toBe("cancelled");
    expect(mockApi.post).toHaveBeenCalledWith(
      "/dispatch/jobs/job-1/cancel",
      { reason_code: "driver_cancelled" },
      expect.objectContaining({ "Idempotency-Key": expect.any(String) })
    );
  });
});

describe("dispatchStore — startPolling / stopPolling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockResolvedValue({ items: [mockOffer] });
    useSessionStore.getState().setSession("token-123", "drv-123", Date.now() + 3_600_000);
    useDispatchStore.setState({
      offers: [],
      offersJobId: null,
      pollTimerId: null,
    });
  });

  afterEach(() => {
    useDispatchStore.getState().stopPolling();
  });

  it("starts polling and sets up timer for the job", () => {
    const { result } = renderHook(() => useDispatchStore());

    act(() => {
      result.current.startPolling("job-1");
    });

    // startPolling calls fetchOffers asynchronously — verify timer is set
    expect(result.current.pollTimerId).not.toBeNull();
    expect(result.current.offersJobId).toBe("job-1");

    act(() => {
      result.current.stopPolling();
    });

    expect(result.current.pollTimerId).toBeNull();
  });

  it("does not restart polling if already polling the same job", () => {
    const { result } = renderHook(() => useDispatchStore());

    act(() => {
      result.current.startPolling("job-1");
    });

    const firstTimerId = result.current.pollTimerId;
    expect(firstTimerId).not.toBeNull();

    // Calling again with same job should not restart
    act(() => {
      result.current.startPolling("job-1");
    });

    expect(result.current.pollTimerId).toBe(firstTimerId);

    result.current.stopPolling();
  });
});
