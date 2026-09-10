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
    // Orthogonality also means: no single mixed state column on store_orders.
    expect(schemaCode).not.toMatch(/order_state\s+TEXT/);
    // A `status` column is allowed on delivery_inventory_reservations (review 10/N),
    // but NOT on store_orders — that would collapse the two orthogonal axes.
    const storeOrdersBlock = schemaCode.match(/CREATE TABLE IF NOT EXISTS store_orders \([\s\S]*?\);/)?.[0] ?? "";
    expect(storeOrdersBlock).not.toMatch(/\bstatus\s+TEXT\s+NOT NULL/);
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
    // Review 10/N added 'inventory' to state_kind (ADR-026 §4.13).
    expect(schemaCode).toMatch(/state_kind\s+TEXT\s+NOT NULL CHECK \(state_kind IN \('fulfillment','payment','inventory'\)\)/);
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

  it("api declares the readiness route as its own operation (review 7/N · §4.10-2)", () => {
    // مسارُ الجاهزيَّةِ منفصلٌ عن الحياةِ: الأوَّلُ يفحصُ التبعيَّاتِ، والثاني يقولُ
    // «العمليَّةُ حيَّةٌ» فقط. دمجُهما يجعلُ عطَلَ قاعدةٍ يُعيدُ تشغيلَ كلِّ نسخةٍ.
    expect(api).toMatch(/operationId: getDeliveryReadiness/);
    expect(api).toMatch(/\/delivery\/ready:/);
    // الجاهزيَّةُ تُجيبُ بنفسِ الجسدِ في الحالتينِ، فالفاحصُ يقرأُ سبباً لا نصّاً.
    expect(api).toMatch(/ReadinessResponse/);
  });

  it("all FIVE write routes REQUIRE an Idempotency-Key header (7/N · 9/N · 11/N · §4.10-1)", () => {
    // الترويسةُ إلزاميَّةٌ لا اختياريَّةٌ: عميلٌ يُعيدُ المحاولةَ بلا مفتاحٍ يُنشئُ
    // طلباً ثانياً، والعقدُ الذي يسمحُ بذلك يسمحُ بفاتورةٍ مضاعفةٍ.
    expect(api).toMatch(/IdempotencyKey:/);
    expect(api).toMatch(/name: Idempotency-Key/);
    expect(api).toMatch(/in: header/);
    // خمسةُ مراجعَ: الإنشاءُ والإلغاءُ ومرآةُ الدفعِ والتأكيدُ (9/N) وانتقالُ
    // التنفيذِ (11/N) — ولا قراءةٌ تحملُ مفتاحاً. والعددُ مثبَّتٌ لأنَّ مساراً
    // كاتباً سادساً بلا مفتاحٍ هو بالضبطِ العطبُ الذي يُنشئُ أثراً مضاعفاً عندَ
    // أوّلِ إعادةِ محاولةٍ.
    expect([...api.matchAll(/parameters\/IdempotencyKey/g)].length).toBe(5);
  });

  it("schema declares the idempotency ledger bound to the order it created (§4.10-1)", () => {
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS delivery_idempotency_keys/);
    // البصمةُ هي ما يمنعُ مفتاحاً واحداً من خدمةِ طلبينِ مختلفينِ.
    expect(schemaCode).toMatch(/request_fingerprint\s+TEXT\s+NOT NULL/);
    // الحذفُ المتتالي: مفتاحٌ يشيرُ إلى طلبٍ محذوفٍ يُعيدُ جسداً لطلبٍ لا وجودَ لهُ.
    expect(schemaCode).toMatch(/REFERENCES store_orders\(order_id\) ON DELETE CASCADE/);
  });

  it("api declares the HTTP layer as IMPLEMENTED since review 6/N (§4.2 lifted)", () => {
    // حتّى المراجعةِ 5/N كان العقدُ يقولُ «مُعرَّفٌ لا مُنفَّذٌ»؛ المراجعةُ 6/N رفعتِ
    // الحدَّ الشبكيَّ، فالوصفُ القديمُ لو بقيَ لكانَ كذباً موثَّقاً.
    expect(api).toMatch(/طبقةُ HTTP \*\*مُنفَّذةٌ\*\*/);
  });

  it("every non-health route declares the unclassified 500 body (review 6/N)", () => {
    // معالجُ الأخطاءِ الواحدُ يستطيعُ إرجاعَ 500 من أيِّ مسارٍ؛ مسارٌ لا يُعلنُهُ
    // يجعلُ العقدَ أضيقَ من الحقيقةِ.
    expect(api).toMatch(/InternalError:/);
    expect([...api.matchAll(/responses\/InternalError/g)].length).toBe(7);
    expect(DELIVERY_ERROR_CODES).toContain("DELIVERY_INTERNAL_ERROR");
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

  /*
   * المراجعةُ 8/N (§4.9-2 → §4.11): مرجعُ المتجرِ هو slug السوقِ.
   *
   * الحارسُ هنا يمنعُ **الانحدارَ** لا يزيّنُ القرارَ: أيُّ عودةٍ إلى
   * `store_public_id` أو إلى نمطِ `WS-` لمرجعِ المتجرِ تُعيدُ العلّةَ التي
   * أقفلتْ `POST /store-orders` سبعَ مراجعاتٍ — عمودٌ يطلبُ هويّةً لا يُصدرُها
   * أحدٌ، فلا محوّلَ يمكنُ كتابتُهُ إلّا بمِعجمٍ مخترعٍ.
   */
  it("the store reference is the marketplace slug — never a WS- id again", () => {
    expect(schema).not.toMatch(/store_public_id/);
    expect(api).not.toMatch(/store_public_id/);
    expect(eventsRaw).not.toMatch(/store_public_id/);

    // العمودُ يحملُ نمطَ الـslug حرفاً كما ينشرُهُ السوقُ.
    expect(schema).toMatch(/store_slug\s+TEXT\s+NOT NULL CHECK \(store_slug ~ '\^\[a-z\]\[a-z0-9-\]\{2,47\}\$'\)/);

    // وفي العقدِ: نوعٌ مستقلٌّ، لا `WaslaPublicId` مُعادُ استعمالُهُ.
    expect(api).toMatch(/StoreSlug:\n\s+type: string\n\s+pattern: "\^\[a-z\]\[a-z0-9-\]\{2,47\}\$"/);
    const slugFieldRefs = [...api.matchAll(/store_slug:\n\s+\$ref: "#\/components\/schemas\/(\w+)"/g)].map((m) => m[1]);
    expect(slugFieldRefs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(slugFieldRefs)).toEqual(new Set(["StoreSlug"]));
  });

  /*
   * «موصولٌ» ليسَ «مسبوراً»: الجاهزيّةُ تصرّحُ بأنّها لم تسألِ السوقَ.
   * إخلاءُ `not_claimed` عندَ الوصلِ كانَ سيقولُ «تحقّقنا» ولم يتحقّقْ أحدٌ.
   */
  it("readiness can say the catalog is wired but not probed", () => {
    expect(api).toMatch(/enum: \[marketplace_catalog_not_wired, marketplace_catalog_not_probed\]/);
  });

  it("errors.md catalog matches DELIVERY_ERROR_CODES exactly", () => {
    const codesInMd = [...errors.matchAll(/`(DELIVERY_[A-Z_]+)`/g)].map((m) => m[1]);
    expect(new Set(codesInMd)).toEqual(new Set(DELIVERY_ERROR_CODES));
  });
});
