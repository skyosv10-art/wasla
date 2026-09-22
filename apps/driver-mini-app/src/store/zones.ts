import { create } from "zustand";
import { apiClient, ApiError } from "../api/client";
import type { ServiceZone, ServiceZoneUpdate, Zone } from "../types/zones";
import { useSessionStore } from "./session";

// Wave 3 (CLM-0294): Zones store per ADR-045 and drivers-service API contract.
// Endpoints:
//   GET /drivers/:id/zones  → { zones: ServiceZone[] }
//   PUT /drivers/:id/zones  → { zones: ServiceZone[] } (full replace)

interface ZonesState {
  zones: ServiceZone[];
  availableZones: Zone[];
  loading: boolean;
  error: string | null;
  saving: boolean;
  saveError: string | null;
  saveSuccess: boolean;

  fetchZones: () => Promise<void>;
  setAvailableZones: (zones: Zone[]) => void;
  saveZones: (updates: ServiceZoneUpdate[]) => Promise<boolean>;
  clearErrors: () => void;
}

export const useZonesStore = create<ZonesState>((set) => ({
  zones: [],
  availableZones: [],
  loading: false,
  error: null,
  saving: false,
  saveError: null,
  saveSuccess: false,

  fetchZones: async () => {
    const { driverId } = useSessionStore.getState();
    if (!driverId) return;

    set({ loading: true, error: null });
    try {
      const data = await apiClient.get<{ zones: ServiceZone[] }>(
        `/drivers/${driverId}/zones`,
      );
      set({ zones: data.zones ?? [], loading: false });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof ApiError ? e.message : "fetch_zones_failed",
      });
    }
  },

  setAvailableZones: (zones: Zone[]) => {
    set({ availableZones: zones });
  },

  saveZones: async (updates: ServiceZoneUpdate[]) => {
    const { driverId } = useSessionStore.getState();
    if (!driverId) return false;

    set({ saving: true, saveError: null, saveSuccess: false });
    try {
      const data = await apiClient.put<{ zones: ServiceZone[] }>(
        `/drivers/${driverId}/zones`,
        { zones: updates },
      );
      set({
        zones: data.zones ?? [],
        saving: false,
        saveSuccess: true,
      });
      return true;
    } catch (e) {
      set({
        saving: false,
        saveError: e instanceof ApiError ? e.message : "save_zones_failed",
      });
      return false;
    }
  },

  clearErrors: () =>
    set({ error: null, saveError: null, saveSuccess: false }),
}));
