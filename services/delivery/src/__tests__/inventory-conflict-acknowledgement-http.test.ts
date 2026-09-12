/**
 * `POST /delivery/inventory-conflicts/{adjustmentId}/acknowledgement` — على
 * السلكِ (المراجعةُ 18/N · ADR-026 §4.20).
 *
 * الدعاوى المُختبَرةُ هنا كلُّها عن **دفترِ مسؤوليّةٍ**، لا عن شكلِ جوابٍ:
 *
 *   1. **غيرُ مُركَّبٍ ⇒ 500 لا 200 «أُقِرَّت».** إقرارٌ كاذبٌ يُغلِقُ حادثةً
 *      حقيقيّةً في ذهنِ مُشغِّلٍ ولا يُبقي لها أثراً — وهوَ أشدُّ من الصفرِ
 *      الكاذبِ في مسارِ القراءةِ.
 *   2. **المُقِرُّ من الرمزِ لا من الجسمِ**، وجسمٌ يُذكَرُ فيهِ `acknowledged_by`
 *      **يُرَدُّ 400** ولا يُتَجاهَلُ صامتاً: التجاهُلُ يعني صفّاً يحملُ اسماً
 *      غيرَ الذي أرسلَهُ مَن يظنُّ أنَّهُ وقَّعَ.
 *   3. **الإنسانُ يُحمَلُ من `obo` إلى العمودِ** — من التوقيعِ إلى الدفترِ.
 *   4. **الإقرارُ الثاني 200 `already_acknowledged` باسمِ الأوّلِ** — الحالةُ
 *      المطلوبةُ مُتحقِّقةٌ، والجوابُ يُسمِّي المالكَ الفعليَّ فلا يظنُّ الثاني
 *      الواقعةَ لهُ.
 *   5. **رايةٌ مجهولةٌ ⇒ 404** ذو رمزٍ خاصٍّ، و**مُعرِّفٌ معطوبٌ ⇒ 400** لا 404.
 *   6. **الوقتُ من ساعةِ التطبيقِ** لا من المنادي.
 */

import { describe, expect, it } from "vitest";

import { createSignedDeliveryApp, signFor } from "./service-identity-support.js";
import type {
  InventoryConflictAcknowledgementOutcome,
  InventoryConflictAcknowledgementPort,
} from "../ports.js";
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
const ADJUSTMENT_ID = "cccccccc-0000-0000-0000-000000000003";
const URL = `/delivery/inventory-conflicts/${ADJUSTMENT_ID}/acknowledgement`;

