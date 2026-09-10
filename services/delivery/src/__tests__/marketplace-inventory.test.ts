/**
 * Marketplace inventory classifier + validator tests (ADR-026 §2.3).
 *
 * Tests the domain layer in isolation — no I/O, no Postgres. The classifier
 * is the ONLY path from a raw outbox row to a projectable event; an invalid
 * payload throws MarketplacePayloadError, which the relay treats as poison.
 */

import { describe, expect, it } from "vitest";
import {
  classifyMarketplaceInventoryEvent,
  MarketplacePayloadError,
  type MarketplaceOutboxRow,
} from "../domain/marketplace-inventory-events.js";

const STORE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PRODUCT_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const ADJUSTMENT_ID = "cccccccc-0000-0000-0000-000000000003";
const ACTOR = "WS-0000000123";

function validData(): Record<string, unknown> {
  return {
    adjustment_id: ADJUSTMENT_ID,
    product_id: PRODUCT_ID,
    store_id: STORE_ID,
    quantity_delta: 10,
    quantity_after: 100,
    reason_code: "restock",
    adjustment_sequence: 1,
    actor_public_id: ACTOR,
    occurred_for: "2026-09-09T10:00:00.000Z",
  };
}

function row(overrides: Partial<MarketplaceOutboxRow> = {}): MarketplaceOutboxRow {
  return {
    event_id: "dddddddd-0000-0000-0000-000000000004",
    event_type: "marketplace.inventory_adjusted",
    event_version: "v1",
    aggregate_type: "inventory",
    aggregate_id: STORE_ID,
    occurred_at: "2026-09-09T10:00:00.000Z",
    trace_id: null,
    data: validData(),
    ...overrides,
  };
}

describe("classifyMarketplaceInventoryEvent — valid payload → projectable", () => {
  it("classifies a valid inventory_adjusted event as projectable", () => {
    const classification = classifyMarketplaceInventoryEvent(row());
    expect(classification.kind).toBe("projectable");
    if (classification.kind === "projectable") {
      expect(classification.event).toEqual({
        kind: "inventory_adjusted",
        adjustment_id: ADJUSTMENT_ID,
        product_id: PRODUCT_ID,
        store_id: STORE_ID,
        quantity_delta: 10,
        quantity_after: 100,
        reason_code: "restock",
        adjustment_sequence: 1,
        actor_public_id: ACTOR,
        occurred_for: "2026-09-09T10:00:00.000Z",
      });
    }
  });

  it("accepts a negative quantity_delta (shrinkage)", () => {
    const classification = classifyMarketplaceInventoryEvent(
      row({ data: { ...validData(), quantity_delta: -5, quantity_after: 95 } }),
    );
    expect(classification.kind).toBe("projectable");
  });
});

describe("classifyMarketplaceInventoryEvent — missing required fields → throws", () => {
  for (const key of [
    "adjustment_id",
    "product_id",
    "store_id",
    "quantity_delta",
    "quantity_after",
    "reason_code",
    "adjustment_sequence",
    "actor_public_id",
    "occurred_for",
  ]) {
    it(`throws when payload.${key} is missing`, () => {
      const data = validData();
      delete data[key];
      expect(() => classifyMarketplaceInventoryEvent(row({ data }))).toThrow(MarketplacePayloadError);
    });
  }
});

describe("classifyMarketplaceInventoryEvent — quantity_delta = 0 → throws", () => {
  it("throws when quantity_delta is zero (schema says non-zero)", () => {
    expect(() =>
      classifyMarketplaceInventoryEvent(row({ data: { ...validData(), quantity_delta: 0 } })),
    ).toThrow(MarketplacePayloadError);
  });
});

describe("classifyMarketplaceInventoryEvent — quantity_after < 0 → throws", () => {
  it("throws when quantity_after is negative (schema says minimum 0)", () => {
    expect(() =>
      classifyMarketplaceInventoryEvent(row({ data: { ...validData(), quantity_after: -1 } })),
    ).toThrow(MarketplacePayloadError);
  });
});

describe("classifyMarketplaceInventoryEvent — wrong event_type → ignored", () => {
  it("classifies a non-inventory event as ignored", () => {
    // The event source filters by event_type, but the classifier is defensive.
    const classification = classifyMarketplaceInventoryEvent(
      row({ event_type: "marketplace.store_approved" as MarketplaceOutboxRow["event_type"] }),
    );
    expect(classification.kind).toBe("ignored");
  });
});

describe("classifyMarketplaceInventoryEvent — invalid UUIDs → throws", () => {
  it("throws when adjustment_id is not a UUID", () => {
    expect(() =>
      classifyMarketplaceInventoryEvent(row({ data: { ...validData(), adjustment_id: "not-a-uuid" } })),
    ).toThrow(MarketplacePayloadError);
  });

  it("throws when product_id is not a UUID", () => {
    expect(() =>
      classifyMarketplaceInventoryEvent(row({ data: { ...validData(), product_id: "not-a-uuid" } })),
    ).toThrow(MarketplacePayloadError);
  });
});

describe("classifyMarketplaceInventoryEvent — invalid actor_public_id → throws", () => {
  it("throws when actor_public_id does not match WS-##########", () => {
    expect(() =>
      classifyMarketplaceInventoryEvent(row({ data: { ...validData(), actor_public_id: "invalid" } })),
    ).toThrow(MarketplacePayloadError);
  });
});

describe("classifyMarketplaceInventoryEvent — invalid occurred_for → throws", () => {
  it("throws when occurred_for is not an ISO date-time", () => {
    expect(() =>
      classifyMarketplaceInventoryEvent(row({ data: { ...validData(), occurred_for: "not-a-date" } })),
    ).toThrow(MarketplacePayloadError);
  });
});

describe("classifyMarketplaceInventoryEvent — adjustment_sequence < 1 → throws", () => {
  it("throws when adjustment_sequence is zero (schema says minimum 1)", () => {
    expect(() =>
      classifyMarketplaceInventoryEvent(row({ data: { ...validData(), adjustment_sequence: 0 } })),
    ).toThrow(MarketplacePayloadError);
  });
});
