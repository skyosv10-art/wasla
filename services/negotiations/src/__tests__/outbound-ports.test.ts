/**
 * المنفذان الصادران الحقيقيان (Phase 08 · MR 5/6).
 *
 * كل اختبار هنا يحرس **حدّاً** لا تفصيلاً: الفرق بين `null` والرمي، والفرق بين `rejected`
 * والرمي، وثباتُ مفتاح التفرّد عبر المحاولات. وهذه الفروق الثلاثة هي التي تُترجَم لاحقاً
 * إلى `422` أو `503`، وإلى «الاتفاق نهائيّ الفشل» أو «أعِد المحاولة» — فخطأٌ في أيّها لا
 * يظهر عطلاً في الشبكة بل قراراً خاطئاً في المجال.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { NegotiationError } from "../domain/errors.js";
import { createServiceRequestSigner, SERVICE_AUTH_HEADER, ServiceAuthKeyRegistry } from "@wasla/service-auth";

import {
  agreedPriceIdempotencyKey,
  HttpAgreedPricePort,
  NEGOTIATIONS_ORDERS_SCOPES,
  ORDER_AGREED_PRICES_PATH,
} from "../infrastructure/http-agreed-price.js";
import {
  HttpDispatchOfferPort,
  NEGOTIATIONS_ORDER_LOOKUP_SCOPES,
} from "../infrastructure/http-dispatch-offer.js";
import {
  configuredAgreedPrice,
  configuredDispatchOffers,
  outboundFullyConfigured,
} from "../infrastructure/outbound-wiring.js";
import {
  UnconfiguredAgreedPricePort,
  UnconfiguredDispatchOfferPort,
} from "../infrastructure/runtime.js";

/** موقّع اختباري حقيقي: النداء يجب أن يحمل ترويسة يقبلها حد الطلبات (M1-04). */
const TEST_KEYS = new ServiceAuthKeyRegistry({
  keys: [{ kid: "test", secret: "negotiations-orders-secret-01234", status: "active" }],
  activeKid: "test",
});

const TEST_SIGNER = createServiceRequestSigner({
  serviceName: "negotiations",
  audience: "orders",
  keys: TEST_KEYS,
  scopes: NEGOTIATIONS_ORDERS_SCOPES,
});

/** موقّع القراءة الخدميّة: صلاحية قراءةِ طلبٍ وحدَها (M1-04). */
const TEST_LOOKUP_SIGNER = createServiceRequestSigner({
  serviceName: "negotiations",
  audience: "orders",
  keys: TEST_KEYS,
  scopes: NEGOTIATIONS_ORDER_LOOKUP_SCOPES,
});


afterEach(() => vi.unstubAllGlobals());

const OFFER_ID = "40000000-0000-4000-8000-000000000001";
const THREAD_ID = "50000000-0000-4000-8000-000000000001";

const offerBody = {
  id: OFFER_ID,
  job_id: "30000000-0000-4000-8000-000000000001",
  driver_public_id: "WS-0000000002",
  order_public_id: "ORD-0000000001",
  order_id: "10000000-0000-4000-8000-000000000001",
  order_type: "ride",
  vehicle_class: "sedan",
  status: "offered",
  job_status: "offering",
  standing: true,
};

