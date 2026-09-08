/**
 * Projector — pure event → projection-state mutation logic (ADR-025 §2.3).
 *
 * The projector is PURE: it takes a classified marketplace event plus the
 * current projection state and produces the new projection rows + a described
 * index effect. It never touches the database — the relay orchestrates I/O.
 *
 * Ordering / idempotency (review 2/N req. 3,5):
 *  - store_decision: stale if `state_sequence <= stored.state_sequence` → skipped_stale.
 *  - product_moderated: stale if `moderation_sequence <= stored`.
 *  - inventory_adjusted: stale if `adjustment_sequence <= stored`.
 *  - product_published/archived/created: terminal state, applied once.
 *
 * Visibility (ADR-016 decision 3) is recomputed before/after so the relay can
 * decide whether the searchable document must be built (catalog fetch), have
 * its state columns refreshed, or be soft-archived.
 */

import type { StoreState, ProductState, ProductModerationState } from "@wasla/contracts-marketplace";
import type { ProjectableEvent } from "./consumed-events.js";
import { isVisible } from "./visibility.js";

export interface StoreProjection {
  readonly store_id: string;
  readonly store_slug: string;
  readonly category_slug: string;
  readonly store_state: StoreState;
  readonly state_sequence: number;
}

export interface ProductProjection {
  readonly product_id: string;
  readonly store_id: string;
  readonly store_slug: string;
  readonly sku: string;
  readonly category_slug: string;
  readonly product_state: ProductState;
  readonly moderation_state: ProductModerationState;
  readonly moderation_sequence: number;
  readonly quantity_on_hand: number;
  readonly adjustment_sequence: number;
  readonly archived_at: string | null;
}

/** New/updated projection row to upsert, or null if the event does not touch it. */
export interface ProjectionResult {
  readonly stale: boolean;
  readonly storeStateUpsert: StoreProjection | null;
  readonly productStateUpsert: ProductProjection | null;
  readonly visibilityBefore: boolean;
  readonly visibilityAfter: boolean;
  readonly indexEffect: IndexEffect;
}

export type IndexEffect =
  | { readonly kind: "none" }
  | { readonly kind: "became_visible"; product_id: string }
  | { readonly kind: "refresh_product"; product_id: string }
  | { readonly kind: "archive_product"; product_id: string }
  | { readonly kind: "store_state_changed"; store_id: string };

function visibleOf(store: StoreState | null, product: ProductProjection | null): boolean {
  if (!store || !product) return false;
  return isVisible({
    store_state: store,
    product_state: product.product_state,
    moderation_state: product.moderation_state,
    quantity_on_hand: product.quantity_on_hand,
  });
}

