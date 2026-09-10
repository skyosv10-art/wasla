/**
 * مرآةُ الدفعِ والتأكيدُ — المراجعةُ 9/N (ADR-026 §2.2 · §3.2).
 *
 * هذهِ الاختباراتُ تُثبِتُ ما لم يكن قابلاً للإثباتِ قبلَ 9/N: أنَّ `payment_state`
 * تتحرَّكُ فعلاً، وأنَّ `placed → confirmed` قابلٌ للوصولِ عبرَ الشبكةِ. وقبلَها كانَ
 * `storeOrderPaymentStateChangedEvent` و`canConfirmOrder` مكتوبَينِ **بلا نداءٍ**
 * — أي منطقٌ صحيحٌ لا يُشغِّلُهُ شيءٌ، وهو أخطرُ من منطقٍ خاطئٍ لأنَّهُ يُقرَأُ كأنَّهُ
 * يعملُ.
 *
 * وما تحرسُهُ الحالاتُ أدناه بالتحديدِ:
 *
 *  - إعلانٌ مُعادٌ (webhook مُكرَّرٌ) لا يُنشئُ حدثاً ثانياً — ولا يُرفَضُ 409.
 *  - نفسُ الحالةِ بمرجعٍ مختلفٍ تُرفَضُ: نيّتانِ ماليّتانِ لطلبٍ واحدٍ.
 *  - سببٌ لا يصفُ حافّتَهُ يُرفَضُ 400 قبلَ أن يدخلَ دفتراً append-only.
 *  - التأكيدُ يرفضُ الدفعَ غيرَ المُخوَّلِ 409 لا 200.
 */

import { describe, expect, it } from "vitest";

import { buildDeliveryHttpApp } from "../http/app.js";
import { decidePaymentMirror } from "../domain/payment-mirror.js";
import { decideConfirmation } from "../domain/store-order-confirmation.js";
import { DeliveryError } from "../domain/errors.js";
import { FakeCatalog, FakeStoreOrderStore, fixedOrder, fixedTask, uuidSequence } from "./store-order-fakes.js";

const NOW = "2026-09-10T10:00:00.000Z";

let keyCounter = 0;
function keyHeaders(): Record<string, string> {
  keyCounter += 1;
  return { "idempotency-key": `mirror-test-key-${String(keyCounter).padStart(6, "0")}` };
}

function buildApp(seed = fixedOrder()) {
  const store = new FakeStoreOrderStore();
  store.seed(seed, fixedTask());
  const app = buildDeliveryHttpApp({
    readPort: store,
    writePort: store,
    catalogPort: new FakeCatalog(),
    newUuid: uuidSequence(),
    now: () => NOW,
  });
  return { app, store };
}

function mirror(body: Record<string, unknown>, publicId = "WS-0000000001") {
  return {
    method: "PUT" as const,
    url: `/store-orders/${publicId}/payment-mirror`,
    headers: keyHeaders(),
    payload: body,
  };
}

