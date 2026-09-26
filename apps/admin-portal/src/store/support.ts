/**
 * Support store for admin portal.
 *
 * Manages support ticket state and API calls to the support service.
 * Uses the admin API client with Bearer token authentication.
 *
 * M5-16 review 7/N: Support admin screen — list tickets (with state filter +
 * cursor pagination), view ticket details, escalate, resolve, close.
 */

import { create } from "zustand";
import { apiClient } from "../api/client";
import type {
  SupportTicketResource,
  TicketListResponse,
  SupportTicketState,
  SupportEscalationLevel,
  SupportResolutionReason,
  EscalateRequest,
  ResolveRequest,
} from "../types/support";

type TicketList = readonly SupportTicketResource[];

interface SupportState {
  tickets: TicketList;
  nextCursor: string | null;
  selectedTicket: SupportTicketResource | null;
  loading: boolean;
  error: string | null;
  stateFilter: SupportTicketState | null;

  fetchTickets: (state?: SupportTicketState | null) => Promise<void>;
  fetchMoreTickets: () => Promise<void>;
  fetchTicket: (ticketId: string) => Promise<void>;
  escalateTicket: (ticketId: string, level: SupportEscalationLevel) => Promise<void>;
  resolveTicket: (ticketId: string, reason: SupportResolutionReason, evidenceId: string) => Promise<void>;
  closeTicket: (ticketId: string) => Promise<void>;
  setStateFilter: (state: SupportTicketState | null) => void;
  clearSelected: () => void;
  clearError: () => void;
}

export const useSupportStore = create<SupportState>((set, get) => ({
  tickets: [],
  nextCursor: null,
  selectedTicket: null,
  loading: false,
  error: null,
  stateFilter: null,

  fetchTickets: async (state?: SupportTicketState | null) => {
    const filter = state ?? get().stateFilter;
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams();
      if (filter) params.set("state", filter);
      const qs = params.toString();
      const data = await apiClient.get<TicketListResponse>(
        qs ? `/support/tickets?${qs}` : "/support/tickets",
      );
      set({ tickets: data.tickets, nextCursor: data.nextCursor, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch tickets",
      });
    }
  },

  fetchMoreTickets: async () => {
    const { nextCursor, tickets } = get();
    if (!nextCursor) return;
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams();
      const { stateFilter } = get();
      if (stateFilter) params.set("state", stateFilter);
      params.set("cursor", nextCursor);
      const data = await apiClient.get<TicketListResponse>(
        `/support/tickets?${params.toString()}`,
      );
      set({ tickets: [...tickets, ...data.tickets] as TicketList, nextCursor: data.nextCursor, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch more tickets",
      });
    }
  },

  fetchTicket: async (ticketId: string) => {
    set({ loading: true, error: null });
    try {
      const ticket = await apiClient.get<SupportTicketResource>(
        `/support/tickets/${ticketId}`,
      );
      set({ selectedTicket: ticket, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch ticket",
      });
    }
  },

  escalateTicket: async (ticketId: string, level: SupportEscalationLevel) => {
    set({ loading: true, error: null });
    try {
      await apiClient.post(`/support/tickets/${ticketId}/escalate`, {
        level,
      } satisfies EscalateRequest);
      // Refresh the selected ticket
      await get().fetchTicket(ticketId);
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to escalate ticket",
      });
    }
  },

  resolveTicket: async (
    ticketId: string,
    reason: SupportResolutionReason,
    evidenceId: string,
  ) => {
    set({ loading: true, error: null });
    try {
      await apiClient.post(`/support/tickets/${ticketId}/resolve`, {
        resolution_reason: reason,
        evidence_id: evidenceId,
      } satisfies ResolveRequest);
      await get().fetchTicket(ticketId);
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to resolve ticket",
      });
    }
  },

  closeTicket: async (ticketId: string) => {
    set({ loading: true, error: null });
    try {
      await apiClient.post(`/support/tickets/${ticketId}/close`);
      await get().fetchTicket(ticketId);
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to close ticket",
      });
    }
  },

  setStateFilter: (state: SupportTicketState | null) => set({ stateFilter: state }),
  clearSelected: () => set({ selectedTicket: null }),
  clearError: () => set({ error: null }),
}));
