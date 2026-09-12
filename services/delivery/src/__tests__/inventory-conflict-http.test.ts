/**
 * `GET /delivery/inventory-conflicts` — على السلكِ (المراجعةُ 16/N · ADR-026 §4.18).
 *
 * ثلاثُ دعاوى تُختبَرُ هنا، وكلُّها عن **ما يقرؤُهُ مُشغِّلٌ في حادثةٍ** لا عن شكلِ
 * كائنٍ في الذاكرةِ:
 *
 *   1. **غيرُ مُركَّبٍ ⇒ 500 لا 200 بقائمةٍ فارغةٍ.** قائمةٌ فارغةٌ تُقرأُ «لا تضاربَ»
 *      والحقيقةُ «لا أدري»، والصفرُ الكاذبُ أخطرُ من خطأٍ مُعلَنٍ (سابقةُ RISK-0030:
 *      `health: ok` وكلُّ قراءةٍ تُجيبُ 503).
 *   2. **المُعامِلاتُ تُرفَضُ ولا تُصحَّحُ صامتةً** — و`limit=0x10` خطأُ مُشغِّلٍ لا
 *      طلبُ ستةَ عشرَ.
 *   3. **`changes_order_state: false` على كلِّ صفٍّ** — من يقرأُ رايةً لا يقرأُ ADR.
 */

import { describe, expect, it } from "vitest";

import { buildDeliveryHttpApp } from "../http/app.js";
import type { InventoryConflictReadPort } from "../ports.js";
import type { InventoryConflictRow } from "../domain/inventory-conflict.js";
import {
  FakeCatalog,
  FakeReadinessProbe,
  FakeReservationPort,
  FakeReservationStore,
  FakeStoreOrderStore,
  uuidSequence,
} from "./store-order-fakes.js";

const NOW = "2026-09-12T02:30:00.000Z";

function row(overrides: Partial<InventoryConflictRow> = {}): InventoryConflictRow {
  return {
    kind: "stock_zeroed_while_reserved",
    storeId: "aaaaaaaa-0000-0000-0000-000000000001",
    productId: "bbbbbbbb-0000-0000-0000-000000000002",
    adjustmentId: "cccccccc-0000-0000-0000-000000000003",
    adjustmentSequence: 12,
    quantityDelta: -3,
    observedQuantityAfter: 0,
    reasonCode: "shrinkage",
    affectedOrderCount: 2,
    affectedUnitsTotal: 5,
    affectedOrderPublicIds: ["SO-0000000100", "SO-0000000200"],
    detectedAt: NOW,
    changesOrderState: false,
    marketplaceEventId: "eeeeeeee-0000-0000-0000-000000000005",
    occurredFor: "2026-09-12T02:29:00.000Z",
    acknowledgedAt: null,
    acknowledgedBy: null,
    traceId: "ffffffff-0000-0000-0000-000000000006",
    ...overrides,
  };
}

/** منفذُ قراءةٍ يُملي الاختبارُ جوابَهُ ويسجِّلُ ما وصلَهُ من مُعامِلاتٍ. */
class FakeInventoryConflictReadPort implements InventoryConflictReadPort {
  readonly calls: { unacknowledgedOnly: boolean; limit: number }[] = [];

  constructor(private readonly answer: readonly InventoryConflictRow[]) {}

  async listInventoryConflicts(query: {
    readonly unacknowledgedOnly: boolean;
    readonly limit: number;
  }): Promise<readonly InventoryConflictRow[]> {
    this.calls.push({ unacknowledgedOnly: query.unacknowledgedOnly, limit: query.limit });
    return this.answer;
  }
}

function buildApp(port?: InventoryConflictReadPort) {
  const store = new FakeStoreOrderStore();
  return buildDeliveryHttpApp({
    readPort: store,
    writePort: store,
    catalogPort: new FakeCatalog(),
    readinessPort: new FakeReadinessProbe([{ name: "database", ok: true }]),
    reservationPort: new FakeReservationPort(),
    reservationStore: new FakeReservationStore(),
    ...(port === undefined ? {} : { inventoryConflictReadPort: port }),
    newUuid: uuidSequence(),
    now: () => NOW,
  });
}