describe("مرآةُ الدفعِ — النطاقُ", () => {
  it("تُجيزُ pending → authorized بسببِ الحافّةِ وتحملُ المرجعَ الجديدَ", () => {
    const decision = decidePaymentMirror(fixedOrder(), {
      paymentState: "authorized",
      reasonCode: "AUTHORIZATION_SUCCEEDED",
      paymentRef: "pay_ref_001",
    });
    expect(decision).toEqual({
      kind: "apply",
      fromState: "pending",
      toState: "authorized",
      reasonCode: "AUTHORIZATION_SUCCEEDED",
      nextPaymentRef: "pay_ref_001",
    });
  });

  it("إعلانٌ مُعادٌ بنفسِ الحالةِ ونفسِ المرجعِ = لا أثرَ (لا 409)", () => {
    const order = fixedOrder({ paymentState: "authorized", paymentRef: "pay_ref_001" });
    const decision = decidePaymentMirror(order, {
      paymentState: "authorized",
      reasonCode: "AUTHORIZATION_SUCCEEDED",
      paymentRef: "pay_ref_001",
    });
    expect(decision).toEqual({ kind: "noop", state: "authorized" });
  });

  it("حقلٌ مفقودٌ للمرجعِ في إعلانٍ مُعادٍ لا يمسحُ المرجعَ المحفوظَ", () => {
    const order = fixedOrder({ paymentState: "authorized", paymentRef: "pay_ref_001" });
    // لا `paymentRef`: «لا جديدَ عندي» — والقرارُ يبقى noop لأنَّ المرجعَ لم يتغيَّر.
    const decision = decidePaymentMirror(order, {
      paymentState: "authorized",
      reasonCode: "AUTHORIZATION_SUCCEEDED",
    });
    expect(decision).toEqual({ kind: "noop", state: "authorized" });
  });

  it("نفسُ الحالةِ بمرجعٍ مختلفٍ تُرفَضُ 409 — نيّتانِ ماليّتانِ لطلبٍ واحدٍ", () => {
    const order = fixedOrder({ paymentState: "authorized", paymentRef: "pay_ref_001" });
    try {
      decidePaymentMirror(order, {
        paymentState: "authorized",
        reasonCode: "AUTHORIZATION_SUCCEEDED",
        paymentRef: "pay_ref_OTHER",
      });
      throw new Error("كانَ يجبُ أن يُرفَضَ");
    } catch (error) {
      expect(error).toBeInstanceOf(DeliveryError);
      const failure = error as DeliveryError;
      expect(failure.code).toBe("DELIVERY_TRANSITION_NOT_ALLOWED");
      expect(failure.details?.field).toBe("payment_ref");
    }
  });

  it("حافّةٌ غيرُ موجودةٍ (authorized → refunded) تُرفَضُ", () => {
    const order = fixedOrder({ paymentState: "authorized" });
    expect(() =>
      decidePaymentMirror(order, { paymentState: "refunded", reasonCode: "REFUND_COMPLETED" }),
    ).toThrowError(/غير مذكور في جداول/);
  });

  it("سببٌ لا يصفُ الحافّةَ يُرفَضُ 400 قبلَ الدفترِ", () => {
    try {
      decidePaymentMirror(fixedOrder(), {
        paymentState: "authorized",
        reasonCode: "REFUND_COMPLETED",
      });
      throw new Error("كانَ يجبُ أن يُرفَضَ");
    } catch (error) {
      const failure = error as DeliveryError;
      expect(failure.code).toBe("DELIVERY_VALIDATION_FAILED");
      expect(failure.details?.expected).toBe("AUTHORIZATION_SUCCEEDED");
      expect(failure.details?.actual).toBe("REFUND_COMPLETED");
    }
  });

  it("`payment_ref: null` صريحاً يمسحُ المرجعَ معَ انتقالٍ مشروعٍ", () => {
    const order = fixedOrder({ paymentState: "authorized", paymentRef: "pay_ref_001" });
    const decision = decidePaymentMirror(order, {
      paymentState: "captured",
      reasonCode: "CAPTURE_SUCCEEDED",
      paymentRef: null,
    });
    expect(decision).toMatchObject({ kind: "apply", nextPaymentRef: null });
  });
});

