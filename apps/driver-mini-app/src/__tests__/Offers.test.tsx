import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Offers } from "../screens/Offers";
import { useDispatchStore } from "../store/dispatch";
import { useSessionStore } from "../store/session";
import type { DispatchOffer } from "../types/dispatch";

vi.mock("../api/client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class extends Error {
    constructor(public status: number, message: string) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

const mockOffer: DispatchOffer = {
  id: "offer-1",
  job_id: "job-1",
  wave_id: "wave-1",
  driver_public_id: "drv-123",
  status: "pending",
  reason_code: null,
  offered_at: new Date(Date.now() - 30_000).toISOString(),
  expires_at: new Date(Date.now() + 120_000).toISOString(),
  responded_at: null,
  resolved_at: null,
  created_at: new Date(Date.now() - 30_000).toISOString(),
};

function setHash(route: string, params?: Record<string, string>) {
  const query = params ? "?" + new URLSearchParams(params).toString() : "";
  window.location.hash = `#/${route}${query}`;
}

describe("Offers screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().setSession("token-123", "drv-123", Date.now() + 3_600_000);
    useDispatchStore.setState({
      offers: [],
      offersJobId: null,
      offersLoading: false,
      offersError: null,
      actionLoading: false,
      actionError: null,
      pollTimerId: null,
      // Prevent the real polling/fetch logic from running on mount and
      // clobbering manually-set test state; interaction tests override these.
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
      fetchOffers: vi.fn(),
    });
  });

  it("renders empty state when no job_id provided", () => {
    setHash("offers");
    render(<Offers />);
    expect(screen.getByTestId("offers-no-jobid")).toBeInTheDocument();
  });

  it("renders loading state while fetching offers", () => {
    setHash("offers", { job_id: "job-1" });
    useDispatchStore.setState({ offersLoading: true });

    render(<Offers />);
    expect(screen.getByTestId("offers-loading")).toBeInTheDocument();
  });

  it("renders error state when fetch fails", () => {
    setHash("offers", { job_id: "job-1" });
    useDispatchStore.setState({ offersError: "Network error", offers: [], offersJobId: "job-1" });

    render(<Offers />);
    expect(screen.getByTestId("offers-error")).toBeInTheDocument();
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("renders empty state when offers list is empty", () => {
    setHash("offers", { job_id: "job-1" });
    useDispatchStore.setState({ offers: [], offersLoading: false, offersJobId: "job-1" });

    render(<Offers />);
    expect(screen.getByTestId("offers-empty")).toBeInTheDocument();
  });

  it("renders offer cards for pending offers", () => {
    setHash("offers", { job_id: "job-1" });
    useDispatchStore.setState({ offers: [mockOffer] });

    render(<Offers />);
    expect(screen.getByTestId("offers-screen")).toBeInTheDocument();
    expect(screen.getByTestId("offer-offer-1")).toBeInTheDocument();
    expect(screen.getByTestId("accept-offer-1")).toBeInTheDocument();
    expect(screen.getByTestId("reject-offer-1")).toBeInTheDocument();
  });

  it("calls acceptOffer when accept button is clicked", async () => {
    setHash("offers", { job_id: "job-1" });
    useDispatchStore.setState({ offers: [mockOffer] });

    const acceptMock = vi.fn().mockResolvedValue(true);
    useDispatchStore.setState({ acceptOffer: acceptMock });

    render(<Offers />);
    fireEvent.click(screen.getByTestId("accept-offer-1"));

    await waitFor(() => {
      expect(acceptMock).toHaveBeenCalledWith("offer-1");
    });
  });

  it("shows reject reason form when reject button is clicked", async () => {
    setHash("offers", { job_id: "job-1" });
    useDispatchStore.setState({ offers: [mockOffer] });

    render(<Offers />);
    fireEvent.click(screen.getByTestId("reject-offer-1"));

    await waitFor(() => {
      expect(screen.getByTestId("reject-reason-offer-1")).toBeInTheDocument();
      expect(screen.getByTestId("confirm-reject-offer-1")).toBeInTheDocument();
    });
  });
});
