/**
 * Boundary guards — the tests that fail the build when someone quietly widens
 * the Order Engine's boundary.
 *
 * Three boundaries are enforced here (ADR-010):
 *  1. Privacy: an event payload carries zone-level location, opaque ids and
 *     catalog reason codes. Never raw coordinates, never user-authored text.
 *  2. Channel neutrality (ADR-007): the engine does not know Telegram exists.
 *  3. Ownership: the engine records assignments; it does not decide them
 *     (Phase 07), and it does not judge driver eligibility (Phase 05).
 *
 * The privacy test DIGS: it walks every nested property name of every payload,
 * so hiding a forbidden field inside an object does not defeat it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONTRACTS_DIR = resolve(__dirname, "../../../../../services/orders/contracts");

const eventsContract = JSON.parse(
  readFileSync(resolve(CONTRACTS_DIR, "events.json"), "utf8"),
) as { $defs: Record<string, any> };
const schemaSql = readFileSync(resolve(CONTRACTS_DIR, "schema.sql"), "utf8");
const openApiYml = readFileSync(resolve(CONTRACTS_DIR, "api.openapi.yml"), "utf8");
const errorsMd = readFileSync(resolve(CONTRACTS_DIR, "errors.md"), "utf8");
const readmeMd = readFileSync(resolve(CONTRACTS_DIR, "README.md"), "utf8");

const EVENT_DEFS = [
  "OrderCreatedV1",
  "OrderStatusChangedV1",
  "OrderAssignmentOfferedV1",
  "OrderAssignmentResolvedV1",
] as const;

/** Every nested property name reachable inside a JSON Schema node. */
function propertyNames(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) propertyNames(item, found);
    return found;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "properties" && value && typeof value === "object") {
        for (const name of Object.keys(value as Record<string, unknown>)) found.add(name);
      }
      propertyNames(value, found);
    }
  }
  return found;
}

/** Resolve local $refs one level deep so digging follows shared definitions. */
function resolved(name: string): unknown {
  const raw = JSON.stringify(eventsContract.$defs[name]);
  return JSON.parse(
    raw.replace(/\{"\$ref":"#\/\$defs\/([A-Za-z]+)"\}/g, (_match, ref: string) =>
      JSON.stringify(eventsContract.$defs[ref] ?? {}),
    ),
  );
}

