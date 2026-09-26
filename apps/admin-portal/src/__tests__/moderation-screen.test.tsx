import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n";
import { Moderation } from "../screens/Moderation";
import { useModerationStore } from "../store/moderation";
import { useSessionStore } from "../store/session";

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe("Moderation screen", () => {
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

    useModerationStore.setState({
      storeReviews: [],
      storeReviewsCursor: null,
      lastProductDecision: null,
      loading: false,
      error: null,
      selectedStoreSlug: null,
      fetchStoreReviews: vi.fn(async () => {}),
      fetchMoreStoreReviews: vi.fn(async () => {}),
      decideStore: vi.fn(async () => {}),
      decideProduct: vi.fn(async () => {}),
      publishProduct: vi.fn(async () => {}),
      archiveProduct: vi.fn(async () => {}),
      setSelectedStoreSlug: vi.fn((slug: string | null) => {
        useModerationStore.setState({ selectedStoreSlug: slug });
      }),
      clearError: vi.fn(() => {}),
      clearLastProductDecision: vi.fn(() => {}),
    });
  });

  it("renders title and store slug search bar for admin", () => {
    i18n.changeLanguage("en");
    renderWithI18n(<Moderation />);
    expect(screen.getByTestId("moderation-store-slug-input")).toBeInTheDocument();
    expect(screen.getByTestId("moderation-search-btn")).toBeInTheDocument();
    expect(screen.getByTestId("moderation-product-id-input")).toBeInTheDocument();
  });

  it("denies access for non-admin", () => {
    i18n.changeLanguage("en");
    useSessionStore.setState({ ...useSessionStore.getState(), role: "viewer" });
    renderWithI18n(<Moderation />);
    expect(screen.queryByTestId("moderation-store-slug-input")).toBeNull();
  });

  it("fetches store reviews on search", async () => {
    i18n.changeLanguage("en");
    const { fetchStoreReviews } = useModerationStore.getState();
    renderWithI18n(<Moderation />);
    const input = screen.getByTestId("moderation-store-slug-input");
    const btn = screen.getByTestId("moderation-search-btn");
    fireEvent.change(input, { target: { value: "acme-store" } });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(fetchStoreReviews).toHaveBeenCalledWith("acme-store");
    });
  });

  it("renders store review ledger rows when present", async () => {
    i18n.changeLanguage("en");
    useModerationStore.setState({
      ...useModerationStore.getState(),
      selectedStoreSlug: "acme-store",
      storeReviews: [
        {
          review_id: "rev-1",
          store_id: "st-1",
          store_slug: "acme-store",
          decision: "approved",
          from_state: "pending_review",
          to_state: "approved",
          state_sequence: 1,
          actor_type: "moderator",
          actor_public_id: "usr-1",
          reason_code: null,
          decided_at: "2026-09-26T00:00:00Z",
        },
      ],
    });
    renderWithI18n(<Moderation />);
    const row = screen.getByTestId("store-review-rev-1");
    expect(row).toBeInTheDocument();
    expect(row).toHaveTextContent("approved");
    expect(row).toHaveTextContent("moderator");
  });

  it("requires a reason code before recording a reject store decision", async () => {
    i18n.changeLanguage("en");
    const { decideStore } = useModerationStore.getState();
    useModerationStore.setState({
      ...useModerationStore.getState(),
      selectedStoreSlug: "acme-store",
    });
    renderWithI18n(<Moderation />);
    fireEvent.change(screen.getByTestId("store-decision-select"), {
      target: { value: "rejected" },
    });
    const btn = screen.getByTestId("store-decision-btn") as HTMLButtonElement;
    // reason select now visible but empty → button disabled
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("store-reason-select"), {
      target: { value: "policy_violation" },
    });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(decideStore).toHaveBeenCalledWith("acme-store", "rejected", "policy_violation");
    });
  });

  it("records a product decision with reason when rejecting", async () => {
    i18n.changeLanguage("en");
    const { decideProduct } = useModerationStore.getState();
    renderWithI18n(<Moderation />);
    fireEvent.change(screen.getByTestId("moderation-product-id-input"), {
      target: { value: "prod-42" },
    });
    fireEvent.change(screen.getByTestId("product-decision-select"), {
      target: { value: "rejected" },
    });
    fireEvent.change(screen.getByTestId("product-reason-select"), {
      target: { value: "prohibited_item" },
    });
    fireEvent.click(screen.getByTestId("product-decision-btn"));
    await waitFor(() => {
      expect(decideProduct).toHaveBeenCalledWith("prod-42", "rejected", "prohibited_item");
    });
  });

  it("publishes and archives a product by id", async () => {
    i18n.changeLanguage("en");
    const { publishProduct, archiveProduct } = useModerationStore.getState();
    renderWithI18n(<Moderation />);
    fireEvent.change(screen.getByTestId("moderation-product-id-input"), {
      target: { value: "prod-7" },
    });
    fireEvent.click(screen.getByTestId("product-publish-btn"));
    fireEvent.click(screen.getByTestId("product-archive-btn"));
    await waitFor(() => {
      expect(publishProduct).toHaveBeenCalledWith("prod-7");
      expect(archiveProduct).toHaveBeenCalledWith("prod-7");
    });
  });
});
