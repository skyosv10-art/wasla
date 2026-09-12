/**
 * الرصدُ في جوابِ الجاهزيّةِ — بانياً ومساراً (المراجعةُ 15/N · ADR-026 §4.17).
 *
 * الدعوى المُختبَرةُ واحدةٌ ولها وجهانِ:
 *
 *   1. الرصدُ **يُنشَرُ**: من يقرأُ 503 على الإنشاءِ يعرفُ هل السوقُ هوَ السببُ.
 *   2. والرصدُ **لا يحكمُ**: سوقٌ ساقطٌ وقاعدةٌ سليمةٌ ⇒ `200 ready` — وهذا هوَ
 *      القرارُ الذي رفضَت المراجعةُ 8/N نقضَهُ، ولو انقلبَ لَأخرجَ عطلُ السوقِ
 *      هذه الخدمةَ من الدورةِ بينما القراءةُ والإلغاءُ يعملانِ.
 */

import { describe, expect, it } from "vitest";

import { createSignedDeliveryApp } from "./service-identity-support.js";
import { buildReadinessResponse } from "../http/readiness.js";
import type {
  DependencyObservation,
  DependencyObservationPort,
} from "../domain/dependency-probe.js";
import {
  FakeCatalog,
  FakeReadinessProbe,
  FakeReservationPort,
  FakeReservationStore,
  FakeStoreOrderStore,
  uuidSequence,
} from "./store-order-fakes.js";

const NOW = "2026-09-12T00:00:00.000Z";
const OBSERVED_AT = new Date("2026-09-11T23:59:57.000Z");

function observation(overrides: Partial<DependencyObservation> = {}): DependencyObservation {
  return {
    name: "marketplace_catalog",
    ok: true,
    observedAt: OBSERVED_AT,
    ageMs: 3_000,
    ...overrides,
  };
}

/** منفذُ رصدٍ يُملي الاختبارُ جوابَهُ — لا شبكةَ ولا صلاحيّةَ. */
class FakeObservationPort implements DependencyObservationPort {
  calls = 0;
  constructor(private readonly answer: DependencyObservation | (() => never)) {}

  async observe(): Promise<DependencyObservation> {
    this.calls += 1;
    const answer = this.answer;
    if (typeof answer === "function") answer();
    return answer as DependencyObservation;
  }
}

const GREEN_DATABASE = [{ name: "database", ok: true }] as const;

describe("buildReadinessResponse — أربعةُ أجوبةٍ لا اثنانِ", () => {
  it("غيرُ موصولٍ ⇒ `not_claimed: [not_wired]` ولا رصدَ", () => {
    const body = buildReadinessResponse(GREEN_DATABASE, false);

    expect(body.not_claimed).toEqual(["marketplace_catalog_not_wired"]);
    expect(body.dependencies).toEqual([]);
  });

  it("موصولٌ بلا مسبارٍ ⇒ `not_probed` ولا رصدَ — تركيبٌ لا يدّعي سبراً", () => {
    const body = buildReadinessResponse(GREEN_DATABASE, true);

    expect(body.not_claimed).toEqual(["marketplace_catalog_not_probed"]);
    expect(body.dependencies).toEqual([]);
  });

  it("موصولٌ ومرصودٌ ⇒ لا ادّعاءَ ناقصاً، ورصدٌ يُعلِنُ أنَّهُ لا يحكمُ", () => {
    const body = buildReadinessResponse(GREEN_DATABASE, true, observation());

    expect(body.not_claimed).toEqual([]);
    expect(body.dependencies).toEqual([
      {
        name: "marketplace_catalog",
        ok: true,
        observed_at: "2026-09-11T23:59:57.000Z",
        age_ms: 3_000,
        gates_readiness: false,
      },
    ]);
  });

  it("رصدٌ ساقطٌ يُنشَرُ بسببِهِ — و`status` يبقى `ready`", () => {
    const body = buildReadinessResponse(GREEN_DATABASE, true, observation({
      ok: false,
      detail: "marketplace_timeout",
    }));

    expect(body.status).toBe("ready");
    expect(body.not_claimed).toEqual([]);
    expect(body.dependencies[0]).toMatchObject({
      ok: false,
      detail: "marketplace_timeout",
      gates_readiness: false,
    });
  });

  it("رصدٌ موصولٌ لا يُلغي عطلَ القاعدةِ: `status` من الفحوصِ وحدَها", () => {
    const body = buildReadinessResponse(
      [{ name: "database", ok: false, detail: "unreachable" }],
      true,
      observation(),
    );

    expect(body.status).toBe("unavailable");
    expect(body.dependencies[0]?.ok).toBe(true);
  });

  it("فحوصٌ فارغةٌ ورصدٌ أخضرُ ⇒ `unavailable`: الرصدُ ليسَ فحصاً (RISK-0030)", () => {
    const body = buildReadinessResponse([], true, observation());

    expect(body.status).toBe("unavailable");
    expect(body.dependencies).toHaveLength(1);
  });

  it("رصدٌ بلا وصلٍ لا يُنشَرُ ولا يُفرِغُ الادّعاءَ", () => {
    const body = buildReadinessResponse(GREEN_DATABASE, false, observation());

    expect(body.not_claimed).toEqual(["marketplace_catalog_not_wired"]);
    expect(body.dependencies).toEqual([]);
  });

  it("`detail` يُحذَفُ عندَ غيابِهِ ولا يظهرُ `undefined` على السلكِ", () => {
    const body = buildReadinessResponse(GREEN_DATABASE, true, observation());

    expect(JSON.parse(JSON.stringify(body)).dependencies[0]).not.toHaveProperty("detail");
  });
});

