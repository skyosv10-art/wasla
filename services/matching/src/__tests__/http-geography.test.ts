import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createServiceRequestSigner,
  ServiceAuthKeyRegistry,
} from "@wasla/service-auth";

import {
  HttpZoneHierarchy,
  MATCHING_GEOGRAPHY_SCOPES,
} from "../infrastructure/http-geography.js";

/**
 * موقّعُ اختبارٍ بالصلاحيّةِ المعلنةِ للعميلِ وحدَها (`M1-04` الموجةُ الخامسةُ):
 * الاختبارُ يُثبتُ العقدَ لا أنّهُ يستطيعُ التوقيعَ بأيِّ صلاحيّةٍ تمرُّ.
 */
function testSigner(method: string, path: string): Record<string, string> {
  return createServiceRequestSigner({
    serviceName: "matching",
    audience: "geography",
    keys: new ServiceAuthKeyRegistry({
      keys: [{ kid: "test-active", secret: "matching-test-secret-0123456789ab", status: "active" }],
      activeKid: "test-active",
    }),
    scopes: MATCHING_GEOGRAPHY_SCOPES,
  })(method, path);
}

const ZONE_ID = "11111111-1111-4111-8111-111111111111";
const COUNTRY_ID = "22222222-2222-4222-8222-222222222222";
const REGION_ID = "33333333-3333-4333-8333-333333333333";
const CITY_ID = "44444444-4444-4444-8444-444444444444";
const DISTRICT_ID = "55555555-5555-4555-8555-555555555555";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("HttpZoneHierarchy", () => {
  it("يبني نسب المنطقة من path في رد الجغرافيا", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: ZONE_ID,
      path: { country: { id: COUNTRY_ID }, region: { id: REGION_ID }, city: { id: CITY_ID }, district: { id: DISTRICT_ID } },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new HttpZoneHierarchy({ baseUrl: "http://geo:8081", signRequest: testSigner }).resolve([ZONE_ID]);
    expect(result.get(ZONE_ID)).toEqual({ zoneId: ZONE_ID, countryId: COUNTRY_ID, regionId: REGION_ID, cityId: CITY_ID, districtId: DISTRICT_ID });
    expect(fetchMock).toHaveBeenCalledWith(`http://geo:8081/geo/zones/${ZONE_ID}`, expect.objectContaining({ method: "GET" }));
    // النداءُ موقَّعٌ برمزٍ جمهورُهُ `geography` وصلاحيّتُهُ المعلنةُ وحدَها.
    const init = fetchMock.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
    const token = init.headers["x-wasla-service-auth"];
    expect(typeof token).toBe("string");
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { aud?: string; scp?: string[] };
    expect(payload.aud).toBe("geography");
    expect(payload.scp).toEqual([...MATCHING_GEOGRAPHY_SCOPES]);
  });

  it("لا يضيف 404 إلى الخريطة", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    const result = await new HttpZoneHierarchy({ signRequest: testSigner }).resolve([ZONE_ID]);
    expect(result.has(ZONE_ID)).toBe(false);
  });

  it("يعامل خطأ النقل أو الاستجابة غير الناجحة كعدم إتاحة", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(new HttpZoneHierarchy({ signRequest: testSigner }).resolve([ZONE_ID])).rejects.toMatchObject({ code: "MATCHING_UNAVAILABLE" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await expect(new HttpZoneHierarchy({ signRequest: testSigner }).resolve([ZONE_ID])).rejects.toMatchObject({ code: "MATCHING_UNAVAILABLE" });
  });
  it("يلغي الطلب عند انقضاء المهلة الصارمة", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = new HttpZoneHierarchy({ timeoutMs: 25, signRequest: testSigner }).resolve([ZONE_ID]);
    const rejected = expect(pending).rejects.toMatchObject({ code: "MATCHING_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

});