describe("GET /delivery/inventory-conflicts — التركيبُ", () => {
  it("منفذٌ غيرُ مُركَّبٍ ⇒ 500 `DELIVERY_INTERNAL_ERROR` لا 200 بقائمةٍ فارغةٍ", async () => {
    const { fastify, close } = buildApp();
    try {
      const res = await fastify.inject({ method: "GET", url: "/delivery/inventory-conflicts" });

      expect(res.statusCode).toBe(500);
      const body = res.json() as { error_code: string; message: string; trace_id: string };
      expect(body.error_code).toBe("DELIVERY_INTERNAL_ERROR");
      expect(body.trace_id).toBeTruthy();
      // والرسالةُ تُسمّي السببَ: نقصُ تركيبٍ لا عجزُ قاعدةٍ.
      expect(body.message).toContain("§4.18");
    } finally {
      await close();
    }
  });
});

describe("GET /delivery/inventory-conflicts — المُعامِلاتُ", () => {
  it("بلا مُعامِلاتٍ ⇒ غيرُ المُقَرِّ وحدَهُ وسقفٌ 50، والمُطبَّقُ مُردَّدٌ في الجسمِ", async () => {
    const port = new FakeInventoryConflictReadPort([row()]);
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({ method: "GET", url: "/delivery/inventory-conflicts" });

      expect(res.statusCode).toBe(200);
      expect(port.calls).toEqual([{ unacknowledgedOnly: true, limit: 50 }]);
      const body = res.json() as {
        applied_filter: { unacknowledged_only: boolean; limit: number };
        count: number;
      };
      // القارئُ لا يستنتجُ المُعامِلَ المُطبَّقَ من عدَدِ الصفوفِ.
      expect(body.applied_filter).toEqual({ unacknowledged_only: true, limit: 50 });
      expect(body.count).toBe(1);
    } finally {
      await close();
    }
  });

  it("`unacknowledged_only=false` ⇒ يُمرَّرُ كما هوَ", async () => {
    const port = new FakeInventoryConflictReadPort([]);
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({
        method: "GET",
        url: "/delivery/inventory-conflicts?unacknowledged_only=false&limit=7",
      });

      expect(res.statusCode).toBe(200);
      expect(port.calls).toEqual([{ unacknowledgedOnly: false, limit: 7 }]);
      const body = res.json() as { count: number; conflicts: unknown[] };
      expect(body.count).toBe(0);
      expect(body.conflicts).toEqual([]);
    } finally {
      await close();
    }
  });

  it("`unacknowledged_only=1` ⇒ 400 — لا تسامُحَ يُخفي خطأَ مُشغِّلٍ", async () => {
    const port = new FakeInventoryConflictReadPort([]);
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({
        method: "GET",
        url: "/delivery/inventory-conflicts?unacknowledged_only=1",
      });

      expect(res.statusCode).toBe(400);
      // شكلُ الخطأِ في هذهِ الخدمةِ مسطَّحٌ `{error_code, message, trace_id}`
      // (`http/errors.ts` يشرحُ لِمَ لا `code`)، ولا `details` على السلكِ —
      // فالحقلُ المرفوضُ يُسمّى في الرسالةِ.
      const body = res.json() as { error_code: string; message: string };
      expect(body.error_code).toBe("DELIVERY_VALIDATION_FAILED");
      expect(body.message).toContain("unacknowledged_only");
      // ولم يُنادَ المنفذُ أصلاً: الرفضُ قبلَ القاعدةِ.
      expect(port.calls).toEqual([]);
    } finally {
      await close();
    }
  });

  it("`limit=0x10` ⇒ 400 — ستةَ عشرَ ليسَ ما طلبَهُ، بل خطأٌ كتَبَهُ", async () => {
    const port = new FakeInventoryConflictReadPort([]);
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({
        method: "GET",
        url: "/delivery/inventory-conflicts?limit=0x10",
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error_code: string; message: string };
      expect(body.error_code).toBe("DELIVERY_VALIDATION_FAILED");
      expect(body.message).toContain("limit");
      expect(port.calls).toEqual([]);
    } finally {
      await close();
    }
  });

  it("`limit=0` و`limit=501` و`limit=2.5` كلُّها 400", async () => {
    const port = new FakeInventoryConflictReadPort([]);
    const { fastify, close } = buildApp(port);
    try {
      for (const limit of ["0", "501", "2.5", "-1", "abc", " 7"]) {
        const res = await fastify.inject({
          method: "GET",
          url: `/delivery/inventory-conflicts?limit=${encodeURIComponent(limit)}`,
        });
        expect(res.statusCode, `limit=${limit}`).toBe(400);
      }
      expect(port.calls).toEqual([]);
    } finally {
      await close();
    }
  });

  it("`limit=500` مقبولٌ — السقفُ نفسُهُ داخلٌ لا خارجٌ", async () => {
    const port = new FakeInventoryConflictReadPort([]);
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({
        method: "GET",
        url: "/delivery/inventory-conflicts?limit=500",
      });

      expect(res.statusCode).toBe(200);
      expect(port.calls).toEqual([{ unacknowledgedOnly: true, limit: 500 }]);
    } finally {
      await close();
    }
  });
});

