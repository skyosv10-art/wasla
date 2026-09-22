import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Users } from "../screens/Users";
import { useUsersStore } from "../store/users";

// Mock the API client to prevent actual network calls
vi.mock("../api/client", () => ({
  apiClient: { get: vi.fn().mockResolvedValue({ customers: [] }), post: vi.fn().mockResolvedValue({}) },
  ApiError: class extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

describe("Users screen", () => {
  beforeEach(() => {
    useUsersStore.setState({
      users: [],
      selectedUser: null,
      loading: false,
      error: null,
      actionLoading: false,
      actionError: null,
      searchQuery: "",
      statusFilter: "all",
      fetchUsers: vi.fn(),
      fetchUserDetail: vi.fn(),
      suspendUser: vi.fn(),
      reinstateUser: vi.fn(),
      clearSelected: vi.fn(),
      clearErrors: vi.fn(),
      setSearchQuery: vi.fn(),
      setStatusFilter: vi.fn(),
    });
  });

  it("renders title", () => {
    render(<Users />);
    expect(screen.getByText("إدارة المستخدمين")).toBeInTheDocument();
  });

  it("renders search input and status filter", () => {
    render(<Users />);
    expect(screen.getByTestId("input-search")).toBeInTheDocument();
    expect(screen.getByTestId("select-status")).toBeInTheDocument();
  });

  it("renders search button", () => {
    render(<Users />);
    expect(screen.getByTestId("btn-search")).toBeInTheDocument();
  });

  it("shows empty state when no users", () => {
    render(<Users />);
    expect(screen.getByText("لا توجد بيانات")).toBeInTheDocument();
  });

  it("renders user rows when users exist", () => {
    useUsersStore.setState({
      users: [{
        wasla_public_id: "usr_001",
        display_name: "Ahmed",
        phone_number: null,
        preferred_locale: "ar",
        status: "active",
        suspension_reason_code: null,
        order_count: 5,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      }],
    });
    render(<Users />);
    expect(screen.getByTestId("user-row-usr_001")).toBeInTheDocument();
    expect(screen.getByText("Ahmed")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    useUsersStore.setState({ loading: true });
    render(<Users />);
    expect(screen.getByText("جارٍ التحميل...")).toBeInTheDocument();
  });

  it("shows error state with retry", () => {
    useUsersStore.setState({ error: "fetch_users_failed" });
    render(<Users />);
    expect(screen.getByText(/خطأ/)).toBeInTheDocument();
    expect(screen.getByText("إعادة المحاولة")).toBeInTheDocument();
  });
});
