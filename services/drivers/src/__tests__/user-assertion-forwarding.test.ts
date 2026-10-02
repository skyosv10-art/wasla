/**
 * ADR-060 §2.4 · CLM-0440 — `drivers` **مُمرِّرٌ** لا مُصدِرٌ ولا مصدرُ هويّةٍ.
 *
 * المقيسُ: (1) طلبٌ واردٌ يحملُ `obo` وترويسةَ التأكيدِ ⇒ نداءُ `matching` الصادرُ يحملُ `obo`
 * نفسَهُ والترويسةَ **حرفاً** (لا يُعادُ صكُّها ولا تُعدَّلُ)؛ (2) نداءٌ عن سائقٍ آخرَ لا يحملُ
 * تفويضَ المُنادي؛ (3) بلا تفويضٍ واردٍ — ومنهُ النبضةُ — نداءٌ نظاميٌّ كما كانَ؛
 * (4) لا تحقُّقَ ولا رفضَ في P1: ترويسةٌ مشوَّهةٌ لا تُغيِّرُ الجوابَ.
 */
import { describe, expect, it } from "vitest";

import { createServiceRequestSigner, ServiceAuthKeyRegistry, SERVICE_AUTH_HEADER, USER_ASSERTION_HEADER } from "@wasla/service-auth";

import { HttpCandidacyPort, DRIVERS_MATCHING_SCOPES } from "../infrastructure/http-candidacy.js";
import { runWithForwardedDelegation } from "../infrastructure/forwarded-delegation.js";
import { DRIVER, registration, httpHarness, key } from "./http-harness.js";

const SIGNER = createServiceRequestSigner({
  serviceName: "drivers",
  audience: "matching",
  keys: new ServiceAuthKeyRegistry({ keys: [{ kid: "test", secret: "drivers-test-secret-0123456789abcd", status: "active" }], activeKid: "test" }),
  scopes: DRIVERS_MATCHING_SCOPES,
});
const ASSERTION = "wua1.ZHJpdmVyLWFzc2VydGlvbg.c2lnbmF0dXJl";

function recorder() {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
    const isRead = (init?.method ?? "GET") === "GET";
    return new Response(isRead ? JSON.stringify({ code: "NOT_FOUND" }) : "{}", { status: isRead ? 404 : 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, port: new HttpCandidacyPort({ baseUrl: "http://matching:8088", fetchImpl, signRequest: SIGNER }) };
}

function oboOf(headers: Record<string, string>): string | undefined {
  const token = headers[SERVICE_AUTH_HEADER]!;
  return (JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as { obo?: string }).obo;
}

const PROJECTION = {
  waslaPublicId: DRIVER,
  eligibilityState: "eligible" as const,
  availabilityState: "available" as const,
  serviceKinds: ["ride" as const],
  zoneIds: [],
  vehicleClass: null,
};

describe("HttpCandidacyPort — تمريرُ التفويضِ", () => {
  it("داخلَ سياقِ تفويضٍ لصاحبِ الترشيحِ: obo والترويسةُ كما وصلا", async () => {
    const { calls, port } = recorder();
    await runWithForwardedDelegation({ publicId: DRIVER, assertion: ASSERTION }, async () => {
      await port.read(DRIVER);
      await port.publish(PROJECTION);
    });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(oboOf(call.headers)).toBe(DRIVER);
      expect(call.headers[USER_ASSERTION_HEADER]).toBe(ASSERTION);
    }
  });

  it("تفويضٌ لسائقٍ آخرَ لا يُنسَبُ إلى هذا الترشيحِ ⇒ نداءٌ نظاميٌّ", async () => {
    const { calls, port } = recorder();
    await runWithForwardedDelegation({ publicId: "WS-1999999999", assertion: ASSERTION }, () => port.publish(PROJECTION));
    expect(oboOf(calls[0]!.headers)).toBeUndefined();
    expect(calls[0]!.headers[USER_ASSERTION_HEADER]).toBeUndefined();
  });

  it("خارجَ أيِّ سياقٍ (النبضةُ) ⇒ نداءٌ نظاميٌّ كما كانَ", async () => {
    const { calls, port } = recorder();
    await port.publish(PROJECTION);
    expect(oboOf(calls[0]!.headers)).toBeUndefined();
    expect(calls[0]!.headers[USER_ASSERTION_HEADER]).toBeUndefined();
  });
});

describe("حدُّ السائقينَ — التفويضُ الواردُ يصلُ إلى المطابقةِ بلا تحقُّقٍ ولا رفضٍ", () => {
  it("PUT availability بـobo وترويسةٍ ⇒ نداءاتُ المطابقةِ تحملُهما؛ وبلا ترويسةٍ لا شيءَ", async () => {
    const harness = httpHarness();
    const { calls, port } = recorder();
    (harness.env as unknown as { candidacy: HttpCandidacyPort }).candidacy = port;
    const created = await harness.app.inject({ method: "POST", url: "/drivers", headers: { "idempotency-key": key("fwd") }, payload: registration(DRIVER) });
    expect(created.statusCode).toBe(201);
    // التسجيلُ بلا ترويسةِ تأكيدٍ ⇒ نداءاتٌ نظاميّةٌ.
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.headers[USER_ASSERTION_HEADER]).toBeUndefined();
    calls.length = 0;

    const declared = await harness.app.inject({
      method: "PUT",
      url: `/drivers/${DRIVER}/availability`,
      headers: { [USER_ASSERTION_HEADER]: ASSERTION },
      payload: { declared_availability: "available" },
    });
    expect(declared.statusCode).toBe(200);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(oboOf(call.headers)).toBe(DRIVER);
      expect(call.headers[USER_ASSERTION_HEADER]).toBe(ASSERTION);
    }
  });

  it("ترويسةٌ مشوَّهةٌ لا تُغيِّرُ الجوابَ في P1 — drivers لا يتحقّقُ ولا يرفضُ", async () => {
    const harness = httpHarness();
    const created = await harness.app.inject({ method: "POST", url: "/drivers", headers: { "idempotency-key": key("fwd") }, payload: registration(DRIVER) });
    expect(created.statusCode).toBe(201);
    const response = await harness.app.inject({
      method: "PUT",
      url: `/drivers/${DRIVER}/availability`,
      headers: { [USER_ASSERTION_HEADER]: "not-a-token" },
      payload: { declared_availability: "available" },
    });
    expect(response.statusCode).toBe(200);
  });
});