const orderBody = {
  order_public_id: "ORD-0000000001",
  order_id: "10000000-0000-4000-8000-000000000001",
  status: "negotiating",
  price_mode: "negotiable",
  order_type: "ride",
  vehicle_class: "sedan",
  agreed_price: null,
  agreed_at: null,
  agreed_negotiation_id: null,
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const offerPort = (): HttpDispatchOfferPort =>
  new HttpDispatchOfferPort({
    signRequest: TEST_LOOKUP_SIGNER,
    dispatchBaseUrl: "http://dispatch.test",
    ordersBaseUrl: "http://orders.test/",
  });

const handOffInput = {
  orderPublicId: "ORD-0000000001",
  threadId: THREAD_ID,
  driverPublicId: "WS-0000000002",
  amountMinor: 4500,
  currency: "SAR",
  agreedAt: "2026-08-23T09:00:00.000Z",
  attemptNo: 1,
};

describe("منفذ عروض التوزيع الحقيقي", () => {
  it("يجمع اللقطة من نداءين: العرض من التوزيع ووضع السعر من محرّك الطلب", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(offerBody))
      .mockResolvedValueOnce(json(orderBody));
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await offerPort().describe(OFFER_ID);

    expect(snapshot).toEqual({
      dispatchOfferId: OFFER_ID,
      orderPublicId: "ORD-0000000001",
      driverPublicId: "WS-0000000002",
      serviceKind: "ride",
      active: true,
      negotiable: true,
    });
    const [offerUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [orderUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(offerUrl).toBe(`http://dispatch.test/dispatch/offers/${OFFER_ID}`);
    // الشرطة الأخيرة في العنوان المُهيّأ تُقطع، ولا يصير المسار `//orders`.
    expect(orderUrl).toBe("http://orders.test/orders/lookup?order_public_id=ORD-0000000001");

    // M1-04: نداء الطلب موقّع ونداء التوزيع ليس كذلك — حدُّ التوزيع لم يُفرَض بعد،
    // ورمزٌ جمهورُه `orders` يُرفَض عنده على أي حال، فإرساله إليه توسيعُ أثرٍ بلا فائدة.
    const [, offerInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, orderInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((orderInit.headers as Record<string, string>)[SERVICE_AUTH_HEADER]).toMatch(
      /^wsvc2\./u,
    );
    expect((offerInit.headers as Record<string, string>)[SERVICE_AUTH_HEADER]).toBeUndefined();
  });

  it("لا يرسل مفتاح تكرار على قراءة", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(offerBody))
      .mockResolvedValueOnce(json(orderBody));
    vi.stubGlobal("fetch", fetchMock);

    await offerPort().describe(OFFER_ID);

    for (const call of fetchMock.mock.calls) {
      const [, options] = call as [string, RequestInit];
      expect(options.method).toBe("GET");
      expect((options.headers as Record<string, string>)["idempotency-key"]).toBeUndefined();
    }
  });

  it("يُميّز عرضاً غير قائم عن عرضٍ قائم، ويأخذ `active` من `standing` لا من موعد", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ ...offerBody, status: "expired", standing: false }))
        .mockResolvedValueOnce(json(orderBody)),
    );

    const snapshot = await offerPort().describe(OFFER_ID);

    expect(snapshot?.active).toBe(false);
  });

  it("يقرأ وضع سعرٍ غير تفاوضي على أنّه غير قابل للتفاوض بلا رفضٍ من عنده", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json(offerBody))
        .mockResolvedValueOnce(json({ ...orderBody, price_mode: "customer_offer" })),
    );

    const snapshot = await offerPort().describe(OFFER_ID);

    // القرار ليس هنا: المنفذ يصف، وحالة الاستخدام هي التي تُجيب 422.
    expect(snapshot?.negotiable).toBe(false);
  });

  it("يُعيد null لعرضٍ مجهول ولا يسأل محرّك الطلب عن طلبٍ لا عرضَ له", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await offerPort().describe(OFFER_ID)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("يُعيد null حين لا يعرف محرّك الطلب المعرّف العام", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json(offerBody))
        .mockResolvedValueOnce(new Response("", { status: 404 })),
    );

    expect(await offerPort().describe(OFFER_ID)).toBeNull();
  });

  it("يرمي NEGOTIATION_UNAVAILABLE على انقطاعٍ أو 5xx، ولا يُعيد null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(offerPort().describe(OFFER_ID)).rejects.toBeInstanceOf(NegotiationError);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(offerPort().describe(OFFER_ID)).rejects.toMatchObject({
      code: "NEGOTIATION_UNAVAILABLE",
    });
  });

  it("يرمي على مهلةٍ منقضية", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      ),
    );

    const port = new HttpDispatchOfferPort({
      signRequest: TEST_LOOKUP_SIGNER,
      dispatchBaseUrl: "http://dispatch.test",
      ordersBaseUrl: "http://orders.test",
      timeoutMs: 5,
    });

    await expect(port.describe(OFFER_ID)).rejects.toMatchObject({
      code: "NEGOTIATION_UNAVAILABLE",
    });
  });

  it("يرمي على جسمٍ لا يوافق العقد بدل أن يقرأه عرضاً غير موجود", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ id: OFFER_ID })));
    await expect(offerPort().describe(OFFER_ID)).rejects.toMatchObject({
      code: "NEGOTIATION_UNAVAILABLE",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ ...offerBody, order_type: "haulage" })),
    );
    await expect(offerPort().describe(OFFER_ID)).rejects.toMatchObject({
      code: "NEGOTIATION_UNAVAILABLE",
    });

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json(offerBody))
        .mockResolvedValueOnce(json({ order_public_id: "ORD-0000000001" })),
    );
    await expect(offerPort().describe(OFFER_ID)).rejects.toMatchObject({
      code: "NEGOTIATION_UNAVAILABLE",
    });
  });
});

