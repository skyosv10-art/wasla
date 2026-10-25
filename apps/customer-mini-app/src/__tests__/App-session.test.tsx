/**
 * G-S8 (CLM-0610): the app shell never parks on an endless loading screen —
 * a failed session init is shown with a retry that calls `retrySession`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "../i18n";

vi.mock("../session/session-init", () => ({ retrySession: vi.fn(async () => false) }));

import { App } from "../App";
import { retrySession } from "../session/session-init";
import { useSessionStore } from "../store/session";

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ token: null, customerId: null, expiresAt: null, initStatus: "idle", initError: null } as never);
});

describe("App session states", () => {
  it("shows the failure reason and a retry button instead of loading when init failed", () => {
    useSessionStore.setState({ initStatus: "failed", initError: "network" });
    const { container } = render(<App />);
    expect(screen.getByRole("alert")).toHaveTextContent("تعذّر الاتصال لبدء الجلسة");
    expect(container.querySelector(".app-loading")).toBeNull();
    fireEvent.click(screen.getByTestId("session-retry"));
    expect(retrySession).toHaveBeenCalledTimes(1);
  });

  it("names the not-in-Telegram case explicitly", () => {
    useSessionStore.setState({ initStatus: "failed", initError: "not_in_telegram" });
    render(<App />);
    expect(screen.getByTestId("session-error")).toHaveTextContent("افتح التطبيق من تلغرام لبدء الجلسة");
  });

  it("shows loading only while an init is in progress", () => {
    useSessionStore.setState({ initStatus: "initializing", initError: null });
    const { container } = render(<App />);
    expect(container.querySelector(".app-loading")).not.toBeNull();
    expect(screen.queryByTestId("session-retry")).toBeNull();
  });
});
