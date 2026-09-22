import { create } from "zustand";

// ADR-045 Decision 4 (reuses ADR-044): Session token in memory only, no localStorage.
// Per ADR-019 §2.5, the session token is never persisted to localStorage,
// sessionStorage, or cookies. On page refresh, the app re-initiates the
// session from Telegram initData.

interface SessionState {
  token: string | null;
  driverId: string | null;
  expiresAt: number | null;
  setSession: (token: string, driverId: string, expiresAt: number) => void;
  clearSession: () => void;
  isAuthenticated: () => boolean;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  token: null,
  driverId: null,
  expiresAt: null,
  setSession: (token: string, driverId: string, expiresAt: number) => {
    set({ token, driverId, expiresAt });
  },
  clearSession: () => {
    set({ token: null, driverId: null, expiresAt: null });
  },
  isAuthenticated: () => {
    const { token, expiresAt } = get();
    if (!token || !expiresAt) return false;
    return Date.now() < expiresAt;
  },
}));
