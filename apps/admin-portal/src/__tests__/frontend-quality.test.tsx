import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { initialLocale, applyLocale } from "../i18n";
import { OfflineBanner } from "../components/OfflineBanner";
import { apiClient } from "../api/client";

// M3-06: frontend quality contract — locale override, offline banner,
// and network/timeout error mapping in the API client.

describe("locale selection (?locale=)", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
    applyLocale("ar");
  });

  it("defaults to Arabic RTL", () => {
    expect(initialLocale()).toBe("ar");
  });

  it("accepts ?locale=en and switches document lang/dir", () => {
    window.history.pushState({}, "", "/?locale=en");
    expect(initialLocale()).toBe("en");
    applyLocale("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("ur stays RTL", () => {
    window.history.pushState({}, "", "/?locale=ur");
    expect(initialLocale()).toBe("ur");
    applyLocale("ur");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("rejects unknown locales back to Arabic", () => {
    window.history.pushState({}, "", "/?locale=fr");
    expect(initialLocale()).toBe("ar");
  });
});

describe("offline banner", () => {
  beforeEach(() => {
    cleanup();
  });

  it("is hidden while online and appears on the offline event", () => {
    const { unmount } = render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByTestId("offline-banner").textContent).toContain("غير متصل");
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    unmount();
  });
});

describe("api client network error mapping", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    cleanup();
  });

  it("maps a fetch TypeError rejection to network_error (status 0)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(apiClient.get("/customers")).rejects.toMatchObject({
      status: 0,
      message: "network_error",
    });
  });

  it("maps an aborted request to timeout (status 408)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    );
    const expectation = expect(apiClient.get("/customers")).rejects.toMatchObject({
      status: 408,
      message: "timeout",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await expectation;
  });
});
