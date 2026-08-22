/**
 * The two outbound HTTP ports (Phase 05 · MR 5/6): matching 8088 and geography 8081.
 *
 * `fetch` is injected rather than intercepted globally, so each test states the exact
 * answer it is describing and nothing leaks between them. What is asserted is never «the
 * call was made» but the DECISION taken from each answer — refusal versus silence,
 * absent versus unreadable — because those are the distinctions the recorded publication
 * and the `422`/`503` split depend on.
 */

import { describe, expect, it } from "vitest";

import { isDriverError } from "../domain/errors.js";
import { HttpCandidacyPort } from "../infrastructure/http-candidacy.js";
import { HttpZoneCatalogPort } from "../infrastructure/http-zone-catalog.js";
import type { CandidacyProjection } from "../ports.js";
import { declareAvailability } from "../use-cases/manage-profile.js";
import { readEligibility } from "../use-cases/read-eligibility.js";
import { DRIVER, ZONE_A, environment, eligibleDriver } from "./helpers.js";

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** A `fetch` that answers from a queue and records what it was asked. */
function stubFetch(
  answers: readonly (Response | Error)[],
): { fetchImpl: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let index = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[name.toLowerCase()] = value;
    }
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    if (answer instanceof Error) throw answer;
    return answer as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PROJECTION: CandidacyProjection = {
  waslaPublicId: DRIVER,
  eligibilityState: "eligible",
  availabilityState: "available",
  serviceKinds: ["ride"],
  zoneIds: [ZONE_A],
  vehicleClass: "sedan",
};

const CLOCK = { now: () => "2026-01-01T00:00:00.000Z" };

describe("دليل المناطق عبر HTTP", () => {
  function catalog(answers: readonly (Response | Error)[]) {
    const { fetchImpl, calls } = stubFetch(answers);
    return { port: new HttpZoneCatalogPort({ baseUrl: "http://geo:8081", fetchImpl }), calls };
  }

  it("يقرأ المنطقة النشِطة من مسار الجغرافيا المعلن", async () => {
    const { port, calls } = catalog([json(200, { id: ZONE_A, status: "active" })]);
    expect([...(await port.existing([ZONE_A]))]).toEqual([ZONE_A]);
    expect(calls[0]?.url).toBe(`http://geo:8081/geo/zones/${ZONE_A}`);
    expect(calls[0]?.method).toBe("GET");
  });

  it("يستثني المنطقة المعطَّلة: موجودة في الهرم ولا يجوز تأليف عمل فيها", async () => {
    const { port } = catalog([json(200, { id: ZONE_A, status: "inactive" })]);
    expect((await port.existing([ZONE_A])).size).toBe(0);
  });

  it("404 غياب لا تعطّل", async () => {
    const { port } = catalog([new Response(null, { status: 404 })]);
    expect((await port.existing([ZONE_A])).size).toBe(0);
  });

  it("يستدعي مرة واحدة لكل معرّف مميّز لا لكل تكرار", async () => {
    const { port, calls } = catalog([json(200, { id: ZONE_A, status: "active" })]);
    await port.existing([ZONE_A, ZONE_A, ZONE_A]);
    expect(calls).toHaveLength(1);
  });

  /**
   * الحارس الأهم في هذا الملف: تعطّل الجغرافيا **ليس** «منطقة مجهولة». لو صار كذلك لأجابت
   * الكتابة 422 عن منطقة صحيحة، و422 تقول للمُنادي إن مدخله خاطئ فيتوقف عن إعادة المحاولة.
   */
  it.each([
    ["500", json(500, { code: "GEO_INTERNAL" })],
    ["جسم غير مقروء", new Response("<html>", { status: 200 })],
    ["حالة منطقة غير مفهومة", json(200, { id: ZONE_A, status: "retired" })],
    ["انقطاع شبكة", new Error("ECONNREFUSED")],
  ])("يرفع DRIVER_UNAVAILABLE لا غياباً عند %s", async (_label, answer) => {
    const { port } = catalog([answer]);
    await expect(port.existing([ZONE_A])).rejects.toMatchObject({ code: "DRIVER_UNAVAILABLE" });
  });

  it("فشل معرّف واحد يُفشل البحث كلّه: الكتابة تحتاج جواباً مغلقاً", async () => {
    const { port } = catalog([json(200, { id: ZONE_A, status: "active" }), json(503, {})]);
    await expect(port.existing([ZONE_A, "22222222-2222-4222-8222-222222222222"])).rejects.toSatisfy(
      isDriverError,
    );
  });
});

