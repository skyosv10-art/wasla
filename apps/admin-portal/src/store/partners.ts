/**
 * Partners store for admin portal.
 *
 * Manages partner lifecycle state and API calls to the partners service.
 * Uses the admin API client with Bearer token authentication.
 */

import { create } from "zustand";
import { apiClient } from "../api/client";
import type {
  PartnerLifecycle,
  PartnerCredential,
  PartnerUsage,
  PartnerAuditEntry,
} from "../types/partners";

interface PartnersState {
  lifecycles: PartnerLifecycle[];
  credentials: PartnerCredential[];
  usage: PartnerUsage | null;
  auditEntries: PartnerAuditEntry[];
  loading: boolean;
  error: string | null;
  selectedStoreId: string | null;

  fetchLifecycles: (storeId: string) => Promise<void>;
  fetchCredentials: (storeId: string) => Promise<void>;
  fetchUsage: (storeId: string) => Promise<void>;
  fetchAudit: (storeId: string) => Promise<void>;
  suspendTenant: (storeId: string, reason: string) => Promise<void>;
  reinstateTenant: (storeId: string) => Promise<void>;
  issueCredential: (
    storeId: string,
    scopes: string[],
  ) => Promise<{ plaintextKey: string; keyPrefix: string }>;
  revokeCredential: (storeId: string, credentialId: string) => Promise<void>;
  setSelectedStoreId: (storeId: string | null) => void;
  clearError: () => void;
}

export const usePartnersStore = create<PartnersState>((set, get) => ({
  lifecycles: [],
  credentials: [],
  usage: null,
  auditEntries: [],
  loading: false,
  error: null,
  selectedStoreId: null,

  fetchLifecycles: async (storeId: string) => {
    set({ loading: true, error: null });
    try {
      const data = await apiClient.get<{ state: string; slaTier: string; suspendedAt: string | null; offboardedAt: string | null; createdAt: string; updatedAt: string }>(
        `/api/partners/lifecycle?storeId=${storeId}`,
      );
      set({
        lifecycles: [
          {
            tenantStoreId: storeId,
            state: data.state as PartnerLifecycle["state"],
            slaTier: data.slaTier as PartnerLifecycle["slaTier"],
            suspendedAt: data.suspendedAt,
            offboardedAt: data.offboardedAt,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          },
        ],
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch lifecycle",
      });
    }
  },

  fetchCredentials: async (storeId: string) => {
    set({ loading: true, error: null });
    try {
      const data = await apiClient.get<{ credentials: PartnerCredential[] }>(
        `/api/partners/credentials?storeId=${storeId}`,
      );
      set({ credentials: data.credentials, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch credentials",
      });
    }
  },

  fetchUsage: async (storeId: string) => {
    set({ loading: true, error: null });
    try {
      const data = await apiClient.get<PartnerUsage>(
        `/api/partners/usage?storeId=${storeId}`,
      );
      set({ usage: data, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch usage",
      });
    }
  },

  fetchAudit: async (storeId: string) => {
    set({ loading: true, error: null });
    try {
      const data = await apiClient.get<{ entries: PartnerAuditEntry[] }>(
        `/api/partners/audit?storeId=${storeId}`,
      );
      set({ auditEntries: data.entries, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch audit",
      });
    }
  },

  suspendTenant: async (storeId: string, reason: string) => {
    set({ loading: true, error: null });
    try {
      await apiClient.post(`/api/partners/lifecycle/suspend`, { storeId, reason });
      await get().fetchLifecycles(storeId);
      set({ loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to suspend tenant",
      });
    }
  },

  reinstateTenant: async (storeId: string) => {
    set({ loading: true, error: null });
    try {
      await apiClient.post(`/api/partners/lifecycle/reinstate`, { storeId });
      await get().fetchLifecycles(storeId);
      set({ loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to reinstate tenant",
      });
    }
  },

  issueCredential: async (storeId: string, scopes: string[]) => {
    set({ loading: true, error: null });
    try {
      const data = await apiClient.post<{ plaintextKey: string; keyPrefix: string }>(
        `/api/partners/credentials`,
        { storeId, scopes },
      );
      await get().fetchCredentials(storeId);
      set({ loading: false });
      return data;
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to issue credential",
      });
      throw err;
    }
  },

  revokeCredential: async (storeId: string, credentialId: string) => {
    set({ loading: true, error: null });
    try {
      await apiClient.del(`/api/partners/credentials/${credentialId}`);
      await get().fetchCredentials(storeId);
      set({ loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to revoke credential",
      });
    }
  },

  setSelectedStoreId: (storeId: string | null) => set({ selectedStoreId: storeId }),
  clearError: () => set({ error: null }),
}));
