// G-S9.7 (CLM-0649 · bounds CLM-0652): store-name search — component behaviour and its wiring
// into the Marketplace screen. apiClient is mocked: these tests prove the
// client's contract use and its stale-response guard, NOT the integration path
// (browser → Channel Edge → search), which is blocked by T1 (see evidence).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StoreSearch, type StoreSearchResult } from "../components/StoreSearch";
import { Marketplace } from "../screens/Marketplace";
import { useSessionStore } from "../store/session";
import i18n from "../i18n";

vi.mock("../api/client", () => ({
  apiClient: { post: vi.fn(), get: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

import { apiClient } from "../api/client";

const mockedGet = apiClient.get as ReturnType<typeof vi.fn>;

const NOOR: StoreSearchResult = { store_slug: "baqala-noor", title: "بقالة النور", category_slug: "groceries" };
const AMAL: StoreSearchResult = { store_slug: "maktabat-amal", title: "مكتبة الأمل", category_slug: "books" };
const page = (items: StoreSearchResult[]) => ({ items, page: 1, page_size: 20, total: items.length });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function type(value: string) {
  fireEvent.change(screen.getByTestId("ss-input"), { target: { value } });
}

describe("StoreSearch component", () => {
  beforeEach(async () => {
    useSessionStore.setState({ token: "t", customerId: "WS-1234567890", expiresAt: Date.now() + 3600000 });
    vi.clearAllMocks();
    await i18n.changeLanguage("ar");
  });

  it("calls the contract path with the trimmed, encoded query, the UI locale and bounded paging — no state/owner filter", async () => {
    mockedGet.mockResolvedValue(page([NOOR]));
    render(<StoreSearch testId="ss" onSelect={() => undefined} />);
    type("  النور ");
    fireEvent.click(screen.getByTestId("ss-button"));
    await screen.findByTestId("ss-results");
    const url = mockedGet.mock.calls[0][0] as string;
    expect(url).toBe(`/search/stores?q=${encodeURIComponent("النور")}&locale=ar&page=1&page_size=20`);
    expect(url).not.toMatch(/state|owner|visible/);
  });

  // CLM-0652 · ADR-025 §6.8 — the client honours the contract's bounds: q 1..200
  // code points after trim, page_size = the contract default (20).
  it("a single character (after trim) is a valid query and reaches the service", async () => {
    mockedGet.mockResolvedValue(page([NOOR]));
    render(<StoreSearch testId="ss" onSelect={() => undefined} />);
    type(" ن ");
    fireEvent.click(screen.getByTestId("ss-button"));
    await screen.findByTestId("ss-results");
    expect(mockedGet).toHaveBeenCalledWith(`/search/stores?q=${encodeURIComponent("ن")}&locale=ar&page=1&page_size=20`);
  });

  it("an empty (whitespace-only) query does not call the service", async () => {
    render(<StoreSearch testId="ss" onSelect={() => undefined} />);
    type("   ");
    fireEvent.click(screen.getByTestId("ss-button"));
    expect(await screen.findByTestId("ss-too-short")).toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("200 code points are sent; 201 are refused client-side and the input is capped at 200", async () => {
    mockedGet.mockResolvedValue(page([]));
    render(<StoreSearch testId="ss" onSelect={() => undefined} />);
    expect(screen.getByTestId("ss-input")).toHaveAttribute("maxLength", "200");
    // Arabic letters are single UTF-16 units; an astral char proves we count code points.
    const twoHundred = "𝐀" + "ب".repeat(199);
    type(twoHundred);
    fireEvent.click(screen.getByTestId("ss-button"));
    await screen.findByTestId("ss-empty");
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet.mock.calls[0][0]).toBe(`/search/stores?q=${encodeURIComponent(twoHundred)}&locale=ar&page=1&page_size=20`);
    type("ب".repeat(201));
    fireEvent.click(screen.getByTestId("ss-button"));
    expect(await screen.findByTestId("ss-too-long")).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it("shows the localized title the service returned", async () => {
    mockedGet.mockResolvedValue(page([NOOR]));
    render(<StoreSearch testId="ss" onSelect={() => undefined} />);
    type("النور");
    fireEvent.keyDown(screen.getByTestId("ss-input"), { key: "Enter" });
    expect((await screen.findByTestId("ss-result-baqala-noor")).textContent).toBe("بقالة النور");
  });

  it("no match → empty state; failure → error, no results", async () => {
    mockedGet.mockResolvedValueOnce(page([]));
    render(<StoreSearch testId="ss" onSelect={() => undefined} />);
    type("zzzz");
    fireEvent.click(screen.getByTestId("ss-button"));
    expect(await screen.findByTestId("ss-empty")).toBeInTheDocument();
    mockedGet.mockRejectedValueOnce(new Error("network"));
    fireEvent.click(screen.getByTestId("ss-button"));
    expect(await screen.findByTestId("ss-error")).toBeInTheDocument();
    expect(screen.queryByTestId("ss-results")).toBeNull();
  });

  it("a late response to an older search never replaces a newer one", async () => {
    const first = deferred<ReturnType<typeof page>>();
    mockedGet.mockImplementation((url: string) =>
      url.includes(encodeURIComponent("الأمل")) ? first.promise : Promise.resolve(page([NOOR]))
    );
    render(<StoreSearch testId="ss" onSelect={() => undefined} />);
    type("الأمل");
    fireEvent.click(screen.getByTestId("ss-button"));
    type("النور");
    fireEvent.keyDown(screen.getByTestId("ss-input"), { key: "Enter" });
    await screen.findByTestId("ss-result-baqala-noor");
    first.resolve(page([AMAL]));
    await first.promise;
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("ss-result-maktabat-amal")).toBeNull();
    expect(screen.getByTestId("ss-result-baqala-noor")).toBeInTheDocument();
  });

  it("uses the UI language as locale (ur)", async () => {
    await i18n.changeLanguage("ur");
    mockedGet.mockResolvedValue(page([]));
    render(<StoreSearch testId="ss" onSelect={() => undefined} />);
    type("noor");
    fireEvent.click(screen.getByTestId("ss-button"));
    await screen.findByTestId("ss-empty");
    expect(mockedGet).toHaveBeenCalledWith("/search/stores?q=noor&locale=ur&page=1&page_size=20");
    await i18n.changeLanguage("ar");
  });
});

describe("Marketplace — store-name search wiring (G-S9.7)", () => {
  beforeEach(async () => {
    useSessionStore.setState({ token: "t", customerId: "WS-1234567890", expiresAt: Date.now() + 3600000 });
    vi.clearAllMocks();
    await i18n.changeLanguage("ar");
  });

  it("choosing a result opens that store's products", async () => {
    mockedGet.mockImplementation((url: string) => {
      if (url === "/stores") return Promise.resolve({ items: [], limit: 20 });
      if (url.startsWith("/search/stores")) return Promise.resolve(page([NOOR]));
      if (url === "/stores/baqala-noor/products") return Promise.resolve({ items: [], limit: 20 });
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<Marketplace />);
    fireEvent.change(await screen.findByTestId("store-search-input"), { target: { value: "النور" } });
    fireEvent.click(screen.getByTestId("store-search-button"));
    fireEvent.click(await screen.findByTestId("store-search-result-baqala-noor"));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith("/stores/baqala-noor/products"));
    expect(screen.getByTestId("selected-store-name").textContent).toBe("baqala-noor");
  });
});
