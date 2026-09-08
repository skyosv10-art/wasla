/**
 * Visibility rules — rebuilt from consumed state, never stored (ADR-025 §2.2).
 *
 * A product document is ONLY kept visible when ALL four visibility conditions
 * hold (ADR-016 decision 3): store approved · product published · moderation
 * approved · quantity > 0. These are read from the consumed projection state
 * at query time. No `is_visible` column is ever stored in the index.
 *
 * If the index and the true state disagree, the INDEX is wrong and the next
 * relay/replay fixes it. Search is not a transaction gateway.
 */

import type {
  StoreState,
  ProductState,
  ProductModerationState,
} from "@wasla/contracts-marketplace";

export type { StoreState, ProductState, ProductModerationState };

export interface ConsumedProductState {
  readonly store_state: StoreState;
  readonly product_state: ProductState;
  readonly moderation_state: ProductModerationState;
  readonly quantity_on_hand: number;
}

/**
 * Returns true iff the product is visible per ADR-016 decision 3. This is the
 * query-time predicate; the relay uses the SAME rule when deciding whether to
 * build/keep the searchable document, so read and write cannot drift.
 */
export function isVisible(state: ConsumedProductState): boolean {
  return (
    state.store_state === "approved" &&
    state.product_state === "published" &&
    state.moderation_state === "approved" &&
    state.quantity_on_hand > 0
  );
}