describe("GET /delivery/inventory-conflicts — شكلُ الصفِّ على السلكِ", () => {
  it("كلُّ حقلٍ بمفتاحِ ثعبانٍ، و`changes_order_state: false` مُعلَنٌ", async () => {
    const port = new FakeInventoryConflictReadPort([row()]);
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({ method: "GET", url: "/delivery/inventory-conflicts" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { conflicts: Record<string, unknown>[] };
      expect(body.conflicts).toHaveLength(1);
      expect(body.conflicts[0]).toEqual({
        adjustment_id: "cccccccc-0000-0000-0000-000000000003",
        marketplace_event_id: "eeeeeeee-0000-0000-0000-000000000005",
        store_id: "aaaaaaaa-0000-0000-0000-000000000001",
        product_id: "bbbbbbbb-0000-0000-0000-000000000002",
        conflict_kind: "stock_zeroed_while_reserved",
        reason_code: "shrinkage",
        quantity_delta: -3,
        observed_quantity_after: 0,
        adjustment_sequence: 12,
        affected_order_count: 2,
        affected_units_total: 5,
        affected_order_public_ids: ["SO-0000000100", "SO-0000000200"],
        changes_order_state: false,
        occurred_for: "2026-09-12T02:29:00.000Z",
        detected_at: NOW,
        acknowledged_at: null,
        acknowledged_by: null,
      });
    } finally {
      await close();
    }
  });

  it("صفٌّ مُقَرٌّ يُظهِرُ مُقِرَّهُ ولحظتَهُ — الإقرارُ يُقرأُ لا يُخفي الصفَّ", async () => {
    const port = new FakeInventoryConflictReadPort([
      row({ acknowledgedAt: "2026-09-12T03:00:00.000Z", acknowledgedBy: "WS-0000000999" }),
    ]);
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({
        method: "GET",
        url: "/delivery/inventory-conflicts?unacknowledged_only=false",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        conflicts: { acknowledged_at: string | null; acknowledged_by: string | null }[];
      };
      expect(body.conflicts[0]?.acknowledged_at).toBe("2026-09-12T03:00:00.000Z");
      expect(body.conflicts[0]?.acknowledged_by).toBe("WS-0000000999");
    } finally {
      await close();
    }
  });

  it("`trace_id` لا يُنشَرُ في الصفِّ — مُعرِّفُ أثرٍ داخليٌّ لا حقلُ تقريرٍ", async () => {
    const port = new FakeInventoryConflictReadPort([row()]);
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({ method: "GET", url: "/delivery/inventory-conflicts" });

      const body = res.json() as { conflicts: Record<string, unknown>[] };
      expect(Object.keys(body.conflicts[0] ?? {})).not.toContain("trace_id");
    } finally {
      await close();
    }
  });
});
