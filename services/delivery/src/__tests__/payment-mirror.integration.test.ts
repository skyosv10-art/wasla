/**
 * مرآةُ الدفعِ والتأكيدُ على PostgreSQL حقيقيٍّ — المراجعةُ 9/N (§2.2 · §3.2).
 *
 * ما لا يستطيعُ الزائفُ إثباتَهُ ويُثبِتُهُ هذا الملفُّ:
 *
 *  - صفُّ الدفترِ يُكتَبُ بـ`state_kind = 'payment'` ويجتازُ قيدَ CHECK — واختبارُ
 *    ذاكرةٍ لا يفشلُ كما يفشلُ قيدٌ، والقيودُ نصفُ التصميمِ.
 *  - `payment_ref` يُحفَظُ ويُمحى فعلاً، و`version` يرتفعُ في القاعدةِ لا في كائنٍ.
 *  - المرآةُ والتأكيدُ يكتبانِ صندوقاً واحداً لكلِّ انتقالٍ، و`published_at` يبقى
 *    فارغاً: لا ناشرَ في هذا الطورِ، وما لا يُنشَرُ لا يُدَّعى أنَّهُ نُشِرَ.
 *  - البوّابةُ المركَّبةُ تُقرَأُ **تحتَ القُفلِ**: تأكيدٌ حُسِبَ على مرآةٍ `authorized`
 *    ثمّ انقلبَت قبلَ الكتابةِ يُرفَضُ.
 *
 * تُتخطَّى بلا `DATABASE_URL` — `docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { PG_ENABLED, resetData, setupPostgres } from "./pg-harness.js";
import { StoreOrderStore } from "../infrastructure/store-order-store.js";
import { CUSTOMER_REF, FakeCatalog, PRODUCT_A, STORE_SLUG, uuidSequence } from "./store-order-fakes.js";
import { placeStoreOrder } from "../use-cases/place-store-order.js";
import { mirrorPayment } from "../use-cases/mirror-payment.js";
import { confirmStoreOrder } from "../use-cases/confirm-store-order.js";
import { isDeliveryError } from "../domain/errors.js";
import type { StoreOrder } from "../domain/model.js";

const NOW = "2026-09-10T10:00:00.000Z";

describe.skipIf(!PG_ENABLED)("مرآةُ الدفعِ والتأكيدُ — PostgreSQL", () => {
  let pool: Pool;
  let close: () => Promise<void>;
  let store: StoreOrderStore;

  beforeAll(async () => {
    const fixture = await setupPostgres();
    pool = fixture.pool;
    close = fixture.close;
    store = new StoreOrderStore(pool);
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetData(pool);
  });

  const deps = () => ({
    catalogPort: new FakeCatalog(),
    writePort: store,
    readPort: store,
    newUuid: uuidSequence(`${Math.floor(Math.random() * 0xfffffff).toString(16).padStart(8, "0")}`),
    now: () => NOW,
  });

  async function place(): Promise<StoreOrder> {
    const result = await placeStoreOrder(
      deps(),
      {
        customer_ref: CUSTOMER_REF,
        store_slug: STORE_SLUG,
        items: [{ product_id: PRODUCT_A, quantity: 2 }],
        delivery_fee_minor_units: 500,
      },
      null,
    );
    if (result.kind !== "applied") throw new Error("unexpected replay on placement");
    return result.order;
  }

  async function applyMirror(
    order: StoreOrder,
    input: { paymentState: "authorized" | "failed" | "captured"; reasonCode: string; paymentRef?: string | null },
  ): Promise<StoreOrder> {
    const result = await mirrorPayment(
      deps(),
      order.publicId,
      input as never,
      null,
    );
    if (result.kind === "replayed") throw new Error("unexpected replay on mirror");
    return result.order;
  }

  it("يكتبُ الحالةَ والمرجعَ وصفَّ دفترٍ بنوعِ payment وصندوقاً واحداً", async () => {
    const order = await place();
    const mirrored = await applyMirror(order, {
      paymentState: "authorized",
      reasonCode: "AUTHORIZATION_SUCCEEDED",
      paymentRef: "pay_ref_integration_1",
    });

    expect(mirrored.paymentState).toBe("authorized");
    expect(mirrored.paymentRef).toBe("pay_ref_integration_1");
    expect(mirrored.version).toBe(order.version + 1);

    const row = await pool.query(
      `SELECT payment_state, payment_ref, version FROM store_orders WHERE order_id = $1`,
      [order.orderId],
    );
    expect(row.rows[0]).toMatchObject({
      payment_state: "authorized",
      payment_ref: "pay_ref_integration_1",
    });

    const ledger = await pool.query(
      `SELECT from_state, to_state, reason_code, actor_type, actor_ref
         FROM store_order_transitions
        WHERE order_id = $1 AND state_kind = 'payment'`,
      [order.orderId],
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({
      from_state: "pending",
      to_state: "authorized",
      reason_code: "AUTHORIZATION_SUCCEEDED",
      actor_type: "system",
      actor_ref: null,
    });

    const outbox = await pool.query(
      `SELECT event_type, published_at FROM delivery_outbox
        WHERE event_type = 'store_order.payment_state_changed'`,
    );
    expect(outbox.rows).toHaveLength(1);
    // لا ناشرَ في هذا الطورِ: صندوقٌ مملوءٌ و`published_at` فارغٌ حقيقةٌ مُعلَنةٌ.
    expect(outbox.rows[0].published_at).toBeNull();
  });

  it("`payment_ref: null` يمحو المرجعَ المحفوظَ فعلاً في القاعدةِ", async () => {
    const order = await place();
    await applyMirror(order, {
      paymentState: "authorized",
      reasonCode: "AUTHORIZATION_SUCCEEDED",
      paymentRef: "pay_ref_to_be_cleared",
    });
    const current = await store.getOrderByPublicId(order.publicId);
    const cleared = await applyMirror(current as StoreOrder, {
      paymentState: "captured",
      reasonCode: "CAPTURE_SUCCEEDED",
      paymentRef: null,
    });
    expect(cleared.paymentRef).toBeNull();

    const row = await pool.query(`SELECT payment_ref FROM store_orders WHERE order_id = $1`, [
      order.orderId,
    ]);
    expect(row.rows[0].payment_ref).toBeNull();
  });

  it("التأكيدُ بعدَ التخويلِ يكتبُ confirmed وصفَّ دفترِ تنفيذٍ ثانياً", async () => {
    const order = await place();
    await applyMirror(order, {
      paymentState: "authorized",
      reasonCode: "AUTHORIZATION_SUCCEEDED",
      paymentRef: "pay_ref_confirm",
    });
    const result = await confirmStoreOrder(deps(), order.publicId, null);
    if (result.kind === "replayed") throw new Error("unexpected replay on confirmation");
    expect(result.order.fulfillmentState).toBe("confirmed");
    expect(result.order.version).toBe(order.version + 2);

    const ledger = await pool.query(
      `SELECT to_state, reason_code, state_kind FROM store_order_transitions
        WHERE order_id = $1 ORDER BY occurred_at, transition_id`,
      [order.orderId],
    );
    // ثلاثةُ صفوفٍ: الإنشاءُ (draft → placed) ثمّ المرآةُ ثمّ التأكيدُ.
    expect(ledger.rows.map((r) => `${String(r.state_kind)}:${String(r.to_state)}`)).toEqual([
      "fulfillment:placed",
      "payment:authorized",
      "fulfillment:confirmed",
    ]);
    expect(ledger.rows[2].reason_code).toBe("PAYMENT_AUTHORIZED");
  });

  it("تأكيدٌ ومرآةٌ في pending يُرفَضُ ولا يكتبُ شيئاً", async () => {
    const order = await place();
    try {
      await confirmStoreOrder(deps(), order.publicId, null);
      throw new Error("كانَ يجبُ أن يُرفَضَ");
    } catch (error) {
      expect(isDeliveryError(error)).toBe(true);
      if (isDeliveryError(error)) expect(error.code).toBe("DELIVERY_PAYMENT_NOT_AUTHORIZED");
    }
    const rows = await pool.query(
      `SELECT fulfillment_state, version FROM store_orders WHERE order_id = $1`,
      [order.orderId],
    );
    expect(rows.rows[0]).toMatchObject({ fulfillment_state: "placed" });
    expect(Number(rows.rows[0].version)).toBe(order.version);
  });

  it("البوّابةُ تُعادُ قراءتُها تحتَ القُفلِ: مرآةٌ انقلبَت بينَ القرارِ والكتابةِ تمنعُ التأكيدَ", async () => {
    const order = await place();
    const authorized = await applyMirror(order, {
      paymentState: "authorized",
      reasonCode: "AUTHORIZATION_SUCCEEDED",
      paymentRef: "pay_ref_race",
    });

    // نُقلِّدُ الانقلابَ بالكتابةِ المباشرةِ بلا رفعِ النسخةِ: فحصُ النسخةِ وحدَهُ كانَ
    // سيمرُّ هنا، فالحرسُ الذي يُنجيهِ هو إعادةُ قراءةِ الشرطِ في المعاملةِ.
    await pool.query(`UPDATE store_orders SET payment_state = 'failed' WHERE order_id = $1`, [
      order.orderId,
    ]);

    const writeResult = store.confirmOrder({
      orderId: authorized.orderId,
      expectedVersion: authorized.version,
      fromFulfillmentState: "placed",
      events: [],
      traceId: null,
    });
    await expect(writeResult).rejects.toMatchObject({ code: "DELIVERY_PAYMENT_NOT_AUTHORIZED" });

    const rows = await pool.query(
      `SELECT fulfillment_state FROM store_orders WHERE order_id = $1`,
      [order.orderId],
    );
    expect(rows.rows[0].fulfillment_state).toBe("placed");
  });
});
