/**
 * `GET /delivery/relay/dead-letters` — على السلكِ (المراجعةُ 21/N · ADR-026 §4.23).
 *
 * أربعُ دعاوى، وكلُّها عن **ما يراهُ مراقِبٌ في الثالثةِ صباحاً**:
 *
 *   1. **غيرُ مُركَّبٍ ⇒ 500 لا 200 بمقياسٍ صفريٍّ.** وهذا أشدُّ من نظيرِهِ في
 *      §4.18: مسارٌ موضوعُهُ مراقبةُ الفقدِ إذا كذبَ بالصفرِ أغلقَ العينَ التي
 *      جاءَ ليفتحَها.
 *   2. **العتبةُ تُنشَرُ معَ الحكمِ.** مراقِبٌ يقرأُ `warning` بلا أن يعرِفَ عندَ
 *      أيِّ عددٍ أُطلِقَ لا يكتبُ حادثةً مفهومةً — ولو كتبَ العتبةَ عندَهُ لصارَت
 *      مصدرَ حقيقةٍ مُكرَّراً.
 *   3. **200 حتّى عندَ `critical`.** القياسُ نجحَ؛ ورمزُ خطأٍ هنا يجعلُ المراقِبَ
 *      يُنبِّهُ «مسارُ الرصدِ معطوبٌ» والحقيقةُ «الفقدُ واقعٌ».
 *   4. **`gates_readiness: false` منشورٌ في الجسمِ** — سابقةُ §4.17-2: مَن يقرأُ
 *      تنبيهاً لا يقرأُ ADR.
 */

import { describe, expect, it } from "vitest";

import {
  ALL_DELIVERY_SCOPES,
  buildSignedDeliveryApp,
  createSignedDeliveryApp,
  signFor,
} from "./service-identity-support.js";
import { DELIVERY_SCOPES } from "../http/service-identity.js";
import type { RelayDeadLetterReadPort } from "../ports.js";
import type { RelayDeadLetterMetric } from "../domain/relay-dead-letters.js";
import {
  FakeCatalog,
  FakeReadinessProbe,
  FakeReservationPort,
  FakeReservationStore,
  FakeStoreOrderStore,
  uuidSequence,
} from "./store-order-fakes.js";

const NOW = "2026-09-13T02:00:00.000Z";
const minutesAgo = (n: number) => new Date(Date.parse(NOW) - n * 60_000).toISOString();

/** منفذُ قياسٍ يُملي الاختبارُ جوابَهُ ويسجِّلُ ما وصلَهُ من مُعامِلاتٍ. */
class FakeRelayDeadLetterReadPort implements RelayDeadLetterReadPort {
  readonly calls: { eventTypeLimit: number }[] = [];

  constructor(private readonly answer: RelayDeadLetterMetric) {}

  async readRelayDeadLetters(query: {
    readonly eventTypeLimit: number;
  }): Promise<RelayDeadLetterMetric> {
    this.calls.push({ eventTypeLimit: query.eventTypeLimit });
    return this.answer;
  }
}

function emptyMetric(): RelayDeadLetterMetric {
  return {
    measuredAt: NOW,
    totalPoisoned: 0,
    ledgers: [
      { ledger: "dispatch", poisoned: 0, oldestPoisonedAt: null, newestPoisonedAt: null, byEventType: [] },
      {
        ledger: "marketplace_inventory",
        poisoned: 0,
        oldestPoisonedAt: null,
        newestPoisonedAt: null,
        byEventType: [],
      },
    ],
  };
}

function buildApp(port?: RelayDeadLetterReadPort) {
  const store = new FakeStoreOrderStore();
  return createSignedDeliveryApp({
    readPort: store,
    writePort: store,
    catalogPort: new FakeCatalog(),
    readinessPort: new FakeReadinessProbe([{ name: "database", ok: true }]),
    reservationPort: new FakeReservationPort(),
    reservationStore: new FakeReservationStore(),
    ...(port === undefined ? {} : { relayDeadLetterReadPort: port }),
    newUuid: uuidSequence(),
    now: () => NOW,
  });
}

describe("GET /delivery/relay/dead-letters — التركيبُ", () => {
  it("منفذٌ غيرُ مُركَّبٍ ⇒ 500 `DELIVERY_INTERNAL_ERROR` لا 200 بصفرٍ", async () => {
    const { fastify, close } = buildApp();
    try {
      const res = await fastify.inject({ method: "GET", url: "/delivery/relay/dead-letters" });

      expect(res.statusCode).toBe(500);
      const body = res.json() as { error_code: string; message: string; trace_id: string };
      expect(body.error_code).toBe("DELIVERY_INTERNAL_ERROR");
      expect(body.trace_id).toBeTruthy();
      // الرسالةُ تُسمّي القرارَ: نقصُ تركيبٍ عندَنا لا عجزُ قاعدةٍ.
      expect(body.message).toContain("§4.23");
    } finally {
      await close();
    }
  });
});

