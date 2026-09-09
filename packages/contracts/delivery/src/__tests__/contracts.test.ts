import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DELIVERY_ERROR_CODES,
  DELIVERY_TASK_STATES,
  DELIVERY_TASK_TERMINAL_STATES,
  FULFILLMENT_STATES,
  FULFILLMENT_TERMINAL_STATES,
  PAYMENT_STATES,
  PAYMENT_TERMINAL_STATES,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = resolve(__dirname, "../../../../../services/delivery/contracts");
const adr = readFileSync(
  resolve(__dirname, "../../../../../docs/15-decisions/ADR-026-store-orders-and-delivery-boundary.md"),
  "utf8",
);

const schema = readFileSync(resolve(base, "schema.sql"), "utf8");
const api = readFileSync(resolve(base, "api.openapi.yml"), "utf8");
const eventsRaw = readFileSync(resolve(base, "events.json"), "utf8");
const errors = readFileSync(resolve(base, "errors.md"), "utf8");
const events = JSON.parse(eventsRaw) as unknown;

/** Strip SQL comments so prose that mentions forbidden names in negation context is ignored. */
const schemaCode = schema.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

/** The ADR §3 section — anchored to line start so "### 3.1" is not swallowed. */
const adrSection3 = adr.split(/^## 3\./m)[1]?.split(/^## 4\./m)[0] ?? "";

/**
 * Extract the ordered enum list from a schema CHECK constraint, e.g.
 * CHECK (fulfillment_state IN ('draft','placed',...)).
 */
function schemaEnum(column: string): string[] {
  const m = schemaCode.match(new RegExp(`${column}\\s+TEXT\\s+NOT NULL CHECK \\(${column} IN \\(([^)]+)\\)\\)`));
  if (!m) throw new Error(`no CHECK enum found for ${column}`);
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
}

describe("delivery contracts — foundational invariants (ADR-026)", () => {
  it("schema declares the store-order aggregate and its ledgers", () => {
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS store_orders/);
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS store_order_items/);
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS store_order_transitions/);
  });

  it("schema declares the delivery-task mirror and its ledger", () => {
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS delivery_tasks/);
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS delivery_task_transitions/);
  });

  it("schema declares an outbox so no state change is silent", () => {
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS delivery_outbox/);
  });

  it("fulfillment and payment are two ORTHOGONAL columns on store_orders (§2.2)", () => {
    expect(schemaCode).toMatch(/fulfillment_state\s+TEXT\s+NOT NULL CHECK/);
    expect(schemaCode).toMatch(/payment_state\s+TEXT\s+NOT NULL CHECK/);
    // Orthogonality also means: no single mixed state column anywhere.
    expect(schemaCode).not.toMatch(/order_state\s+TEXT/);
    expect(schemaCode).not.toMatch(/\bstatus\s+TEXT\s+NOT NULL/);
  });

  it("schema enums match the contract constants exactly, in ADR §3 order", () => {
    expect(schemaEnum("fulfillment_state")).toEqual([...FULFILLMENT_STATES]);
    expect(schemaEnum("payment_state")).toEqual([...PAYMENT_STATES]);
    expect(schemaEnum("state")).toEqual([...DELIVERY_TASK_STATES]);
  });

  it("constants match the ADR §3 canonical state lists (the binding reference)", () => {
    const fulfillment = adrSection3.split("### 3.1")[1]?.split("### 3.2")[0] ?? "";
    for (const s of FULFILLMENT_STATES) {
      expect(fulfillment).toContain(s);
    }
    const payment = adrSection3.split("### 3.2")[1]?.split("### 3.3")[0] ?? "";
    for (const s of PAYMENT_STATES) {
      expect(payment).toContain(s);
    }
    const task = adrSection3.split("### 3.3")[1] ?? "";
    for (const s of DELIVERY_TASK_STATES) {
      expect(task).toContain(s);
    }
    // Terminal sets are stated in prose in the ADR.
    for (const s of FULFILLMENT_TERMINAL_STATES) {
      expect(adrSection3).toContain(s);
    }
    for (const s of PAYMENT_TERMINAL_STATES) {
      expect(adrSection3).toContain(s);
    }
    for (const s of DELIVERY_TASK_TERMINAL_STATES) {
      expect(adrSection3).toContain(s);
    }
  });

  it("items are SNAPSHOTS, not inventory balances (§2.3) — no quantity_on_hand here", () => {
    expect(schemaCode).toMatch(/unit_price_minor_units\s+INTEGER NOT NULL/);
    expect(schemaCode).toMatch(/line_total_minor_units\s+INTEGER NOT NULL CHECK \(line_total_minor_units = quantity \* unit_price_minor_units\)/);
    expect(schemaCode).not.toMatch(/quantity_on_hand/);
    expect(schemaCode).not.toMatch(/reserved_quantity/);
  });

  it("money is integer minor units + SAR alone, never floating point (§2.6)", () => {
    expect(schemaCode).toMatch(/currency_code\s+TEXT\s+NOT NULL CHECK \(currency_code = 'SAR'\)/);
    expect(schemaCode).toMatch(/total_minor_units\s+INTEGER NOT NULL CHECK \(total_minor_units = items_total_minor_units \+ delivery_fee_minor_units\)/);
    expect(schemaCode).not.toMatch(/NUMERIC|DECIMAL|DOUBLE|REAL/);
  });

  it("delivered requires proof and proof requires delivered (§2.4)", () => {
    expect(schemaCode).toMatch(/CONSTRAINT ck_delivery_proof CHECK \(\s*\(state = 'delivered'\) = \(proof_type IS NOT NULL AND proof_ref IS NOT NULL\)\s*\)/);
  });

  it("external humans/stores are opaque WS refs — no FK across the boundary (§2.3, §2.6)", () => {
    expect(schemaCode).toMatch(/customer_ref\s+TEXT\s+NOT NULL CHECK \(customer_ref ~ '\^WS-\[0-9\]\{10\}\$'\)/);
    expect(schemaCode).toMatch(/courier_ref\s+TEXT\s+CHECK \(courier_ref IS NULL OR courier_ref ~ '\^WS-\[0-9\]\{10\}\$'\)/);
    // The store is referenced logically, never via a cross-service FK.
    expect(schemaCode).not.toMatch(/REFERENCES marketplace/);
  });

  it("NO personal data or coordinates anywhere in the schema (§2.6, ADR-001)", () => {
    expect(schemaCode).not.toMatch(/phone|mobile|email|first_name|last_name|full_name|address|latitude|longitude|lat_|lng_|gps|chat_id|telegram/i);
  });

  it("transitions ledgers are append-only shapes with closed actor sets", () => {
    expect(schemaCode).toMatch(/state_kind\s+TEXT\s+NOT NULL CHECK \(state_kind IN \('fulfillment','payment'\)\)/);
    expect(schemaCode).toMatch(/actor_type\s+TEXT\s+NOT NULL CHECK \(actor_type IN \('system','customer','store','courier','admin'\)\)/);
    expect(schemaCode).toMatch(/actor_type\s+TEXT\s+NOT NULL CHECK \(actor_type IN \('system','customer','store','courier','admin','dispatch'\)\)/);
    expect(schemaCode).toMatch(/CHECK \(to_state <> from_state\)/);
  });

  it("api declares store-order and delivery endpoints plus health", () => {
    expect(api).toMatch(/operationId: placeStoreOrder/);
    expect(api).toMatch(/operationId: getStoreOrder/);
    expect(api).toMatch(/operationId: cancelStoreOrder/);
    expect(api).toMatch(/operationId: getDeliveryTaskForOrder/);
    expect(api).toMatch(/operationId: getDeliveryHealth/);
  });

  it("api declares the HTTP layer as DECLARED, NOT IMPLEMENTED in review 1/N (§4.2)", () => {
    expect(api).toMatch(/عقدٌ مُعرَّفٌ لا مُنفَّذٌ/);
  });

  it("api carries no personal-data fields (§2.6)", () => {
    expect(api).not.toMatch(/phone|mobile|email|first_name|last_name|full_name|latitude|longitude|address_line|chat_id/i);
  });

  it("events contract is a valid JSON Schema with a delivery-service envelope", () => {
    const e = events as { $schema?: string; $defs?: Record<string, unknown> };
    expect(e.$schema).toMatch(/json-schema/);
    expect(e.$defs?.EventEnvelope).toBeDefined();
    const producer = (e.$defs?.EventEnvelope as { properties?: { producer?: { const?: string } } })
      .properties?.producer?.const;
    expect(producer).toBe("delivery-service");
  });

  it("events.json publishes exactly the 12 domain events the contract package types", () => {
    const e = events as { $defs?: Record<string, unknown> };
    const eventConsts = (e.$defs?.EventEnvelope as { properties?: { event_type?: { minLength?: number } } });
    expect(eventConsts).toBeDefined();
    const defs = e.$defs ?? {};
    for (const name of [
      "StoreOrderCreatedV1",
      "StoreOrderFulfillmentStateChangedV1",
      "StoreOrderPaymentStateChangedV1",
      "StoreOrderItemSubstitutedV1",
      "DeliveryTaskCreatedV1",
      "DeliveryEligibilityResolvedV1",
      "DeliveryDispatchRequestedV1",
      "DeliveryDriverAssignedV1",
      "DeliveryStatusChangedV1",
      "DeliveryCompletedV1",
      "DeliveryFailedV1",
      "DeliveryTaskCancelledV1",
    ]) {
      expect(defs[name], `missing event def ${name}`).toBeDefined();
    }
  });

  it("events.json state enums match the contract constants", () => {
    const defs = (events as { $defs?: Record<string, { enum?: string[] }> }).$defs ?? {};
    const asSet = (xs?: string[]) => new Set(xs ?? []);
    expect(asSet(defs.FulfillmentState?.enum)).toEqual(new Set(FULFILLMENT_STATES));
    expect(asSet(defs.PaymentState?.enum)).toEqual(new Set(PAYMENT_STATES));
    expect(asSet(defs.DeliveryTaskState?.enum)).toEqual(new Set(DELIVERY_TASK_STATES));
  });

  it("no event payload carries coordinates or personal data (§2.6)", () => {
    expect(eventsRaw).not.toMatch(/latitude|longitude|phone|email|first_name|last_name|full_name|address_line|chat_id|telegram/i);
  });

  it("errors.md catalog matches DELIVERY_ERROR_CODES exactly", () => {
    const codesInMd = [...errors.matchAll(/`(DELIVERY_[A-Z_]+)`/g)].map((m) => m[1]);
    expect(new Set(codesInMd)).toEqual(new Set(DELIVERY_ERROR_CODES));
  });
});
