import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "../store/session";

describe("session store", () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
  });

  it("starts unauthenticated", () => {
    const state = useSessionStore.getState();
    expect(state.token).toBeNull();
    expect(state.driverId).toBeNull();
    expect(state.expiresAt).toBeNull();
    expect(state.isAuthenticated()).toBe(false);
  });

  it("sets session and becomes authenticated", () => {
    const future = Date.now() + 3600_000;
    useSessionStore.getState().setSession("tok-123", "drv-456", future);
    const state = useSessionStore.getState();
    expect(state.token).toBe("tok-123");
    expect(state.driverId).toBe("drv-456");
    expect(state.expiresAt).toBe(future);
    expect(state.isAuthenticated()).toBe(true);
  });

  it("clears session and becomes unauthenticated", () => {
    const future = Date.now() + 3600_000;
    useSessionStore.getState().setSession("tok-123", "drv-456", future);
    useSessionStore.getState().clearSession();
    const state = useSessionStore.getState();
    expect(state.token).toBeNull();
    expect(state.driverId).toBeNull();
    expect(state.expiresAt).toBeNull();
    expect(state.isAuthenticated()).toBe(false);
  });

  it("is not authenticated when token is expired", () => {
    const past = Date.now() - 1000;
    useSessionStore.getState().setSession("tok-123", "drv-456", past);
    expect(useSessionStore.getState().isAuthenticated()).toBe(false);
  });
});
