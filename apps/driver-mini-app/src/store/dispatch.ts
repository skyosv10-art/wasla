import { create } from "zustand";
import { apiClient, ApiError } from "../api/client";
import type { DispatchJob, DispatchOffer } from "../types/dispatch";
import type { Order } from "../types/orders";
import { useSessionStore } from "./session";

// ADR-045 Decision 4: Offer Feed uses polling (not WebSocket).
// Polling interval: 10 seconds (acceptable latency per ADR-045).

const POLL_INTERVAL_MS = 10_000;

interface DispatchState {
  // Offer Feed
  offers: DispatchOffer[];
  offersJobId: string | null;
  offersLoading: boolean;
  offersError: string | null;
  pollTimerId: ReturnType<typeof setInterval> | null;

  // Job Detail
  activeJob: DispatchJob | null;
  activeOrder: Order | null;
  jobLoading: boolean;
  jobError: string | null;

  // Action states
  actionLoading: boolean;
  actionError: string | null;

  // Actions
  fetchOffers: (jobId: string) => Promise<void>;
  startPolling: (jobId: string) => void;
  stopPolling: () => void;

  fetchJobDetail: (jobId: string) => Promise<void>;

  acceptOffer: (offerId: string) => Promise<boolean>;
  rejectOffer: (offerId: string, reasonCode: string) => Promise<boolean>;

  transitionOrder: (orderId: string, toStatus: string, reasonCode?: string) => Promise<boolean>;
  cancelJob: (jobId: string, reasonCode: string) => Promise<boolean>;

  clearErrors: () => void;
}

function generateIdempotencyKey(): string {
  // RFC-4122 v4 UUID via crypto.randomUUID (available in all modern browsers)
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return `drv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useDispatchStore = create<DispatchState>((set, get) => ({
  offers: [],
  offersJobId: null,
  offersLoading: false,
  offersError: null,
  pollTimerId: null,

  activeJob: null,
  activeOrder: null,
  jobLoading: false,
  jobError: null,

  actionLoading: false,
  actionError: null,

  fetchOffers: async (jobId: string) => {
    set({ offersLoading: true, offersError: null });
    try {
      const data = await apiClient.get<{ items: DispatchOffer[] }>(
        `/dispatch/jobs/${jobId}/offers`
      );
      set({ offers: data.items ?? [], offersJobId: jobId, offersLoading: false });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "فشل في جلب العروض";
      set({ offersError: message, offersLoading: false });
    }
  },

  startPolling: (jobId: string) => {
    const { pollTimerId, offersJobId } = get();
    // Don't restart if already polling the same job
    if (pollTimerId && offersJobId === jobId) return;

    // Clear any existing timer
    if (pollTimerId) {
      clearInterval(pollTimerId);
    }

    // Fetch immediately
    get().fetchOffers(jobId);

    // Set up interval
    const timerId = setInterval(() => {
      get().fetchOffers(jobId);
    }, POLL_INTERVAL_MS);

    set({ pollTimerId: timerId, offersJobId: jobId });
  },

  stopPolling: () => {
    const { pollTimerId } = get();
    if (pollTimerId) {
      clearInterval(pollTimerId);
    }
    set({ pollTimerId: null });
  },

  fetchJobDetail: async (jobId: string) => {
    set({ jobLoading: true, jobError: null });
    try {
      const job = await apiClient.get<DispatchJob>(`/dispatch/jobs/${jobId}`);
      set({ activeJob: job, jobLoading: false });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "فشل في جلب تفاصيل المهمة";
      set({ jobError: message, jobLoading: false });
    }
  },

  acceptOffer: async (offerId: string) => {
    set({ actionLoading: true, actionError: null });
    try {
      const key = generateIdempotencyKey();
      const offer = await apiClient.post<DispatchOffer>(
        `/dispatch/offers/${offerId}/accept`,
        undefined,
        { "Idempotency-Key": key }
      );
      // Update the offer in the list
      const { offers } = get();
      set({
        offers: offers.map((o) => (o.id === offerId ? offer : o)),
        actionLoading: false,
      });
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "فشل في قبول العرض";
      set({ actionError: message, actionLoading: false });
      return false;
    }
  },

  rejectOffer: async (offerId: string, reasonCode: string) => {
    set({ actionLoading: true, actionError: null });
    try {
      const key = generateIdempotencyKey();
      const offer = await apiClient.post<DispatchOffer>(
        `/dispatch/offers/${offerId}/reject`,
        { reason_code: reasonCode },
        { "Idempotency-Key": key }
      );
      // Update the offer in the list
      const { offers } = get();
      set({
        offers: offers.map((o) => (o.id === offerId ? offer : o)),
        actionLoading: false,
      });
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "فشل في رفض العرض";
      set({ actionError: message, actionLoading: false });
      return false;
    }
  },

  transitionOrder: async (orderId: string, toStatus: string, reasonCode?: string) => {
    set({ actionLoading: true, actionError: null });
    try {
      const { driverId } = useSessionStore.getState();
      const key = generateIdempotencyKey();
      await apiClient.post<Order>(
        `/orders/${orderId}/transitions`,
        {
          to_status: toStatus,
          actor_type: "driver",
          actor_ref: driverId,
          ...(reasonCode ? { reason_code: reasonCode } : {}),
        },
        { "Idempotency-Key": key }
      );
      set({ actionLoading: false });
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "فشل في تحديث حالة الطلب";
      set({ actionError: message, actionLoading: false });
      return false;
    }
  },

  cancelJob: async (jobId: string, reasonCode: string) => {
    set({ actionLoading: true, actionError: null });
    try {
      const key = generateIdempotencyKey();
      const job = await apiClient.post<DispatchJob>(
        `/dispatch/jobs/${jobId}/cancel`,
        { reason_code: reasonCode },
        { "Idempotency-Key": key }
      );
      set({ activeJob: job, actionLoading: false });
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "فشل في إلغاء المهمة";
      set({ actionError: message, actionLoading: false });
      return false;
    }
  },

  clearErrors: () => {
    set({ offersError: null, jobError: null, actionError: null });
  },
}));
