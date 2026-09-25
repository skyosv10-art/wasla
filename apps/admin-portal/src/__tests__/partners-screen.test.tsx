import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n";
import { Partners } from "../screens/Partners";
import { usePartnersStore } from "../store/partners";
import { useSessionStore } from "../store/session";

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe("Partners screen", () => {
  beforeEach(() => {
    useSessionStore.setState({
      token: "test-token",
      userId: "test-user",
      role: "admin",
      expiresAt: Date.now() + 3600000,
      setSession: vi.fn(),
      clearSession: vi.fn(),
      isAuthenticated: () => true,
    });

    usePartnersStore.setState({
      lifecycles: [],
      credentials: [],
      usage: null,
      auditEntries: [],
      loading: false,
      error: null,
      selectedStoreId: null,
      fetchLifecycles: vi.fn(async () => {}),
      fetchCredentials: vi.fn(async () => {}),
      fetchUsage: vi.fn(async () => {}),
      fetchAudit: vi.fn(async () => {}),
      suspendTenant: vi.fn(async () => {}),
      reinstateTenant: vi.fn(async () => {}),
      issueCredential: vi.fn(async () => ({ plaintextKey: "wsk_test123", keyPrefix: "wsk_test" })),
      revokeCredential: vi.fn(async () => {}),
      setSelectedStoreId: vi.fn((id: string | null) => {
        usePartnersStore.setState({ selectedStoreId: id });
      }),
      clearError: vi.fn(() => {}),
    });
  });

  it("renders title and search bar for admin", () => {
    i18n.changeLanguage("en");
    renderWithI18n(<Partners />);
    expect(screen.getByText("Partner Management")).toBeInTheDocument();
    expect(screen.getByTestId("partner-store-id-input")).toBeInTheDocument();
    expect(screen.getByTestId("partner-search-btn")).toBeInTheDocument();
  });

  it("shows access denied for non-admin role", () => {
    i18n.changeLanguage("en");
    useSessionStore.setState({ role: "operator" });
    renderWithI18n(<Partners />);
    expect(screen.getByText("This page is available to admins only")).toBeInTheDocument();
  });

  it("searches for a store and fetches data", async () => {
    const { setSelectedStoreId } = usePartnersStore.getState();
    renderWithI18n(<Partners />);

    const input = screen.getByTestId("partner-store-id-input");
    const btn = screen.getByTestId("partner-search-btn");

    fireEvent.change(input, { target: { value: "test-store-123" } });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(setSelectedStoreId).toHaveBeenCalledWith("test-store-123");
    });
  });

  it("shows lifecycle info when data is loaded", async () => {
    usePartnersStore.setState({
      selectedStoreId: "store-1",
      lifecycles: [
        {
          tenantStoreId: "store-1",
          state: "active",
          slaTier: "standard",
          suspendedAt: null,
          offboardedAt: null,
          createdAt: "2026-09-25T10:00:00Z",
          updatedAt: "2026-09-25T10:00:00Z",
        },
      ],
    });

    renderWithI18n(<Partners />);
    expect(screen.getByTestId("partner-state")).toHaveTextContent("active");
    expect(screen.getByTestId("partner-suspend-btn")).toBeInTheDocument();
  });

  it("shows reinstate button when state is suspended", async () => {
    usePartnersStore.setState({
      selectedStoreId: "store-1",
      lifecycles: [
        {
          tenantStoreId: "store-1",
          state: "suspended",
          slaTier: "standard",
          suspendedAt: "2026-09-25T10:00:00Z",
          offboardedAt: null,
          createdAt: "2026-09-25T10:00:00Z",
          updatedAt: "2026-09-25T10:00:00Z",
        },
      ],
    });

    renderWithI18n(<Partners />);
    expect(screen.getByTestId("partner-state")).toHaveTextContent("suspended");
    expect(screen.getByTestId("partner-reinstate-btn")).toBeInTheDocument();
  });

  it("shows suspend dialog when suspend button is clicked", async () => {
    usePartnersStore.setState({
      selectedStoreId: "store-1",
      lifecycles: [
        {
          tenantStoreId: "store-1",
          state: "active",
          slaTier: "standard",
          suspendedAt: null,
          offboardedAt: null,
          createdAt: "2026-09-25T10:00:00Z",
          updatedAt: "2026-09-25T10:00:00Z",
        },
      ],
    });

    renderWithI18n(<Partners />);
    fireEvent.click(screen.getByTestId("partner-suspend-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("suspend-reason-input")).toBeInTheDocument();
      expect(screen.getByTestId("confirm-suspend-btn")).toBeDisabled();
    });
  });

  it("shows issued key after issuing credential", async () => {
    usePartnersStore.setState({
      selectedStoreId: "store-1",
      lifecycles: [
        {
          tenantStoreId: "store-1",
          state: "active",
          slaTier: "standard",
          suspendedAt: null,
          offboardedAt: null,
          createdAt: "2026-09-25T10:00:00Z",
          updatedAt: "2026-09-25T10:00:00Z",
        },
      ],
    });

    renderWithI18n(<Partners />);
    fireEvent.click(screen.getByTestId("issue-credential-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("issued-key")).toHaveTextContent("wsk_test123");
    });
  });

  it("displays error messages", async () => {
    usePartnersStore.setState({
      selectedStoreId: "store-1",
      error: "Failed to fetch lifecycle",
      lifecycles: [
        {
          tenantStoreId: "store-1",
          state: "active",
          slaTier: "standard",
          suspendedAt: null,
          offboardedAt: null,
          createdAt: "2026-09-25T10:00:00Z",
          updatedAt: "2026-09-25T10:00:00Z",
        },
      ],
    });

    renderWithI18n(<Partners />);
    expect(screen.getByText("Failed to fetch lifecycle")).toBeInTheDocument();
  });
});
