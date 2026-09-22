import { describe, it, expect, vi, beforeEach } from "vitest";
import { useVehiclesStore } from "../store/vehicles";
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

describe("Vehicles store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVehiclesStore.setState({
      vehicles: [],
      loading: false,
      error: null,
      actionLoading: false,
      actionError: null,
      fetchVehicles: useVehiclesStore.getState().fetchVehicles,
      addVehicle: useVehiclesStore.getState().addVehicle,
      patchVehicle: useVehiclesStore.getState().patchVehicle,
      clearErrors: useVehiclesStore.getState().clearErrors,
    });
    useSessionStore.getState().setSession("token-123", "drv-123", Date.now() + 3_600_000);
  });

  it("fetchVehicles populates vehicles on success", async () => {
    const mockVehicles = [
      { id: "veh-1", vehicle_class: "sedan" as const, make: "Toyota", model: "Camry", model_year: 2023, color: "White", plate_number: "ABC-1234", is_primary: true, status: "active" as const, created_at: "", updated_at: "" },
    ];
    mockApi.get.mockResolvedValue({ items: mockVehicles });
    await useVehiclesStore.getState().fetchVehicles();
    expect(useVehiclesStore.getState().vehicles).toEqual(mockVehicles);
    expect(useVehiclesStore.getState().loading).toBe(false);
  });

  it("fetchVehicles sets error on failure", async () => {
    mockApi.get.mockRejectedValue(new Error("Network error"));
    await useVehiclesStore.getState().fetchVehicles();
    expect(useVehiclesStore.getState().error).toBe("fetch_vehicles_failed");
    expect(useVehiclesStore.getState().loading).toBe(false);
  });

  it("addVehicle sends POST with Idempotency-Key", async () => {
    const mockVehicle = { id: "veh-new", vehicle_class: "suv" as const, make: "Nissan", model: null, model_year: null, color: null, plate_number: null, is_primary: false, status: "active" as const, created_at: "", updated_at: "" };
    mockApi.post.mockResolvedValue(mockVehicle);
    const result = await useVehiclesStore.getState().addVehicle({ vehicle_class: "suv", make: "Nissan" });
    expect(result).toBe(true);
    expect(mockApi.post).toHaveBeenCalledWith(
      "/drivers/drv-123/vehicles",
      { vehicle_class: "suv", make: "Nissan" },
      expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
    );
    expect(useVehiclesStore.getState().vehicles).toContain(mockVehicle);
  });

  it("addVehicle sets actionError on failure", async () => {
    mockApi.post.mockRejectedValue(new Error("Validation failed"));
    const result = await useVehiclesStore.getState().addVehicle({ vehicle_class: "sedan" });
    expect(result).toBe(false);
    expect(useVehiclesStore.getState().actionError).toBe("add_vehicle_failed");
  });

  it("patchVehicle sends PATCH request", async () => {
    const updatedVehicle = { id: "veh-1", vehicle_class: "sedan" as const, make: "Toyota", model: null, model_year: null, color: null, plate_number: null, is_primary: false, status: "retired" as const, created_at: "", updated_at: "" };
    mockApi.patch.mockResolvedValue(updatedVehicle);
    useVehiclesStore.setState({ vehicles: [{ id: "veh-1", vehicle_class: "sedan" as const, make: "Toyota", model: null, model_year: null, color: null, plate_number: null, is_primary: true, status: "active" as const, created_at: "", updated_at: "" }] });
    const result = await useVehiclesStore.getState().patchVehicle("veh-1", { status: "retired" });
    expect(result).toBe(true);
    expect(mockApi.patch).toHaveBeenCalledWith("/drivers/drv-123/vehicles/veh-1", { status: "retired" });
    expect(useVehiclesStore.getState().vehicles[0].status).toBe("retired");
  });

  it("patchVehicle sets actionError on failure", async () => {
    mockApi.patch.mockRejectedValue(new Error("Not found"));
    const result = await useVehiclesStore.getState().patchVehicle("veh-999", { status: "retired" });
    expect(result).toBe(false);
    expect(useVehiclesStore.getState().actionError).toBe("patch_vehicle_failed");
  });

  it("clearErrors resets error states", () => {
    useVehiclesStore.setState({ error: "some error", actionError: "action error" });
    useVehiclesStore.getState().clearErrors();
    expect(useVehiclesStore.getState().error).toBeNull();
    expect(useVehiclesStore.getState().actionError).toBeNull();
  });

  it("addVehicle returns false when no driverId", async () => {
    useSessionStore.getState().clearSession();
    const result = await useVehiclesStore.getState().addVehicle({ vehicle_class: "sedan" });
    expect(result).toBe(false);
  });
});
