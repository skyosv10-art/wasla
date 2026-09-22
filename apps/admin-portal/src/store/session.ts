import { create } from "zustand";

// ADR-047: Session token in memory only, no localStorage.
// Admin portal authenticates via identity service JWT.

interface SessionState {
  token: string | null;
  userId: string | null;
  role: string | null;
  expiresAt: number | null;
  setSession: (token: string, userId: string, role: string, expiresAt: number) => void;
  clearSession: () => void;
  isAuthenticated: () => boolean;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  token: null,
  userId: null,
  role: null,
  expiresAt: null,
  setSession: (token, userId, role, expiresAt) => {
    set({ token, userId, role, expiresAt });
  },
  clearSession: () => {
    set({ token: null, userId: null, role: null, expiresAt: null });
  },
  isAuthenticated: () => {
    const { token, expiresAt } = get();
    if (!token || !expiresAt) return false;
    return Date.now() < expiresAt;
  },
}));
