import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "../store/session";

describe("session store", () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
  });

  it("starts unauthenticated", () => {
    expect(useSessionStore.getState().isAuthenticated()).toBe(false);
  });

  it("sets session and authenticates", () => {
    const future = Date.now() + 3600000;
    useSessionStore.getState().setSession("token", "user_1", "operator", future);
    expect(useSessionStore.getState().isAuthenticated()).toBe(true);
    expect(useSessionStore.getState().token).toBe("token");
    expect(useSessionStore.getState().role).toBe("operator");
  });

  it("clears session on clearSession", () => {
    const future = Date.now() + 3600000;
    useSessionStore.getState().setSession("token", "user_1", "admin", future);
    useSessionStore.getState().clearSession();
    expect(useSessionStore.getState().isAuthenticated()).toBe(false);
    expect(useSessionStore.getState().token).toBeNull();
  });

  it("is unauthenticated when expired", () => {
    const past = Date.now() - 1000;
    useSessionStore.getState().setSession("token", "user_1", "operator", past);
    expect(useSessionStore.getState().isAuthenticated()).toBe(false);
  });
});
