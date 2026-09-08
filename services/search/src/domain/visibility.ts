/**
 * Visibility rules — rebuilt from consumed state, never stored (ADR-025 §2.2).
 *
 * A product document is ONLY indexed when ALL four visibility conditions hold
 * (ADR-016 decision 3): store approved · product published · moderation
 * approved · quantity > 0. These are read from consumed marketplace state at
 * document-build time. No `is_visible` column is ever stored in the index.
 *
 * If the index and the true state disagree, the INDEX is wrong and the next
 * ingestion/rebuild fixes it. Search is not a transaction gateway.
 */

export type StoreState = "approved" | "pending" | "suspended" | "archived";
export type ProductModerationState = "approved" | "pending" | "rejected";
export type ProductPublicationState = "published" | "draft" | "archived";

export interface ConsumedProductState {
  readonly store_state: StoreState;
  readonly publication_state: ProductPublicationState;
  readonly moderation_state: ProductModerationState;
  readonly quantity_on_hand: number;
}

/**
 * Returns true iff the product is visible per ADR-016 decision 3. This gates
 * whether an indexed document is built/kept at all — invisible products never
 * enter the index, and a state change that hides a product removes it.
 */
export function isVisible(state: ConsumedProductState): boolean {
  return (
    state.store_state === "approved" &&
    state.publication_state === "published" &&
    state.moderation_state === "approved" &&
    state.quantity_on_hand > 0
  );
}
