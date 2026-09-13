/**
 * إثباتُ **توقيعِ** عميلِ المفاوضاتِ في بوتِ العميلِ (`M1-04` · المراجعةُ 26/N).
 *
 * ولماذا ملفٌّ مستقلٌّ لا سطرٌ في `negotiation-flows.test.ts`: تلكَ المجموعةُ
 * تُثبتُ **الانسيابَ** بميناءٍ مزدوجٍ لا HTTP، فلو أُثبِتَ التوقيعُ فيها لما
 * أثبتَ شيئاً — الميناءُ المزدوجُ لا يُوقِّعُ ولا يُفترضُ أن يُوقِّعَ.
 *
 * وما يُقاسُ هنا ثلاثةٌ لا واحدٌ:
 * 1. أنَّ الرمزَ يُرسَلُ فعلاً، وجمهورُهُ `negotiations`، وصلاحيّاتُهُ **هيَ
 *    المُعلَنةُ للعميلِ** لا أوسعُ.
 * 2. أنَّ **الربطَ لا يحملُ سلسلةَ الاستفسارِ** مع أنَّ النداءَ يحملُها —
 *    فالقطعُ مركزيٌّ في `canonicalRequestBinding` والفاحصُ يقطعُ بالدالّةِ
 *    نفسِها (ADR-021 §4)، وهذا يُقاسُ لا يُفترضُ.
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
  CUSTOMER_BOT_NEGOTIATIONS_SCOPES,
  HttpCustomerNegotiations,
} from "../infrastructure/http-negotiations.js";

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "ORD-1000000001";
const BASE = "http://negotiations:8086";

/** موقِّعُ اختبارٍ بالصلاحيّةِ المُعلَنةِ للعميلِ وحدَها. */
function testSigner(method: string, path: string): Record<string, string> {
  return createServiceRequestSigner({
    serviceName: "customer-bot",
    audience: "negotiations",
    keys: new ServiceAuthKeyRegistry({
      keys: [
        { kid: "test-active", secret: "customer-bot-test-secret-01234567", status: "active" },
      ],
      activeKid: "test-active",
    }),
    scopes: CUSTOMER_BOT_NEGOTIATIONS_SCOPES,
  })(method, path);
}

function client(signRequest = testSigner): HttpCustomerNegotiations {
  return new HttpCustomerNegotiations({ baseUrl: BASE, signRequest });
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

describe("HttpCustomerNegotiations — التوقيع", () => {
  it("يوقّع سرد الخيوط بالمسار بلا سلسلة استفسار", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ threads: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await client().listThreads({ orderPublicId: ORDER_ID, traceId: "t-1" });

    // النداءُ نفسُهُ يحملُ السلسلةَ — والرمزُ لا.
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/negotiations?orderPublicId=${ORDER_ID}`);
    const claims = claimsOf(fetchMock);
    expect(claims.aud).toBe("negotiations");
    expect(claims.req).toBe("GET /negotiations");
    expect(claims.svc).toBe("customer-bot");
    expect(claims.scp).toEqual([...CUSTOMER_BOT_NEGOTIATIONS_SCOPES]);
  });

  it("يوقّع القبول بمسار الدور نفسه وبطريقة POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await client().accept({
      threadId: THREAD_ID,
      expectedRoundNo: 3,
      actingParty: "customer",
      idempotencyKey: "idem-accept-0000001",
      traceId: "t-2",
    });

    const claims = claimsOf(fetchMock);
    expect(claims.req).toBe(`POST /negotiations/${THREAD_ID}/rounds/3/accept`);
    // القبولُ يحتاجُ `round:decide`، وهيَ في المُعلَنِ للعميلِ.
    expect(claims.scp).toContain("negotiations:round:decide");
  });

  it("لا يطلب صلاحية كتابةٍ أو نبضةٍ لا يحتاجها", () => {
    // الحصرُ مقصودٌ: رمزٌ أوسعُ من الحاجةِ يُوسِّعُ أثرَ سرقتِهِ بلا مقابلٍ.
    expect(CUSTOMER_BOT_NEGOTIATIONS_SCOPES).not.toContain("negotiations:thread:write");
    expect(CUSTOMER_BOT_NEGOTIATIONS_SCOPES).not.toContain("negotiations:round:write");
    expect(CUSTOMER_BOT_NEGOTIATIONS_SCOPES).not.toContain("negotiations:tick:run");
  });

  it("موقّعٌ يرفض يُخرج عطل تركيبٍ لا عطل الطرف الآخر، ولا نداءَ أصلاً", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const refusing = client(refusingServiceRequestSigner("لا مفاتيحَ في البيئةِ."));

    await expect(
      refusing.listThreads({ orderPublicId: ORDER_ID, traceId: "t-3" }),
    ).rejects.toThrow(/لا يمكن توقيعُ نداءٍ صادرٍ/u);
    // ولا نداءَ خرجَ: خدمةٌ لا تُنادى بلا هويّةٍ فلا تُرَدُّ 401 ولا تُحسَبُ عطلاً لها.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
