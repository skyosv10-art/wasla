import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Marketplace } from "../screens/Marketplace";
import { useSessionStore } from "../store/session";
import "../i18n";

vi.mock("../api/client", () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

import { apiClient } from "../api/client";

const mockedGet = apiClient.get as ReturnType<typeof vi.fn>;

describe("Marketplace screen", () => {
  beforeEach(() => {
    useSessionStore.setState({ token: "test-token", customerId: "WS-1234567890", expiresAt: Date.now() + 3600000 });
    vi.clearAllMocks();
  });

  it("loads stores on mount", async () => {
    mockedGet.mockResolvedValueOnce({
      items: [{ store_id: "s1", slug: "store-1", display_name: "Store One" }],
      limit: 20,
    });

    render(<Marketplace />);

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith("/stores");
    });
  });

  it("renders stores list", async () => {
    mockedGet.mockResolvedValueOnce({
      items: [
        { store_id: "s1", slug: "store-1", display_name: "Store One", description: "Best store" },
        { store_id: "s2", slug: "store-2", display_name: "Store Two" },
      ],
      limit: 20,
    });

    render(<Marketplace />);

    await waitFor(() => {
      expect(screen.getByTestId("stores-list")).toBeInTheDocument();
    });
    expect(screen.getByTestId("store-store-1")).toBeInTheDocument();
    expect(screen.getByTestId("store-store-2")).toBeInTheDocument();
  });

  it("shows empty state when no stores", async () => {
    mockedGet.mockResolvedValueOnce({ items: [], limit: 20 });

    render(<Marketplace />);

    await waitFor(() => {
      expect(screen.getByTestId("stores-empty")).toBeInTheDocument();
    });
  });

  it("shows error on failure", async () => {
    mockedGet.mockRejectedValueOnce(new Error("load_failed"));

    render(<Marketplace />);

    await waitFor(() => {
      expect(screen.getByTestId("marketplace-error")).toBeInTheDocument();
    });
  });

  it("loads products when store is clicked", async () => {
    mockedGet.mockResolvedValueOnce({
      items: [{ store_id: "s1", slug: "store-1", display_name: "Store One" }],
      limit: 20,
    });
    mockedGet.mockResolvedValueOnce({
      items: [{ product_id: "p1", store_slug: "store-1", name: "Product 1", price: 10, currency: "SAR", status: "published" }],
      limit: 20,
    });

    render(<Marketplace />);

    await waitFor(() => {
      expect(screen.getByTestId("store-store-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("store-store-1"));

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith("/stores/store-1/products");
    });
    await waitFor(() => {
      expect(screen.getByTestId("products-list")).toBeInTheDocument();
    });
  });
});
