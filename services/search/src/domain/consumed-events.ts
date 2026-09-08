/**
 * Consumer-side typed views of the marketplace outbox events the relay reads
 * (ADR-025 §2.3). These are the search service's projection of the marketplace
 * event contract (@wasla/contracts-marketplace events.json). They are NOT a
 * second source of truth — they describe the shape of what is consumed.
 *
 * Drift is guarded at test time: `event-coverage.test.ts` reads the canonical
 * marketplace events.json and proves every event type is explicitly classified
 * by `classifyEvent` below. A new marketplace event type that the relay does
 * not yet classify fails the test — it is never silently dropped.
 *
 * Constraints honoured (ADR-016):
 *  - decision 4: NO price in payloads (fetched from the catalog port).
 *  - decision 10: NO free text in payloads (title fetched from the catalog).
 *  - decision 3: NO visibility event (derived from consumed state).
 *  - decision 9: NO delete event (archived is terminal soft-delete).
 */

import type {
  MarketplaceEventType,
  StoreState,
  ProductState,
  ProductModerationState,
  InventoryReasonCode,
} from "@wasla/contracts-marketplace";

/** A row read from `marketplace_outbox` by the relay's event source. */
export interface MarketplaceOutboxRow {
  readonly outbox_id: string;
  readonly event_type: MarketplaceEventType;
  readonly event_version: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly occurred_at: string;
  readonly created_at: string;
  /** Flat scalars only (ADR-016 decision 1) — no nested objects/arrays. */
  readonly data: Record<string, unknown>;
}

/** The checkpoint offset the relay owns (ADR-025 §2.3, GAP-3). */
export interface RelayCheckpoint {
  readonly last_outbox_id: string;
  readonly last_created_at: string;
}

/** Terminal/non-terminal status of a consumed outbox event. */
export type ConsumedStatus =
  | "pending" // in-flight / retryable failure — checkpoint does NOT advance
  | "applied" // projected into the read model — terminal
  | "skipped" // no-op for search (e.g. already-current) — terminal
  | "skipped_stale" // older sequence than stored — terminal, no regression
  | "ignored" // event type does not affect search — terminal
  | "poisoned"; // dead-letter after max attempts / unknown version — terminal

export function isTerminal(status: ConsumedStatus): boolean {
  return status !== "pending";
}

// ── Per-event payload views (flat scalars, as enforced by events.json) ──

interface StoreDecisionData {
  readonly store_id: string;
  readonly store_slug: string;
  readonly owner_public_id?: string;
  readonly category_slug: string;
  readonly from_state?: StoreState | null;
  readonly to_state: StoreState;
  readonly state_sequence: number;
  readonly actor_type?: string;
  readonly actor_public_id?: string | null;
  readonly reason_code?: string | null;
  readonly occurred_for: string;
}

interface ProductCreatedData {
  readonly product_id: string;
  readonly store_id: string;
  readonly store_slug: string;
  readonly sku: string;
  readonly category_slug: string;
  readonly state: ProductState;
  readonly moderation_state: ProductModerationState;
  readonly created_by_public_id: string;
  readonly occurred_for: string;
}

interface ProductModeratedData {
  readonly product_id: string;
  readonly store_id: string;
  readonly store_slug: string;
  readonly from_state: ProductModerationState | null;
  readonly to_state: ProductModerationState;
  readonly moderation_sequence: number;
  readonly actor_type?: string;
  readonly actor_public_id?: string | null;
  readonly reason_code?: string | null;
  readonly occurred_for: string;
}

interface ProductPublishedData {
  readonly product_id: string;
  readonly store_id: string;
  readonly store_slug: string;
  readonly category_slug: string;
  readonly from_state: ProductState;
  readonly to_state: "published";
  readonly store_state: StoreState;
  readonly quantity_on_hand: number;
  readonly actor_public_id: string;
  readonly occurred_for: string;
}

interface ProductArchivedData {
  readonly product_id: string;
  readonly store_id: string;
  readonly store_slug: string;
  readonly from_state: ProductState;
  readonly to_state: "archived";
  readonly actor_public_id: string;
  readonly occurred_for: string;
}

interface InventoryAdjustedData {
  readonly adjustment_id: string;
  readonly product_id: string;
  readonly store_id: string;
  readonly quantity_delta: number;
  readonly quantity_after: number;
  readonly reason_code: InventoryReasonCode;
  readonly adjustment_sequence: number;
  readonly actor_public_id: string;
  readonly occurred_for: string;
}

interface StoreStaffData {
  readonly store_id: string;
  readonly store_slug: string;
  readonly role?: string;
  readonly occurred_for: string;
}

/** Discriminated union of the events the projector actually handles. */
export type ProjectableEvent =
  | { readonly type: "store_decision"; data: StoreDecisionData }
  | { readonly type: "product_created"; data: ProductCreatedData }
  | { readonly type: "product_moderated"; data: ProductModeratedData }
  | { readonly type: "product_published"; data: ProductPublishedData }
  | { readonly type: "product_archived"; data: ProductArchivedData }
  | { readonly type: "inventory_adjusted"; data: InventoryAdjustedData }
  | { readonly type: "store_staff"; data: StoreStaffData };

export type EventClassification =
  | { readonly kind: "projectable"; event: ProjectableEvent }
  | { readonly kind: "ignored"; reason: string };

/**
 * Classify a raw outbox row into a projectable event or an explicit ignore.
 * Every marketplace event type is classified here — `event-coverage.test.ts`
 * enforces that no type is missing. Unknown event versions are NOT classified
 * here; the relay treats them as poison (version compatibility, req. 11).
 */
export function classifyEvent(row: MarketplaceOutboxRow): EventClassification {
  switch (row.event_type) {
    case "marketplace.store_registered":
    case "marketplace.store_review_requested":
    case "marketplace.store_approved":
    case "marketplace.store_rejected":
    case "marketplace.store_suspended":
    case "marketplace.store_archived":
      return { kind: "projectable", event: { type: "store_decision", data: row.data as unknown as StoreDecisionData } };
    case "marketplace.store_staff_added":
    case "marketplace.store_staff_removed":
      return {
        kind: "ignored",
        reason: "staff lifecycle does not affect product visibility (ADR-016 decision 3)",
      };
    case "marketplace.product_created":
      return { kind: "projectable", event: { type: "product_created", data: row.data as unknown as ProductCreatedData } };
    case "marketplace.product_moderated":
      return { kind: "projectable", event: { type: "product_moderated", data: row.data as unknown as ProductModeratedData } };
    case "marketplace.product_published":
      return { kind: "projectable", event: { type: "product_published", data: row.data as unknown as ProductPublishedData } };
    case "marketplace.product_archived":
      return { kind: "projectable", event: { type: "product_archived", data: row.data as unknown as ProductArchivedData } };
    case "marketplace.inventory_adjusted":
      return { kind: "projectable", event: { type: "inventory_adjusted", data: row.data as unknown as InventoryAdjustedData } };
    default:
      // Exhaustiveness guard: a new event type in the contract that this
      // switch does not handle is a compile error here AND a test failure in
      // event-coverage.test.ts.
      return { kind: "ignored", reason: `unhandled event type: ${row.event_type satisfies never}` };
  }
}

/** Catalog datum fetched from the read port (GET /products/{productId}). */
export interface CatalogProduct {
  readonly product_id: string;
  readonly store_id: string;
  readonly store_slug: string;
  readonly sku: string;
  readonly category_slug: string;
  readonly title_ar: string;
  readonly title_en: string | null;
  readonly price_minor_units: number;
  readonly currency_code: "SAR";
}
