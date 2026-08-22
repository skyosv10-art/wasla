import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpMatchingPort } from "../infrastructure/http-matching.js";
import type { CandidateRequest } from "../ports.js";

afterEach(() => vi.unstubAllGlobals());

const request = {
  orderId: "10000000-0000-4000-8000-000000000001",
  orderPublicId: "ORD-0000000001",
  zoneId: "20000000-0000-4000-8000-000000000001",
  serviceKind: "ride",
  vehicleClass: "sedan",
  limit: 2,
  excludedDriverPublicIds: [],
  dispatchJobId: "30000000-0000-4000-8000-000000000001",
} as CandidateRequest;

describe("محول المطابقة", () => {
  it("يرسل استعلام المرشحين كاملاً بلا مفتاح تكرار ويقبل القائمة الفارغة", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ decision_id: "d", ruleset_version: 1, evaluated_at: "2026-01-01T00:00:00.000Z", candidates: [], counts: { considered: 0, eligible: 0, returned: 0 }, empty_reason_code: "NO_AVAILABLE_DRIVERS" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new HttpMatchingPort({ baseUrl: "http://matching.test" }).candidates(request);
    expect(result.emptyReasonCode).toBe("NO_AVAILABLE_DRIVERS");
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://matching.test/matching/candidates");
    expect(options.headers).toEqual({ "content-type": "application/json" });
    expect((options.headers as Record<string, string>)["idempotency-key"]).toBeUndefined();
    expect(JSON.parse(options.body as string)).toEqual({
      order_id: request.orderId,
      order_public_id: request.orderPublicId,
      order_type: request.serviceKind,
      vehicle_class: request.vehicleClass,
      pickup_zone_id: request.zoneId,
      excluded_driver_ids: request.excludedDriverPublicIds,
      limit: request.limit,
      dispatch_job_id: request.dispatchJobId,
    });
  });

  it("يرفض الجواب غير المفهوم ويعامل 404 للتوافر كفشل غير قاذف", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("{}", { status: 200 })).mockResolvedValueOnce(new Response("", { status: 404 })));
    const port = new HttpMatchingPort({ baseUrl: "http://matching.test" });
    await expect(port.candidates(request)).rejects.toMatchObject({ code: "DISPATCH_MATCHING_RESULT_INVALID" });
    await expect(port.markUnavailable("WS-0000000001", "OFFER_ACCEPTED", "2026-01-01T00:00:00.000Z")).resolves.toBeUndefined();
  });

  it("يعامل 503 من المرشحين كمنفذ غير متاح", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));

    await expect(new HttpMatchingPort({ baseUrl: "http://matching.test" }).candidates(request))
      .rejects.toMatchObject({ code: "DISPATCH_ENGINE_UNAVAILABLE" });
  });

  it("يعامل انقطاع شبكة المرشحين كمنفذ غير متاح", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("انقطاع")));

    await expect(new HttpMatchingPort({ baseUrl: "http://matching.test" }).candidates(request))
      .rejects.toMatchObject({ code: "DISPATCH_ENGINE_UNAVAILABLE" });
  });

  it("يعامل مهلة المرشحين كمنفذ غير متاح", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("مهلة"), { name: "AbortError" })));

    await expect(new HttpMatchingPort({ baseUrl: "http://matching.test", timeoutMs: 1 }).candidates(request))
      .rejects.toMatchObject({ code: "DISPATCH_ENGINE_UNAVAILABLE" });
  });

  it("يرسل تغيير توافر السائق مع مفتاح حتمي وهوية الموزع", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const port = new HttpMatchingPort({ baseUrl: "http://matching.test" });
    const changedAt = "2026-01-01T00:00:00.000Z";

    await port.markUnavailable("WS-0000000001", "OFFER_ACCEPTED", changedAt);
    await port.markUnavailable("WS-0000000001", "OFFER_ACCEPTED", changedAt);
    await port.markUnavailable("WS-0000000001", "OFFER_ACCEPTED", "2026-01-01T00:00:01.000Z");

    expect(fetchMock.mock.calls[0][0]).toBe("http://matching.test/candidacy/WS-0000000001/availability");
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      "idempotency-key": "dispatch:availability:WS-0000000001:OFFER_ACCEPTED:2026-01-01T00:00:00.000Z",
    });
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      "idempotency-key": "dispatch:availability:WS-0000000001:OFFER_ACCEPTED:2026-01-01T00:00:00.000Z",
    });
    expect(fetchMock.mock.calls[2][1].headers).toMatchObject({
      "idempotency-key": "dispatch:availability:WS-0000000001:OFFER_ACCEPTED:2026-01-01T00:00:01.000Z",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      availability_state: "busy",
      actor_type: "dispatch",
    });
  });

  it("لا يسقط قبول العرض عندما لا يجد تغيير التوافر صف المرشح", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));

    await expect(new HttpMatchingPort({ baseUrl: "http://matching.test" })
      .markUnavailable("WS-0000000001", "OFFER_ACCEPTED", "2026-01-01T00:00:00.000Z"))
      .resolves.toBeUndefined();
  });
});