describe("منفذ تسليم السعر الحقيقي", () => {
  it("يُرسل الحمولة كاملة بمفتاح تفرّدٍ مبنيّ على الخيط، ويقرأ 201 قبولاً", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ order_public_id: "ORD-0000000001" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new HttpAgreedPricePort({ baseUrl: "http://orders.test", signRequest: TEST_SIGNER }).handOff(
      handOffInput,
      { traceId: "trace-1" },
    );

    expect(result).toEqual({ outcome: "accepted", responseStatus: 201, errorCode: null });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://orders.test${ORDER_AGREED_PRICES_PATH}`);
    expect(options.method).toBe("POST");
    expect(options.headers).toMatchObject({
      "content-type": "application/json",
      "idempotency-key": agreedPriceIdempotencyKey(THREAD_ID),
      "x-request-id": "trace-1",
    });
    // M1-04: حد الطلبات يفرض الهوية، فنداء بلا ترويسة يُرَدّ 401.
    expect((options.headers as Record<string, string>)[SERVICE_AUTH_HEADER]).toMatch(/^wsvc2\./u);
    expect(JSON.parse(options.body as string)).toEqual({
      order_public_id: "ORD-0000000001",
      negotiation_id: THREAD_ID,
      driver_public_id: "WS-0000000002",
      amount_minor: 4500,
      currency: "SAR",
      agreed_at: "2026-08-23T09:00:00.000Z",
    });
  });

  it("مفتاح التفرّد لا يتغيّر برقم المحاولة — وإلّا سُجّل سعرٌ مرّتين", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}, 200));
    vi.stubGlobal("fetch", fetchMock);
    const port = new HttpAgreedPricePort({ baseUrl: "http://orders.test", signRequest: TEST_SIGNER });

    await port.handOff(handOffInput);
    await port.handOff({ ...handOffInput, attemptNo: 4 });

    const keys = fetchMock.mock.calls.map(
      (call) => ((call as [string, RequestInit])[1].headers as Record<string, string>)[
        "idempotency-key"
      ],
    );
    expect(keys).toEqual([
      agreedPriceIdempotencyKey(THREAD_ID),
      agreedPriceIdempotencyKey(THREAD_ID),
    ]);
  });

  it("يقرأ 200 قبولاً كما يقرأ 201: إعادةٌ ناجحة ليست عطلاً", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 200)));

    const result = await new HttpAgreedPricePort({ baseUrl: "http://orders.test", signRequest: TEST_SIGNER }).handOff(
      handOffInput,
    );

    expect(result).toEqual({ outcome: "accepted", responseStatus: 200, errorCode: null });
  });

  it("لا يُرسل x-request-id حين لا يوجد أثر", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}, 201));
    vi.stubGlobal("fetch", fetchMock);

    await new HttpAgreedPricePort({ baseUrl: "http://orders.test", signRequest: TEST_SIGNER }).handOff(handOffInput, {
      traceId: null,
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["x-request-id"]).toBeUndefined();
  });

  it("يُسجّل 409 و422 رفضاً نهائياً بالرمز الذي جاء", async () => {
    for (const status of [409, 422]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(json({ code: "ORDER_PRICE_NOT_NEGOTIABLE" }, status)),
      );

      const result = await new HttpAgreedPricePort({ baseUrl: "http://orders.test", signRequest: TEST_SIGNER }).handOff(
        handOffInput,
      );

      expect(result).toEqual({
        outcome: "rejected",
        responseStatus: status,
        errorCode: "ORDER_PRICE_NOT_NEGOTIABLE",
      });
    }
  });

  it("رفضٌ بلا رمزٍ مقروء يبقى رفضاً: قرارٌ وقع، ورمزه تفصيل", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 422 })));

    const result = await new HttpAgreedPricePort({ baseUrl: "http://orders.test", signRequest: TEST_SIGNER }).handOff(
      handOffInput,
    );

    expect(result).toEqual({ outcome: "rejected", responseStatus: 422, errorCode: null });
  });

  it("يرمي على 5xx وعلى الانقطاع وعلى 404 — ولا يُعيد rejected", async () => {
    for (const status of [500, 503, 404]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status })));
      await expect(
        new HttpAgreedPricePort({ baseUrl: "http://orders.test", signRequest: TEST_SIGNER }).handOff(handOffInput),
      ).rejects.toBeInstanceOf(Error);
    }

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(
      new HttpAgreedPricePort({ baseUrl: "http://orders.test", signRequest: TEST_SIGNER }).handOff(handOffInput),
    ).rejects.toBeInstanceOf(Error);
  });

  it("ما يرميه ليس NegotiationError: لا رمز منشور لفشل التسليم (ADR-013 القرار 2)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));

    await expect(
      new HttpAgreedPricePort({ baseUrl: "http://orders.test", signRequest: TEST_SIGNER }).handOff(handOffInput),
    ).rejects.not.toBeInstanceOf(NegotiationError);
  });
});

