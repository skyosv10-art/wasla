import { describe, it, expect, vi, beforeEach } from "vitest";
import { useZonesStore } from "../store/zones";
import { useSessionStore } from "../store/session";
import { apiClient } from "../api/client";

vi.mock("../api/client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
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

describe("Zones store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useZonesStore.setState({
      zones: [],
      availableZones: [],
      loading: false,
      error: null,
      saving: false,
      saveError: null,
      saveSuccess: false,
      fetchZones: useZonesStore.getState().fetchZones,
      setAvailableZones: useZonesStore.getState().setAvailableZones,
      saveZones: useZonesStore.getState().saveZones,
      clearErrors: useZonesStore.getState().clearErrors,
    });
    useSessionStore.getState().setSession("token-123", "drv-123", Date.now() + 3_600_000);
  });

  it("fetchZones populates zones on success", async () => {
    const mockZones = [
      { zone_id: "zone-1", preference_rank: 1, created_at: "2024-01-01T00:00:00Z" },
      { zone_id: "zone-2", preference_rank: 2, created_at: "2024-01-02T00:00:00Z" },
    ];
    mockApi.get.mockResolvedValue({ zones: mockZones });
    await useZonesStore.getState().fetchZones();
    expect(useZonesStore.getState().zones).toEqual(mockZones);
    expect(useZonesStore.getState().loading).toBe(false);
  });

  it("fetchZones sets error on failure", async () => {
    mockApi.get.mockRejectedValue(new Error("Network error"));
    await useZonesStore.getState().fetchZones();
    expect(useZonesStore.getState().error).toBe("fetch_zones_failed");
    expect(useZonesStore.getState().loading).toBe(false);
  });

  it("saveZones sends PUT with full zone list", async () => {
    const mockResponse = {
      zones: [{ zone_id: "zone-1", preference_rank: 1, created_at: "2024-01-01T00:00:00Z" }],
    };
    mockApi.put.mockResolvedValue(mockResponse);
    const updates = [{ zone_id: "zone-1", preference_rank: 1 }];
    const result = await useZonesStore.getState().saveZones(updates);
    expect(result).toBe(true);
    expect(mockApi.put).toHaveBeenCalledWith(
      "/drivers/drv-123/zones",
      { zones: updates },
    );
    expect(useZonesStore.getState().zones).toEqual(mockResponse.zones);
    expect(useZonesStore.getState().saveSuccess).toBe(true);
  });

  it("saveZones sets saveError on failure", async () => {
    mockApi.put.mockRejectedValue(new Error("Validation failed"));
    const result = await useZonesStore.getState().saveZones([{ zone_id: "zone-1", preference_rank: 1 }]);
    expect(result).toBe(false);
    expect(useZonesStore.getState().saveError).toBe("save_zones_failed");
    expect(useZonesStore.getState().saving).toBe(false);
  });

  it("clearErrors resets all error states", () => {
    useZonesStore.setState({
      error: "some error",
      saveError: "save error",
      saveSuccess: true,
    });
    useZonesStore.getState().clearErrors();
    expect(useZonesStore.getState().error).toBeNull();
    expect(useZonesStore.getState().saveError).toBeNull();
    expect(useZonesStore.getState().saveSuccess).toBe(false);
  });

  it("setAvailableZones updates availableZones", () => {
    const zones = [{ id: "zone-1", name: "North Zone", parent_path: "" }];
    useZonesStore.getState().setAvailableZones(zones);
    expect(useZonesStore.getState().availableZones).toEqual(zones);
  });

  it("saveZones returns false when no driverId", async () => {
    useSessionStore.getState().clearSession();
    const result = await useZonesStore.getState().saveZones([]);
    expect(result).toBe(false);
  });

  it("saveZones handles empty zones list in response", async () => {
    mockApi.put.mockResolvedValue({ zones: [] });
    const result = await useZonesStore.getState().saveZones([]);
    expect(result).toBe(true);
    expect(useZonesStore.getState().zones).toEqual([]);
  });
});
