/**
 * مُثبَّتاتُ `delivery-events.ts` تُطابقُ عقدَ التوصيلِ المنشورِ (M5-17Q · CLM-0376).
 *
 * المُصنِّفُ يُختبَرُ على هذهِ الصفوفِ في اختباراتِ الوحدةِ والتكامل؛ فإن انجرفت
 * عن `services/delivery/contracts/events.json` صارَ الاختبارُ يُثبِتُ شيئاً لا
 * يُنتِجُهُ أحد — وهوَ بالضبطِ عطبُ M5-17P (حقولٌ لا يحملُها المنتِج). المُدقِّقُ
 * صغيرٌ عمداً ويغطّي ما يستعملُهُ العقدُ: `$ref` · `allOf` · `anyOf` · `type` ·
 * `const` · `enum` · `pattern` · `required` · `properties` · `items` · `minimum`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { DeliveryOutboxRow } from "../domain/consumed-events.js";
import {
  createdRow,
  deliveredRow,
  deliveryCompletedRow,
  orderRef,
  substitutedRow,
  transitionRow,
} from "./delivery-events.js";

type Schema = Record<string, unknown>;

const CONTRACT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "delivery", "contracts", "events.json",
);
const CONTRACT = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as { $defs: Record<string, Schema> };

function resolve(schema: Schema): Schema {
  const ref = schema["$ref"];
  if (typeof ref === "string") {
    const name = ref.replace("#/$defs/", "");
    const target = CONTRACT.$defs[name];
    if (!target) throw new Error(`unresolved $ref ${ref}`);
    return resolve(target);
  }
  return schema;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function violations(value: unknown, raw: Schema, path: string): string[] {
  const schema = resolve(raw);
  const out: string[] = [];
  for (const part of (schema["allOf"] as Schema[] | undefined) ?? []) out.push(...violations(value, part, path));
  const anyOf = schema["anyOf"] as Schema[] | undefined;
  if (anyOf && !anyOf.some((s) => violations(value, s, path).length === 0)) out.push(`${path}: no anyOf branch matches`);
  if ("const" in schema && value !== schema["const"]) out.push(`${path}: expected const ${String(schema["const"])}`);
  const en = schema["enum"] as unknown[] | undefined;
  if (en && !en.includes(value)) out.push(`${path}: ${String(value)} not in enum`);
  const type = schema["type"];
  if (type !== undefined) {
    const allowed = Array.isArray(type) ? (type as string[]) : [type as string];
    const t = typeOf(value);
    if (!allowed.includes(t) && !(t === "integer" && allowed.includes("number"))) {
      out.push(`${path}: type ${t} not in ${allowed.join("|")}`);
      return out;
    }
  }
  if (typeof value === "string" && typeof schema["pattern"] === "string" && !new RegExp(schema["pattern"]).test(value)) {
    out.push(`${path}: ${value} does not match ${schema["pattern"]}`);
  }
  if (typeof value === "number" && typeof schema["minimum"] === "number" && value < schema["minimum"]) {
    out.push(`${path}: ${value} < minimum`);
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of (schema["required"] as string[] | undefined) ?? []) {
      if (!(key in obj)) out.push(`${path}.${key}: required`);
    }
    const props = (schema["properties"] as Record<string, Schema> | undefined) ?? {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) out.push(...violations(obj[key], sub, `${path}.${key}`));
    }
  }
  if (Array.isArray(value) && schema["items"]) {
    value.forEach((item, i) => out.push(...violations(item, schema["items"] as Schema, `${path}[${i}]`)));
  }
  return out;
}

/** الصفُّ ← المظروفُ كما نشرَهُ المنتِج (الأعمدةُ نفسُها التي يكتبُها `appendOutbox`). */
function asEvent(row: DeliveryOutboxRow): Record<string, unknown> {
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    event_version: row.event_version,
    occurred_at: row.occurred_at,
    producer: "delivery-service",
    aggregate: { type: row.aggregate_type, id: row.aggregate_id },
    trace_id: row.trace_id,
    payload: row.payload,
  };
}

const at = { occurredAt: "2026-09-27T10:00:00.000000Z" };
const order = orderRef(1);

describe("billing fixtures conform to the delivery event contract (M5-17Q)", () => {
  const cases: Array<[string, string, DeliveryOutboxRow]> = [
    ["store_order.created", "StoreOrderCreatedV1", createdRow(order, 10000, 1500, at)],
    ["store_order.fulfillment_state_changed → delivered", "StoreOrderFulfillmentStateChangedV1", deliveredRow(order, at)],
    ["store_order.fulfillment_state_changed → picking", "StoreOrderFulfillmentStateChangedV1", transitionRow(order, "confirmed", "picking", at)],
    ["store_order.fulfillment_state_changed → cancelled", "StoreOrderFulfillmentStateChangedV1", transitionRow(order, "placed", "cancelled", at)],
    ["store_order.item_substituted", "StoreOrderItemSubstitutedV1", substitutedRow(order, -250, at)],
    ["delivery.completed", "DeliveryCompletedV1", deliveryCompletedRow(order, at)],
  ];

  for (const [label, def, row] of cases) {
    it(`${label} validates against ${def}`, () => {
      const schema = CONTRACT.$defs[def];
      expect(schema, `missing $defs.${def}`).toBeDefined();
      expect(violations(asEvent(row), schema, "event")).toEqual([]);
    });
  }

  it("the validator rejects what the M5-17P classifier used to require (no totals → violation)", () => {
    const row = createdRow(order, 10000, 1500, at);
    const { totals: _totals, ...noTotals } = row.payload;
    const broken = asEvent({ ...row, payload: noTotals });
    expect(violations(broken, CONTRACT.$defs["StoreOrderCreatedV1"], "event")).toContain("event.payload.totals: required");
  });
});
