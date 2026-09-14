/**
 * `POST /delivery/relay/dead-letters/{ledger}/{eventId}/requeue` — على السلكِ
 * (المراجعةُ 22/N · `M5-13R` · ADR-026 §4.24).
 *
 * الدعاوى، وكلُّها عن **ما يفعلُهُ مُشغِّلٌ في حادثةٍ**:
 *
 *   1. **غيرُ مُركَّبٍ ⇒ 500 لا 202.** ادّعاءُ إعادةٍ لم تقعْ يُغلِقُ حادثةً على
 *      فقدٍ قائمٍ — وهوَ أسوأُ من رفضٍ صريحٍ.
 *   2. **الصلاحيّةُ مفصولةٌ:** رمزُ `:read` لا يُحرِّكُ طابوراً (403).
 *   3. **الرفضانِ يُفرَّقانِ:** 404 «لا صفَّ» ≠ 409 «ليسَ مسموماً» — والحالةُ
 *      المقروءةُ تُنشَرُ.
 *   4. **202 لا 200**، والجوابُ يقولُ `requeued` ويُعلِنُ كلفةَ الإرجاعِ.
 *   5. **اسمُ دفترٍ مجهولٌ ⇒ 400 ولا يُنادى المنفذُ** — فلا يصلُ مُدخَلٌ نصَّ
 *      استعلامٍ أصلاً.
 */

import { describe, expect, it } from "vitest";

import {
  buildSignedDeliveryApp,
  createSignedDeliveryApp,
  signFor,
} from "./service-identity-support.js";
import { DELIVERY_SCOPES } from "../http/service-identity.js";
import type { RelayRequeuePort } from "../ports.js";
import type { RelayDeadLetterLedger } from "../domain/relay-dead-letters.js";
import type { RelayRequeueDecision } from "../domain/relay-reprocess.js";
import {
  FakeCatalog,
  FakeReadinessProbe,
  FakeReservationPort,
  FakeReservationStore,
  FakeStoreOrderStore,
  uuidSequence,
} from "./store-order-fakes.js";

const NOW = "2026-09-14T09:00:00.000Z";
const EVENT = "11111111-2222-4333-8444-555555555555";
const PATH = `/delivery/relay/dead-letters/dispatch/${EVENT}/requeue`;

/** منفذُ إعادةٍ يُملي الاختبارُ قرارَهُ ويسجِّلُ ما وصلَهُ. */
class FakeRelayRequeuePort implements RelayRequeuePort {
  readonly calls: { ledger: RelayDeadLetterLedger; eventId: string }[] = [];

  constructor(private readonly answer: RelayRequeueDecision) {}

  async requeuePoisonedEvent(cmd: {
    readonly ledger: RelayDeadLetterLedger;
    readonly eventId: string;
  }): Promise<RelayRequeueDecision> {
    this.calls.push({ ledger: cmd.ledger, eventId: cmd.eventId });
    return this.answer;
  }
}

function baseDeps(port?: RelayRequeuePort) {
  const store = new FakeStoreOrderStore();
  return {
    readPort: store,
    writePort: store,
    catalogPort: new FakeCatalog(),
    readinessPort: new FakeReadinessProbe([{ name: "database", ok: true }]),
    reservationPort: new FakeReservationPort(),
    reservationStore: new FakeReservationStore(),
    ...(port === undefined ? {} : { relayRequeuePort: port }),
    newUuid: uuidSequence(),
    now: () => NOW,
  };
}

const buildApp = (port?: RelayRequeuePort) => createSignedDeliveryApp(baseDeps(port));

