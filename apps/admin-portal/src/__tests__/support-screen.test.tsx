/**
 * Support screen tests — M5-16 review 7/N.
 *
 * Tests the Support admin screen: ticket list with state filter,
 * ticket detail view, escalate/resolve/close actions.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n";
import { Support } from "../screens/Support";
import { useSupportStore } from "../store/support";
import { useSessionStore } from "../store/session";

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe("Support screen", () => {
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

    useSupportStore.setState({
      tickets: [],
      nextCursor: null,
      selectedTicket: null,
      loading: false,
      error: null,
      stateFilter: null,
      fetchTickets: vi.fn(),
      fetchMoreTickets: vi.fn(),
      fetchTicket: vi.fn(),
      escalateTicket: vi.fn(),
      resolveTicket: vi.fn(),
      closeTicket: vi.fn(),
      setStateFilter: vi.fn(),
      clearSelected: vi.fn(),
      clearError: vi.fn(),
    });
  });

  it("renders the ticket list with title", () => {
    renderWithI18n(<Support />);
    expect(screen.getByText(/support tickets|تذاكر الدعم/i)).toBeTruthy();
  });

  it("renders state filter buttons", () => {
    renderWithI18n(<Support />);
    expect(screen.getByText(/all|الكل/i)).toBeTruthy();
  });

  it("shows no tickets message when list is empty", () => {
    renderWithI18n(<Support />);
    expect(screen.getByText(/no tickets|لا توجد تذاكر/i)).toBeTruthy();
  });

  it("renders ticket rows when tickets exist", () => {
    useSupportStore.setState({
      tickets: [
        {
          ticket_id: "abc-1234",
          ticket_type: "order_issue",
          state: "open",
          escalation_level: null,
          reporter_public_id: "WS-1234567890",
          subject_public_id: null,
          order_public_id: "ORD-1234567890",
          resolution_reason: null,
          evidence_id: null,
          opened_at: "2026-09-26T10:00:00Z",
          investigating_at: null,
          escalated_at: null,
          resolved_at: null,
          closed_at: null,
        },
      ],
      fetchTickets: vi.fn(),
    });
    renderWithI18n(<Support />);
    expect(screen.getByText("abc-1234")).toBeTruthy();
  });

  it("calls fetchTickets on mount", () => {
    const fetchTickets = vi.fn();
    useSupportStore.setState({ fetchTickets });
    renderWithI18n(<Support />);
    expect(fetchTickets).toHaveBeenCalled();
  });

  it("calls setStateFilter and fetchTickets when filter is clicked", () => {
    const setStateFilter = vi.fn();
    const fetchTickets = vi.fn();
    useSupportStore.setState({ setStateFilter, fetchTickets });
    renderWithI18n(<Support />);
    const openButton = screen.getByText(/open|مفتوحة/i);
    fireEvent.click(openButton);
    expect(setStateFilter).toHaveBeenCalled();
    expect(fetchTickets).toHaveBeenCalled();
  });

  it("shows detail view when ticket is selected", async () => {
    useSupportStore.setState({
      tickets: [
        {
          ticket_id: "abc-1234",
          ticket_type: "order_issue",
          state: "open",
          escalation_level: null,
          reporter_public_id: "WS-123",
          subject_public_id: null,
          order_public_id: null,
          resolution_reason: null,
          evidence_id: null,
          opened_at: "2026-09-26T10:00:00Z",
          investigating_at: null,
          escalated_at: null,
          resolved_at: null,
          closed_at: null,
        },
      ],
      selectedTicket: {
        ticket_id: "abc-1234",
        ticket_type: "order_issue",
        state: "investigating",
        escalation_level: "supervisor",
        reporter_public_id: "WS-123",
        subject_public_id: "WS-456",
        order_public_id: "ORD-789",
        resolution_reason: null,
        evidence_id: null,
        opened_at: "2026-09-26T10:00:00Z",
        investigating_at: "2026-09-26T11:00:00Z",
        escalated_at: null,
        resolved_at: null,
        closed_at: null,
      },
      fetchTicket: vi.fn(),
    });
    renderWithI18n(<Support />);
    // Click the ticket row
    fireEvent.click(screen.getByText("abc-1234"));
    await waitFor(() => {
      expect(screen.getByText(/back to list|العودة للقائمة/i)).toBeTruthy();
    });
  });
});
