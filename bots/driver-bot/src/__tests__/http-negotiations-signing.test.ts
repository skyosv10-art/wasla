/**
 * إثباتُ **توقيعِ** عميلِ المفاوضاتِ في بوتِ السائقِ (`M1-04` · المراجعةُ 26/N).
 *
 * ولماذا ملفٌّ مستقلٌّ لا سطرٌ في `negotiation-flows.test.ts`: تلكَ المجموعةُ
 * تُثبتُ **الانسيابَ** بميناءٍ مزدوجٍ لا HTTP، فلو أُثبِتَ التوقيعُ فيها لما
 * أثبتَ شيئاً — الميناءُ المزدوجُ لا يُوقِّعُ ولا يُفترضُ أن يُوقِّعَ.
 *
 * وما يُقاسُ هنا ثلاثةٌ لا واحدٌ:
 * 1. أنَّ الرمزَ يُرسَلُ فعلاً، وجمهورُهُ `negotiations`، وصلاحيّاتُهُ **هيَ
 *    المُعلَنةُ للعميلِ** لا أوسعُ.
 * 2. أنَّ **الربطَ يحملُ سلسلةَ الاستفسارِ** كما يحملُها النداءُ — فالضمُّ
 *    مركزيٌّ في `canonicalRequestBinding` والفاحصُ يضمُّ بالدالّةِ نفسِها
 *    (`ADR-036` · `wsvc3`)، وهذا يُقاسُ لا يُفترضُ.
 *    [إضافةٌ 2026-09-17] وكانَ هذا البندُ يقيسُ العكسَ (`ADR-021 §4`: الربطُ بلا
 *    استعلامٍ)، وهوَ ما سجَّلَهُ `RISK-0026`: رمزُ قراءةِ خيطٍ كانَ يُعادُ استعمالُهُ
 *    لسردِ خيوطِ غيرِ صاحبِهِ. فالمقياسُ انقلبَ لأنَّ الحكمَ انقلبَ، لا لأنَّهُ لُيِّنَ.
 * 3. أنَّ مُوقِّعاً يرفضُ يُخرِجُ **عطلَ تركيبٍ** لا `DEPENDENCY_UNAVAILABLE`،
 *    كي لا يُقرأَ نسيانُ المفاتيحِ عندَنا بوصفِهِ خدمةَ مفاوضاتٍ ساقطةً.
 */

import {
  createServiceRequestSigner,
  refusingServiceRequestSigner,
  ServiceAuthKeyRegistry,
} from "@wasla/service-auth";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DRIVER_BOT_NEGOTIATIONS_SCOPES,
  HttpDriverNegotiations,
} from "../infrastructure/http-negotiations.js";

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const DRIVER_ID = "WS-3000000001";
const BASE = "http://negotiations:8086";

/** موقِّعُ اختبارٍ بالصلاحيّةِ المُعلَنةِ لهذا العميلِ وحدَها. */
function testSigner(method: string, path: string): Record<string, string> {
  return createServiceRequestSigner({
    serviceName: "driver-bot",
    audience: "negotiations",
    keys: new ServiceAuthKeyRegistry({
      keys: [
        { kid: "test-active", secret: "driver-bot-test-secret-012345678", status: "active" },
      ],
      activeKid: "test-active",
    }),
    scopes: DRIVER_BOT_NEGOTIATIONS_SCOPES,
  })(method, path);
}

function client(signRequest = testSigner): HttpDriverNegotiations {
  return new HttpDriverNegotiations({ baseUrl: BASE, signRequest });
}

interface TokenClaims {
  readonly aud?: string;
  readonly svc?: string;
  readonly scp?: readonly string[];
  /** الربطُ بالطلبِ: `<METHOD> <path>` بلا سلسلةِ استفسارٍ. */
  readonly req?: string;
}

function claimsOf(mock: ReturnType<typeof vi.fn>): TokenClaims {
  const init = mock.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
  const token = init.headers["x-wasla-service-auth"];
  expect(typeof token).toBe("string");
  return JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
  ) as TokenClaims;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpDriverNegotiations — التوقيع", () => {
  it("يوقّع سرد الخيوط بالمسار مع سلسلة الاستفسار مضمومةً إلى الربط", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ threads: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await client().listThreads({ driverPublicId: DRIVER_ID, traceId: "t-1" });

    // النداءُ يحملُ السلسلةَ — والرمزُ يحملُها معهُ (`ADR-036`).
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/negotiations?driverPublicId=${DRIVER_ID}`);
    const claims = claimsOf(fetchMock);
    expect(claims.aud).toBe("negotiations");
    expect(claims.req).toBe(`GET /negotiations?driverPublicId=${DRIVER_ID}`);
    expect(claims.svc).toBe("driver-bot");
    expect(claims.scp).toEqual([...DRIVER_BOT_NEGOTIATIONS_SCOPES]);
  });

  it("يوقّع القبول بمسار الدور نفسه وبطريقة POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await client().accept({
      threadId: THREAD_ID,
      expectedRoundNo: 3,
      actingParty: "driver",
      idempotencyKey: "idem-accept-0000001",
      traceId: "t-2",
    });

    const claims = claimsOf(fetchMock);
    expect(claims.req).toBe(`POST /negotiations/${THREAD_ID}/rounds/3/accept`);
    // القبولُ يحتاجُ `round:decide`، وهيَ في المُعلَنِ لبوتِ السائقِ.
    expect(claims.scp).toContain("negotiations:round:decide");
  });

  it("لا يطلب صلاحية كتابةٍ أو نبضةٍ لا يحتاجها", () => {
    // الحصرُ مقصودٌ: رمزٌ أوسعُ من الحاجةِ يُوسِّعُ أثرَ سرقتِهِ بلا مقابلٍ.
    expect(DRIVER_BOT_NEGOTIATIONS_SCOPES).not.toContain("negotiations:thread:write");
    expect(DRIVER_BOT_NEGOTIATIONS_SCOPES).not.toContain("negotiations:round:write");
    expect(DRIVER_BOT_NEGOTIATIONS_SCOPES).not.toContain("negotiations:tick:run");
  });

  it("موقّعٌ يرفض يُخرج عطل تركيبٍ لا عطل الطرف الآخر، ولا نداءَ أصلاً", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const refusing = client(refusingServiceRequestSigner("لا مفاتيحَ في البيئةِ."));

    await expect(
      refusing.listThreads({ driverPublicId: DRIVER_ID, traceId: "t-3" }),
    ).rejects.toThrow(/لا يمكن توقيعُ نداءٍ صادرٍ/u);
    // ولا نداءَ خرجَ: خدمةٌ لا تُنادى بلا هويّةٍ فلا تُرَدُّ 401 ولا تُحسَبُ عطلاً لها.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