describe("POST …/requeue — التركيبُ والصلاحيّةُ", () => {
  it("منفذٌ غيرُ مُركَّبٍ ⇒ 500 `DELIVERY_INTERNAL_ERROR` لا 202 «أُعيدَ»", async () => {
    const { fastify, close } = buildApp();
    try {
      const res = await fastify.inject({ method: "POST", url: PATH });

      expect(res.statusCode).toBe(500);
      const body = res.json() as { error_code: string; message: string; trace_id: string };
      expect(body.error_code).toBe("DELIVERY_INTERNAL_ERROR");
      expect(body.trace_id).toBeTruthy();
      // الرسالةُ تُسمّي القرارَ: نقصُ تركيبٍ عندَنا لا عجزُ قاعدةٍ.
      expect(body.message).toContain("§4.24");
    } finally {
      await close();
    }
  });

  /*
   * **الدعوى المركزيّةُ في الصلاحيّةِ.** لو ضُمَّت الإعادةُ إلى `:read` لكانَ كلُّ
   * رمزِ لوحةِ رصدٍ مسروقٍ قادراً على إرجاعِ مُرحِّلَي التوصيلِ إلى الصفرِ
   * مِراراً — إغراقُ قراءةٍ بصلاحيّةِ **نظرٍ**. والرفضُ يقعُ **قبلَ** أن يُنادى
   * المنفذُ، وهذا مُثبَتٌ لا مُفترَضٌ.
   */
  it("رمزُ قراءةِ الرسائلِ المسمومةِ لا يُعيدُ صفّاً ⇒ 403، ولا يُنادى المنفذُ", async () => {
    const port = new FakeRelayRequeuePort({ outcome: "requeued", previousStatus: "poisoned" });
    const { app, rawInject, keys } = buildSignedDeliveryApp(baseDeps(port));
    try {
      const res = await rawInject({
        method: "POST",
        url: PATH,
        headers: signFor("POST", PATH, {
          keys,
          scopes: [DELIVERY_SCOPES.relayDeadLettersRead],
        }),
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error_code).toBe("AUTHZ_FORBIDDEN");
      expect(port.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("رمزٌ يحملُ صلاحيّةَ الإعادةِ وحدَها يمرُّ ⇒ 202", async () => {
    const port = new FakeRelayRequeuePort({ outcome: "requeued", previousStatus: "poisoned" });
    const { app, rawInject, keys } = buildSignedDeliveryApp(baseDeps(port));
    try {
      const res = await rawInject({
        method: "POST",
        url: PATH,
        headers: signFor("POST", PATH, {
          keys,
          scopes: [DELIVERY_SCOPES.relayDeadLettersRequeue],
        }),
      });

      expect(res.statusCode).toBe(202);
      expect(port.calls).toEqual([{ ledger: "dispatch", eventId: EVENT }]);
    } finally {
      await app.close();
    }
  });
});

describe("POST …/requeue — المُعامِلاتُ", () => {
  it("اسمُ دفترٍ خارجَ القائمةِ المُصرَّحةِ ⇒ 400 ولا يُنادى المنفذُ", async () => {
    const port = new FakeRelayRequeuePort({ outcome: "requeued", previousStatus: "poisoned" });
    const { fastify, close } = buildApp(port);
    try {
      for (const ledger of ["dispatch_v2", "delivery_relay_consumed_events", "'; DROP TABLE x--"]) {
        const url = `/delivery/relay/dead-letters/${encodeURIComponent(ledger)}/${EVENT}/requeue`;
        const res = await fastify.inject({ method: "POST", url });
        expect(res.statusCode, ledger).toBe(400);
        expect(res.json().error_code).toBe("DELIVERY_VALIDATION_FAILED");
      }
      // لا مُدخَلَ بلغَ المُحوِّلَ أصلاً — وهذا هوَ سببُ انعدامِ سطحِ الحقنِ فيهِ.
      expect(port.calls).toEqual([]);
    } finally {
      await close();
    }
  });

  it("`eventId` ليسَ UUID ⇒ 400", async () => {
    const port = new FakeRelayRequeuePort({ outcome: "requeued", previousStatus: "poisoned" });
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({
        method: "POST",
        url: "/delivery/relay/dead-letters/dispatch/not-a-uuid/requeue",
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error_code).toBe("DELIVERY_VALIDATION_FAILED");
      expect(port.calls).toEqual([]);
    } finally {
      await close();
    }
  });

  it("الدفترُ الثاني يمرُّ باسمِهِ المُشغِّليِّ لا باسمِ جدولِهِ", async () => {
    const port = new FakeRelayRequeuePort({ outcome: "requeued", previousStatus: "poisoned" });
    const { fastify, close } = buildApp(port);
    try {
      const url = `/delivery/relay/dead-letters/marketplace_inventory/${EVENT}/requeue`;
      const res = await fastify.inject({ method: "POST", url });
      expect(res.statusCode).toBe(202);
      expect(port.calls).toEqual([{ ledger: "marketplace_inventory", eventId: EVENT }]);
    } finally {
      await close();
    }
  });
});

describe("POST …/requeue — الجوابُ", () => {
  it("«لا صفَّ» ⇒ 404 بكودٍ خاصٍّ — لا 202 صامتٌ", async () => {
    const port = new FakeRelayRequeuePort({
      outcome: "rejected",
      reason: "not_found",
      observedStatus: null,
    });
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({ method: "POST", url: PATH });
      expect(res.statusCode).toBe(404);
      expect(res.json().error_code).toBe("DELIVERY_RELAY_DEAD_LETTER_NOT_FOUND");
    } finally {
      await close();
    }
  });

  /*
   * 409 لا 404، **والحالةُ المقروءةُ منشورةٌ**. ودمجُ الرفضَينِ في كودٍ واحدٍ
   * كانَ سيجعلُ مُشغِّلاً في حادثةٍ يُطارِدُ مُعرِّفاً صحيحاً ظانّاً أنَّهُ أخطأَ
   * نسخَهُ، والحقيقةُ أنَّ زميلَهُ سبقَهُ قبلَ ثانيةٍ.
   */
  it.each([["applied"], ["pending"], ["ignored_foreign"]])(
    "«ليسَ مسموماً» (%s) ⇒ 409 بكودٍ آخرَ، والحالةُ المقروءةُ على السلكِ",
    async (status) => {
      const port = new FakeRelayRequeuePort({
        outcome: "rejected",
        reason: "not_poisoned",
        observedStatus: status,
      });
      const { fastify, close } = buildApp(port);
      try {
        const res = await fastify.inject({ method: "POST", url: PATH });
        expect(res.statusCode).toBe(409);
        const body = res.json() as Record<string, unknown>;
        expect(body["error_code"]).toBe("DELIVERY_RELAY_DEAD_LETTER_NOT_POISONED");
        /*
         * الحالةُ في **نصِّ الرسالةِ**، وهذا مقصودٌ ومُختبَرٌ هنا بالذاتِ:
         * عقدُ خطأِ التوصيلِ لا يَنشُرُ `details`، فدعوى «الحالةُ منشورةٌ»
         * لو عُلِّقَت على `details` لكانت خضراءَ على حقلٍ **لا يصلُ السلكَ**.
         */
        expect(body["details"]).toBeUndefined();
        expect(String(body["message"])).toContain(status);
      } finally {
        await close();
      }
    },
  );

  /*
   * **202 لا 200، و`requeued` لا `reprocessed`.** النداءُ قَبِلَ الإعادةَ ولم
   * يُنجِزْها: المُرحِّلُ يقرأُ الصفَّ في دورةٍ لاحقةٍ، وقد يُسَمُّ ثانيةً فوراً
   * إن كانَ سببُهُ ثابتاً. و«عولِجَ» كانَ سيُغلِقُ حادثةً على فقدٍ قائمٍ.
   */
  it("النجاحُ ⇒ 202 `requeued`، وكلفةُ الإرجاعِ منشورةٌ لا مخفيّةٌ", async () => {
    const port = new FakeRelayRequeuePort({ outcome: "requeued", previousStatus: "poisoned" });
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({ method: "POST", url: PATH });

      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({
        outcome: "requeued",
        ledger: "dispatch",
        event_id: EVENT,
        previous_status: "poisoned",
        new_status: "pending",
        checkpoint_rewound: true,
        rewind_cost: "full_rescan_from_zero",
        gates_readiness: false,
      });
    } finally {
      await close();
    }
  });

  it("جسمٌ مُرسَلٌ يُرَدُّ 400 ولا يُتَجاهَلُ صامتاً", async () => {
    // منادٍ يبعثُ `{\"reason\":\"…\"}` يظنُّ أنَّهُ سجَّلَ سبباً؛ وتجاهُلُهُ صامتاً
    // يجعلُهُ يعتقدُ أنَّ في الدفترِ ما ليسَ فيهِ — سابقةُ §4.20 حرفاً.
    const port = new FakeRelayRequeuePort({ outcome: "requeued", previousStatus: "poisoned" });
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({
        method: "POST",
        url: PATH,
        payload: { reason: "fixed the consumer" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error_code).toBe("DELIVERY_VALIDATION_FAILED");
      expect(port.calls).toEqual([]);
    } finally {
      await close();
    }
  });
});
