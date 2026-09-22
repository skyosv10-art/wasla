import { describe, it, expect, beforeEach } from "vitest";
import { useUsersStore } from "../store/users";
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

describe("users store", () => {
  beforeEach(() => {
    useUsersStore.getState().users = [];
    useUsersStore.getState().selectedUser = null;
    useUsersStore.getState().loading = false;
    useUsersStore.getState().error = null;
    useUsersStore.getState().actionLoading = false;
    useUsersStore.getState().actionError = null;
    useUsersStore.getState().searchQuery = "";
    useUsersStore.getState().statusFilter = "all";
    vi.clearAllMocks();
    // Set up authenticated session
    useSessionStore.getState().setSession("test-token", "admin-1", "admin", Date.now() + 3600000);
  });

  it("starts with empty state", () => {
    expect(useUsersStore.getState().users).toEqual([]);
    expect(useUsersStore.getState().selectedUser).toBeNull();
    expect(useUsersStore.getState().loading).toBe(false);
  });

  it("fetches users successfully", async () => {
    const mockUsers = [
      {
        wasla_public_id: "usr_001",
        display_name: "Ahmed",
        phone_number: "+966500000000",
        preferred_locale: "ar",
        status: "active",
        suspension_reason_code: null,
        order_count: 5,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({ customers: mockUsers });

    await useUsersStore.getState().fetchUsers();

    expect(useUsersStore.getState().users).toEqual(mockUsers);
    expect(useUsersStore.getState().loading).toBe(false);
    expect(useUsersStore.getState().error).toBeNull();
  });

  it("handles fetch error", async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));

    await useUsersStore.getState().fetchUsers();

    expect(useUsersStore.getState().error).toBe("fetch_users_failed");
    expect(useUsersStore.getState().loading).toBe(false);
    expect(useUsersStore.getState().users).toEqual([]);
  });

  it("suspends user successfully", async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await useUsersStore.getState().suspendUser("usr_001", "admin_action");

    expect(result).toBe(true);
    expect(apiClient.post).toHaveBeenCalledWith("/customers/usr_001/suspend", {
      reason_code: "admin_action",
    });
  });

  it("handles suspend error", async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("forbidden"));

    const result = await useUsersStore.getState().suspendUser("usr_001", "admin_action");

    expect(result).toBe(false);
    expect(useUsersStore.getState().actionError).toBe("suspend_user_failed");
  });

  it("reinstates user successfully", async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await useUsersStore.getState().reinstateUser("usr_001");

    expect(result).toBe(true);
    expect(apiClient.post).toHaveBeenCalledWith("/customers/usr_001/reinstate", {});
  });

  it("sets search query and status filter", () => {
    useUsersStore.getState().setSearchQuery("ahmed");
    useUsersStore.getState().setStatusFilter("active");

    expect(useUsersStore.getState().searchQuery).toBe("ahmed");
    expect(useUsersStore.getState().statusFilter).toBe("active");
  });

  it("clears selected user", () => {
    useUsersStore.getState().selectedUser = {} as never;
    useUsersStore.getState().clearSelected();
    expect(useUsersStore.getState().selectedUser).toBeNull();
  });

  it("clears errors", () => {
    useUsersStore.getState().error = "some_error";
    useUsersStore.getState().actionError = "action_error";
    useUsersStore.getState().clearErrors();
    expect(useUsersStore.getState().error).toBeNull();
    expect(useUsersStore.getState().actionError).toBeNull();
  });
});