function row(overrides: Partial<InventoryConflictRow> = {}): InventoryConflictRow {
  return {
    kind: "stock_zeroed_while_reserved",
    storeId: "aaaaaaaa-0000-0000-0000-000000000001",
    productId: "bbbbbbbb-0000-0000-0000-000000000002",
    adjustmentId: ADJUSTMENT_ID,
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

/** منفذُ كتابةٍ يُملي الاختبارُ جوابَهُ ويسجِّلُ **ما وصلَهُ** — والثاني هوَ المهمُّ. */
class FakeAckPort implements InventoryConflictAcknowledgementPort {
  readonly calls: { adjustmentId: string; acknowledgedBy: string; acknowledgedAt: string }[] = [];

  constructor(private readonly answer: InventoryConflictAcknowledgementOutcome) {}

  async acknowledgeInventoryConflict(command: {
    readonly adjustmentId: string;
    readonly acknowledgedBy: string;
    readonly acknowledgedAt: string;
  }): Promise<InventoryConflictAcknowledgementOutcome> {
    this.calls.push({ ...command });
    return this.answer;
  }
}

function buildApp(port?: InventoryConflictAcknowledgementPort) {
  const store = new FakeStoreOrderStore();
  return createSignedDeliveryApp({
    readPort: store,
    writePort: store,
    catalogPort: new FakeCatalog(),
    readinessPort: new FakeReadinessProbe([{ name: "database", ok: true }]),
    reservationPort: new FakeReservationPort(),
    reservationStore: new FakeReservationStore(),
    ...(port === undefined ? {} : { inventoryConflictAcknowledgementPort: port }),
    newUuid: uuidSequence(),
    now: () => NOW,
  });
}

describe("POST …/acknowledgement — التركيبُ", () => {
  it("منفذٌ غيرُ مُركَّبٍ ⇒ 500 `DELIVERY_INTERNAL_ERROR` لا 200 «أُقِرَّت»", async () => {
    const { fastify, close } = buildApp();
    try {
      const res = await fastify.inject({ method: "POST", url: URL });
      expect(res.statusCode).toBe(500);
      expect((res.json() as { error_code: string }).error_code).toBe("DELIVERY_INTERNAL_ERROR");
    } finally {
      await close();
    }
  });
});

describe("POST …/acknowledgement — المُقِرُّ يُؤخَذُ من الرمزِ وحدَهُ", () => {
  it("نداءٌ بلا جسمٍ ⇒ 200 `acknowledged`، والمُقِرُّ `service:<name>`", async () => {
    const port = new FakeAckPort({
      acknowledgement: "recorded",
      row: row({ acknowledgedAt: NOW, acknowledgedBy: "service:core" }),
    });
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({ method: "POST", url: URL });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.outcome).toBe("acknowledged");
      expect(body.conflict.acknowledged_by).toBe("service:core");
      expect(body.conflict.adjustment_id).toBe(ADJUSTMENT_ID);
      // اللحظةُ من ساعةِ التطبيقِ لا من المنادي: منادٍ يختارُ لحظةَ إقرارِهِ
      // يستطيعُ أن يُقدِّمَ إغلاقَ حادثةٍ على وقوعِها في الدفترِ.
      expect(port.calls).toEqual([
        { adjustmentId: ADJUSTMENT_ID, acknowledgedBy: "service:core", acknowledgedAt: NOW },
      ]);
    } finally {
      await close();
    }
  });

  it("`obo` في الرمزِ ⇒ الإنسانُ في العمودِ، من التوقيعِ إلى الدفترِ", async () => {
    const port = new FakeAckPort({
      acknowledgement: "recorded",
      row: row({
        acknowledgedAt: NOW,
        acknowledgedBy: "service:ops-console/on-behalf-of:US-0000000042",
      }),
    });
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({
        method: "POST",
        url: URL,
        headers: signFor("POST", URL, {
          serviceName: "ops-console",
          onBehalfOfPublicId: "US-0000000042",
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(port.calls[0]?.acknowledgedBy).toBe(
        "service:ops-console/on-behalf-of:US-0000000042",
      );
    } finally {
      await close();
    }
  });

  it("جسمٌ فيهِ `acknowledged_by` ⇒ **400** ولا يُتَجاهَلُ صامتاً", async () => {
    const port = new FakeAckPort({
      acknowledgement: "recorded",
      row: row({ acknowledgedAt: NOW, acknowledgedBy: "service:core" }),
    });
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({
        method: "POST",
        url: URL,
        payload: { acknowledged_by: "قسمُ العملياتِ" },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error_code: string }).error_code).toBe("DELIVERY_VALIDATION_FAILED");
      // والدعوى الأهمُّ: **لم يُكتَبْ شيءٌ**. رفضٌ يُقرَأُ ثمَّ يُقِرُّ أسوأُ من
      // قبولٍ صريحٍ، لأنَّ المُنادي يظنُّ أنَّ نداءَهُ لم يُؤثِّرْ.
      expect(port.calls).toEqual([]);
    } finally {
      await close();
    }
  });

  it("أيُّ جسمٍ غيرِ فارغٍ يُرَدُّ — لا قائمةَ حقولٍ ممنوعةٍ", async () => {
    const port = new FakeAckPort({
      acknowledgement: "recorded",
      row: row({ acknowledgedAt: NOW, acknowledgedBy: "service:core" }),
    });
    const { fastify, close } = buildApp(port);
    try {
      // حقلٌ غيرُ معروفٍ أصلاً: الرفضُ لأنَّ المسارَ **لا جسمَ لهُ**، لا لأنَّ
      // هذا الحقلَ بالذاتِ محجوزٌ — وقائمةُ ممنوعاتٍ تُنسى فيها إضافةٌ قادمةٌ.
      const res = await fastify.inject({ method: "POST", url: URL, payload: { note: "تمَّ" } });
      expect(res.statusCode).toBe(400);
      expect(port.calls).toEqual([]);
    } finally {
      await close();
    }
  });

  it("جسمٌ فارغٌ `{}` مقبولٌ — النداءُ الشريفُ لا يُعاقَبُ على قوسَينِ", async () => {
    const port = new FakeAckPort({
      acknowledgement: "recorded",
      row: row({ acknowledgedAt: NOW, acknowledgedBy: "service:core" }),
    });
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({ method: "POST", url: URL, payload: {} });
      expect(res.statusCode).toBe(200);
    } finally {
      await close();
    }
  });
});

