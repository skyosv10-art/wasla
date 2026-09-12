/**
 * `Retry-After` — الخريطةُ الخالصةُ ثمَّ الترويسةُ على السلكِ
 * (المراجعةُ 19/N · ADR-026 §4.21 · رفعُ دَينِ §4.10-1).
 *
 * الدعاوى هنا ليست عن شكلِ ترويسةٍ بل عن **صدقِ وعدٍ**:
 *
 *   1. الرمزُ الوحيدُ الذي قِيسَت إعادتُهُ يحملُ `1`، وكلُّ رمزٍ آخرَ لا يحملُ شيئاً
 *      **بالبناءِ** — فرمزٌ قادمٌ يبدأُ صامتاً لا واعداً بما لم يُقَسْ.
 *   2. القيمُ المُعلَنةُ أعدادٌ صحيحةٌ موجبةٌ: `1.5` ترويسةٌ يرفضُها RFC 9110
 *      §10.2.3 (`delay-seconds = 1*DIGIT`)، و`0` أمرٌ بالدَّوَرانِ.
 *   3. **الجسمُ لم يتغيَّرْ**: ثلاثةُ حقولٍ لا أربعةٌ — الترويسةُ سطحُ نقلٍ لا
 *      حقلُ عقدٍ.
 *   4. المُزاحِمانِ الأقربانِ صامتانِ: `DELIVERY_IDEMPOTENCY_KEY_REUSED` (إعادةٌ
 *      لن تنجحَ أبداً) و`DELIVERY_CONCURRENT_UPDATE` (الصوابُ قراءةٌ ثمَّ قرارٌ لا
 *      إعادةٌ) — وهما 409 كالأوّلِ، فلو كانَ الوصلُ بالحالِ لا بالرمزِ لَنطقا.
 *   5. **العطلُ لا يَعِدُ**: 503 تبعيّةٍ و500 غيرِ مُصنَّفٍ بلا ترويسةٍ، وأوّلُهما
 *      هوَ الحالُ الذي كُتِبَت لهُ الترويسةُ في المعيارِ — فالصمتُ هنا قرارٌ
 *      مكتوبٌ لا إغفالٌ.
 */

import { describe, expect, it } from "vitest";

import { createSignedDeliveryApp } from "./service-identity-support.js";
import {
  CUSTOMER_REF,
  FakeCatalog,
  FakeReservationPort,
  FakeReservationStore,
  FakeStoreOrderStore,
  PRODUCT_A,
  STORE_SLUG,
  uuidSequence,
} from "./store-order-fakes.js";
import { DeliveryError } from "../domain/errors.js";
import {
  DELIVERY_IN_FLIGHT_RETRY_AFTER_SECONDS,
  declaredRetryAfterSeconds,
  retryAfterSecondsForDeliveryError,
} from "../http/retry-after.js";
import { DELIVERY_ERROR_CODES } from "@wasla/contracts-delivery";

const NOW = "2026-09-12T12:00:00.000Z";

describe("retry-after — الخريطةُ الخالصةُ", () => {
  it("رفضُ التماثُلِ المتزامنِ وحدَهُ يحملُ مَهَلاً، وقيمتُهُ ثانيةٌ واحدةٌ", () => {
    const error = new DeliveryError("DELIVERY_IDEMPOTENT_REQUEST_IN_FLIGHT", "قيدَ معاملةٍ أخرى");
    expect(retryAfterSecondsForDeliveryError(error)).toBe(1);
    expect(DELIVERY_IN_FLIGHT_RETRY_AFTER_SECONDS).toBe(1);
  });

  it("كلُّ رمزٍ آخرَ في الكتالوجِ صامتٌ — لا استثناءَ واحدٌ منسيٌّ", () => {
    const speaking = DELIVERY_ERROR_CODES.filter(
      (code) => retryAfterSecondsForDeliveryError(new DeliveryError(code, "x")) !== null,
    );
    // قائمةٌ صريحةٌ لا عَدٌّ: مَن أضافَ رمزاً ناطقاً يُعلِنُهُ هنا ومعَهُ ما قاسَ.
    expect(speaking).toEqual(["DELIVERY_IDEMPOTENT_REQUEST_IN_FLIGHT"]);
  });

  it("المُزاحِمانِ الأقربانِ صامتانِ ولو كانا 409 نفسَهُ", () => {
    for (const code of ["DELIVERY_IDEMPOTENCY_KEY_REUSED", "DELIVERY_CONCURRENT_UPDATE"] as const) {
      const error = new DeliveryError(code, "x");
      expect(error.httpStatus).toBe(409);
      expect(retryAfterSecondsForDeliveryError(error)).toBeNull();
    }
  });

  it("العطلُ لا يَعِدُ: تبعيّةٌ غيرُ متاحةٍ وخطأٌ غيرُ مُصنَّفٍ بلا مَهَلٍ", () => {
    for (const code of [
      "DELIVERY_MARKETPLACE_UNAVAILABLE",
      "DELIVERY_DISPATCH_UNAVAILABLE",
      "DELIVERY_INTERNAL_ERROR",
    ] as const) {
      expect(retryAfterSecondsForDeliveryError(new DeliveryError(code, "x"))).toBeNull();
    }
  });

  it("ما ليسَ خطأَ توصيلٍ لا يُسأَلُ عنهُ: خطأُ إطارٍ · نصٌّ · فراغٌ", () => {
    expect(retryAfterSecondsForDeliveryError(new Error("boom"))).toBeNull();
    expect(retryAfterSecondsForDeliveryError(Object.assign(new Error("ctp"), { statusCode: 415 }))).toBeNull();
    expect(retryAfterSecondsForDeliveryError("DELIVERY_IDEMPOTENT_REQUEST_IN_FLIGHT")).toBeNull();
    expect(retryAfterSecondsForDeliveryError(null)).toBeNull();
    expect(retryAfterSecondsForDeliveryError(undefined)).toBeNull();
  });

  it("كلُّ قيمةٍ مُعلَنةٍ عددٌ صحيحٌ موجبٌ — لا `0` ولا كسرٌ ولا سالبٌ", () => {
    const values = declaredRetryAfterSeconds();
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      // ما يُكتَبُ في الترويسةِ نصّاً يجبُ أن يُطابقَ `1*DIGIT` حرفاً.
      expect(String(v)).toMatch(/^[0-9]+$/);
    }
  });
});

