import { describe, it, expect, vi, beforeEach } from "vitest";
import { useProfileStore } from "../store/profile";
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

const mockProfile = {
  wasla_public_id: "drv-123",
  display_name: "Ahmed",
  preferred_locale: "ar",
  status: "active" as const,
  verification_status: "verified" as const,
  declared_availability: "available" as const,
  work_city_zone_id: "zone-1",
  service_kinds: ["ride"] as ("ride" | "delivery")[],
  suspension_reason_code: null,
  eligibility_policy_version: 1,
  eligibility_recheck_at: null,
  last_published_state: null,
  last_published_at: null,
  created_at: "",
  updated_at: "",
};

describe("Profile store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProfileStore.setState({
      profile: null,
      loading: false,
      error: null,
      saving: false,
      saveError: null,
      saveSuccess: false,
      fetchProfile: useProfileStore.getState().fetchProfile,
      updateProfile: useProfileStore.getState().updateProfile,
      clearErrors: useProfileStore.getState().clearErrors,
    });
    useSessionStore.getState().setSession("token-123", "drv-123", Date.now() + 3_600_000);
  });

  it("fetchProfile populates profile on success", async () => {
    mockApi.get.mockResolvedValue(mockProfile);
    await useProfileStore.getState().fetchProfile();
    expect(useProfileStore.getState().profile).toEqual(mockProfile);
    expect(useProfileStore.getState().loading).toBe(false);
  });

  it("fetchProfile sets error on failure", async () => {
    mockApi.get.mockRejectedValue(new Error("Network error"));
    await useProfileStore.getState().fetchProfile();
    expect(useProfileStore.getState().error).toBe("fetch_profile_failed");
    expect(useProfileStore.getState().loading).toBe(false);
  });

  it("updateProfile sends PATCH request", async () => {
    const updated = { ...mockProfile, display_name: "Ali" };
    mockApi.patch.mockResolvedValue(updated);
    const result = await useProfileStore.getState().updateProfile({ display_name: "Ali" });
    expect(result).toBe(true);
    expect(mockApi.patch).toHaveBeenCalledWith("/drivers/drv-123", { display_name: "Ali" });
    expect(useProfileStore.getState().profile?.display_name).toBe("Ali");
    expect(useProfileStore.getState().saveSuccess).toBe(true);
  });

  it("updateProfile sets saveError on failure", async () => {
    mockApi.patch.mockRejectedValue(new Error("Validation failed"));
    const result = await useProfileStore.getState().updateProfile({ display_name: "Ali" });
    expect(result).toBe(false);
    expect(useProfileStore.getState().saveError).toBe("update_profile_failed");
    expect(useProfileStore.getState().saving).toBe(false);
  });

  it("clearErrors resets all error states", () => {
    useProfileStore.setState({ error: "some error", saveError: "save error", saveSuccess: true });
    useProfileStore.getState().clearErrors();
    expect(useProfileStore.getState().error).toBeNull();
    expect(useProfileStore.getState().saveError).toBeNull();
    expect(useProfileStore.getState().saveSuccess).toBe(false);
  });

  it("updateProfile returns false when no driverId", async () => {
    useSessionStore.getState().clearSession();
    const result = await useProfileStore.getState().updateProfile({ display_name: "Ali" });
    expect(result).toBe(false);
  });
});