describe("POST …/acknowledgement — الإقرارُ الثاني والرايةُ المجهولةُ", () => {
  it("مُقَرَّةٌ سابقاً ⇒ 200 `already_acknowledged` **باسمِ الأوّلِ** لا باسمي", async () => {
    const port = new FakeAckPort({
      acknowledgement: "already_recorded",
      row: row({
        acknowledgedAt: "2026-09-11T09:00:00.000Z",
        acknowledgedBy: "service:ops-console/on-behalf-of:US-0000000007",
      }),
    });
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({ method: "POST", url: URL });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.outcome).toBe("already_acknowledged");
      // مَن نادى الآنَ هوَ `core`، والجوابُ يقولُ اسمَ الأوّلِ: لولا ذلكَ لظنَّ
      // الثاني الحادثةَ في عهدتِهِ وهيَ في عهدةِ إنسانٍ آخرَ.
      expect(body.conflict.acknowledged_by).toBe(
        "service:ops-console/on-behalf-of:US-0000000007",
      );
      expect(body.conflict.acknowledged_at).toBe("2026-09-11T09:00:00.000Z");
    } finally {
      await close();
    }
  });

  it("رايةٌ مجهولةٌ ⇒ 404 `DELIVERY_INVENTORY_CONFLICT_NOT_FOUND` لا 500 ولا 200", async () => {
    const port = new FakeAckPort({ acknowledgement: "unknown_conflict" });
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({ method: "POST", url: URL });
      expect(res.statusCode).toBe(404);
      expect((res.json() as { error_code: string }).error_code).toBe("DELIVERY_INVENTORY_CONFLICT_NOT_FOUND");
    } finally {
      await close();
    }
  });

  it("مُعرِّفٌ ليسَ UUID ⇒ 400 ولا يبلغُ المنفذَ ولا القاعدةَ", async () => {
    const port = new FakeAckPort({ acknowledgement: "unknown_conflict" });
    const { fastify, close } = buildApp(port);
    try {
      // ولمَ 400 لا 404؟ `not-a-uuid` نداءٌ معطوبٌ لا «رايةٌ غيرُ موجودةٍ»؛ و404
      // كانَ سيُرسِلُ مُشغِّلاً يبحثُ في القاعدةِ عن صفٍّ موجودٍ. ولولا الحاجزُ
      // لبلغَ النصُّ `::uuid` فارتدَّ 22P02 مُترجَماً 500 — عيبٌ عندَنا على خطأِ
      // منادٍ.
      const badUrl = "/delivery/inventory-conflicts/not-a-uuid/acknowledgement";
      const res = await fastify.inject({ method: "POST", url: badUrl });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error_code: string }).error_code).toBe("DELIVERY_VALIDATION_FAILED");
      expect(port.calls).toEqual([]);
    } finally {
      await close();
    }
  });

  it("حالةُ الأحرفِ في المُعرِّفِ لا تُنشئُ رايتَينِ", async () => {
    const port = new FakeAckPort({
      acknowledgement: "recorded",
      row: row({ acknowledgedAt: NOW, acknowledgedBy: "service:core" }),
    });
    const { fastify, close } = buildApp(port);
    try {
      const upper = `/delivery/inventory-conflicts/${ADJUSTMENT_ID.toUpperCase()}/acknowledgement`;
      const res = await fastify.inject({
        method: "POST",
        url: upper,
        headers: signFor("POST", upper),
      });
      expect(res.statusCode).toBe(200);
      // `uuid` في PostgreSQL لا يُبالي بالحالةِ، فالتطبيعُ عندَنا يجعلُ السجلَّ
      // والمُقارنةَ في الاختبارِ متوقَّعَينِ بلا مفاجأةٍ.
      expect(port.calls[0]?.adjustmentId).toBe(ADJUSTMENT_ID);
    } finally {
      await close();
    }
  });
});
