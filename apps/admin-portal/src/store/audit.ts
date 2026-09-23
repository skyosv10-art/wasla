/**
 * Audit log Zustand store for admin portal.
 *
 * Uses GET /audit/events with filtering (date, actor, action, resource_type).
 * Audit service is planned for services/audit/ (Fastify, port 8090) —
 * frontend built ahead per ADR-047 Wave 3 pattern.
 */

import { create } from "zustand";
import type {
  AuditEvent,
  AuditEventListResponse,
  AuditEventQuery,
} from "../types/audit";
import { useSessionStore } from "./session";

interface AuditState {
  events: AuditEvent[];
  total: number;
  loading: boolean;
  error: string | null;
  filters: AuditEventQuery;

  fetchEvents: (overrides?: AuditEventQuery) => Promise<void>;
  setFilter: <K extends keyof AuditEventQuery>(
    key: K,
    value: AuditEventQuery[K],
  ) => void;
  clearFilters: () => void;
}

export const useAuditStore = create<AuditState>((set, get) => ({
  events: [],
  total: 0,
  loading: false,
  error: null,
  filters: { limit: 50, offset: 0 },

  fetchEvents: async (overrides?: AuditEventQuery) => {
    const token = useSessionStore.getState().token;
    if (!token) {
      set({ error: "NO_SESSION" });
      return;
    }
    const filters = { ...get().filters, ...overrides };
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams();
      if (filters.from_date) params.set("from_date", filters.from_date);
      if (filters.to_date) params.set("to_date", filters.to_date);
      if (filters.actor_id) params.set("actor_id", filters.actor_id);
      if (filters.action) params.set("action", filters.action);
      if (filters.resource_type)
        params.set("resource_type", filters.resource_type);
      if (filters.limit) params.set("limit", String(filters.limit));
      if (filters.offset) params.set("offset", String(filters.offset));

      const res = await fetch(`/audit/events?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Request-Id": crypto.randomUUID(),
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.code || `HTTP_${res.status}`);
      }
      const data: AuditEventListResponse = await res.json();
      set({
        events: data.events,
        total: data.total,
        loading: false,
        filters,
      });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : "UNKNOWN",
      });
    }
  },

  setFilter: (key, value) => {
    set((state) => ({
      filters: { ...state.filters, [key]: value },
    }));
  },

  clearFilters: () => set({ filters: { limit: 50, offset: 0 } }),
}));