describe("منفذ الترشيح عبر HTTP", () => {
  function candidacy(answers: readonly (Response | Error)[]) {
    const { fetchImpl, calls } = stubFetch(answers);
    return {
      port: new HttpCandidacyPort({ baseUrl: "http://matching:8088/", fetchImpl, clock: CLOCK }),
      calls,
    };
  }

  it("يقرأ حالة التوافر الحالية من المطابقة", async () => {
    const { port, calls } = candidacy([json(200, { availability_state: "busy" })]);
    expect(await port.read(DRIVER)).toEqual({ availabilityState: "busy" });
    expect(calls[0]?.url).toBe(`http://matching:8088/candidacy/${DRIVER}`);
  });

  it("404 يعني لا صفّ بعد، لا تعطّلاً", async () => {
    const { port } = candidacy([new Response(null, { status: 404 })]);
    expect(await port.read(DRIVER)).toBeNull();
  });

  /**
   * القراءة fail-closed: قيمة غير مفهومة أو خدمة صامتة ترمي، لأن الافتراض المتساهل هنا
   * («لا صفّ») هو بالضبط الحالة التي نكتب فيها `available` فوق التزام قائم.
   */
  it.each([
    ["500", json(500, {})],
    ["حالة توافر مجهولة", json(200, { availability_state: "resting" })],
    ["حالة ناقصة", json(200, {})],
    ["انقطاع", new Error("ETIMEDOUT")],
  ])("ترمي القراءة عند %s ولا تُعيد null", async (_label, answer) => {
    const { port } = candidacy([answer]);
    await expect(port.read(DRIVER)).rejects.toMatchObject({ code: "DRIVER_UNAVAILABLE" });
  });

  it("ينشر استبدالاً كاملاً بمصدر أهليّة محسوب لا مدّعى", async () => {
    const { port, calls } = candidacy([json(200, { driver_public_id: DRIVER })]);
    expect(await port.publish(PROJECTION)).toEqual({ accepted: true, failureCode: null });

    const call = calls[0];
    expect(call?.method).toBe("PUT");
    expect(call?.body).toEqual({
      availability_state: "available",
      eligibility_state: "eligible",
      eligibility_source: "driver_core",
      service_kinds: ["ride"],
      vehicle_class: "sedan",
      zone_ids: [ZONE_A],
      actor_type: "driver_core",
    });
    // مفتاح إلزامي في عقد المطابقة، وطوله داخل 8..128.
    const key = call?.headers["idempotency-key"] ?? "";
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(128);
    expect(key).toContain(DRIVER);
  });

  /**
   * لماذا لا يكون المفتاح بصمة المحتوى وحده: سائق يتنقل available → offline → available
   * كان سيرسل النشر الثالث بمفتاح النشر الأول، فتُعيد المطابقة الجواب المخزَّن بلا تطبيق،
   * ويبقى صفّها `offline` وسجلّنا يقول `published`.
   */
  it("يمنح كل محاولة مفتاحاً جديداً حتى لو تكرر المحتوى نفسه", async () => {
    let millis = 1_760_000_000_000;
    const { fetchImpl, calls } = stubFetch([json(200, {})]);
    const port = new HttpCandidacyPort({
      baseUrl: "http://matching:8088",
      fetchImpl,
      clock: {
        now: () => {
          millis += 1000;
          return new Date(millis).toISOString();
        },
      },
    });
    await port.publish(PROJECTION);
    await port.publish(PROJECTION);
    expect(calls[0]?.headers["idempotency-key"]).not.toBe(calls[1]?.headers["idempotency-key"]);
  });

  it("يمرّر معرّف التتبّع ليصير trace_id في المطابقة، ويحذف الرأس إذا لم يوجد", async () => {
    const withTrace = candidacy([json(200, {})]);
    await withTrace.port.publish(PROJECTION, { traceId: "req-77" });
    expect(withTrace.calls[0]?.headers["x-request-id"]).toBe("req-77");

    const without = candidacy([json(200, {})]);
    await without.port.publish(PROJECTION, { traceId: null });
    expect(without.calls[0]?.headers["x-request-id"]).toBeUndefined();
  });

  /** رفض المطابقة **جواب**: يُسجَّل برمزها الحرفي لا برمز نخترعه لها. */
  it.each([400, 409, 422])("يعيد رفضاً مسجَّلاً برمز المطابقة عند %s", async (status) => {
    const { port } = candidacy([json(status, { code: "MATCHING_ZONE_UNKNOWN", message: "x" })]);
    expect(await port.publish(PROJECTION)).toEqual({
      accepted: false,
      failureCode: "MATCHING_ZONE_UNKNOWN",
    });
  });

  it("يعيد رمزاً يحمل الحالة إذا رفضت المطابقة بلا رمز مقروء", async () => {
    const { port } = candidacy([new Response("nope", { status: 422 })]);
    expect(await port.publish(PROJECTION)).toEqual({
      accepted: false,
      failureCode: "MATCHING_HTTP_422",
    });
  });

  /**
   * 503 من المطابقة صمتٌ لا رفض: هي تقول «ليس الآن، أعد المحاولة»، وتسجيلها رفضاً يضع
   * حكماً يبدو نهائياً في التدقيق عن انقطاع عابر.
   */
  it.each([
    ["503", json(503, { code: "MATCHING_UNAVAILABLE" })],
    ["500", json(500, {})],
    ["انقطاع", new Error("ECONNRESET")],
  ])("ترمي عند %s ليصير الأثر unavailable لا rejected", async (_label, answer) => {
    const { port } = candidacy([answer]);
    await expect(port.publish(PROJECTION)).rejects.toSatisfy(isDriverError);
  });
});

