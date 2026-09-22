import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SavedPlaces } from "../screens/SavedPlaces";
import { usePlacesStore } from "../store/places";
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
const mockedPost = apiClient.post as ReturnType<typeof vi.fn>;
const mockedDel = apiClient.del as ReturnType<typeof vi.fn>;

describe("SavedPlaces screen", () => {
  beforeEach(() => {
    usePlacesStore.getState().reset();
    useSessionStore.setState({ token: "test-token", customerId: "WS-1234567890", expiresAt: Date.now() + 3600000 });
    vi.clearAllMocks();
  });

  it("loads places on mount", async () => {
    mockedGet.mockResolvedValueOnce({ items: [], limit: 20 });

    render(<SavedPlaces />);

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith("/customers/WS-1234567890/places");
    });
  });

  it("shows empty state when no places", async () => {
    mockedGet.mockResolvedValueOnce({ items: [], limit: 20 });

    render(<SavedPlaces />);

    await waitFor(() => {
      expect(screen.getByTestId("places-empty")).toBeInTheDocument();
    });
  });

  it("renders places list", async () => {
    mockedGet.mockResolvedValueOnce({
      items: [
        { place_id: "p1", label: "Home", zone_id: "zone-1", created_at: "2026-01-01" },
        { place_id: "p2", label: "Work", zone_id: "zone-2", created_at: "2026-01-02" },
      ],
      limit: 20,
    });

    render(<SavedPlaces />);

    await waitFor(() => {
      expect(screen.getByTestId("places-list")).toBeInTheDocument();
    });
    expect(screen.getByTestId("place-p1")).toBeInTheDocument();
    expect(screen.getByTestId("place-p2")).toBeInTheDocument();
  });

  it("adds a new place", async () => {
    mockedGet.mockResolvedValueOnce({ items: [], limit: 20 });
    mockedPost.mockResolvedValueOnce({});
    mockedGet.mockResolvedValueOnce({ items: [{ place_id: "p1", label: "Home", zone_id: "zone-1", created_at: "2026-01-01" }], limit: 20 });

    render(<SavedPlaces />);

    await waitFor(() => {
      expect(screen.getByTestId("places-empty")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("place-label-input"), { target: { value: "Home" } });
    fireEvent.change(screen.getByTestId("place-zone-input"), { target: { value: "zone-1" } });
    fireEvent.click(screen.getByTestId("add-place-button"));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith(
        "/customers/WS-1234567890/places",
        { label: "Home", zone_id: "zone-1" },
        expect.objectContaining({ "Idempotency-Key": expect.any(String) })
      );
    });
  });

  it("deletes a place", async () => {
    mockedGet.mockResolvedValueOnce({
      items: [{ place_id: "p1", label: "Home", zone_id: "zone-1", created_at: "2026-01-01" }],
      limit: 20,
    });
    mockedDel.mockResolvedValueOnce(undefined);
    mockedGet.mockResolvedValueOnce({ items: [], limit: 20 });

    render(<SavedPlaces />);

    await waitFor(() => {
      expect(screen.getByTestId("place-p1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("delete-place-p1"));

    await waitFor(() => {
      expect(mockedDel).toHaveBeenCalledWith("/customers/WS-1234567890/places/p1");
    });
  });

  it("shows error when adding without label", async () => {
    mockedGet.mockResolvedValueOnce({ items: [], limit: 20 });

    render(<SavedPlaces />);

    await waitFor(() => {
      expect(screen.getByTestId("places-empty")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("add-place-button"));

    await waitFor(() => {
      expect(screen.getByTestId("place-add-error")).toBeInTheDocument();
    });
  });
});
