import { create } from "zustand";

export interface SavedPlace {
  place_id: string;
  label: string;
  zone_id: string;
  zone_path?: string[] | null;
  created_at: string;
}

type PlacesStatus = "idle" | "loading" | "success" | "error";

interface PlacesState {
  places: SavedPlace[];
  status: PlacesStatus;
  error: string | null;

  setPlaces: (places: SavedPlace[]) => void;
  setStatus: (status: PlacesStatus) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  places: [] as SavedPlace[],
  status: "idle" as PlacesStatus,
  error: null as string | null,
};

export const usePlacesStore = create<PlacesState>((set) => ({
  ...initialState,
  setPlaces: (places) => set({ places }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  reset: () => set({ ...initialState }),
}));
