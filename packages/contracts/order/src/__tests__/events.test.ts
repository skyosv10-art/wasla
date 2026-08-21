/**
 * Drift guard between events.json (the canonical Event Contract) and the
 * hand-derived TypeScript event types.
 *
 * The types are hand-written on purpose (see events-types.ts). That choice is
 * only safe with this test: it reads the schema and asserts the literals,
 * required fields and enum members still agree.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ORDER_EVENT_TYPES, ORDER_STATUSES } from "../index.js";

const EVENTS_PATH = resolve(
  __dirname,
  "../../../../../services/orders/contracts/events.json",
);

const contract = JSON.parse(readFileSync(EVENTS_PATH, "utf8")) as {
  $id: string;
  $defs: Record<string, any>;
};

const EVENT_DEFS = [
  "OrderCreatedV1",
  "OrderStatusChangedV1",
  "OrderAssignmentOfferedV1",
  "OrderAssignmentResolvedV1",
] as const;

describe("event contract shape", () => {
  it("is versioned under a stable $id", () => {
    expect(contract.$id).toBe("https://wasla.local/orders/events/v1");
  });

  it("defines exactly the four events the package knows about", () => {
    const defined = Object.keys(contract.$defs).filter((k) => k.endsWith("V1"));
    expect(defined.sort()).toEqual([...EVENT_DEFS].sort());
  });

  it("declares the same event_type literals the package exports", () => {
    const fromSchema = EVENT_DEFS.map(
      (name) => contract.$defs[name].properties.event_type.const as string,
    );
    expect(fromSchema.sort()).toEqual(Object.values(ORDER_EVENT_TYPES).sort());
  });

  it("names this service as the only producer", () => {
    expect(contract.$defs.EventEnvelope.properties.producer.const).toBe("orders-service");
  });

  it("wraps every event in the shared envelope", () => {
    for (const name of EVENT_DEFS) {
      const def = contract.$defs[name];
      expect(def.allOf, `${name} must extend EventEnvelope`).toEqual([
        { $ref: "#/$defs/EventEnvelope" },
      ]);
      for (const field of [
        "event_id",
        "event_type",
        "event_version",
        "occurred_at",
        "producer",
        "aggregate",
        "data",
      ]) {
        expect(def.required, `${name}.${field}`).toContain(field);
      }
    }
  });

  it("pins every event at v1 (a breaking change needs v2 + an ADR)", () => {
    for (const name of EVENT_DEFS) {
      expect(contract.$defs[name].properties.event_version.const).toBe("v1");
    }
  });

  it("closes every data payload to additional properties", () => {
    for (const name of EVENT_DEFS) {
      expect(
        contract.$defs[name].properties.data.additionalProperties,
        `${name}.data must be closed so a leak cannot slip in as an extra field`,
      ).toBe(false);
    }
  });

  it("carries the order public id in every payload", () => {
    for (const name of EVENT_DEFS) {
      expect(contract.$defs[name].properties.data.required).toContain("order_public_id");
    }
  });

  it("lists the same statuses as the rest of the contract", () => {
    expect([...contract.$defs.OrderStatus.enum].sort()).toEqual([...ORDER_STATUSES].sort());
  });
});

describe("order.created", () => {
  const data = contract.$defs.OrderCreatedV1.properties.data;

  it("can only be emitted in the initial state", () => {
    expect(data.properties.status.const).toBe("published");
  });

  it("reports both stops in order", () => {
    expect(data.properties.stops.minItems).toBe(2);
    expect(data.properties.stops.maxItems).toBe(2);
  });

  it("keeps money as integer minor units", () => {
    expect(data.properties.offered_amount_minor.type).toContain("integer");
    expect(data.properties.offered_amount_minor.type).not.toContain("number");
  });
});

describe("order.status_changed", () => {
  const data = contract.$defs.OrderStatusChangedV1.properties.data;

  it("allows a null from_status (creation) but never a null to_status", () => {
    expect(JSON.stringify(data.properties.from_status)).toContain("null");
    expect(data.properties.to_status).toEqual({ $ref: "#/$defs/OrderStatus" });
  });

  it("requires a per-order sequence so a consumer can detect redelivery", () => {
    expect(data.required).toContain("sequence");
    expect(data.properties.sequence.minimum).toBe(1);
  });

  it("states terminality explicitly instead of asking consumers to guess", () => {
    expect(data.required).toContain("is_terminal");
    expect(data.properties.is_terminal.type).toBe("boolean");
  });

  it("requires the actor of the transition", () => {
    expect(data.required).toContain("actor_type");
    expect(contract.$defs.ActorType.enum).toEqual([
      "system",
      "customer",
      "driver",
      "partner",
      "admin",
    ]);
  });
});

describe("assignment events", () => {
  it("records the offer with its per-order sequence", () => {
    const data = contract.$defs.OrderAssignmentOfferedV1.properties.data;
    expect(data.required).toEqual(
      expect.arrayContaining(["driver_public_id", "sequence", "offered_at"]),
    );
  });

  it("resolves an offer into a terminal assignment state only", () => {
    const states = contract.$defs.OrderAssignmentResolvedV1.properties.data.properties
      .assignment_state.enum as string[];
    expect(states).toEqual(["accepted", "rejected", "expired", "cancelled"]);
    expect(states, "an offer cannot resolve back into `offered`").not.toContain("offered");
  });
});
