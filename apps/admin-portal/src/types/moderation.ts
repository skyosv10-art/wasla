/**
 * Moderation types for admin portal.
 *
 * Mirrors the marketplace service moderation contract (ADR-016).
 * Marketplace service runs at services/marketplace/ (Fastify, port 8094).
 * Routes: GET /stores/:storeSlug/reviews, POST /stores/:storeSlug/decisions,
 *         POST /products/:productId/decisions, POST /products/:productId/publish,
 *         POST /products/:productId/archive.
 */

/** Store lifecycle states as returned by the store review ledger. */
export const STORE_STATES = [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "suspended",
  "archived",
] as const;
export type StoreState = (typeof STORE_STATES)[number];

/** Store moderation decisions (one path, one transition table). */
export const STORE_DECISIONS = [
  "review_requested",
  "approved",
  "rejected",
  "suspended",
  "reinstated",
  "archived",
] as const;
export type StoreDecision = (typeof STORE_DECISIONS)[number];

/** Closed list of rejection / suspension reason codes. */
export const STORE_REASON_CODES = [
  "incomplete_profile",
  "prohibited_category",
  "duplicate_store",
  "misleading_title",
  "unverified_owner",
  "policy_violation",
  "owner_request",
] as const;
export type StoreReasonCode = (typeof STORE_REASON_CODES)[number];

/** Product moderation states. */
export const PRODUCT_MODERATION_STATES = ["pending", "approved", "rejected"] as const;
export type ProductModerationState = (typeof PRODUCT_MODERATION_STATES)[number];

/** Product moderation decisions. */
export const PRODUCT_DECISIONS = ["approved", "rejected"] as const;
export type ProductDecision = (typeof PRODUCT_DECISIONS)[number];

/** Product reason codes (closed list). */
export const PRODUCT_REASON_CODES = ["prohibited_item"] as const;
export type ProductReasonCode = (typeof PRODUCT_REASON_CODES)[number];

/** Store review record as returned by GET /stores/:storeSlug/reviews */
export interface StoreReviewResource {
  review_id: string;
  store_id: string;
  store_slug: string;
  decision: StoreDecision;
  from_state: StoreState | null;
  to_state: StoreState;
  state_sequence: number;
  actor_type: "owner" | "moderator" | "system";
  actor_public_id: string | null;
  reason_code: StoreReasonCode | null;
  decided_at: string;
}

/** Store review list response (cursor-paginated ledger). */
export interface StoreReviewsResponse {
  reviews: StoreReviewResource[];
  next_cursor: string | null;
}

/** Store decision request body for POST /stores/:storeSlug/decisions */
export interface StoreDecisionRequest {
  decision: StoreDecision;
  actor_type: "owner" | "moderator" | "system";
  actor_public_id?: string | null;
  reason_code?: StoreReasonCode | null;
}

/** Product review record as returned by POST /products/:productId/decisions */
export interface ProductReviewResource {
  review_id: string;
  product_id: string;
  store_id: string;
  decision: ProductDecision;
  from_state: ProductModerationState | null;
  to_state: ProductModerationState;
  moderation_sequence: number;
  actor_type: "moderator" | "system";
  actor_public_id: string | null;
  reason_code: ProductReasonCode | null;
  decided_at: string;
}

/** Product decision request body for POST /products/:productId/decisions */
export interface ProductDecisionRequest {
  decision: ProductDecision;
  actor_type: "moderator" | "system";
  actor_public_id?: string | null;
  reason_code?: ProductReasonCode | null;
}

/** Product publish/archive decision request body. */
export interface ProductLifecycleRequest {
  actor_type: "moderator" | "system";
  actor_public_id?: string | null;
}