/** مخزنٌ يرمي رمزاً يُملِيهِ الاختبارُ من مسارِ الكتابةِ — بلا قاعدةٍ ولا تسابُقٍ. */
class ThrowingStore extends FakeStoreOrderStore {
  constructor(private readonly error: unknown) {
    super();
  }

  override async placeOrder(): Promise<never> {
    throw this.error;
  }
}

describe("retry-after — على السلكِ عبرَ مُترجِمِ الأخطاءِ الوحيدِ", () => {
  let counter = 0;

  const place = async (thrown: unknown) => {
    counter += 1;
    const store = new ThrowingStore(thrown);
    const app = createSignedDeliveryApp({
      readPort: store,
      writePort: store,
      catalogPort: new FakeCatalog(),
      reservationPort: new FakeReservationPort(),
      reservationStore: new FakeReservationStore(),
      newUuid: uuidSequence(),
      now: () => NOW,
    });
    const response = await app.fastify.inject({
      method: "POST",
      url: "/store-orders",
      headers: { "idempotency-key": `retry-after-http-${String(counter).padStart(6, "0")}` },
      payload: {
        customer_ref: CUSTOMER_REF,
        store_slug: STORE_SLUG,
        items: [{ product_id: PRODUCT_A, quantity: 1 }],
        delivery_fee_minor_units: 500,
      },
    });
    await app.close();
    return response;
  };

  it("رفضُ التماثُلِ المتزامنِ ⇒ 409 معَ `retry-after: 1`، والجسمُ ثلاثةُ حقولٍ لا أربعةٌ", async () => {
    const response = await place(
      new DeliveryError("DELIVERY_IDEMPOTENT_REQUEST_IN_FLIGHT", "المفتاحُ قيدَ معاملةٍ أخرى"),
    );
    expect(response.statusCode).toBe(409);
    expect(response.headers["retry-after"]).toBe("1");
    expect(response.json().error_code).toBe("DELIVERY_IDEMPOTENT_REQUEST_IN_FLIGHT");
    expect(Object.keys(response.json()).sort()).toEqual(["error_code", "message", "trace_id"]);
  });

  it("مفتاحٌ مُعادُ الاستعمالِ ⇒ 409 **بلا** ترويسةٍ — الفرقُ بالرمزِ لا بالحالِ", async () => {
    const response = await place(
      new DeliveryError("DELIVERY_IDEMPOTENCY_KEY_REUSED", "بصمةٌ مختلفةٌ"),
    );
    expect(response.statusCode).toBe(409);
    expect(response.headers["retry-after"]).toBeUndefined();
  });

  it("503 تبعيّةٍ غيرِ متاحةٍ ⇒ بلا ترويسةٍ ولو كانَ حالَ المعيارِ الأصليَّ", async () => {
    const response = await place(
      new DeliveryError("DELIVERY_MARKETPLACE_UNAVAILABLE", "لا جوابَ من السوقِ"),
    );
    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBeUndefined();
  });

  it("عيبٌ غيرُ مُصنَّفٍ ⇒ 500 بلا ترويسةٍ — «لا تُعِدْ» يبقى «لا تُعِدْ»", async () => {
    const response = await place(new Error("boom"));
    expect(response.statusCode).toBe(500);
    expect(response.headers["retry-after"]).toBeUndefined();
  });
});
