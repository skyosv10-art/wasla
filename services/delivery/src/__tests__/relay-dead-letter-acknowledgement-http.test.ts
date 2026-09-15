/**
 * `POST /delivery/relay/dead-letters/{ledger}/{eventId}/acknowledge` — على السلكِ
 * (المراجعةُ 24/N · `M5-13` · ADR-026 §4.27).
 *
 * الدعاوى، وكلُّها عن **الحدِّ بينَ محضرِ حكمٍ وزرِّ إسكاتٍ**:
 *
 *   1. **غيرُ مُركَّبٍ ⇒ 500 لا 200.** ادّعاءُ إقرارٍ لم يُكتَبْ يُغلِقُ حادثةً
 *      على فقدٍ قائمٍ بلا أثرٍ في القاعدةِ.
 *   2. **صلاحيّةٌ ثالثةٌ مستقلّةٌ:** لا `:read` ولا `:requeue` تُقِرُّ (403)،
 *      والرفضُ **قبلَ** نداءِ المنفذِ.
 *   3. **لا إقرارَ بلا سببٍ:** غائبٌ · قصيرٌ · طويلٌ · فراغٌ ⇒ 400 ولا نداءَ.
 *   4. **والمُقِرُّ من الهويّةِ المُثبَتةِ لا من الجسمِ:** مفتاحٌ زائدٌ ⇒ 400،
 *      والاسمُ المكتوبُ هوَ المُركَّبُ من الرمزِ بما فيهِ الفاعلُ البشريُّ.
 *   5. **الرفضانِ يُفرَّقانِ:** 404 «لا صفَّ» ≠ 409 «ليسَ مسموماً» والحالةُ
 *      المقروءةُ في النصِّ.
 *   6. **نداءٌ ثانٍ ⇒ 200 `already_acknowledged` بإقرارِ الأوّلِ كما هوَ** لا
 *      409 ولا كتابةٌ فوقَ أوّلِ شاهدٍ.
 *   7. **والجوابُ يقولُ إنَّ العددَ لم ينقُصْ** — فلا يُفتَحُ بلاغٌ على مسارٍ
 *      سليمٍ، ولا يُقرأُ الإقرارُ محواً للدليلِ.
 */

import { describe, expect, it } from "vitest";

import {
  buildSignedDeliveryApp,
  createSignedDeliveryApp,
  signFor,
} from "./service-identity-support.js";
import { DELIVERY_SCOPES } from "../http/service-identity.js";
import type { RelayDeadLetterAcknowledgementPort } from "../ports.js";
import type { RelayDeadLetterLedger } from "../domain/relay-dead-letters.js";
import type { RelayAcknowledgementDecision } from "../domain/relay-acknowledgement.js";
import {
  FakeCatalog,
  FakeReadinessProbe,
  FakeReservationPort,
  FakeReservationStore,
  FakeStoreOrderStore,
  uuidSequence,
} from "./store-order-fakes.js";

const NOW = "2026-09-15T09:00:00.000Z";
const EVENT = "11111111-2222-4333-8444-555555555555";
const PATH = `/delivery/relay/dead-letters/dispatch/${EVENT}/acknowledge`;
const REASON = "منتِجٌ أُصلِحَ والحدثُ لا يُعادُ — RISK-0021";

interface RecordedCall {
  readonly ledger: RelayDeadLetterLedger;
  readonly eventId: string;
  readonly acknowledgedBy: string;
  readonly reason: string;
  readonly acknowledgedAt: string;
}

/** منفذُ إقرارٍ يُملي الاختبارُ قرارَهُ ويسجِّلُ **كلَّ** ما وصلَهُ. */
class FakeAcknowledgementPort implements RelayDeadLetterAcknowledgementPort {
  readonly calls: RecordedCall[] = [];

  constructor(private readonly answer: RelayAcknowledgementDecision) {}

  async acknowledgePoisonedEvent(cmd: RecordedCall): Promise<RelayAcknowledgementDecision> {
    this.calls.push(cmd);
    return this.answer;
  }
}

function baseDeps(port?: RelayDeadLetterAcknowledgementPort) {
  const store = new FakeStoreOrderStore();
  return {
    readPort: store,
    writePort: store,
    catalogPort: new FakeCatalog(),
    readinessPort: new FakeReadinessProbe([{ name: "database", ok: true }]),
    reservationPort: new FakeReservationPort(),
    reservationStore: new FakeReservationStore(),
    ...(port === undefined ? {} : { relayDeadLetterAcknowledgementPort: port }),
    newUuid: uuidSequence(),
    now: () => NOW,
  };
}

