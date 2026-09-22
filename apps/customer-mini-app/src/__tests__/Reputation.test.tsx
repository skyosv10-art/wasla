import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Reputation } from "../screens/Reputation";
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

describe("Reputation screen", () => {
  beforeEach(() => {
    useSessionStore.setState({ token: "test-token", customerId: "WS-1234567890", expiresAt: Date.now() + 3600000 });
    vi.clearAllMocks();
  });

  it("loads score and ratings on mount", async () => {
    mockedGet.mockResolvedValueOnce({
      subject_public_id: "WS-1234567890",
      subject_type: "customer",
      score: 85,
      level: "good",
      updated_at: "2026-09-22T00:00:00Z",
    });
    mockedGet.mockResolvedValueOnce({ items: [], limit: 200 });

    render(<Reputation />);

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith("/reputation/scores/customer/WS-1234567890");
    });
    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith("/reputation/ratings?subjectPublicId=WS-1234567890");
    });
  });

  it("renders score card", async () => {
    mockedGet.mockResolvedValueOnce({
      subject_public_id: "WS-1234567890",
      subject_type: "customer",
      score: 92,
      level: "excellent",
      updated_at: "2026-09-22T00:00:00Z",
    });
    mockedGet.mockResolvedValueOnce({ items: [], limit: 200 });

    render(<Reputation />);

    await waitFor(() => {
      expect(screen.getByTestId("reputation-score")).toBeInTheDocument();
    });
    expect(screen.getByTestId("score-value")).toHaveTextContent("92");
  });

  it("shows no ratings state", async () => {
    mockedGet.mockResolvedValueOnce({
      subject_public_id: "WS-1234567890",
      subject_type: "customer",
      score: 50,
      level: "fair",
      updated_at: "2026-09-22T00:00:00Z",
    });
    mockedGet.mockResolvedValueOnce({ items: [], limit: 200 });

    render(<Reputation />);

    await waitFor(() => {
      expect(screen.getByTestId("ratings-empty")).toBeInTheDocument();
    });
  });

  it("renders ratings list", async () => {
    mockedGet.mockResolvedValueOnce({
      subject_public_id: "WS-1234567890",
      subject_type: "customer",
      score: 75,
      level: "good",
      updated_at: "2026-09-22T00:00:00Z",
    });
    mockedGet.mockResolvedValueOnce({
      items: [
        { rating_id: "r1", order_public_id: "ord-1", stars: 5, comment: "Great!", created_at: "2026-09-20T00:00:00Z" },
        { rating_id: "r2", order_public_id: "ord-2", stars: 3, created_at: "2026-09-19T00:00:00Z" },
      ],
      limit: 200,
    });

    render(<Reputation />);

    await waitFor(() => {
      expect(screen.getByTestId("ratings-list")).toBeInTheDocument();
    });
    expect(screen.getByTestId("rating-r1")).toBeInTheDocument();
    expect(screen.getByTestId("rating-r2")).toBeInTheDocument();
  });
});
