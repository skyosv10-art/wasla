/**
 * Orders Zustand store for admin portal.
 *
 * Uses GET /orders/lookup (by public ID), GET /orders/:orderId (detail),
 * and GET /orders/:orderId/history (status transitions).
 * Admin list endpoint (GET /orders) is deferred — frontend built ahead.
 */

import { create } from "zustand";
import type {
  OrderSummary,
  OrderDetail,
  StatusHistoryEntry,
  StatusHistoryResponse,
} from "../types/orders";
import { useSessionStore } from "./session";

interface OrdersState {
  searchResults: OrderSummary[];
  searchLoading: boolean;
  searchError: string | null;
  detail: OrderDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  history: StatusHistoryEntry[];
  historyLoading: boolean;
  historyError: string | null;

  searchByPublicId: (publicId: string) => Promise<void>;
  fetchDetail: (orderId: number) => Promise<void>;
  fetchHistory: (orderId: number) => Promise<void>;
  clearSearch: () => void;
  clearDetail: () => void;
}

export const useOrdersStore = create<OrdersState>((set) => ({
  searchResults: [],
  searchLoading: false,
  searchError: null,
  detail: null,
  detailLoading: false,
  detailError: null,
  history: [],
  historyLoading: false,
  historyError: null,

  searchByPublicId: async (publicId: string) => {
    const token = useSessionStore.getState().token;
    if (!token) {
      set({ searchError: "NO_SESSION" });
      return;
    }
    set({ searchLoading: true, searchError: null });
    try {
      const res = await fetch(
        `/orders/lookup?order_public_id=${encodeURIComponent(publicId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Request-Id": crypto.randomUUID(),
          },
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.code || `HTTP_${res.status}`);
      }
      const order: OrderSummary = await res.json();
      set({ searchResults: [order], searchLoading: false });
    } catch (e) {
      set({
        searchLoading: false,
        searchError: e instanceof Error ? e.message : "UNKNOWN",
      });
    }
  },

  fetchDetail: async (orderId: number) => {
    const token = useSessionStore.getState().token;
    if (!token) {
      set({ detailError: "NO_SESSION" });
      return;
    }
    set({ detailLoading: true, detailError: null });
    try {
      const res = await fetch(`/orders/${orderId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Request-Id": crypto.randomUUID(),
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.code || `HTTP_${res.status}`);
      }
      const detail: OrderDetail = await res.json();
      set({ detail, detailLoading: false });
    } catch (e) {
      set({
        detailLoading: false,
        detailError: e instanceof Error ? e.message : "UNKNOWN",
      });
    }
  },

  fetchHistory: async (orderId: number) => {
    const token = useSessionStore.getState().token;
    if (!token) {
      set({ historyError: "NO_SESSION" });
      return;
    }
    set({ historyLoading: true, historyError: null });
    try {
      const res = await fetch(`/orders/${orderId}/history`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Request-Id": crypto.randomUUID(),
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.code || `HTTP_${res.status}`);
      }
      const data: StatusHistoryResponse = await res.json();
      set({ history: data.items, historyLoading: false });
    } catch (e) {
      set({
        historyLoading: false,
        historyError: e instanceof Error ? e.message : "UNKNOWN",
      });
    }
  },

  clearSearch: () => set({ searchResults: [], searchError: null }),
  clearDetail: () =>
    set({ detail: null, detailError: null, history: [], historyError: null }),
}));