describe("التأكيدُ — النطاقُ", () => {
  it("يُجيزُ placed معَ دفعٍ مُخوَّلٍ", () => {
    const order = fixedOrder({ paymentState: "authorized" });
    expect(decideConfirmation(order)).toEqual({ fromFulfillmentState: "placed" });
  });

  it("يرفضُ دفعاً غيرَ مُخوَّلٍ بشفرةِ الدفعِ لا بشفرةِ الطريقِ", () => {
    try {
      decideConfirmation(fixedOrder());
      throw new Error("كانَ يجبُ أن يُرفَضَ");
    } catch (error) {
      const failure = error as DeliveryError;
      expect(failure.code).toBe("DELIVERY_PAYMENT_NOT_AUTHORIZED");
      expect(failure.details?.actual).toBe("pending");
    }
  });

  it("يرفضُ طريقاً غيرَ موجودٍ قبلَ فحصِ الدفعِ", () => {
    // `cancelled → confirmed` ليست حافّةً: لو فُحِصَ الدفعُ أوّلاً لكانَ طلبٌ ملغيٌّ
    // ومدفوعٌ يُجابُ «الدفعُ غيرُ مُخوَّلٍ» — جوابٌ صحيحُ الشكلِ وكاذبُ المعنى.
    const order = fixedOrder({ fulfillmentState: "cancelled", paymentState: "authorized" });
    try {
      decideConfirmation(order);
      throw new Error("كانَ يجبُ أن يُرفَضَ");
    } catch (error) {
      expect((error as DeliveryError).code).toBe("DELIVERY_TRANSITION_NOT_ALLOWED");
    }
  });
});

