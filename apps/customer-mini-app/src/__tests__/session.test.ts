import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "../store/session";

describe("Session Store", () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
  });

  it("starts unauthenticated", () => {
    expect(useSessionStore.getState().isAuthenticated()).toBe(false);
  });

  it("stores token in memory only", () => {
    useSessionStore.getState().setSession("test-token", Date.now() + 3600_000);
    expect(useSessionStore.getState().token).toBe("test-token");
    expect(useSessionStore.getState().isAuthenticated()).toBe(true);
  });

  it("does not persist to localStorage", () => {
    useSessionStore.getState().setSession("test-token", Date.now() + 3600_000);
    expect(window.localStorage.getItem("token")).toBeNull();
  });

  it("clears session on clearSession()", () => {
    useSessionStore.getState().setSession("test-token", Date.now() + 3600_000);
    useSessionStore.getState().clearSession();
    expect(useSessionStore.getState().token).toBeNull();
    expect(useSessionStore.getState().isAuthenticated()).toBe(false);
  });

  it("reports expired session", () => {
    useSessionStore.getState().setSession("test-token", Date.now() - 1000);
    expect(useSessionStore.getState().isAuthenticated()).toBe(false);
  });
});
