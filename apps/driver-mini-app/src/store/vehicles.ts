import { create } from "zustand";
import { apiClient, ApiError } from "../api/client";
import type { Vehicle, VehicleRegistration, VehiclePatch } from "../types/vehicles";
import { useSessionStore } from "./session";

// Wave 3 (CLM-0294): Vehicles store per ADR-045 and drivers-service API contract.
// Endpoints:
//   GET  /drivers/:id/vehicles           → { items: Vehicle[] }
//   POST /drivers/:id/vehicles           (Idempotency-Key) → Vehicle
//   PATCH /drivers/:id/vehicles/:vehicleId → Vehicle

interface VehiclesState {
  vehicles: Vehicle[];
  loading: boolean;
  error: string | null;
  actionLoading: boolean;
  actionError: string | null;

  fetchVehicles: () => Promise<void>;
  addVehicle: (registration: VehicleRegistration) => Promise<boolean>;
  patchVehicle: (vehicleId: string, patch: VehiclePatch) => Promise<boolean>;
  clearErrors: () => void;
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const useVehiclesStore = create<VehiclesState>((set) => ({
  vehicles: [],
  loading: false,
  error: null,
  actionLoading: false,
  actionError: null,

  fetchVehicles: async () => {
    const { driverId } = useSessionStore.getState();
    if (!driverId) return;

    set({ loading: true, error: null });
    try {
      const data = await apiClient.get<{ items: Vehicle[] }>(
        `/drivers/${driverId}/vehicles`,
      );
      set({ vehicles: data.items ?? [], loading: false });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof ApiError ? e.message : "fetch_vehicles_failed",
      });
    }
  },

  addVehicle: async (registration: VehicleRegistration) => {
    const { driverId } = useSessionStore.getState();
    if (!driverId) return false;

    set({ actionLoading: true, actionError: null });
    try {
      const vehicle = await apiClient.post<Vehicle>(
        `/drivers/${driverId}/vehicles`,
        registration,
        { "Idempotency-Key": generateIdempotencyKey() },
      );
      set((s) => ({
        vehicles: [...s.vehicles, vehicle],
        actionLoading: false,
      }));
      return true;
    } catch (e) {
      set({
        actionLoading: false,
        actionError: e instanceof ApiError ? e.message : "add_vehicle_failed",
      });
      return false;
    }
  },

  patchVehicle: async (vehicleId: string, patch: VehiclePatch) => {
    const { driverId } = useSessionStore.getState();
    if (!driverId) return false;

    set({ actionLoading: true, actionError: null });
    try {
      const updated = await apiClient.patch<Vehicle>(
        `/drivers/${driverId}/vehicles/${vehicleId}`,
        patch,
      );
      set((s) => ({
        vehicles: s.vehicles.map((v) => (v.id === vehicleId ? updated : v)),
        actionLoading: false,
      }));
      return true;
    } catch (e) {
      set({
        actionLoading: false,
        actionError: e instanceof ApiError ? e.message : "patch_vehicle_failed",
      });
      return false;
    }
  },

  clearErrors: () => set({ error: null, actionError: null }),
}));