export function project(
  event: ProjectableEvent,
  store: StoreProjection | null,
  product: ProductProjection | null,
): ProjectionResult {
  switch (event.type) {
    case "store_decision": {
      const d = event.data;
      if (store && d.state_sequence <= store.state_sequence) {
        return { stale: true, storeStateUpsert: null, productStateUpsert: null, visibilityBefore: false, visibilityAfter: false, indexEffect: { kind: "none" } };
      }
      const next: StoreProjection = {
        store_id: d.store_id,
        store_slug: d.store_slug,
        category_slug: d.category_slug,
        store_state: d.to_state,
        state_sequence: d.state_sequence,
      };
      return {
        stale: false,
        storeStateUpsert: next,
        productStateUpsert: null,
        visibilityBefore: false,
        visibilityAfter: false,
        // A store state change re-evaluates visibility for ALL its products.
        indexEffect: { kind: "store_state_changed", store_id: d.store_id },
      };
    }

    case "product_created": {
      const d = event.data;
      const next: ProductProjection = {
        product_id: d.product_id,
        store_id: d.store_id,
        store_slug: d.store_slug,
        sku: d.sku,
        category_slug: d.category_slug,
        product_state: d.state,
        moderation_state: d.moderation_state,
        moderation_sequence: 0,
        quantity_on_hand: 0,
        adjustment_sequence: 0,
        archived_at: null,
      };
      return {
        stale: false,
        storeStateUpsert: null,
        productStateUpsert: next,
        visibilityBefore: false,
        visibilityAfter: visibleOf(store?.store_state ?? null, next),
        indexEffect: { kind: "none" },
      };
    }

    case "product_moderated": {
      const d = event.data;
      if (product && d.moderation_sequence <= product.moderation_sequence) {
        return { stale: true, storeStateUpsert: null, productStateUpsert: null, visibilityBefore: false, visibilityAfter: false, indexEffect: { kind: "none" } };
      }
      const next: ProductProjection = {
        ...(product ?? emptyProduct(d.product_id, d.store_id, d.store_slug)),
        product_id: d.product_id,
        store_id: d.store_id,
        store_slug: d.store_slug,
        moderation_state: d.to_state,
        moderation_sequence: d.moderation_sequence,
      };
      const vb = visibleOf(store?.store_state ?? null, product);
      const va = visibleOf(store?.store_state ?? null, next);
      return { stale: false, storeStateUpsert: null, productStateUpsert: next, visibilityBefore: vb, visibilityAfter: va, indexEffect: indexEffectFor(vb, va, d.product_id, false) };
    }

    case "product_published": {
      const d = event.data;
      // published carries snapshots of store_state + quantity_on_hand at publish time.
      const next: ProductProjection = {
        ...(product ?? emptyProduct(d.product_id, d.store_id, d.store_slug, d.category_slug)),
        product_id: d.product_id,
        store_id: d.store_id,
        store_slug: d.store_slug,
        category_slug: d.category_slug,
        product_state: d.to_state,
        quantity_on_hand: d.quantity_on_hand,
      };
      const vb = visibleOf(store?.store_state ?? null, product);
      const va = visibleOf(d.store_state, next);
      return { stale: false, storeStateUpsert: null, productStateUpsert: next, visibilityBefore: vb, visibilityAfter: va, indexEffect: indexEffectFor(vb, va, d.product_id, false) };
    }

    case "inventory_adjusted": {
      const d = event.data;
      if (product && d.adjustment_sequence <= product.adjustment_sequence) {
        return { stale: true, storeStateUpsert: null, productStateUpsert: null, visibilityBefore: false, visibilityAfter: false, indexEffect: { kind: "none" } };
      }
      const next: ProductProjection = {
        ...(product ?? emptyProduct(d.product_id, d.store_id, "")),
        product_id: d.product_id,
        store_id: d.store_id,
        quantity_on_hand: d.quantity_after,
        adjustment_sequence: d.adjustment_sequence,
      };
      const vb = visibleOf(store?.store_state ?? null, product);
      const va = visibleOf(store?.store_state ?? null, next);
      return { stale: false, storeStateUpsert: null, productStateUpsert: next, visibilityBefore: vb, visibilityAfter: va, indexEffect: indexEffectFor(vb, va, d.product_id, false) };
    }

    case "product_archived": {
      const d = event.data;
      const next: ProductProjection = {
        ...(product ?? emptyProduct(d.product_id, d.store_id, d.store_slug)),
        product_id: d.product_id,
        store_id: d.store_id,
        store_slug: d.store_slug,
        product_state: d.to_state,
        archived_at: d.occurred_for,
      };
      return {
        stale: false,
        storeStateUpsert: null,
        productStateUpsert: next,
        visibilityBefore: visibleOf(store?.store_state ?? null, product),
        visibilityAfter: false,
        indexEffect: { kind: "archive_product", product_id: d.product_id },
      };
    }

    case "store_staff":
      return { stale: false, storeStateUpsert: null, productStateUpsert: null, visibilityBefore: false, visibilityAfter: false, indexEffect: { kind: "none" } };
  }
}

function indexEffectFor(vb: boolean, va: boolean, productId: string, archived: boolean): IndexEffect {
  if (archived) return { kind: "archive_product", product_id: productId };
  if (!vb && va) return { kind: "became_visible", product_id: productId };
  if (vb && !va) return { kind: "refresh_product", product_id: productId };
  if (vb && va) return { kind: "refresh_product", product_id: productId };
  return { kind: "none" };
}

function emptyProduct(productId: string, storeId: string, storeSlug: string, categorySlug = ""): ProductProjection {
  return {
    product_id: productId,
    store_id: storeId,
    store_slug: storeSlug,
    sku: "",
    category_slug: categorySlug,
    product_state: "draft",
    moderation_state: "pending",
    moderation_sequence: 0,
    quantity_on_hand: 0,
    adjustment_sequence: 0,
    archived_at: null,
  };
}