describe("GET /delivery/relay/dead-letters — المُعامِلاتُ", () => {
  it("بلا مُعامِلاتٍ ⇒ سقفُ تفصيلٍ 10، والمُطبَّقُ مُردَّدٌ في الجسمِ", async () => {
    const port = new FakeRelayDeadLetterReadPort(emptyMetric());
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({ method: "GET", url: "/delivery/relay/dead-letters" });

      expect(res.statusCode).toBe(200);
      expect(port.calls).toEqual([{ eventTypeLimit: 10 }]);
      const body = res.json() as { applied_filter: { event_type_limit: number } };
      expect(body.applied_filter).toEqual({ event_type_limit: 10 });
    } finally {
      await close();
    }
  });

  it("`event_type_limit` مقبولٌ يُمرَّرُ كما هوَ", async () => {
    const port = new FakeRelayDeadLetterReadPort(emptyMetric());
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({
        method: "GET",
        url: "/delivery/relay/dead-letters?event_type_limit=25",
      });

      expect(res.statusCode).toBe(200);
      expect(port.calls).toEqual([{ eventTypeLimit: 25 }]);
    } finally {
      await close();
    }
  });

  it("`0` و`101` و`2.5` و`0x10` و`abc` كلُّها 400 — ولا يُنادى المنفذُ", async () => {
    const port = new FakeRelayDeadLetterReadPort(emptyMetric());
    const { fastify, close } = buildApp(port);
    try {
      for (const value of ["0", "101", "2.5", "0x10", "abc", "-1", " 7"]) {
        const res = await fastify.inject({
          method: "GET",
          url: `/delivery/relay/dead-letters?event_type_limit=${encodeURIComponent(value)}`,
        });
        expect(res.statusCode, `event_type_limit=${value}`).toBe(400);
        const body = res.json() as { error_code: string; message: string };
        expect(body.error_code).toBe("DELIVERY_VALIDATION_FAILED");
        expect(body.message).toContain("event_type_limit");
      }
      // الرفضُ قبلَ القاعدةِ: لا نداءَ واحدٌ.
      expect(port.calls).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe("GET /delivery/relay/dead-letters — الصلاحيّةُ", () => {
  const PATH = "/delivery/relay/dead-letters";

  it("الصلاحيّةُ الجديدةُ مُصرَّحةٌ بنصِّها في `DELIVERY_SCOPES`", () => {
    // اسمُ الصلاحيّةِ عقدٌ معَ مُصدِرِ الرموزِ: تغييرُهُ يكسِرُ كلَّ حاملٍ قائمٍ،
    // فيجبُ أن يُسقِطَ اختباراً باسمِهِ لا أن يمرَّ صامتاً.
    expect(DELIVERY_SCOPES.relayDeadLettersRead).toBe("delivery:ops:relay-dead-letters:read");
  });

  it("رمزٌ صحيحٌ **بلا** صلاحيّةِ الدفترِ ⇒ 403 لا 200 — والقياسُ لا يُنادى", async () => {
    const port = new FakeRelayDeadLetterReadPort(emptyMetric());
    const store = new FakeStoreOrderStore();
    const { app, keys, rawInject } = buildSignedDeliveryApp({
      readPort: store,
      writePort: store,
      catalogPort: new FakeCatalog(),
      readinessPort: new FakeReadinessProbe([{ name: "database", ok: true }]),
      reservationPort: new FakeReservationPort(),
      reservationStore: new FakeReservationStore(),
      relayDeadLetterReadPort: port,
      newUuid: uuidSequence(),
      now: () => NOW,
    });
    try {
      const withoutScope = ALL_DELIVERY_SCOPES.filter(
        (scope) => scope !== DELIVERY_SCOPES.relayDeadLettersRead,
      );
      const denied = await rawInject({
        method: "GET",
        url: PATH,
        headers: signFor("GET", PATH, { keys, scopes: withoutScope }),
      });

      expect(denied.statusCode).toBe(403);
      // الرفضُ عن الصلاحيّةِ قبلَ أن تُسألَ القاعدةُ.
      expect(port.calls).toEqual([]);

      // ونفسُ الرمزِ معَ الصلاحيّةِ وحدَها يمرُّ — فالرفضُ عنها لا عن شيءٍ آخرَ.
      const allowed = await rawInject({
        method: "GET",
        url: PATH,
        headers: signFor("GET", PATH, {
          keys,
          scopes: [DELIVERY_SCOPES.relayDeadLettersRead],
        }),
      });
      expect(allowed.statusCode).toBe(200);
      expect(port.calls).toEqual([{ eventTypeLimit: 10 }]);
    } finally {
      await app.close();
    }
  });
});

describe("GET /delivery/relay/dead-letters — الجسمُ والحكمُ", () => {
  it("دفتَرانِ خاليانِ ⇒ `ok`، **والدفترانِ مذكورانِ كلاهما** لا محذوفانِ", async () => {
    const port = new FakeRelayDeadLetterReadPort(emptyMetric());
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({ method: "GET", url: "/delivery/relay/dead-letters" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        measured_at: string;
        total_poisoned: number;
        ledgers: { ledger: string; poisoned: number }[];
        alert: Record<string, unknown>;
      };

      expect(body.measured_at).toBe(NOW);
      expect(body.total_poisoned).toBe(0);
      // دفترٌ يغيبُ حينَ يخلو لا يُفرَّقُ عن دفترٍ نُسِيَ من الاستعلامِ.
      expect(body.ledgers.map((l) => l.ledger)).toEqual(["dispatch", "marketplace_inventory"]);
      expect(body.alert).toEqual({
        severity: "ok",
        because: "no_poisoned_rows",
        oldest_poisoned_age_seconds: null,
        thresholds: {
          warning_poisoned: 1,
          critical_poisoned: 10,
          critical_age_seconds: 86_400,
        },
        gates_readiness: false,
      });
    } finally {
      await close();
    }
  });

  it("صفٌّ واحدٌ ⇒ `warning` **مع العتبةِ منشورةً** وتفصيلِ النوعِ", async () => {
    const port = new FakeRelayDeadLetterReadPort({
      measuredAt: NOW,
      totalPoisoned: 1,
      ledgers: [
        { ledger: "dispatch", poisoned: 0, oldestPoisonedAt: null, newestPoisonedAt: null, byEventType: [] },
        {
          ledger: "marketplace_inventory",
          poisoned: 1,
          oldestPoisonedAt: minutesAgo(5),
          newestPoisonedAt: minutesAgo(5),
          byEventType: [{ eventType: "marketplace.inventory_adjusted", poisoned: 1 }],
        },
      ],
    });
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({ method: "GET", url: "/delivery/relay/dead-letters" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        total_poisoned: number;
        ledgers: {
          ledger: string;
          poisoned: number;
          oldest_poisoned_at: string | null;
          by_event_type: { event_type: string; poisoned: number }[];
        }[];
        alert: { severity: string; because: string; oldest_poisoned_age_seconds: number };
      };

      expect(body.total_poisoned).toBe(1);
      expect(body.alert.severity).toBe("warning");
      expect(body.alert.because).toBe("poisoned_present");
      expect(body.alert.oldest_poisoned_age_seconds).toBe(300);

      const inventory = body.ledgers.find((l) => l.ledger === "marketplace_inventory");
      expect(inventory?.poisoned).toBe(1);
      expect(inventory?.oldest_poisoned_at).toBe(minutesAgo(5));
      expect(inventory?.by_event_type).toEqual([
        { event_type: "marketplace.inventory_adjusted", poisoned: 1 },
      ]);
    } finally {
      await close();
    }
  });

  it("`critical` يُجابُ **200** لا 5xx — القياسُ نجحَ وإن ساءَ مقيسُهُ", async () => {
    const port = new FakeRelayDeadLetterReadPort({
      measuredAt: NOW,
      totalPoisoned: 12,
      ledgers: [
        {
          ledger: "dispatch",
          poisoned: 12,
          oldestPoisonedAt: minutesAgo(30),
          newestPoisonedAt: minutesAgo(1),
          byEventType: [{ eventType: "dispatch.job_assigned", poisoned: 12 }],
        },
        {
          ledger: "marketplace_inventory",
          poisoned: 0,
          oldestPoisonedAt: null,
          newestPoisonedAt: null,
          byEventType: [],
        },
      ],
    });
    const { fastify, close } = buildApp(port);
    try {
      const res = await fastify.inject({ method: "GET", url: "/delivery/relay/dead-letters" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { alert: { severity: string; because: string; gates_readiness: boolean } };
      expect(body.alert.severity).toBe("critical");
      expect(body.alert.because).toBe("poisoned_count_at_or_above_critical");
      // ولا يمسُّ الجاهزيّةَ: حدثٌ فاسدٌ ليسَ انقطاعَ خدمةٍ.
      expect(body.alert.gates_readiness).toBe(false);
    } finally {
      await close();
    }
  });

  it("`critical` لا يُغيِّرُ `GET /delivery/ready` — مُعلِمٌ لا حاكمٌ، مقيسٌ لا مُدَّعىً", async () => {
    const port = new FakeRelayDeadLetterReadPort({
      measuredAt: NOW,
      totalPoisoned: 99,
      ledgers: [
        {
          ledger: "dispatch",
          poisoned: 99,
          oldestPoisonedAt: minutesAgo(10_000),
          newestPoisonedAt: minutesAgo(1),
          byEventType: [],
        },
        {
          ledger: "marketplace_inventory",
          poisoned: 0,
          oldestPoisonedAt: null,
          newestPoisonedAt: null,
          byEventType: [],
        },
      ],
    });
    const { fastify, close } = buildApp(port);
    try {
      const metricRes = await fastify.inject({ method: "GET", url: "/delivery/relay/dead-letters" });
      expect((metricRes.json() as { alert: { severity: string } }).alert.severity).toBe("critical");

      const readyRes = await fastify.inject({ method: "GET", url: "/delivery/ready" });
      expect(readyRes.statusCode).toBe(200);
      expect((readyRes.json() as { status: string }).status).toBe("ready");
    } finally {
      await close();
    }
  });
});
