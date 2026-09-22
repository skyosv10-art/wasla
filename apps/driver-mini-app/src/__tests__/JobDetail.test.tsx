import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { JobDetail } from "../screens/JobDetail";
import { useDispatchStore } from "../store/dispatch";
import { useSessionStore } from "../store/session";
import type { DispatchJob } from "../types/dispatch";

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

const mockJob: DispatchJob = {
  id: "job-1",
  order_id: "order-uuid-1",
  order_public_id: "ORD-001",
  zone_id: "zone-1",
  order_type: "ride",
  vehicle_class: "car",
  status: "assigned",
  status_reason_code: null,
  rules: {
    ruleset_version: "v1",
    wave_size: 5,
    offer_timeout_seconds: 120,
    max_waves: 3,
    escalation_timeout_seconds: 300,
  },
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  escalation_expires_at: new Date(Date.now() + 1_200_000).toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function setHash(route: string, params?: Record<string, string>) {
  const query = params ? "?" + new URLSearchParams(params).toString() : "";
  window.location.hash = `#/${route}${query}`;
}

describe("JobDetail screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().setSession("token-123", "drv-123", Date.now() + 3_600_000);
    useDispatchStore.setState({
      activeJob: null,
      jobLoading: false,
      jobError: null,
      actionLoading: false,
      actionError: null,
      // Prevent the real fetch logic from running on mount and clobbering
      // manually-set test state; interaction tests override these as needed.
      fetchJobDetail: vi.fn(),
      transitionOrder: vi.fn(),
      cancelJob: vi.fn(),
      clearErrors: vi.fn(),
    });
  });

  it("renders empty state when no job_id provided", () => {
    setHash("job");
    render(<JobDetail />);
    expect(screen.getByTestId("job-no-jobid")).toBeInTheDocument();
  });

  it("renders loading state while fetching", () => {
    setHash("job", { job_id: "job-1" });
    useDispatchStore.setState({ jobLoading: true });

    render(<JobDetail />);
    expect(screen.getByTestId("job-loading")).toBeInTheDocument();
  });

  it("renders error state when fetch fails", () => {
    setHash("job", { job_id: "job-1" });
    useDispatchStore.setState({ jobError: "Network error" });

    render(<JobDetail />);
    expect(screen.getByTestId("job-error")).toBeInTheDocument();
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("renders job details when job is loaded", () => {
    setHash("job", { job_id: "job-1" });
    useDispatchStore.setState({ activeJob: mockJob });

    render(<JobDetail />);
    expect(screen.getByTestId("job-detail-screen")).toBeInTheDocument();
    expect(screen.getByTestId("job-status-value")).toBeInTheDocument();
    expect(screen.getByTestId("job-order-id")).toHaveTextContent("ORD-001");
    expect(screen.getByTestId("job-vehicle-class")).toHaveTextContent("car");
  });

  it("shows start_trip button when status is assigned", () => {
    setHash("job", { job_id: "job-1" });
    useDispatchStore.setState({ activeJob: mockJob });

    render(<JobDetail />);
    expect(screen.getByTestId("transition-driver_en_route")).toBeInTheDocument();
  });

  it("shows arrived button when status is in_progress", () => {
    setHash("job", { job_id: "job-1" });
    const inProgressJob = { ...mockJob, status: "in_progress" as const };
    useDispatchStore.setState({ activeJob: inProgressJob });

    render(<JobDetail />);
    expect(screen.getByTestId("transition-completed")).toBeInTheDocument();
  });

  it("shows no transition button when status is completed", () => {
    setHash("job", { job_id: "job-1" });
    const completedJob = { ...mockJob, status: "completed" as const };
    useDispatchStore.setState({ activeJob: completedJob });

    render(<JobDetail />);
    expect(screen.queryByTestId("transition-driver_en_route")).not.toBeInTheDocument();
    expect(screen.queryByTestId("transition-arrived")).not.toBeInTheDocument();
    expect(screen.queryByTestId("transition-in_progress")).not.toBeInTheDocument();
    expect(screen.queryByTestId("transition-completed")).not.toBeInTheDocument();
  });

  it("calls transitionOrder when transition button is clicked", async () => {
    setHash("job", { job_id: "job-1" });
    const transitionMock = vi.fn().mockResolvedValue(true);
    const fetchJobDetailMock = vi.fn().mockResolvedValue(undefined);
    useDispatchStore.setState({
      activeJob: mockJob,
      transitionOrder: transitionMock,
      fetchJobDetail: fetchJobDetailMock,
    });

    render(<JobDetail />);
    fireEvent.click(screen.getByTestId("transition-driver_en_route"));

    await waitFor(() => {
      expect(transitionMock).toHaveBeenCalledWith("order-uuid-1", "driver_en_route");
    });
  });

  it("shows cancel form when cancel button is clicked", async () => {
    setHash("job", { job_id: "job-1" });
    useDispatchStore.setState({ activeJob: mockJob });

    render(<JobDetail />);
    fireEvent.click(screen.getByTestId("show-cancel-form"));

    await waitFor(() => {
      expect(screen.getByTestId("cancel-form")).toBeInTheDocument();
      expect(screen.getByTestId("confirm-cancel")).toBeInTheDocument();
    });
  });

  it("does not show cancel button for completed jobs", () => {
    setHash("job", { job_id: "job-1" });
    const completedJob = { ...mockJob, status: "completed" as const };
    useDispatchStore.setState({ activeJob: completedJob });

    render(<JobDetail />);
    expect(screen.queryByTestId("show-cancel-form")).not.toBeInTheDocument();
  });
});