const buildApp = (port?: RelayDeadLetterAcknowledgementPort) =>
  createSignedDeliveryApp(baseDeps(port));

const acceptedPort = () => new FakeAcknowledgementPort({ outcome: "acknowledged" });

describe("POST …/acknowledge — التركيبُ والصلاحيّةُ", () => {
  it("منفذٌ غيرُ مُركَّبٍ ⇒ 500 لا 200 «أُقِرَّ»", async () => {
    const { fastify, close } = buildApp();
    try {
      const res = await fastify.inject({ method: "POST", url: PATH, payload: { reason: REASON } });

      expect(res.statusCode).toBe(500);
      const body = res.json() as { error_code: string; message: string; trace_id: string };
      expect(body.error_code).toBe("DELIVERY_INTERNAL_ERROR");
      expect(body.trace_id).toBeTruthy();
      // الرسالةُ تُسمّي القرارَ ومكانَهُ: نقصُ تركيبٍ عندَنا لا عجزُ قاعدةٍ.
      expect(body.message).toContain("§4.27");
    } finally {
      await close();
    }
  });

  /*
   * **الدعوى المركزيّةُ في الصلاحيّةِ.** ضمُّ الإقرارِ إلى `:read` كانَ سيجعلُ
   * كلَّ رمزِ لوحةِ رصدٍ مسروقٍ قادراً على **إسكاتِ تنبيهِ الفقدِ كلِّهِ**
   * بصلاحيّةِ نظرٍ؛ وضمُّهُ إلى `:requeue` كانَ سيجعلَ مَن يملكُ الإنقاذَ يملكُ
   * التسكيتَ — وهُما قرارانِ متضادّانِ في أثرِهما على الدليلِ.
   */
  it("رمزُ القراءةِ لا يُقِرُّ ⇒ 403، ولا يُنادى المنفذُ", async () => {
    const port = acceptedPort();
    const { app, rawInject, keys } = buildSignedDeliveryApp(baseDeps(port));
    try {
      const res = await rawInject({
        method: "POST",
        url: PATH,
        payload: { reason: REASON },
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

  it("**ورمزُ الإعادةِ لا يُقِرُّ** ⇒ 403 — إنقاذٌ ليسَ تسكيتاً", async () => {
    const port = acceptedPort();
    const { app, rawInject, keys } = buildSignedDeliveryApp(baseDeps(port));
    try {
      const res = await rawInject({
        method: "POST",
        url: PATH,
        payload: { reason: REASON },
        headers: signFor("POST", PATH, {
          keys,
          scopes: [DELIVERY_SCOPES.relayDeadLettersRequeue],
        }),
      });

      expect(res.statusCode).toBe(403);
      expect(port.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("رمزٌ يحملُ صلاحيّةَ الإقرارِ وحدَها يمرُّ ⇒ 200", async () => {
    const port = acceptedPort();
    const { app, rawInject, keys } = buildSignedDeliveryApp(baseDeps(port));
    try {
      const res = await rawInject({
        method: "POST",
        url: PATH,
        payload: { reason: REASON },
        headers: signFor("POST", PATH, {
          keys,
          scopes: [DELIVERY_SCOPES.relayDeadLettersAcknowledge],
        }),
      });

      expect(res.statusCode).toBe(200);
      expect(port.calls).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});

describe("POST …/acknowledge — لا إقرارَ بلا سببٍ", () => {
  const badBodies: {
    readonly name: string;
    readonly payload: Record<string, unknown> | readonly unknown[];
  }[] = [
    { name: "جسمٌ فارغٌ", payload: {} },
    { name: "سببٌ قصيرٌ (أحدَ عشرَ حرفاً)", payload: { reason: "x".repeat(11) } },
    { name: "سببٌ فراغاتٌ (اثنا عشرَ فراغاً)", payload: { reason: "            " } },
    { name: "سببٌ طويلٌ (513)", payload: { reason: "y".repeat(513) } },
    { name: "سببٌ ليسَ نصّاً", payload: { reason: 42 } },
    { name: "مصفوفةٌ لا كائنٌ", payload: [{ reason: REASON }] },
  ];

  for (const bad of badBodies) {
    it(`${bad.name} ⇒ 400 **ولا يُنادى المنفذُ**`, async () => {
      const port = acceptedPort();
      const { fastify, close } = buildApp(port);
      try {
        const res = await fastify.inject({ method: "POST", url: PATH, payload: bad.payload });

        expect(res.statusCode).toBe(400);
        expect(res.json().error_code).toBe("DELIVERY_VALIDATION_FAILED");
        // الدعوى الأهمُّ: لا معاملةَ فُتِحَت ولا صفَّ قُرِئَ بـ`FOR UPDATE`.
        expect(port.calls).toEqual([]);
      } finally {
        await close();
      }
    });
  }

  it("والرسالةُ تُنشِرُ الحدَّينِ بالرقمِ — `details` لا يَعبُرُ السلكَ", async () => {
    const port = acceptedPort();
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({
        method: "POST",
        url: PATH,
        payload: { reason: "قصيرٌ" },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { message: string; details?: unknown };
      // عقدُ خطأِ التوصيلِ ثلاثةُ حقولٍ ولا يَنشُرُ `details` (سابقةُ §4.24)،
      // فالحدُّ في **النصِّ** وإلّا لم يقرأْهُ المنادي أبداً.
      expect(body.details).toBeUndefined();
      expect(body.message).toContain("12");
      expect(body.message).toContain("512");
      expect(port.calls).toEqual([]);
    } finally {
      await close();
    }
  });

  it("**مفتاحٌ زائدٌ ⇒ 400**: المُقِرُّ من الهويّةِ لا من الجسمِ", async () => {
    // `acknowledged_by` في الجسمِ كانَ سيُقبَلُ صامتاً ويُتجاهَلُ، فيقرأُ
    // المنادي محضراً باسمِهِ وهوَ باسمٍ آخرَ — سابقةُ §4.20 حرفاً.
    const port = acceptedPort();
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({
        method: "POST",
        url: PATH,
        payload: { reason: REASON, acknowledged_by: "service:someone-else" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("acknowledged_by");
      expect(port.calls).toEqual([]);
    } finally {
      await close();
    }
  });

  it("اسمُ دفترٍ مجهولٌ ⇒ 400 ولا يُنادى المنفذُ — لا مُدخَلَ يبلغُ نصَّ الاستعلامِ", async () => {
    // نفسُ المُدخَلاتِ العدائيّةِ الثلاثةِ في §4.24 حرفاً: مفتاحُ الخريطةِ نوعُهُ
    // `RelayDeadLetterLedger` لا `string`، والحدُّ يرفضُ ما سواهُ **قبلَ** أن
    // يُنادى المنفذُ، فلا يبلغُ مُدخَلٌ نصَّ استعلامٍ أصلاً.
    const port = acceptedPort();
    const { fastify, close } = buildApp(port);
    try {
      for (const ledger of ["dispatch_v2", "delivery_relay_consumed_events", "'; DROP TABLE x--"]) {
        const url = `/delivery/relay/dead-letters/${encodeURIComponent(ledger)}/${EVENT}/acknowledge`;
        const res = await fastify.inject({ method: "POST", url, payload: { reason: REASON } });

        expect(res.statusCode, ledger).toBe(400);
      }
      expect(port.calls).toEqual([]);
    } finally {
      await close();
    }
  });

  it("مُعرِّفٌ ليسَ `uuid` ⇒ 400 ولا يُنادى المنفذُ", async () => {
    const port = acceptedPort();
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({
        method: "POST",
        url: "/delivery/relay/dead-letters/dispatch/not-a-uuid/acknowledge",
        payload: { reason: REASON },
      });

      expect(res.statusCode).toBe(400);
      expect(port.calls).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe("POST …/acknowledge — الأجوبةُ", () => {
  it("المقبولُ ⇒ 200 `acknowledged` **بالثلاثيِّ المكتوبِ** وبإعلانِ بقاءِ العدِّ", async () => {
    const port = acceptedPort();
    const { app, rawInject, keys } = buildSignedDeliveryApp(baseDeps(port));
    try {
      const res = await rawInject({
        method: "POST",
        url: PATH,
        payload: { reason: `  ${REASON}  ` },
        headers: signFor("POST", PATH, {
          keys,
          scopes: [DELIVERY_SCOPES.relayDeadLettersAcknowledge],
          serviceName: "ops-console",
          onBehalfOfPublicId: "usr_01HQZX",
        }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        outcome: "acknowledged",
        ledger: "dispatch",
        event_id: EVENT,
        // **الدعوى التي تفصلُ الإقرارَ عن محوِ الدليلِ**: العددُ الكلِّيُّ باقٍ،
        // والمُستثنى هوَ الحكمُ وحدَهُ — وقولُهُ في الجوابِ لا في ADR وحدَهُ.
        still_counted_in_total_poisoned: true,
        excluded_from_severity: true,
        acknowledgement: {
          acknowledged_at: NOW,
          acknowledged_by: "service:ops-console/on-behalf-of:usr_01HQZX",
          reason: REASON,
        },
      });

      // وما وصلَ المنفذَ هوَ **الاسمُ المُركَّبُ من الرمزِ** والسببُ مُقلَّماً:
      // من التوقيعِ إلى العمودِ بلا وسيطٍ يُخمِّنُ.
      expect(port.calls).toEqual([
        {
          ledger: "dispatch",
          eventId: EVENT,
          acknowledgedBy: "service:ops-console/on-behalf-of:usr_01HQZX",
          reason: REASON,
          acknowledgedAt: NOW,
        },
      ]);
    } finally {
      await app.close();
    }
  });

  it("**نداءٌ ثانٍ ⇒ 200 `already_acknowledged` بإقرارِ الأوّلِ** لا 409 ولا كتابةٌ فوقَهُ", async () => {
    const first = {
      acknowledgedAt: "2026-09-15T08:00:00.000Z",
      acknowledgedBy: "service:ops-console/on-behalf-of:usr_FIRST",
      acknowledgementReason: "سببُ الأوّلِ المكتوبُ في الدفترِ",
    };
    const port = new FakeAcknowledgementPort({ outcome: "already_acknowledged", ...first });
    const { app, rawInject, keys } = buildSignedDeliveryApp(baseDeps(port));
    try {
      const res = await rawInject({
        method: "POST",
        url: PATH,
        payload: { reason: "سببُ الثاني الذي لا يُكتَبُ" },
        headers: signFor("POST", PATH, {
          keys,
          scopes: [DELIVERY_SCOPES.relayDeadLettersAcknowledge],
          serviceName: "ops-console",
          onBehalfOfPublicId: "usr_SECOND",
        }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        outcome: string;
        acknowledgement: { acknowledged_at: string; acknowledged_by: string; reason: string };
      };
      expect(body.outcome).toBe("already_acknowledged");
      // دفترُ مسؤوليّةٍ يُكتَبُ فوقَ أوّلِ شاهدٍ فيهِ ليسَ دفترَ مسؤوليّةٍ.
      expect(body.acknowledgement).toEqual({
        acknowledged_at: first.acknowledgedAt,
        acknowledged_by: first.acknowledgedBy,
        reason: first.acknowledgementReason,
      });
      expect(body.acknowledgement.acknowledged_by).not.toContain("usr_SECOND");
    } finally {
      await app.close();
    }
  });

  it("لا صفَّ ⇒ 404 بكودِ §4.24 نفسِهِ — لا قاموسَ ثانٍ لمعنىً واحدٍ", async () => {
    const port = new FakeAcknowledgementPort({
      outcome: "rejected",
      reason: "not_found",
      observedStatus: null,
    });
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({ method: "POST", url: PATH, payload: { reason: REASON } });

      expect(res.statusCode).toBe(404);
      expect(res.json().error_code).toBe("DELIVERY_RELAY_DEAD_LETTER_NOT_FOUND");
    } finally {
      await close();
    }
  });

  it("صفٌّ بحالةٍ أخرى ⇒ 409 **والحالةُ المقروءةُ في النصِّ**", async () => {
    const port = new FakeAcknowledgementPort({
      outcome: "rejected",
      reason: "not_poisoned",
      observedStatus: "pending",
    });
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({ method: "POST", url: PATH, payload: { reason: REASON } });

      expect(res.statusCode).toBe(409);
      const body = res.json() as { error_code: string; message: string };
      expect(body.error_code).toBe("DELIVERY_RELAY_DEAD_LETTER_NOT_POISONED");
      // مُشغِّلٌ يحتاجُ أن يعرِفَ أنَّ زميلَهُ أعادَ الصفَّ قبلَ ثانيةٍ، لا أن
      // يُطارِدَ مُعرِّفاً يظنُّهُ منسوخاً خطأً.
      expect(body.message).toContain("pending");
    } finally {
      await close();
    }
  });
});