describe("مرآةُ الدفعِ والتأكيدُ — عبرَ HTTP", () => {
  it("PUT payment-mirror يُجيبُ 200 بحالةٍ جديدةٍ ونسخةٍ مرفوعةٍ وحدثٍ واحدٍ", async () => {
    const { app, store } = buildApp();
    const response = await app.fastify.inject(
      mirror({ payment_state: "authorized", reason_code: "AUTHORIZATION_SUCCEEDED", payment_ref: "pay_1" }),
    );
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.payment_state).toBe("authorized");
    expect(body.version).toBe(2);
    expect(store.outbox).toHaveLength(1);
    expect(store.outbox[0].event_type).toBe("store_order.payment_state_changed");
    expect(store.outbox[0].payload).toMatchObject({
      from_state: "pending",
      to_state: "authorized",
      reason_code: "AUTHORIZATION_SUCCEEDED",
    });
    await app.close();
  });

  it("إعلانٌ مُعادٌ بمفتاحٍ جديدٍ = 200 بلا حدثٍ ثانٍ ولا نسخةٍ ثانيةٍ", async () => {
    const { app, store } = buildApp(fixedOrder({ paymentState: "authorized", paymentRef: "pay_1" }));
    const response = await app.fastify.inject(
      mirror({ payment_state: "authorized", reason_code: "AUTHORIZATION_SUCCEEDED", payment_ref: "pay_1" }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().version).toBe(1);
    expect(store.outbox).toHaveLength(0);
    await app.close();
  });

  it("نفسُ المفتاحِ ونفسُ الجسمِ = إعادةٌ مُعلَنةٌ بترويسةِ Idempotent-Replay", async () => {
    const { app, store } = buildApp();
    const request = mirror({
      payment_state: "authorized",
      reason_code: "AUTHORIZATION_SUCCEEDED",
      payment_ref: "pay_1",
    });
    const first = await app.fastify.inject(request);
    const second = await app.fastify.inject(request);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.headers["idempotent-replay"]).toBe("true");
    expect(second.json()).toEqual(first.json());
    // الحدثُ مرّةً واحدةً: هذا هو كلُّ ما يشتريهِ المفتاحُ.
    expect(store.outbox).toHaveLength(1);
    await app.close();
  });

  it("حقلٌ ماليٌّ غيرُ مُعلَنٍ يُرفَضُ 400 — لا مالَ في هذه الخدمةِ", async () => {
    const { app } = buildApp();
    const response = await app.fastify.inject(
      mirror({
        payment_state: "authorized",
        reason_code: "AUTHORIZATION_SUCCEEDED",
        amount_minor_units: 1500,
      }),
    );
    expect(response.statusCode).toBe(400);
    expect(response.json().error_code).toBe("DELIVERY_VALIDATION_FAILED");
    await app.close();
  });

  it("حالةُ دفعٍ خارجَ الكتالوجِ تُرفَضُ 400 لا 500", async () => {
    const { app } = buildApp();
    const response = await app.fastify.inject(
      mirror({ payment_state: "settled", reason_code: "AUTHORIZATION_SUCCEEDED" }),
    );
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toMatch(/الكتالوجِ المغلقِ/);
    await app.close();
  });

  it("مرآةٌ لطلبٍ لا وجودَ لهُ = 404", async () => {
    const { app } = buildApp();
    const response = await app.fastify.inject(
      mirror({ payment_state: "authorized", reason_code: "AUTHORIZATION_SUCCEEDED" }, "WS-0009999999"),
    );
    expect(response.statusCode).toBe(404);
    expect(response.json().error_code).toBe("DELIVERY_ORDER_NOT_FOUND");
    await app.close();
  });

  it("بلا ترويسةِ مفتاحٍ = 400 على المسارَينِ الجديدَينِ", async () => {
    const { app } = buildApp(fixedOrder({ paymentState: "authorized" }));
    const noKeyMirror = await app.fastify.inject({
      method: "PUT",
      url: "/store-orders/WS-0000000001/payment-mirror",
      payload: { payment_state: "captured", reason_code: "CAPTURE_SUCCEEDED" },
    });
    const noKeyConfirm = await app.fastify.inject({
      method: "POST",
      url: "/store-orders/WS-0000000001/confirmation",
    });
    expect(noKeyMirror.statusCode).toBe(400);
    expect(noKeyConfirm.statusCode).toBe(400);
    expect(noKeyConfirm.json().error_code).toBe("DELIVERY_VALIDATION_FAILED");
    await app.close();
  });

  it("«غائبٌ» و`null` بصمتانِ مختلفتانِ — نفسُ المفتاحِ يُرفَضُ 409 إعادةَ استعمالٍ", async () => {
    // لو سُوِّيَ الغائبُ بـ`null` في البصمةِ لكانَ webhook يمسحُ المرجعَ يُجابُ
    // بجوابِ webhook لم يمسحهُ — إعادةُ تشغيلٍ كاذبةٌ لا يراها أحدٌ.
    const { app } = buildApp();
    const headers = keyHeaders();
    const first = await app.fastify.inject({
      method: "PUT",
      url: "/store-orders/WS-0000000001/payment-mirror",
      headers,
      payload: { payment_state: "authorized", reason_code: "AUTHORIZATION_SUCCEEDED" },
    });
    const second = await app.fastify.inject({
      method: "PUT",
      url: "/store-orders/WS-0000000001/payment-mirror",
      headers,
      payload: { payment_state: "authorized", reason_code: "AUTHORIZATION_SUCCEEDED", payment_ref: null },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(second.json().error_code).toBe("DELIVERY_IDEMPOTENCY_KEY_REUSED");
    await app.close();
  });

  it("الرحلةُ الكاملةُ: تخويلٌ ثمّ تأكيدٌ = confirmed وحدثانِ", async () => {
    const { app, store } = buildApp();
    const authorized = await app.fastify.inject(
      mirror({ payment_state: "authorized", reason_code: "AUTHORIZATION_SUCCEEDED", payment_ref: "pay_1" }),
    );
    expect(authorized.statusCode).toBe(200);

    const confirmed = await app.fastify.inject({
      method: "POST",
      url: "/store-orders/WS-0000000001/confirmation",
      headers: keyHeaders(),
    });
    expect(confirmed.statusCode).toBe(200);
    const body = confirmed.json();
    expect(body.fulfillment_state).toBe("confirmed");
    expect(body.payment_state).toBe("authorized");
    expect(body.version).toBe(3);

    expect(store.outbox.map((event) => event.event_type)).toEqual([
      "store_order.payment_state_changed",
      "store_order.fulfillment_state_changed",
    ]);
    expect(store.outbox[1].payload).toMatchObject({
      from_state: "placed",
      to_state: "confirmed",
      reason_code: "PAYMENT_AUTHORIZED",
    });
    await app.close();
  });

  it("تأكيدٌ بلا تخويلٍ = 409 DELIVERY_PAYMENT_NOT_AUTHORIZED ولا حدثَ", async () => {
    const { app, store } = buildApp();
    const response = await app.fastify.inject({
      method: "POST",
      url: "/store-orders/WS-0000000001/confirmation",
      headers: keyHeaders(),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error_code).toBe("DELIVERY_PAYMENT_NOT_AUTHORIZED");
    expect(store.outbox).toHaveLength(0);
    await app.close();
  });

  it("إعادةُ تأكيدٍ بنفسِ المفتاحِ تُعيدُ الجوابَ ولا تلمسُ آلةَ الحالاتِ", async () => {
    const { app, store } = buildApp(fixedOrder({ paymentState: "authorized" }));
    const request = {
      method: "POST" as const,
      url: "/store-orders/WS-0000000001/confirmation",
      headers: keyHeaders(),
    };
    const first = await app.fastify.inject(request);
    const second = await app.fastify.inject(request);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.headers["idempotent-replay"]).toBe("true");
    expect(store.outbox).toHaveLength(1);
    await app.close();
  });

  it("تأكيدٌ لطلبٍ مُؤكَّدٍ بمفتاحٍ جديدٍ = 409 لا 200", async () => {
    // بلا هذا لكانَ `confirmed → confirmed` إمّا انهياراً وإمّا نجاحاً صامتاً
    // يُنشئُ صفَّ دفترٍ ثانياً لانتقالٍ واحدٍ.
    const { app } = buildApp(fixedOrder({ fulfillmentState: "confirmed", paymentState: "authorized" }));
    const response = await app.fastify.inject({
      method: "POST",
      url: "/store-orders/WS-0000000001/confirmation",
      headers: keyHeaders(),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error_code).toBe("DELIVERY_TRANSITION_NOT_ALLOWED");
    await app.close();
  });
});

/**
 * ما رآهُ السلكُ ولم ترَهُ الوحدةُ — سُدَّتِ الثغرةُ في المراجعةِ 9/N.
 *
 * `app.inject` بلا `payload` لا يبعثُ `content-type`، فمرَّ التأكيدُ في كلِّ
 * اختباراتِ الوحدةِ ثمَّ سقطَ 500 في بوّابةِ الخروجِ حينَ نادتْهُ `fetch` برأسِ
 * JSON وجسمٍ فارغٍ. فهذه الاختباراتُ تُثبّتُ الرأسَ صراحةً: العميلُ العامُّ
 * يبعثُهُ، وعقدُنا لا يطلبُ جسماً، فاللقاءُ بينهما يجبُ أن ينجحَ.
 */
describe("جسمُ الطلبِ على الحدِّ (9/N)", () => {
  it("تأكيدٌ بلا جسمٍ ومع رأسِ JSON = 200 لا 500", async () => {
    const { app } = buildApp(fixedOrder({ paymentState: "authorized" }));
    const response = await app.fastify.inject({
      method: "POST",
      url: "/store-orders/WS-0000000001/confirmation",
      headers: { ...keyHeaders(), "content-type": "application/json" },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().fulfillment_state).toBe("confirmed");
    await app.close();
  });

  it("مسارٌ يطلبُ جسماً يرفضُ الفارغَ بـ400 من عقدِنا — لا برسالةِ إطارٍ", async () => {
    const { app } = buildApp();
    const response = await app.fastify.inject({
      method: "PUT",
      url: "/store-orders/WS-0000000001/payment-mirror",
      headers: { ...keyHeaders(), "content-type": "application/json" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error_code).toBe("DELIVERY_VALIDATION_FAILED");
    await app.close();
  });

  it("JSON معطوبٌ = 400 ولا يُسرِّبُ الجسمَ في الرسالةِ", async () => {
    const { app } = buildApp();
    const response = await app.fastify.inject({
      method: "PUT",
      url: "/store-orders/WS-0000000001/payment-mirror",
      headers: { ...keyHeaders(), "content-type": "application/json" },
      payload: '{"payment_ref":"pay_secret_0001"',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error_code).toBe("DELIVERY_VALIDATION_FAILED");
    expect(response.body).not.toContain("pay_secret_0001");
    await app.close();
  });
});
