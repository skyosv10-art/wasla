/**
 * Moderation store for admin portal.
 *
 * Manages marketplace moderation state and API calls to the marketplace service.
 * Uses the admin API client with Bearer token authentication.
 *
 * Privileged workflow (M5-15): store review decisions, product moderation
 * decisions, and product publish/archive lifecycle. The moderation ledger is
 * append-only; this screen reads it and records decisions, never edits rows.
 */

import { create } from "zustand";
import { apiClient } from "../api/client";
import type {
  StoreReviewResource,
  StoreReviewsResponse,
  StoreDecision,
  StoreReasonCode,
  StoreDecisionRequest,
  ProductDecision,
  ProductReasonCode,
  ProductDecisionRequest,
  ProductReviewResource,
  ProductLifecycleRequest,
} from "../types/moderation";

interface ModerationState {
  storeReviews: StoreReviewResource[];
  storeReviewsCursor: string | null;
  lastProductDecision: ProductReviewResource | null;
  loading: boolean;
  error: string | null;
  selectedStoreSlug: string | null;

  fetchStoreReviews: (storeSlug: string) => Promise<void>;
  fetchMoreStoreReviews: () => Promise<void>;
  decideStore: (
    storeSlug: string,
    decision: StoreDecision,
    reasonCode: StoreReasonCode | null,
  ) => Promise<void>;
  decideProduct: (
    productId: string,
    decision: ProductDecision,
    reasonCode: ProductReasonCode | null,
  ) => Promise<void>;
  publishProduct: (productId: string) => Promise<void>;
  archiveProduct: (productId: string) => Promise<void>;
  setSelectedStoreSlug: (storeSlug: string | null) => void;
  clearError: () => void;
  clearLastProductDecision: () => void;
}

const ADMIN_ACTOR: StoreDecisionRequest["actor_type"] = "moderator";

export const useModerationStore = create<ModerationState>((set, get) => ({
  storeReviews: [],
  storeReviewsCursor: null,
  lastProductDecision: null,
  loading: false,
  error: null,
  selectedStoreSlug: null,

  fetchStoreReviews: async (storeSlug: string) => {
    set({ loading: true, error: null, storeReviews: [], storeReviewsCursor: null });
    try {
      const data = await apiClient.get<StoreReviewsResponse>(
        `/stores/${storeSlug}/reviews?limit=50`,
      );
      set({
        storeReviews: data.reviews,
        storeReviewsCursor: data.next_cursor,
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch store reviews",
      });
    }
  },

  fetchMoreStoreReviews: async () => {
    const { selectedStoreSlug, storeReviewsCursor } = get();
    if (!selectedStoreSlug || !storeReviewsCursor) return;
    set({ loading: true, error: null });
    try {
      const data = await apiClient.get<StoreReviewsResponse>(
        `/stores/${selectedStoreSlug}/reviews?limit=50&cursor=${storeReviewsCursor}`,
      );
      set({
        storeReviews: [...get().storeReviews, ...data.reviews],
        storeReviewsCursor: data.next_cursor,
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch more reviews",
      });
    }
  },

  decideStore: async (
    storeSlug: string,
    decision: StoreDecision,
    reasonCode: StoreReasonCode | null,
  ) => {
    set({ loading: true, error: null });
    try {
      const body: StoreDecisionRequest = {
        decision,
        actor_type: ADMIN_ACTOR,
        reason_code: reasonCode,
      };
      await apiClient.post(`/stores/${storeSlug}/decisions`, body);
      await get().fetchStoreReviews(storeSlug);
      set({ loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to record store decision",
      });
    }
  },

  decideProduct: async (
    productId: string,
    decision: ProductDecision,
    reasonCode: ProductReasonCode | null,
  ) => {
    set({ loading: true, error: null, lastProductDecision: null });
    try {
      const body: ProductDecisionRequest = {
        decision,
        actor_type: ADMIN_ACTOR,
        reason_code: reasonCode,
      };
      const data = await apiClient.post<ProductReviewResource>(
        `/products/${productId}/decisions`,
        body,
      );
      set({ lastProductDecision: data, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to record product decision",
      });
    }
  },

  publishProduct: async (productId: string) => {
    set({ loading: true, error: null });
    try {
      const body: ProductLifecycleRequest = { actor_type: ADMIN_ACTOR };
      await apiClient.post(`/products/${productId}/publish`, body);
      set({ loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to publish product",
      });
    }
  },

  archiveProduct: async (productId: string) => {
    set({ loading: true, error: null });
    try {
      const body: ProductLifecycleRequest = { actor_type: ADMIN_ACTOR };
      await apiClient.post(`/products/${productId}/archive`, body);
      set({ loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to archive product",
      });
    }
  },

  setSelectedStoreSlug: (storeSlug: string | null) =>
    set({ selectedStoreSlug: storeSlug }),

  clearError: () => set({ error: null }),
  clearLastProductDecision: () => set({ lastProductDecision: null }),
}));
