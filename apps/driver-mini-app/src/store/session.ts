import { create } from "zustand";

// ADR-045 Decision 4 (reuses ADR-044): Session token in memory only, no localStorage.
// Per ADR-019 §2.5, the session token is never persisted to localStorage,
// sessionStorage, or cookies. On page refresh, the app re-initiates the
// session from Telegram initData.

/**
 * G-S8 (CLM-0610): the init outcome is state, not a silent boolean — the app
 * renders a failure with a retry instead of an endless loading screen.
 */
export type SessionInitStatus = "idle" | "initializing" | "ready" | "failed";
export type SessionInitError =
  | "not_in_telegram"
  | "edge_rejected"
  | "network"
  | "invalid_response"
  | "retry_limit";

interface SessionState {
  token: string | null;
  driverId: string | null;
  expiresAt: number | null;
  setSession: (token: string, driverId: string, expiresAt: number) => void;
  clearSession: () => void;
  isAuthenticated: () => boolean;
  initStatus: SessionInitStatus;
  initError: SessionInitError | null;
  setInitState: (status: SessionInitStatus, error?: SessionInitError | null) => void;
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
  initStatus: "idle",
  initError: null,
  setInitState: (status: SessionInitStatus, error: SessionInitError | null = null) => {
    set({ initStatus: status, initError: error });
  },
}));
