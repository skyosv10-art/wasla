import { create } from "zustand";
import { apiClient } from "../api/client";
import type {
  DeclaredAvailability,
  DriverEligibility,
  DriverProfile,
  ProfilePatch,
} from "../types/profile";
import { useSessionStore } from "./session";

interface ProfileState {
  profile: DriverProfile | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  fetchProfile: () => Promise<void>;
  updateProfile: (patch: ProfilePatch) => Promise<boolean>;
  clearErrors: () => void;
  /** G-S10 (CLM-0613): GET /drivers/:id/eligibility. */
  eligibility: DriverEligibility | null;
  eligibilityLoading: boolean;
  eligibilityError: string | null;
  fetchEligibility: () => Promise<void>;
  /** G-S10 (CLM-0613): PUT /drivers/:id/availability — only `available`/`offline` are declarable. */
  availabilityUpdating: boolean;
  availabilityError: string | null;
  setAvailability: (value: DeclaredAvailability) => Promise<boolean>;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: null,
  loading: false,
  error: null,
  saving: false,
  saveError: null,
  saveSuccess: false,

  fetchProfile: async () => {
    const { driverId } = useSessionStore.getState();
    if (!driverId) return;
    set({ loading: true, error: null });
    try {
      const profile = await apiClient.get<DriverProfile>(
        `/drivers/${driverId}`,
      );
      set({ profile, loading: false });
    } catch {
      set({ error: "fetch_profile_failed", loading: false });
    }
  },

  updateProfile: async (patch: ProfilePatch) => {
    const { driverId } = useSessionStore.getState();
    if (!driverId) return false;
    set({ saving: true, saveError: null, saveSuccess: false });
    try {
      const profile = await apiClient.patch<DriverProfile>(
        `/drivers/${driverId}`,
        patch,
      );
      set({ profile, saving: false, saveSuccess: true });
      return true;
    } catch {
      set({ saveError: "update_profile_failed", saving: false });
      return false;
    }
  },

  clearErrors: () => set({ error: null, saveError: null, saveSuccess: false }),

  eligibility: null,
  eligibilityLoading: false,
  eligibilityError: null,

  fetchEligibility: async () => {
    const { driverId } = useSessionStore.getState();
    if (!driverId) return;
    set({ eligibilityLoading: true, eligibilityError: null });
    try {
      const eligibility = await apiClient.get<DriverEligibility>(
        `/drivers/${driverId}/eligibility`,
      );
      set({ eligibility, eligibilityLoading: false });
    } catch {
      set({ eligibilityError: "fetch_eligibility_failed", eligibilityLoading: false });
    }
  },

  availabilityUpdating: false,
  availabilityError: null,

  setAvailability: async (value: DeclaredAvailability) => {
    const { driverId } = useSessionStore.getState();
    if (!driverId) return false;
    if (get().availabilityUpdating) return false;
    set({ availabilityUpdating: true, availabilityError: null });
    try {
      // The route answers with the full profile; it replaces the cached one so
      // the toggle shows what the server holds, not what was requested.
      const profile = await apiClient.put<DriverProfile>(
        `/drivers/${driverId}/availability`,
        { declared_availability: value },
      );
      set({ profile, availabilityUpdating: false });
      return true;
    } catch {
      set({ availabilityError: "update_availability_failed", availabilityUpdating: false });
      return false;
    }
  },
}));