describe("توصيل المنافذ الصادرة من البيئة", () => {
  const silent = (): void => undefined;

  /** بيئة كاملة: عنوانان ومفاتيح هوية خدمة — لأن المنفذ الحقيقي صار موقِّعاً. */
  const fullEnv = {
    DISPATCH_SERVICE_URL: "http://dispatch.test",
    ORDERS_SERVICE_URL: "http://orders.test",
    WASLA_SERVICE_AUTH_KEYS: "test:active:negotiations-orders-secret-01234",
    WASLA_SERVICE_AUTH_ACTIVE_KID: "test",
  };

  it("عنوانٌ موصولٌ بلا مفاتيح ⇒ إخفاقٌ عند الإقلاع لا نداءٌ يُرَدّ 401 (M1-04)", () => {
    // منفذٌ حقيقيٌّ بلا موقّع كان سيُنادي بلا هوية، فيُقرأ الردُّ عطلَ محرّكِ
    // الطلبات لا نقصَ إعدادٍ هنا. والرمي عند التوصيل يسمّي العلة في موضعها.
    expect(() =>
      configuredAgreedPrice({ ORDERS_SERVICE_URL: "http://orders.test" }, silent),
    ).toThrow(/WASLA_SERVICE_AUTH_KEYS/u);
  });

  it("العنوانان موجودان ⇒ المنفذان الحقيقيان", () => {
    const env = fullEnv;

    expect(configuredDispatchOffers(env, silent)).toBeInstanceOf(HttpDispatchOfferPort);
    expect(configuredAgreedPrice(env, silent)).toBeInstanceOf(HttpAgreedPricePort);
    expect(outboundFullyConfigured(env)).toBe(true);
  });

  it("عنوان التوزيع وحده لا يكفي للقطة، ويُسمّى المتغيّر الناقص في الملاحظة", () => {
    const messages: string[] = [];

    const port = configuredDispatchOffers(
      { DISPATCH_SERVICE_URL: "http://dispatch.test" },
      (message) => messages.push(message),
    );

    expect(port).toBeInstanceOf(UnconfiguredDispatchOfferPort);
    expect(messages[0]).toContain("ORDERS_SERVICE_URL");
    expect(messages[0]).not.toContain("DISPATCH_SERVICE_URL");
  });

  it("عنوانٌ فارغٌ نصّاً يُعَدّ غائباً ولا يُبنى منه محوّل", () => {
    const env = { DISPATCH_SERVICE_URL: "   ", ORDERS_SERVICE_URL: "" };

    expect(configuredDispatchOffers(env, silent)).toBeInstanceOf(UnconfiguredDispatchOfferPort);
    expect(configuredAgreedPrice(env, silent)).toBeInstanceOf(UnconfiguredAgreedPricePort);
    expect(outboundFullyConfigured(env)).toBe(false);
  });

  it("غيابُ محرّك الطلب لا يُعلن توقّف التفاوض بل بقاء الاتفاقات غير مُسلَّمة", () => {
    const messages: string[] = [];

    configuredAgreedPrice({ DISPATCH_SERVICE_URL: "http://dispatch.test" }, (message) =>
      messages.push(message),
    );

    expect(messages[0]).toContain("ORDERS_SERVICE_URL");
    expect(messages[0]).toContain("handoff_state=pending");
  });
});
