import { describe, it, expect, beforeEach } from "vitest";
import { useDriversStore } from "../store/drivers";
import { useSessionStore } from "../store/session";

// Mock the API client
vi.mock("../api/client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
  ApiError: class extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

import { apiClient } from "../api/client";

describe("drivers store", () => {
  beforeEach(() => {
    useDriversStore.getState().drivers = [];
    useDriversStore.getState().selectedDriver = null;
    useDriversStore.getState().documents = [];
    useDriversStore.getState().loading = false;
    useDriversStore.getState().error = null;
    useDriversStore.getState().actionLoading = false;
    useDriversStore.getState().actionError = null;
    useDriversStore.getState().searchQuery = "";
    useDriversStore.getState().statusFilter = "all";
    useDriversStore.getState().verificationFilter = "all";
    vi.clearAllMocks();
    useSessionStore.getState().setSession("test-token", "admin-1", "admin", Date.now() + 3600000);
  });

  it("starts with empty state", () => {
    expect(useDriversStore.getState().drivers).toEqual([]);
    expect(useDriversStore.getState().selectedDriver).toBeNull();
    expect(useDriversStore.getState().documents).toEqual([]);
    expect(useDriversStore.getState().loading).toBe(false);
  });

  it("fetches drivers successfully", async () => {
    const mockDrivers = [
      {
        wasla_public_id: "drv_001",
        display_name: "Mohammed",
        status: "active",
        verification_status: "verified",
        declared_availability: "available",
        work_city_zone_id: "jed_01",
        service_kinds: ["ride"],
        suspension_reason_code: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({ drivers: mockDrivers });

    await useDriversStore.getState().fetchDrivers();

    expect(useDriversStore.getState().drivers).toEqual(mockDrivers);
    expect(useDriversStore.getState().loading).toBe(false);
    expect(useDriversStore.getState().error).toBeNull();
  });

  it("handles fetch error", async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));

    await useDriversStore.getState().fetchDrivers();

    expect(useDriversStore.getState().error).toBe("fetch_drivers_failed");
    expect(useDriversStore.getState().loading).toBe(false);
  });

  it("fetches driver documents successfully", async () => {
    const mockDocs = [
      {
        id: "doc_001",
        document_type: "national_id",
        status: "pending",
        vehicle_id: null,
        storage_ref: "ref_001",
        issued_at: null,
        expires_at: null,
        reviewed_at: null,
        reviewed_by: null,
        rejection_reason_code: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({ documents: mockDocs });

    await useDriversStore.getState().fetchDocuments("drv_001");

    expect(useDriversStore.getState().documents).toEqual(mockDocs);
    expect(useDriversStore.getState().loading).toBe(false);
  });

  it("approves document successfully", async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({ documents: [] });

    const result = await useDriversStore.getState().reviewDocument(
      "drv_001",
      "doc_001",
      "approved",
    );

    expect(result).toBe(true);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/drivers/drv_001/documents/doc_001/review",
      { decision: "approved", reviewed_by: "admin-1" },
    );
  });

  it("rejects document with reason code", async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({ documents: [] });

    const result = await useDriversStore.getState().reviewDocument(
      "drv_001",
      "doc_001",
      "rejected",
      "expired_document",
    );

    expect(result).toBe(true);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/drivers/drv_001/documents/doc_001/review",
      { decision: "rejected", reviewed_by: "admin-1", rejection_reason_code: "expired_document" },
    );
  });

  it("suspends driver successfully", async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await useDriversStore.getState().suspendDriver("drv_001", "safety_violation");

    expect(result).toBe(true);
    expect(apiClient.post).toHaveBeenCalledWith("/drivers/drv_001/suspend", {
      reason_code: "safety_violation",
    });
  });

  it("reinstates driver successfully", async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await useDriversStore.getState().reinstateDriver("drv_001");

    expect(result).toBe(true);
    expect(apiClient.post).toHaveBeenCalledWith("/drivers/drv_001/reinstate", {});
  });

  it("sets search and filter values", () => {
    useDriversStore.getState().setSearchQuery("mohammed");
    useDriversStore.getState().setStatusFilter("active");
    useDriversStore.getState().setVerificationFilter("verified");

    expect(useDriversStore.getState().searchQuery).toBe("mohammed");
    expect(useDriversStore.getState().statusFilter).toBe("active");
    expect(useDriversStore.getState().verificationFilter).toBe("verified");
  });

  it("clears selected driver and documents", () => {
    useDriversStore.getState().selectedDriver = {} as never;
    useDriversStore.getState().documents = [{} as never];
    useDriversStore.getState().clearSelected();
    expect(useDriversStore.getState().selectedDriver).toBeNull();
    expect(useDriversStore.getState().documents).toEqual([]);
  });

  it("clears errors", () => {
    useDriversStore.getState().error = "some_error";
    useDriversStore.getState().actionError = "action_error";
    useDriversStore.getState().clearErrors();
    expect(useDriversStore.getState().error).toBeNull();
    expect(useDriversStore.getState().actionError).toBeNull();
  });
});
