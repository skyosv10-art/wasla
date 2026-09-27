/**
 * M5-13M (CLM-0378): `FakeReservationStore` يرفضُ ما يرفضُهُ الجدول — ويبقى كذلك.
 *
 * قبلَ M5-13M كانَ الـfake لا يكتبُ شيئاً، فمرَّت كلُّ اختباراتِ الطلبِ متعدِّدِ الأصنافِ بينما
 * الجدولُ الحقيقيُّ يُسقِطُ الصنفَ الثاني. هذا الملفُّ يربطُ قيودَ الـfake **بنصِّ العقدِ**
 * (`contracts/schema.sql`): لو أُضيفَ قيدُ تفرّدٍ على الجدولِ ولم يُضَفْ إلى الـfake — أو العكس —
 * سقطَ الاختبارُ هنا لا في الإنتاج.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { ReservationRecord } from "../ports.js";
import { FakeReservationStore, PRODUCT_A, PRODUCT_B, STORE_SLUG } from "./store-order-fakes.js";

const DDL = readFileSync(resolve(process.cwd(), "contracts", "schema.sql"), "utf8");

function reservationsTableBody(): string {
  const m = /CREATE TABLE IF NOT EXISTS delivery_inventory_reservations \(([\s\S]*?)\n\);/u.exec(DDL);
  if (!m) throw new Error("delivery_inventory_reservations not found in contracts/schema.sql");
  return m[1]
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

/** مجموعاتُ الأعمدةِ الفريدةِ في العقد: المفتاحُ الأساسيُّ + كلُّ `UNIQUE (...)`. */
function contractUniqueSets(): string[] {
  const body = reservationsTableBody();
  const sets = [...body.matchAll(/UNIQUE \(([^)]+)\)/gu)].map((m) =>
    m[1].split(",").map((c) => c.trim()).sort().join(","),
  );
  const pk = /^\s*(\w+)\s+UUID\s+PRIMARY KEY/mu.exec(body);
  if (pk) sets.push(pk[1]);
  return sets.sort();
}

const ORDER = "bbbbbbbb-0000-4000-8000-00000000a001";
const OTHER_ORDER = "bbbbbbbb-0000-4000-8000-00000000a002";

let seq = 0;
function row(over: Partial<ReservationRecord> = {}): ReservationRecord {
  seq += 1;
  return {
    reservationId: `eeeeeeee-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    orderId: ORDER,
    storeSlug: STORE_SLUG,
    productId: PRODUCT_A,
    sku: "SKU-1111",
    quantityReserved: 1,
    unitPriceMinorUnits: 100,
    marketplaceReservationRef: "mkt-res-WS-0000000001",
    status: "active",
    reservedAt: "2026-09-27T00:00:00.000Z",
    traceId: null,
    ...over,
  };
}

describe("FakeReservationStore ↔ contracts/schema.sql", () => {
  it("the contract's unique sets are exactly the ones the fake enforces", () => {
    // إن تغيّرَ هذا فحدِّث `FakeReservationStore.saveReservations` معهُ.
    expect(contractUniqueSets()).toEqual(["order_id,product_id", "reservation_id"]);
  });

  it("a multi-line order shares ONE marketplace ref across its lines", async () => {
    const fake = new FakeReservationStore();
    await fake.saveReservations(ORDER, [row(), row({ productId: PRODUCT_B })]);
    expect(await fake.loadActiveReservations(ORDER)).toHaveLength(2);
  });

  it("the same product twice in one order is refused like the table (23505), all-or-nothing", async () => {
    const fake = new FakeReservationStore();
    await expect(fake.saveReservations(ORDER, [row(), row()])).rejects.toMatchObject({
      code: "23505",
      constraint: "delivery_inventory_reservations_order_id_product_id_key",
    });
    expect(fake.rows.size).toBe(0);
  });

  it("the same product in two different orders is fine", async () => {
    const fake = new FakeReservationStore();
    await fake.saveReservations(ORDER, [row()]);
    await fake.saveReservations(OTHER_ORDER, [row({ orderId: OTHER_ORDER, marketplaceReservationRef: "mkt-res-WS-0000000002" })]);
    expect(fake.rows.size).toBe(2);
  });

  it("CHECK constraints: ref length, quantity, price", async () => {
    const fake = new FakeReservationStore();
    await expect(fake.saveReservations(ORDER, [row({ marketplaceReservationRef: "" })])).rejects.toMatchObject({ code: "23514" });
    await expect(fake.saveReservations(ORDER, [row({ marketplaceReservationRef: "x".repeat(129) })])).rejects.toMatchObject({ code: "23514" });
    await expect(fake.saveReservations(ORDER, [row({ quantityReserved: 0 })])).rejects.toMatchObject({ code: "23514" });
    await expect(fake.saveReservations(ORDER, [row({ unitPriceMinorUnits: -1 })])).rejects.toMatchObject({ code: "23514" });
  });

  it("release / consume flip only active rows of the order and report the count", async () => {
    const fake = new FakeReservationStore();
    await fake.saveReservations(ORDER, [row(), row({ productId: PRODUCT_B })]);
    await fake.saveReservations(OTHER_ORDER, [row({ orderId: OTHER_ORDER })]);
    expect(await fake.releaseReservations(ORDER)).toBe(2);
    expect(await fake.releaseReservations(ORDER)).toBe(0);
    expect(await fake.loadActiveReservations(ORDER)).toEqual([]);
    expect(await fake.consumeReservations(OTHER_ORDER)).toBe(1);
  });
});
