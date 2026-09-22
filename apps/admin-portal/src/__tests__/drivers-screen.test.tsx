import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Drivers } from "../screens/Drivers";
import { useDriversStore } from "../store/drivers";

// Mock the API client to prevent actual network calls
vi.mock("../api/client", () => ({
  apiClient: { get: vi.fn().mockResolvedValue({ drivers: [], documents: [] }), post: vi.fn().mockResolvedValue({}) },
  ApiError: class extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

describe("Drivers screen", () => {
  beforeEach(() => {
    useDriversStore.setState({
      drivers: [],
      selectedDriver: null,
      documents: [],
      loading: false,
      error: null,
      actionLoading: false,
      actionError: null,
      searchQuery: "",
      statusFilter: "all",
      verificationFilter: "all",
      fetchDrivers: vi.fn(),
      fetchDriverDetail: vi.fn(),
      fetchDocuments: vi.fn(),
      reviewDocument: vi.fn(),
      suspendDriver: vi.fn(),
      reinstateDriver: vi.fn(),
      clearSelected: vi.fn(),
      clearErrors: vi.fn(),
      setSearchQuery: vi.fn(),
      setStatusFilter: vi.fn(),
      setVerificationFilter: vi.fn(),
    });
  });

  it("renders title", () => {
    render(<Drivers />);
    expect(screen.getByText("إدارة السائقين")).toBeInTheDocument();
  });

  it("renders search input, status filter, and verification filter", () => {
    render(<Drivers />);
    expect(screen.getByTestId("input-driver-search")).toBeInTheDocument();
    expect(screen.getByTestId("select-driver-status")).toBeInTheDocument();
    expect(screen.getByTestId("select-verification")).toBeInTheDocument();
  });

  it("renders search button", () => {
    render(<Drivers />);
    expect(screen.getByTestId("btn-driver-search")).toBeInTheDocument();
  });

  it("shows empty state when no drivers", () => {
    render(<Drivers />);
    expect(screen.getByText("لا توجد بيانات")).toBeInTheDocument();
  });

  it("renders driver rows when drivers exist", () => {
    useDriversStore.setState({
      drivers: [{
        wasla_public_id: "drv_001",
        display_name: "Mohammed",
        status: "active",
        verification_status: "verified",
        declared_availability: "available",
        work_city_zone_id: "jed_01",
        service_kinds: ["ride"],
        suspension_reason_code: null,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      }],
    });
    render(<Drivers />);
    expect(screen.getByTestId("driver-row-drv_001")).toBeInTheDocument();
    expect(screen.getByText("Mohammed")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    useDriversStore.setState({ loading: true });
    render(<Drivers />);
    expect(screen.getByText("جارٍ التحميل...")).toBeInTheDocument();
  });

  it("shows error state with retry", () => {
    useDriversStore.setState({ error: "fetch_drivers_failed" });
    render(<Drivers />);
    expect(screen.getByText(/خطأ/)).toBeInTheDocument();
    expect(screen.getByText("إعادة المحاولة")).toBeInTheDocument();
  });
});