describe("GET /delivery/ready — الرصدُ على السلكِ", () => {
  function buildApp(observationPort?: DependencyObservationPort) {
    const store = new FakeStoreOrderStore();
    return createSignedDeliveryApp({
      readPort: store,
      writePort: store,
      catalogPort: new FakeCatalog(),
      readinessPort: new FakeReadinessProbe([{ name: "database", ok: true }]),
      reservationPort: new FakeReservationPort(),
      reservationStore: new FakeReservationStore(),
      ...(observationPort === undefined ? {} : { marketplaceObservationPort: observationPort }),
      newUuid: uuidSequence(),
      now: () => NOW,
    });
  }

  it("مسبارٌ مُركَّبٌ ⇒ 200 ورصدٌ في الجسمِ وادّعاءٌ فارغٌ", async () => {
    const port = new FakeObservationPort(observation());
    const app = buildApp(port);

    const res = await app.fastify.inject({ method: "GET", url: "/delivery/ready" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "ready",
      checks: [{ name: "database", ok: true }],
      not_claimed: [],
      dependencies: [
        {
          name: "marketplace_catalog",
          ok: true,
          observed_at: "2026-09-11T23:59:57.000Z",
          age_ms: 3_000,
          gates_readiness: false,
        },
      ],
    });
    expect(port.calls).toBe(1);
    await app.close();
  });

  it("سوقٌ ساقطٌ وقاعدةٌ سليمةٌ ⇒ **200 ready**: العطلُ يُعلَنُ ولا يُخرِجُ الخدمةَ", async () => {
    const app = buildApp(
      new FakeObservationPort(
        observation({ ok: false, detail: "marketplace_unreachable", ageMs: 0 }),
      ),
    );

    const res = await app.fastify.inject({ method: "GET", url: "/delivery/ready" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ready");
    expect(body.dependencies[0]).toMatchObject({
      ok: false,
      detail: "marketplace_unreachable",
      gates_readiness: false,
    });
    await app.close();
  });

  it("منفذُ رصدٍ خرقَ عقدَهُ ورمى ⇒ المسارُ يحفظُ عقدَهُ ويعودُ إلى `not_probed`", async () => {
    const app = buildApp(
      new FakeObservationPort(() => {
        throw new Error("boom");
      }),
    );

    const res = await app.fastify.inject({ method: "GET", url: "/delivery/ready" });

    // لا `ErrorResponse` على مسارٍ عقدُهُ `ReadinessResponse` (errors.md قاعدةُ 6).
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: "ready",
      not_claimed: ["marketplace_catalog_not_probed"],
      dependencies: [],
    });
    await app.close();
  });

  it("بلا منفذِ رصدٍ يبقى الجوابُ كما كانَ قبلَ 15/N", async () => {
    const app = buildApp();

    const res = await app.fastify.inject({ method: "GET", url: "/delivery/ready" });

    expect(res.json()).toMatchObject({
      not_claimed: ["marketplace_catalog_not_probed"],
      dependencies: [],
    });
    await app.close();
  });
});
