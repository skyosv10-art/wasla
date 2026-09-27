/**
 * M5-13M (CLM-0378): جسمُ الحجزِ والإطلاقِ الذي يُرسلُهُ التوصيلُ يُطابقُ عقدَ السوقِ المنشورَ.
 *
 * كانَ `release` يُرسلُ `reservation_ref` والعقدُ `additionalProperties: false`، فكلُّ إطلاقٍ
 * حقيقيٍّ ⇒ `400` من السوقِ ⇒ `503` من التوصيلِ، ولا طلبَ محجوزاً يُلغى. لم يرَهُ اختبارٌ لأنَّ
 * المنفذَ الحقيقيَّ لم يُطلِق قطُّ على سلكٍ: الـfake القديمُ لا يُخزِّنُ حجزاً فلا إطلاقَ.
 * هنا يُقرأُ المخطَّطُ من `services/marketplace/contracts/api.openapi.yml` حرفاً ويُقارَنُ بما
 * يخرجُ فعلاً من `HttpMarketplaceReservationPort`.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { HttpMarketplaceReservationPort } from "../infrastructure/http-marketplace-reservation.js";
import type { StoreSlug } from "@wasla/contracts-delivery";

const here = dirname(fileURLToPath(import.meta.url));
const OPENAPI = readFileSync(resolve(here, "../../../../services/marketplace/contracts/api.openapi.yml"), "utf8");

/** خصائصُ `ReservationRequest` ومطلوباتُهُ — بقراءةِ كتلتِهِ في الـYAML لا بافتراض. */
function reservationRequestSchema(): { required: string[]; properties: string[]; closed: boolean } {
  const start = OPENAPI.indexOf("\n    ReservationRequest:\n");
  if (start < 0) throw new Error("ReservationRequest not found in marketplace OpenAPI");
  const rest = OPENAPI.slice(start + 1).split("\n").slice(1);
  const block: string[] = [];
  for (const line of rest) {
    if (/^ {4}\S/u.test(line)) break; // المخطَّطُ التالي
    block.push(line);
  }
  const text = block.join("\n");
  const required = /required: \[([^\]]+)\]/u.exec(text)?.[1].split(",").map((s) => s.trim()) ?? [];
  const properties = block.filter((l) => /^ {8}\w+:/u.test(l)).map((l) => l.trim().replace(/:.*$/u, ""));
  return { required, properties, closed: /additionalProperties: false/u.test(text) };
}

function capturingPort(status: number, response: unknown) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    return new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const port = new HttpMarketplaceReservationPort({
    baseUrl: "http://marketplace.test",
    signRequest: () => ({ authorization: "Bearer test" }),
    fetchImpl,
  });
  return { port, bodies };
}

const REQ = {
  orderPublicId: "WS-5000000011",
  storeSlug: "matjar-alfawakih" as StoreSlug,
  items: [
    { productId: "11111111-1111-4111-8111-111111111111", quantity: 2 },
    { productId: "22222222-2222-4222-8222-222222222222", quantity: 3 },
  ],
};

describe("delivery → marketplace reservation bodies match the published contract", () => {
  const schema = reservationRequestSchema();

  it("the contract is read, and it is closed", () => {
    expect(schema.closed).toBe(true);
    expect(schema.required.sort()).toEqual(["idempotency_key", "items", "order_public_id"]);
    expect(schema.properties.sort()).toEqual(["idempotency_key", "items", "order_public_id"]);
  });

  it("reserve sends exactly the contract's properties", async () => {
    const { port, bodies } = capturingPort(201, { reservation_ref: "delivery-reserve:WS-5000000011:v1", items: [] });
    await port.reserve(REQ);
    expect(Object.keys(bodies[0]).sort()).toEqual(schema.properties.sort());
  });

  it("release sends exactly the contract's properties — no `reservation_ref`", async () => {
    const { port, bodies } = capturingPort(200, { reservation_ref: "delivery-release:WS-5000000011:v1", items: [] });
    const result = await port.release({ ...REQ, reservationRef: "delivery-reserve:WS-5000000011:v1" });
    expect(result.released).toBe(true);
    expect(Object.keys(bodies[0]).sort()).toEqual(schema.properties.sort());
    expect(bodies[0].items).toEqual([
      { product_id: REQ.items[0].productId, quantity: 2 },
      { product_id: REQ.items[1].productId, quantity: 3 },
    ]);
  });
});
