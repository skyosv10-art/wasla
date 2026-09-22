import { create } from "zustand";
import { apiClient } from "../api/client";
import type { DriverProfile, ProfilePatch } from "../types/profile";
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
}

export const useProfileStore = create<ProfileState>((set) => ({
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
}));