describe("event payloads carry no location detail beyond the zone", () => {
  const FORBIDDEN_LOCATION_FIELDS = [
    "latitude",
    "longitude",
    "lat",
    "lng",
    "lon",
    "coordinates",
    "point",
    "geo",
    "address",
    "street",
  ];

  it.each(EVENT_DEFS)("%s exposes no coordinate-like field", (name) => {
    const names = propertyNames(resolved(name));
    for (const forbidden of FORBIDDEN_LOCATION_FIELDS) {
      expect([...names], `${name} leaks ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("keeps coordinates in the database and out of the wire contract", () => {
    // The engine may store what the customer sent (operational evidence)…
    expect(schemaSql).toContain("latitude      NUMERIC(8,6)");
    // …but a stop in an event is a zone and a kind, nothing else.
    const stopItems =
      eventsContract.$defs.OrderCreatedV1.properties.data.properties.stops.items;
    expect(Object.keys(stopItems.properties).sort()).toEqual(["kind", "zone_id"]);
    expect(stopItems.additionalProperties).toBe(false);
  });
});

describe("event payloads carry no user-authored text", () => {
  const FORBIDDEN_TEXT_FIELDS = [
    "label",
    "notes",
    "note",
    "description",
    "display_name",
    "name",
    "comment",
    "message",
    "text",
    "phone",
    "phone_number",
    "email",
  ];

  it.each(EVENT_DEFS)("%s exposes no free-text field", (name) => {
    const names = propertyNames(resolved(name));
    for (const forbidden of FORBIDDEN_TEXT_FIELDS) {
      expect([...names], `${name} leaks ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("stores the user's own words but never publishes them", () => {
    expect(schemaSql).toContain("shipment_description");
    expect(schemaSql).toContain("notes");
    const allNames = EVENT_DEFS.flatMap((name) => [...propertyNames(resolved(name))]);
    expect(allNames).not.toContain("shipment_description");
    expect(allNames).not.toContain("notes");
  });

  it("expresses every reason as a catalog code, not a sentence", () => {
    for (const name of EVENT_DEFS) {
      const names = propertyNames(resolved(name));
      expect([...names], `${name} must not carry a free reason`).not.toContain("reason");
      expect([...names], `${name} must not carry a free reason`).not.toContain("reason_text");
    }
    expect(eventsContract.$defs.ReasonCode.maxLength).toBe(64);
  });
});

describe("the channel does not exist at this boundary (ADR-007)", () => {
  const FORBIDDEN_CHANNEL_TOKENS = [
    "telegram",
    "chat_id",
    "chat-id",
    "whatsapp",
    "bot_token",
    "update_id",
    "message_id",
  ];

  it.each([
    ["schema.sql", schemaSql],
    ["api.openapi.yml", openApiYml],
    ["errors.md", errorsMd],
    ["README.md", readmeMd],
  ])("%s mentions no channel identifier as a field", (fileName, content) => {
    // `telegram_location` is a stop SOURCE value inherited from the customer
    // contract: it says how the customer produced the point, not who they are.
    const withoutAllowedSource = content.replace(/telegram_location/g, "");
    for (const token of FORBIDDEN_CHANNEL_TOKENS) {
      const asField = new RegExp(`\\b${token}\\b\\s*[:=]|\\b${token}\\b\\s+(TEXT|BIGINT|UUID)`, "i");
      expect(asField.test(withoutAllowedSource), `${fileName} defines ${token}`).toBe(false);
    }
  });

  it.each(EVENT_DEFS)("%s carries no channel identifier", (name) => {
    const names = [...propertyNames(resolved(name))];
    for (const token of FORBIDDEN_CHANNEL_TOKENS) {
      expect(names, `${name} leaks ${token}`).not.toContain(token);
    }
  });
});

describe("the engine records assignments and does not decide them (§16, Phase 07)", () => {
  it("stores no dispatch policy: no candidate list, no wave, no timeout window", () => {
    for (const token of ["candidate", "wave", "radius", "timeout_seconds", "search_window"]) {
      expect(schemaSql.toLowerCase(), `schema owns dispatch concept: ${token}`).not.toContain(
        token,
      );
    }
  });

  it("exposes no candidate-selection route", () => {
    for (const token of ["/candidates", "/dispatch", "/match", "/broadcast"]) {
      expect(openApiYml, `route ${token} belongs to Phase 07`).not.toContain(token);
    }
  });

  it("keeps driver eligibility out of its error catalog (Phase 05 owns the profile)", () => {
    for (const token of [
      "DRIVER_NOT_FOUND",
      "DRIVER_NOT_ELIGIBLE",
      "DRIVER_SUSPENDED",
      "VEHICLE_NOT_FOUND",
    ]) {
      expect(errorsMd, `${token} is not this service's judgement`).not.toContain(token);
    }
  });

  it("names the driver only as an opaque reference, never as a profile", () => {
    expect(schemaSql).toContain("driver_public_id  TEXT        NOT NULL");
    for (const token of ["driver_name", "driver_phone", "vehicle_plate", "driver_rating"]) {
      expect(schemaSql, `${token} is not owned here`).not.toContain(token);
    }
  });
});

describe("no impossible state is representable (the Phase 06 exit gate, at contract level)", () => {
  it("forbids a pre-acceptance order from naming a driver", () => {
    expect(schemaSql).toContain("ck_orders_assignment_matches_status");
    expect(schemaSql).toContain("AND active_assignment_id IS NULL");
  });

  it("forbids a driver-bound order without an assignment", () => {
    expect(schemaSql).toContain("AND active_assignment_id IS NOT NULL");
  });

  it("forbids a terminal order without a reason", () => {
    expect(schemaSql).toContain("ck_orders_terminal_needs_reason");
  });

  it("forbids an assignment state that its timestamps contradict", () => {
    expect(schemaSql).toContain("ck_order_assignments_state_timestamp");
  });

  it("forbids offering the same order to the same driver twice", () => {
    expect(schemaSql).toContain("ux_order_assignments_order_driver");
  });

  it("forbids a customer_offer without money and a negotiable with money", () => {
    expect(schemaSql).toContain("ck_orders_price_mode_amount");
  });

  it("forbids shipment details on a ride", () => {
    expect(schemaSql).toContain("ck_orders_shipment_only_delivery");
  });

  it("forbids a system actor with a personal reference, and a person without one", () => {
    expect(schemaSql).toContain("ck_order_status_history_actor_ref");
  });
});
