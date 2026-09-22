import { create } from "zustand";
import { apiClient } from "../api/client";
import type {
  UserSummary,
  UserListResponse,
  UserDetail,
  SuspendUserRequest,
} from "../types/users";

interface UsersState {
  users: UserSummary[];
  selectedUser: UserDetail | null;
  loading: boolean;
  error: string | null;
  actionLoading: boolean;
  actionError: string | null;
  searchQuery: string;
  statusFilter: string;
  fetchUsers: () => Promise<void>;
  fetchUserDetail: (id: string) => Promise<void>;
  suspendUser: (id: string, reasonCode: string) => Promise<boolean>;
  reinstateUser: (id: string) => Promise<boolean>;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (filter: string) => void;
  clearSelected: () => void;
  clearErrors: () => void;
}

export const useUsersStore = create<UsersState>((set, get) => ({
  users: [],
  selectedUser: null,
  loading: false,
  error: null,
  actionLoading: false,
  actionError: null,
  searchQuery: "",
  statusFilter: "all",

  fetchUsers: async () => {
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams();
      const { searchQuery, statusFilter } = get();
      if (searchQuery) params.set("q", searchQuery);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const qs = params.toString();
      const path = qs ? `/customers?${qs}` : "/customers";
      const result = await apiClient.get<UserListResponse>(path);
      set({ users: result.customers ?? [], loading: false });
    } catch {
      set({ error: "fetch_users_failed", loading: false });
    }
  },

  fetchUserDetail: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const detail = await apiClient.get<UserDetail>(`/customers/${id}`);
      set({ selectedUser: detail, loading: false });
    } catch {
      set({ error: "fetch_user_detail_failed", loading: false });
    }
  },

  suspendUser: async (id: string, reasonCode: string) => {
    set({ actionLoading: true, actionError: null });
    try {
      const body: SuspendUserRequest = { reason_code: reasonCode };
      await apiClient.post(`/customers/${id}/suspend`, body);
      set({ actionLoading: false });
      return true;
    } catch {
      set({ actionError: "suspend_user_failed", actionLoading: false });
      return false;
    }
  },

  reinstateUser: async (id: string) => {
    set({ actionLoading: true, actionError: null });
    try {
      await apiClient.post(`/customers/${id}/reinstate`, {});
      set({ actionLoading: false });
      return true;
    } catch {
      set({ actionError: "reinstate_user_failed", actionLoading: false });
      return false;
    }
  },

  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setStatusFilter: (filter: string) => set({ statusFilter: filter }),
  clearSelected: () => set({ selectedUser: null }),
  clearErrors: () => set({ error: null, actionError: null }),
}));
