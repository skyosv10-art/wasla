import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Earnings } from "../screens/Earnings";

vi.mock("../store/earnings", () => ({
  useEarningsStore: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { useEarningsStore } from "../store/earnings";

const mockStore = {
  period: "today" as const,
  summary: null as ReturnType<typeof useEarningsStore.getState>["summary"],
  loading: false,
  error: null as string | null,
  fetchEarnings: vi.fn(),
  setPeriod: vi.fn(),
};

describe("Earnings screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useEarningsStore).mockReturnValue(mockStore);
  });

  it("renders title and period buttons", () => {
    render(<Earnings />);
    expect(screen.getByText("driver.earnings.title")).toBeInTheDocument();
    expect(screen.getByTestId("period-today")).toBeInTheDocument();
    expect(screen.getByTestId("period-week")).toBeInTheDocument();
    expect(screen.getByTestId("period-month")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    vi.mocked(useEarningsStore).mockReturnValue({ ...mockStore, loading: true });
    render(<Earnings />);
    expect(screen.getByTestId("loading")).toBeInTheDocument();
  });

  it("shows error state", () => {
    vi.mocked(useEarningsStore).mockReturnValue({ ...mockStore, error: "fetch_failed" });
    render(<Earnings />);
    expect(screen.getByTestId("error")).toBeInTheDocument();
  });

  it("shows empty state when no jobs", () => {
    vi.mocked(useEarningsStore).mockReturnValue({
      ...mockStore,
      summary: { period: "today", job_count: 0, total_amount: { amount_minor: 0, currency: "SAR" }, jobs: [] },
    });
    render(<Earnings />);
    expect(screen.getByTestId("empty")).toBeInTheDocument();
  });

  it("shows summary with count and total", () => {
    vi.mocked(useEarningsStore).mockReturnValue({
      ...mockStore,
      summary: {
        period: "today",
        job_count: 5,
        total_amount: { amount_minor: 12500, currency: "SAR" },
        jobs: [],
      },
    });
    render(<Earnings />);
    expect(screen.getByTestId("summary-count")).toHaveTextContent("5 driver.earnings.jobs");
    expect(screen.getByTestId("summary-total")).toHaveTextContent("125.00 SAR");
  });

  it("renders job list entries", () => {
    vi.mocked(useEarningsStore).mockReturnValue({
      ...mockStore,
      summary: {
        period: "today",
        job_count: 2,
        total_amount: { amount_minor: 5000, currency: "SAR" },
        jobs: [
          {
            order_public_id: "ORD-0000000001",
            order_type: "ride",
            vehicle_class: "sedan",
            status: "completed",
            agreed_price: { amount_minor: 2500, currency: "SAR" },
            agreed_at: "2026-09-22T10:00:00Z",
            completed_at: "2026-09-22T10:30:00Z",
            pickup_label: "Location A",
            dropoff_label: "Location B",
          },
          {
            order_public_id: "ORD-0000000002",
            order_type: "delivery",
            vehicle_class: "motorcycle",
            status: "completed",
            agreed_price: { amount_minor: 2500, currency: "SAR" },
            agreed_at: "2026-09-22T11:00:00Z",
            completed_at: "2026-09-22T11:30:00Z",
            pickup_label: "Location C",
            dropoff_label: "Location D",
          },
        ],
      },
    });
    render(<Earnings />);
    expect(screen.getByTestId("job-ORD-0000000001")).toBeInTheDocument();
    expect(screen.getByTestId("job-ORD-0000000002")).toBeInTheDocument();
    expect(screen.getByText("ORD-0000000001")).toBeInTheDocument();
  });

  it("calls fetchEarnings on mount and when period changes", () => {
    render(<Earnings />);
    expect(mockStore.fetchEarnings).toHaveBeenCalledWith("today");
  });

  it("calls setPeriod when period button clicked", () => {
    render(<Earnings />);
    screen.getByTestId("period-week").click();
    expect(mockStore.setPeriod).toHaveBeenCalledWith("week");
  });

  it("disables period buttons while loading", () => {
    vi.mocked(useEarningsStore).mockReturnValue({ ...mockStore, loading: true });
    render(<Earnings />);
    expect(screen.getByTestId("period-today")).toBeDisabled();
    expect(screen.getByTestId("period-week")).toBeDisabled();
    expect(screen.getByTestId("period-month")).toBeDisabled();
  });

  it("marks active period with aria-pressed", () => {
    vi.mocked(useEarningsStore).mockReturnValue({ ...mockStore, period: "week" });
    render(<Earnings />);
    expect(screen.getByTestId("period-week")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("period-today")).toHaveAttribute("aria-pressed", "false");
  });

  it("fetches earnings when period changes via useEffect", async () => {
    const { rerender } = render(<Earnings />);
    expect(mockStore.fetchEarnings).toHaveBeenCalledWith("today");

    vi.mocked(useEarningsStore).mockReturnValue({ ...mockStore, period: "week" });
    rerender(<Earnings />);
    await waitFor(() => {
      expect(mockStore.fetchEarnings).toHaveBeenCalledWith("week");
    });
  });
});
