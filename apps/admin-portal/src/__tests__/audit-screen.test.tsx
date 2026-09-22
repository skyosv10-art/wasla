import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n";
import { AuditLog } from "../screens/AuditLog";
import { useAuditStore } from "../store/audit";

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe("AuditLog screen", () => {
  beforeEach(() => {
    useAuditStore.setState({
      events: [],
      total: 0,
      loading: false,
      error: null,
      filters: { limit: 50, offset: 0 },
      fetchEvents: vi.fn(async () => {}),
      setFilter: vi.fn(() => {}),
      clearFilters: vi.fn(() => {}),
    });
  });

  it("renders title and filter bar", () => {
    renderWithI18n(<AuditLog />);
    expect(screen.getByText("Audit Log")).toBeInTheDocument();
    expect(screen.getByLabelText(/From Date/)).toBeInTheDocument();
    expect(screen.getByLabelText(/To Date/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Actor ID/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Action/)).toBeInTheDocument();
  });

  it("renders empty state when no events", () => {
    renderWithI18n(<AuditLog />);
    expect(screen.getByText("No audit events found")).toBeInTheDocument();
  });

  it("renders events table when events exist", () => {
    useAuditStore.setState({
      events: [
        {
          id: 1,
          actor_id: "USR-1234567890",
          actor_role: "operator",
          action: "user.suspended",
          resource_type: "user",
          resource_id: "USR-9876543210",
          metadata: null,
          created_at: "2026-01-01T10:00:00Z",
        },
      ],
      total: 1,
    });

    renderWithI18n(<AuditLog />);
    expect(screen.getByText("USR-1234567890")).toBeInTheDocument();
    expect(screen.getByText("Total: 1")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    useAuditStore.setState({ loading: true });
    renderWithI18n(<AuditLog />);
    expect(screen.getByText(/تحميل|Loading/)).toBeInTheDocument();
  });

  it("shows error message", () => {
    useAuditStore.setState({ error: "INTERNAL" });
    renderWithI18n(<AuditLog />);
    expect(screen.getByText(/INTERNAL/)).toBeInTheDocument();
  });

  it("renders all action options in filter dropdown", () => {
    renderWithI18n(<AuditLog />);
    const select = screen.getByLabelText(/Action/);
    expect(select).toBeInTheDocument();
    expect(screen.getByText("All Actions")).toBeInTheDocument();
  });

  it("calls fetchEvents on mount", () => {
    const fetchFn = vi.fn(async () => {});
    useAuditStore.setState({ fetchEvents: fetchFn });
    renderWithI18n(<AuditLog />);
    expect(fetchFn).toHaveBeenCalled();
  });
});
