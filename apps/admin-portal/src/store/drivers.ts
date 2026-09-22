import { create } from "zustand";
import { apiClient } from "../api/client";
import { useSessionStore } from "./session";
import type {
  DriverSummary,
  DriverListResponse,
  DriverDetail,
  DriverDocument,
  DriverDocumentList,
  ReviewDocumentRequest,
  SuspendDriverRequest,
} from "../types/drivers";

interface DriversState {
  drivers: DriverSummary[];
  selectedDriver: DriverDetail | null;
  documents: DriverDocument[];
  loading: boolean;
  error: string | null;
  actionLoading: boolean;
  actionError: string | null;
  searchQuery: string;
  statusFilter: string;
  verificationFilter: string;
  fetchDrivers: () => Promise<void>;
  fetchDriverDetail: (id: string) => Promise<void>;
  fetchDocuments: (id: string) => Promise<void>;
  reviewDocument: (
    driverId: string,
    documentId: string,
    decision: "approved" | "rejected",
    rejectionReasonCode?: string,
  ) => Promise<boolean>;
  suspendDriver: (id: string, reasonCode: string) => Promise<boolean>;
  reinstateDriver: (id: string) => Promise<boolean>;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (filter: string) => void;
  setVerificationFilter: (filter: string) => void;
  clearSelected: () => void;
  clearErrors: () => void;
}

export const useDriversStore = create<DriversState>((set, get) => ({
  drivers: [],
  selectedDriver: null,
  documents: [],
  loading: false,
  error: null,
  actionLoading: false,
  actionError: null,
  searchQuery: "",
  statusFilter: "all",
  verificationFilter: "all",

  fetchDrivers: async () => {
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams();
      const { searchQuery, statusFilter, verificationFilter } = get();
      if (searchQuery) params.set("q", searchQuery);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (verificationFilter !== "all") params.set("verification", verificationFilter);
      const qs = params.toString();
      const path = qs ? `/drivers?${qs}` : "/drivers";
      const result = await apiClient.get<DriverListResponse>(path);
      set({ drivers: result.drivers ?? [], loading: false });
    } catch {
      set({ error: "fetch_drivers_failed", loading: false });
    }
  },

  fetchDriverDetail: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const detail = await apiClient.get<DriverDetail>(`/drivers/${id}`);
      set({ selectedDriver: detail, loading: false });
    } catch {
      set({ error: "fetch_driver_detail_failed", loading: false });
    }
  },

  fetchDocuments: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const result = await apiClient.get<DriverDocumentList>(`/drivers/${id}/documents`);
      set({ documents: result.documents ?? [], loading: false });
    } catch {
      set({ error: "fetch_documents_failed", loading: false });
    }
  },

  reviewDocument: async (
    driverId: string,
    documentId: string,
    decision: "approved" | "rejected",
    rejectionReasonCode?: string,
  ) => {
    set({ actionLoading: true, actionError: null });
    try {
      const { userId } = useSessionStore.getState();
      const body: ReviewDocumentRequest = {
        decision,
        reviewed_by: userId ?? "admin",
      };
      if (decision === "rejected" && rejectionReasonCode) {
        body.rejection_reason_code = rejectionReasonCode;
      }
      await apiClient.post(
        `/drivers/${driverId}/documents/${documentId}/review`,
        body,
      );
      // Refresh documents after review
      const result = await apiClient.get<DriverDocumentList>(
        `/drivers/${driverId}/documents`,
      );
      set({ documents: result.documents ?? [], actionLoading: false });
      return true;
    } catch {
      set({ actionError: "review_document_failed", actionLoading: false });
      return false;
    }
  },

  suspendDriver: async (id: string, reasonCode: string) => {
    set({ actionLoading: true, actionError: null });
    try {
      const body: SuspendDriverRequest = { reason_code: reasonCode };
      await apiClient.post(`/drivers/${id}/suspend`, body);
      set({ actionLoading: false });
      return true;
    } catch {
      set({ actionError: "suspend_driver_failed", actionLoading: false });
      return false;
    }
  },

  reinstateDriver: async (id: string) => {
    set({ actionLoading: true, actionError: null });
    try {
      await apiClient.post(`/drivers/${id}/reinstate`, {});
      set({ actionLoading: false });
      return true;
    } catch {
      set({ actionError: "reinstate_driver_failed", actionLoading: false });
      return false;
    }
  },

  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setStatusFilter: (filter: string) => set({ statusFilter: filter }),
  setVerificationFilter: (filter: string) => set({ verificationFilter: filter }),
  clearSelected: () => set({ selectedDriver: null, documents: [] }),
  clearErrors: () => set({ error: null, actionError: null }),
}));