/**
 * الانحدار الذي جعل هذا الطور يمسّ `recompute-eligibility.ts`.
 *
 * كانت `candidacy.read` تُنادى خارج الحارس، وهو غير مرئي مع منفذ لا يفشل. مع أول منفذ
 * حقيقي كان تعطّل المطابقة سيخرج من النشر إلى كل حالة كتابة، فتُرفض وثيقة رُوجعت فعلاً
 * بسبب خدمة **خلفنا** — عكس ما يفرضه ADR-012 القرار 3.
 */
describe("تعطّل المطابقة لا يُسقط كتابة محلية", () => {
  it("فشل القراءة يُسجَّل محاولة unavailable ولا يرمي", async () => {
    const env = environment();
    await eligibleDriver(env);
    env.candidacy.readBroken = true;

    const profile = await declareAvailability(env, DRIVER, "offline");

    expect(profile.declaredAvailability).toBe("offline");
    const last = (await env.publications.list(DRIVER)).at(-1);
    expect(last?.outcome).toBe("unavailable");
    expect(last?.failureCode).toBe("MATCHING_UNREACHABLE");
  });

  it("القراءة المعطّلة تمنع النشر أصلاً: لا يجوز الكتابة فوق busy بلا معرفة", async () => {
    const env = environment();
    await eligibleDriver(env);
    env.candidacy.seed({
      waslaPublicId: DRIVER,
      eligibilityState: "eligible",
      availabilityState: "busy",
      serviceKinds: ["ride"],
      zoneIds: [ZONE_A],
      vehicleClass: "sedan",
    });
    env.candidacy.readBroken = true;

    await readEligibility(env, DRIVER);

    // الصفّ المزروع لم يُلمَس: النشر لم يخرج أصلاً.
    env.candidacy.readBroken = false;
    expect(await env.candidacy.read(DRIVER)).toEqual({ availabilityState: "busy" });
  });

  it("القراءة السليمة تحفظ busy ولا ترفعه إلى available", async () => {
    const env = environment();
    await eligibleDriver(env);
    env.candidacy.seed({
      waslaPublicId: DRIVER,
      eligibilityState: "eligible",
      availabilityState: "busy",
      serviceKinds: ["ride"],
      zoneIds: [ZONE_A],
      vehicleClass: "sedan",
    });

    await declareAvailability(env, DRIVER, "available");

    const last = (await env.publications.list(DRIVER)).at(-1);
    expect(last?.outcome).toBe("published");
    expect(last?.availabilityState).toBe("busy");
  });
});
