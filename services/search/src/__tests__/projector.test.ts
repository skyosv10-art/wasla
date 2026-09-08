/**
 * Projector unit tests (review 2/N). Pure logic — no database.
 *
 * Covers: stale-sequence detection (ordering/idempotency), visibility
 * before/after transitions, and the index effect classification.
 */

import { describe, expect, it } from "vitest";
import { project } from "../domain/projector.js";
import type { StoreProjection, ProductProjection } from "../domain/projector.js";
import type { ProjectableEvent } from "../domain/consumed-events.js";

const STORE_ID = "11111111-1111-1111-1111-111111111111";
const PRODUCT_ID = "22222222-2222-2222-2222-222222222222";

const approvedStore: StoreProjection = {
  store_id: STORE_ID, store_slug: "acme", category_slug: "electronics",
  store_state: "approved", state_sequence: 3,
};

function product(overrides: Partial<ProductProjection>): ProductProjection {
  return {
    product_id: PRODUCT_ID, store_id: STORE_ID, store_slug: "acme", sku: "sku-1",
    category_slug: "electronics", product_state: "draft", moderation_state: "pending",
    moderation_sequence: 1, quantity_on_hand: 0, adjustment_sequence: 1, archived_at: null,
    ...overrides,
  };
}

describe("projector — stale sequence detection (ordering / idempotency)", () => {
  it("store_decision with older state_sequence is skipped_stale", () => {
    const event: ProjectableEvent = {
      type: "store_decision",
      data: { store_id: STORE_ID, store_slug: "acme", category_slug: "electronics", to_state: "approved", state_sequence: 2, occurred_for: "2026-01-01T00:00:00Z" },
    };
    const r = project(event, approvedStore, null);
    expect(r.stale).toBe(true);
    expect(r.storeStateUpsert).toBeNull();
  });

  it("store_decision with newer state_sequence is applied", () => {
    const event: ProjectableEvent = {
      type: "store_decision",
      data: { store_id: STORE_ID, store_slug: "acme", category_slug: "electronics", to_state: "suspended", state_sequence: 5, occurred_for: "2026-01-01T00:00:00Z" },
    };
    const r = project(event, approvedStore, null);
    expect(r.stale).toBe(false);
    expect(r.storeStateUpsert?.store_state).toBe("suspended");
    expect(r.indexEffect.kind).toBe("store_state_changed");
  });

  it("product_moderated with older moderation_sequence is skipped_stale", () => {
    const event: ProjectableEvent = {
      type: "product_moderated",
      data: { product_id: PRODUCT_ID, store_id: STORE_ID, store_slug: "acme", from_state: "pending", to_state: "approved", moderation_sequence: 1, occurred_for: "2026-01-01T00:00:00Z" },
    };
    const r = project(event, approvedStore, product({ moderation_state: "approved", moderation_sequence: 2 }));
    expect(r.stale).toBe(true);
  });

  it("inventory_adjusted with older adjustment_sequence is skipped_stale", () => {
    const event: ProjectableEvent = {
      type: "inventory_adjusted",
      data: { adjustment_id: "a1", product_id: PRODUCT_ID, store_id: STORE_ID, quantity_delta: 1, quantity_after: 5, reason_code: "restock", adjustment_sequence: 1, actor_public_id: "WS-0000000001", occurred_for: "2026-01-01T00:00:00Z" },
    };
    const r = project(event, approvedStore, product({ adjustment_sequence: 2 }));
    expect(r.stale).toBe(true);
  });
});

describe("projector — visibility transitions and index effects", () => {
  it("product_created with no store approved => not visible, none", () => {
    const event: ProjectableEvent = {
      type: "product_created",
      data: { product_id: PRODUCT_ID, store_id: STORE_ID, store_slug: "acme", sku: "sku-1", category_slug: "electronics", state: "draft", moderation_state: "pending", created_by_public_id: "WS-0000000001", occurred_for: "2026-01-01T00:00:00Z" },
    };
    const r = project(event, null, null);
    expect(r.visibilityAfter).toBe(false);
    expect(r.indexEffect.kind).toBe("none");
  });

  it("product_published with approved store + qty>0 + moderation approved => became_visible", () => {
    const event: ProjectableEvent = {
      type: "product_published",
      data: { product_id: PRODUCT_ID, store_id: STORE_ID, store_slug: "acme", category_slug: "electronics", from_state: "draft", to_state: "published", store_state: "approved", quantity_on_hand: 5, actor_public_id: "WS-0000000001", occurred_for: "2026-01-01T00:00:00Z" },
    };
    // product already moderated approved
    const r = project(event, approvedStore, product({ moderation_state: "approved" }));
    expect(r.visibilityBefore).toBe(false);
    expect(r.visibilityAfter).toBe(true);
    expect(r.indexEffect.kind).toBe("became_visible");
  });

  it("inventory_adjusted to zero => becomes invisible, refresh_product", () => {
    const visible = product({ product_state: "published", moderation_state: "approved", quantity_on_hand: 5, adjustment_sequence: 2 });
    const event: ProjectableEvent = {
      type: "inventory_adjusted",
      data: { adjustment_id: "a1", product_id: PRODUCT_ID, store_id: STORE_ID, quantity_delta: -5, quantity_after: 0, reason_code: "shrinkage", adjustment_sequence: 3, actor_public_id: "WS-0000000001", occurred_for: "2026-01-01T00:00:00Z" },
    };
    const r = project(event, approvedStore, visible);
    expect(r.visibilityBefore).toBe(true);
    expect(r.visibilityAfter).toBe(false);
    expect(r.indexEffect.kind).toBe("refresh_product");
  });

  it("product_archived => archive_product effect", () => {
    const visible = product({ product_state: "published", moderation_state: "approved", quantity_on_hand: 5, adjustment_sequence: 2 });
    const event: ProjectableEvent = {
      type: "product_archived",
      data: { product_id: PRODUCT_ID, store_id: STORE_ID, store_slug: "acme", from_state: "published", to_state: "archived", actor_public_id: "WS-0000000001", occurred_for: "2026-01-02T00:00:00Z" },
    };
    const r = project(event, approvedStore, visible);
    expect(r.indexEffect).toEqual({ kind: "archive_product", product_id: PRODUCT_ID });
    expect(r.productStateUpsert?.archived_at).toBe("2026-01-02T00:00:00Z");
  });

  it("store_staff event => none effect (ignored upstream)", () => {
    const event: ProjectableEvent = {
      type: "store_staff",
      data: { store_id: STORE_ID, store_slug: "acme", occurred_for: "2026-01-01T00:00:00Z" },
    };
    const r = project(event, approvedStore, null);
    expect(r.indexEffect.kind).toBe("none");
    expect(r.storeStateUpsert).toBeNull();
  });
});
