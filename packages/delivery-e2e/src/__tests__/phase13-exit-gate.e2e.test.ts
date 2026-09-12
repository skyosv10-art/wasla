/**
 * بوّابةُ خروجِ الطورِ 13 — ستُّ توكيداتٍ لا يُثبتُها اختبارُ خدمةٍ واحدةٍ.
 *
 * ولمَ ستٌّ فقط؟ لأنَّ البوّابةَ ليست نسخةً ثانيةً من 205 اختباراً؛ هيَ الطبقةُ التي
 * تسألُ ما لا يستطيعُ اختبارُ خدمةٍ سؤالَهُ: هل تُؤخَذُ لقطةُ السعرِ من **السوقِ
 * الحقيقيِّ** عبرَ سلكٍ موقَّعٍ؟ وهل يُقطَعُ الشوطُ `placed → confirmed` فعلاً بعدَ
 * أن كانَ مقطوعاً بلا مُنادٍ؟ وهل ما يُكتَبُ في الصندوقِ يُطابقُ **الورقةَ
 * المنشورةَ**؟ وهل يعبرُ حدثُ مخزونٍ **كتبَهُ السوقُ** إلى دفترِ التوصيلِ؟ وهل يصمدُ
 * الجوابُ المحفوظُ بايتاً ببايتٍ على الشبكةِ؟ وهل تُعلِنُ الجاهزيّةُ ما لا تدّعيهِ؟
 * وكلُّ توكيدٍ زائدٍ فوقَ ذلكَ يُكرِّرُ حارساً قائماً فيصيرُ عبئاً يُعدَّلُ مرّتَينِ.
 *
 * Related Docs: docs/12-testing/PHASE13_EXIT_GATE_E2E.md
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DELIVERY_SCOPES } from "@wasla/delivery-service";

import {
  CATEGORY,
  CUSTOMER,
  DELIVERY_FEE_MINOR_UNITS,
  MODERATOR,
  OWNER,
  PG_ENABLED,
  STORE_SLUG,
  UNIT_PRICE_MINOR_UNITS,
  call,
  callDelivery,
  canonicalJson,
  contractEventDefs,
  countRows,
  defNameOf,
  deliveryOutbox,
  eventViolations,
  nextKey,
  resetData,
  seedLeafCategory,
  startGate,
  transitions,
  type GateContext,
} from "../harness.js";

const SKU = "SKU-GATE13-001";
const QUANTITY = 2;
const PAYMENT_REF = "psp_gate13_authorization_0001";

/**
 * حارسُ الخُضرةِ الصامتةِ — **خارجَ المجموعةِ المتخطّاةِ عمداً**.
 *
 * `describe.skipIf` رحمةٌ للمُطوِّرِ بلا قاعدةٍ، وخطرٌ في CI: وصلٌ منسيٌّ أو اسمُ
 * متغيّرٍ مكتوبٌ خطأً يجعلُ `vitest` تخرجُ بصفرٍ والوظيفةَ خضراءَ **ولم تُقَسْ حالةٌ
 * واحدةٌ** — وهوَ `RISK-0022` بعينِهِ. فتُعلِنُ الوظيفةُ `EXIT_GATE_REQUIRE_DB=1`
 * فيصيرُ التخطّي إخفاقاً **باسمِهِ داخلَ الملفِّ نفسِهِ**، لا بمُرشِّحِ نصٍّ على سجلٍّ
 * ينكسرُ بأوّلِ تغييرٍ في صياغةِ `vitest`.
 */
it("البوّابةُ لا تُتخطّى صامتةً حيثُ أُعلِنَ أنّها واجبةٌ", () => {
  if ((process.env.EXIT_GATE_REQUIRE_DB ?? "").trim() !== "1") return;
  expect(
    PG_ENABLED,
    "EXIT_GATE_REQUIRE_DB=1 ولا DATABASE_URL — البوّابةُ كانت ستُتخطّى وتُعلَنُ خضراءَ",
  ).toBe(true);
});

describe.skipIf(!PG_ENABLED)("بوّابةُ خروج Phase 13 · السوقُ والتوصيلُ على مُستمعَينِ وقاعدةٍ حقيقيَّينِ", () => {
  let gate: GateContext;

  beforeAll(async () => {
    gate = await startGate();
  });

  beforeEach(async () => {
    await resetData(gate.pool);
    await seedLeafCategory(gate.stores);
  });

  afterAll(async () => {
    await gate?.close();
  });

  /**
   * رحلةُ السوقِ كاملةً عبرَ الشبكةِ حتّى منتجٍ **منشورٍ ظاهرٍ** — تُعيدُ مُعرِّفَهُ.
   *
   * وكلُّ خطوةٍ تُوكَّدُ بحالتِها لأنَّ خطوةً تفشلُ صامتةً كانت ستجعلُ نداءَ الطلبِ
   * التالي يُجابُ 503 «السوقُ لا يُجيبُ» فيُنسَبُ الفشلُ إلى السلكِ لا إلى الخطوةِ.
   */
  async function publishProduct(): Promise<string> {
    const market = gate.marketplaceBaseUrl;

    const registered = await call(market, {
      method: "POST",
      path: "/stores",
      body: {
        owner_public_id: OWNER,
        store_slug: STORE_SLUG,
        title_ar: "إلكترونيّات المدينة",
        category_slug: CATEGORY,
      },
      idempotencyKey: nextKey("register"),
    });
    expect(registered.status, registered.text).toBe(201);

    const requested = await call(market, {
      method: "POST",
      path: `/stores/${STORE_SLUG}/review-requests`,
      body: { requested_by_public_id: OWNER },
      idempotencyKey: nextKey("review"),
    });
    expect(requested.status, requested.text).toBe(201);

    const approved = await call(market, {
      method: "POST",
      path: `/stores/${STORE_SLUG}/decisions`,
      body: { decision: "approved", actor_type: "moderator", actor_public_id: MODERATOR },
      idempotencyKey: nextKey("store-decide"),
    });
    expect(approved.status, approved.text).toBe(201);

    const created = await call(market, {
      method: "POST",
      path: `/stores/${STORE_SLUG}/products`,
      body: {
        sku: SKU,
        title_ar: "هاتف",
        category_slug: CATEGORY,
        price_minor_units: UNIT_PRICE_MINOR_UNITS,
        currency_code: "SAR",
        created_by_public_id: OWNER,
      },
      idempotencyKey: nextKey("product"),
    });
    expect(created.status, created.text).toBe(201);
    const productId = created.body.product_id as string;

    const moderated = await call(market, {
      method: "POST",
      path: `/products/${productId}/decisions`,
      body: { decision: "approved", actor_type: "moderator", actor_public_id: MODERATOR },
      idempotencyKey: nextKey("product-decide"),
    });
    expect(moderated.status, moderated.text).toBe(201);

    const stocked = await call(market, {
      method: "POST",
      path: `/products/${productId}/inventory`,
      body: { quantity_delta: 9, reason_code: "restock", actor_public_id: OWNER },
      idempotencyKey: nextKey("inventory"),
    });
    expect(stocked.status, stocked.text).toBe(201);

    const published = await call(market, {
      method: "POST",
      path: `/products/${productId}/publish`,
      body: { actor_public_id: OWNER },
      idempotencyKey: nextKey("publish"),
    });
    expect(published.status, published.text).toBe(200);

    // الظهورُ شرطُ الطلبِ (`is_visible`)، وقراءتُهُ هنا تفصلُ فشلَ الرحلةِ عن فشلِ السلكِ.
    const visible = await call(market, { method: "GET", path: `/products/${productId}` });
    expect(visible.status, visible.text).toBe(200);
    expect(visible.body.is_visible).toBe(true);

    return productId;
  }

  /** طلبٌ يُوضَعُ عبرَ حدِّ التوصيلِ بلقطةِ سعرٍ مأخوذةٍ من السوقِ عبرَ الشبكةِ. */
  async function placeOrder(productId: string): Promise<Record<string, unknown>> {
    const placed = await callDelivery(gate, {
      method: "POST",
      path: "/store-orders",
      body: {
        customer_ref: CUSTOMER,
        store_slug: STORE_SLUG,
        items: [{ product_id: productId, quantity: QUANTITY }],
        delivery_fee_minor_units: DELIVERY_FEE_MINOR_UNITS,
      },
      idempotencyKey: nextKey("place"),
    });
    expect(placed.status, placed.text).toBe(201);
    return placed.body;
  }

  it("اللقطةُ تُؤخَذُ من السوقِ الحقيقيِّ، والشوطُ placed → confirmed مقطوعٌ عبرَ سلكَينِ", async () => {
    const productId = await publishProduct();
    const order = await placeOrder(productId);

    const publicId = order.public_id as string;
    expect(publicId).toMatch(/^WS-[0-9]{10}$/u);
    expect(order.fulfillment_state).toBe("placed");
    expect(order.payment_state).toBe("pending");

    /*
     * السعرُ **لم يُرسَلْ في الطلبِ** — وهذا هوَ التوكيدُ: الرقمُ في الجوابِ هوَ
     * الرقمُ الذي نشرَهُ السوقُ، ولو اخترعَ الحدُّ سعراً لَظهرَ الفرقُ هنا.
     */
    const items = order.items as readonly Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0].unit_price_minor_units).toBe(UNIT_PRICE_MINOR_UNITS);
    expect(items[0].sku).toBe(SKU);
    expect(order.items_total_minor_units).toBe(UNIT_PRICE_MINOR_UNITS * QUANTITY);
    expect(order.total_minor_units).toBe(
      UNIT_PRICE_MINOR_UNITS * QUANTITY + DELIVERY_FEE_MINOR_UNITS,
    );

    // مرآةُ الدفعِ: `PUT` يُعلِنُ حالةَ المُزوِّدِ — ولا مالَ يُعالَجُ هنا (§2.2).
    const mirrored = await callDelivery(gate, {
      method: "PUT",
      path: `/store-orders/${publicId}/payment-mirror`,
      body: {
        payment_state: "authorized",
        reason_code: "AUTHORIZATION_SUCCEEDED",
        payment_ref: PAYMENT_REF,
      },
      idempotencyKey: nextKey("mirror"),
    });
    expect(mirrored.status, mirrored.text).toBe(200);
    expect(mirrored.body.payment_state).toBe("authorized");
    // الحالتانِ متعامدتانِ: مرآةُ الدفعِ لا تُحرِّكُ التنفيذَ بنفسِها.
    expect(mirrored.body.fulfillment_state).toBe("placed");

    // التأكيدُ: البوّابةُ المركَّبةُ (`placed` + دفعٌ مُخوَّلٌ) — وقبلَ 9/N كانت لا تُنادى.
    const confirmed = await callDelivery(gate, {
      method: "POST",
      path: `/store-orders/${publicId}/confirmation`,
      idempotencyKey: nextKey("confirm"),
    });
    expect(confirmed.status, confirmed.text).toBe(200);
    expect(confirmed.body.fulfillment_state).toBe("confirmed");
    expect(confirmed.body.payment_state).toBe("authorized");

    // والقراءةُ الطازجةُ من القاعدةِ لا من الجوابِ المُعادِ — الحالةُ محفوظةٌ لا مُدَّعاةٌ.
    const read = await callDelivery(gate, {
      method: "GET",
      path: `/store-orders/${publicId}`,
    });
    expect(read.body.fulfillment_state).toBe("confirmed");
    expect(read.body.payment_state).toBe("authorized");

    /*
     * دفترُ الانتقالاتِ بنوعَيهِ الثلاثةِ صفوفٍ: حافّةُ الإيداعِ `draft → placed`
     * مكتوبةٌ وإن لم يحملْها صفٌّ قطُّ (وإلاّ لظهرتِ الحالةُ الأولى بلا سببٍ)، ثمَّ
     * صفُّ `payment` من المرآةِ، ثمَّ صفُّ `fulfillment` من التأكيدِ. وعمودُ
     * `state_kind` هوَ ما يمنعُ خلطَ المحورَينِ في دفترٍ واحدٍ (§3.2)، والدفترُ
     * كاملاً — لا مُصفّىً — هوَ ما يُقرأُ هنا: صفٌّ زائدٌ لا يراهُ أحدٌ تدقيقٌ ضائعٌ.
     */
    expect(await transitions(gate.pool, publicId)).toEqual([
      {
        state_kind: "fulfillment",
        from_state: "draft",
        to_state: "placed",
        reason_code: "CART_CONFIRMED",
      },
      {
        state_kind: "inventory",
        from_state: "none",
        to_state: "reserved",
        reason_code: "INVENTORY_RESERVED",
      },
      {
        state_kind: "payment",
        from_state: "pending",
        to_state: "authorized",
        reason_code: "AUTHORIZATION_SUCCEEDED",
      },
      {
        state_kind: "fulfillment",
        from_state: "placed",
        to_state: "confirmed",
        reason_code: "PAYMENT_AUTHORIZED",
      },
    ]);
  });

  it("كلُّ حدثٍ كتبَهُ الحدُّ يُطابقُ العقدَ المنشورَ، ولا ناقلَ يختمُ شيئاً", async () => {
    const productId = await publishProduct();
    const order = await placeOrder(productId);
    const publicId = order.public_id as string;

    await callDelivery(gate, {
      method: "PUT",
      path: `/store-orders/${publicId}/payment-mirror`,
      body: { payment_state: "authorized", reason_code: "AUTHORIZATION_SUCCEEDED", payment_ref: PAYMENT_REF },
      idempotencyKey: nextKey("mirror"),
    });
    await callDelivery(gate, {
      method: "POST",
      path: `/store-orders/${publicId}/confirmation`,
      idempotencyKey: nextKey("confirm"),
    });

    const rows = await deliveryOutbox(gate.pool);

    // أربعةُ أحداثٍ: الطلبُ + المهمّةُ + حجزُ المخزونِ (المراجعةُ 10/N) ثمّ محورُ الدفعِ،
    // ثمّ محورُ التنفيذِ. والترتيبُ مقروءٌ لا مُفترَضٌ: الإيداعُ يكتبُ حدثَ الطلبِ وحدثَ
    // المهمّةِ في معاملةٍ واحدةٍ، ثمَّ يُعقِبُهُ حجزُ المخزونِ، فالمرآةُ، فالتأكيدُ.
    expect(rows.map((row) => row.event.event_type)).toEqual([
      "store_order.created",
      "delivery.task_created",
      "store_order.inventory_reserved",
      "store_order.payment_state_changed",
      "store_order.fulfillment_state_changed",
    ]);

    // ولكلِّ نوعٍ تعريفٌ في الورقةِ — لا نوعَ يُكتَبُ بلا عقدٍ منشورٍ يقرؤُهُ المُتكامِلُ.
    const defs = contractEventDefs();
    for (const row of rows) {
      expect(defs).toContain(defNameOf(row.event.event_type as string));
    }

    // ثمّ الغلافُ والحمولةُ معاً على الورقةِ — لا ثابتَ حدثٍ واحدٍ في هذا الملفّ.
    for (const row of rows) {
      expect(eventViolations(row.event), `${row.event.event_type}`).toEqual([]);
    }

    // ومرجعُ الدفعِ يعبرُ إلى الحمولةِ كما أعلنَهُ المُزوِّدُ — لا يُخترَعُ ولا يُحذَفُ.
    const paymentRow = rows.find((row) => row.event.event_type === "store_order.payment_state_changed");
    expect(paymentRow, "لا حدثَ مرآةٍ في الصندوقِ").toBeDefined();
    const paymentEvent = paymentRow!.event.payload as Record<string, unknown>;
    expect(paymentEvent.payment_ref).toBe(PAYMENT_REF);
    expect(paymentEvent.public_id).toBe(publicId);

    // دَينُ الناقلِ مُعلَنٌ، والمُعلَنُ يُثبَّتُ لا يُترَكُ ظنّاً.
    expect(rows.every((row) => row.publishedAt === null)).toBe(true);
  });

  it("حدثُ مخزونٍ كتبَهُ السوقُ يعبرُ الناقلَ إلى دفترِ التوصيلِ", async () => {
    const productId = await publishProduct();

    // الصفُّ في `marketplace_outbox` يكتبُهُ **حدُّ السوقِ** لا الاختبارُ.
    const adjusted = await call(gate.marketplaceBaseUrl, {
      method: "POST",
      path: `/products/${productId}/inventory`,
      body: { quantity_delta: -3, reason_code: "shrinkage", actor_public_id: OWNER },
      idempotencyKey: nextKey("adjust"),
    });
    expect(adjusted.status, adjusted.text).toBe(201);

    const outcome = await gate.relayInventory();
    // حدثانِ: بذرةُ الرحلةِ (+9) وهذا التعديلُ (−3). ولا مسمومَ ولا مُهمَلَ.
    expect(outcome.poisoned).toBe(0);
    expect(outcome.applied).toBe(2);

    const observed = await gate.pool.query<{
      observed_quantity_after: number;
      last_quantity_delta: number;
      last_reason_code: string;
      last_adjustment_sequence: number;
    }>(
      `SELECT observed_quantity_after, last_quantity_delta, last_reason_code,
              last_adjustment_sequence
         FROM delivery_inventory_observations
        WHERE product_id = $1::uuid`,
      [productId],
    );
    expect(observed.rows).toHaveLength(1);
    expect(observed.rows[0]).toEqual({
      observed_quantity_after: 6,
      last_quantity_delta: -3,
      last_reason_code: "shrinkage",
      last_adjustment_sequence: 2,
    });

    /*
     * ودفعةٌ ثانيةٌ بلا حدثٍ جديدٍ لا تفعلُ شيئاً: علامةُ الماءِ تقدَّمت، والناقلُ
     * الذي يُعيدُ قراءةَ ما استهلكَهُ كانَ سيُرجِعُ اللقطةَ إلى ماضٍ.
     */
    const again = await gate.relayInventory();
    expect(again.processed).toBe(0);
    expect(await countRows(gate.pool, "delivery_inventory_observations")).toBe(1);
  });

  it("الجوابُ المحفوظُ يصمدُ بايتاً ببايتٍ على الشبكةِ، والمفتاحُ يُعلِنُ الإعادةَ", async () => {
    const productId = await publishProduct();
    const order = await placeOrder(productId);
    const publicId = order.public_id as string;
    const key = nextKey("mirror-replay");

    const first = await callDelivery(gate, {
      method: "PUT",
      path: `/store-orders/${publicId}/payment-mirror`,
      body: { payment_state: "authorized", reason_code: "AUTHORIZATION_SUCCEEDED", payment_ref: PAYMENT_REF },
      idempotencyKey: key,
    });
    expect(first.status, first.text).toBe(200);
    expect(first.replayHeader).toBeNull();

    const replay = await callDelivery(gate, {
      method: "PUT",
      path: `/store-orders/${publicId}/payment-mirror`,
      body: { payment_state: "authorized", reason_code: "AUTHORIZATION_SUCCEEDED", payment_ref: PAYMENT_REF },
      idempotencyKey: key,
    });
    expect(replay.status, replay.text).toBe(200);
    // ترويسةٌ صريحةٌ: بلا هذا لا يُفرِّقُ العميلُ بينَ «كُتِبَ الآنَ» و«كُتِبَ سابقاً».
    expect(replay.replayHeader).toBe("true");
    expect(canonicalJson(replay.body)).toBe(canonicalJson(first.body));

    // ولا انتقالَ ثانياً في الدفترِ: الإعادةُ جوابٌ محفوظٌ لا كتابةٌ ثانيةٌ.
    const ledger = await transitions(gate.pool, publicId);
    expect(ledger.filter((row) => row.state_kind === "payment")).toHaveLength(1);

    /*
     * ونفسُ المفتاحِ بمرجعٍ آخرَ إعادةُ استعمالٍ لا إعادةُ محاولةٍ: مُزوِّدانِ
     * مختلفانِ لطلبٍ واحدٍ خطأُ تركيبٍ يجبُ أن يُصرَخَ بهِ لا أن يُجابَ بجوابٍ قديمٍ.
     */
    const reused = await callDelivery(gate, {
      method: "PUT",
      path: `/store-orders/${publicId}/payment-mirror`,
      body: { payment_state: "authorized", reason_code: "AUTHORIZATION_SUCCEEDED", payment_ref: "psp_other_ref" },
      idempotencyKey: key,
    });
    expect(reused.status, reused.text).toBe(409);
    expect(reused.body.error_code).toBe("DELIVERY_IDEMPOTENCY_KEY_REUSED");
    /*
     * ولا `Retry-After` هنا (المراجعةُ 19/N · ADR-026 §4.21): الحالُ 409 نفسُهُ
     * الذي يحملُها في رفضِ التزامُنِ، فلو كانَ الوصلُ بالحالِ لا بالرمزِ لَنطقَت
     * هذه أيضاً — وهيَ إعادةٌ **لن تنجحَ أبداً** فالوعدُ فيها كذبٌ.
     */
    expect(reused.retryAfterHeader).toBeNull();
    expect(replay.retryAfterHeader).toBeNull();
    expect(first.retryAfterHeader).toBeNull();
  });

  /*
   * `Retry-After` على مقبسٍ حقيقيٍّ (المراجعةُ 19/N · ADR-026 §4.21).
   *
   * ولمَ في البوّابةِ وقد أُثبِتَت في التكامُلِ؟ لأنَّ `app.inject` لا يمرُّ على
   * مُسلسِلِ ترويساتِ HTTP: ترويسةٌ يُسقِطُها المُستمعُ أو يُعيدُ تسميتَها كانت
   * ستمُرَّ خضراءَ هناكَ وتغيبَ عن كلِّ منادٍ حقيقيٍّ. **والقراءةُ نصٌّ لا عددٌ**
   * كي تُثبَتَ الصيغةُ (`1*DIGIT`) لا القيمةُ وحدَها.
   *
   * والدعوى الأهمُّ أنَّ الوعدَ **صادقٌ**: إعادةٌ فوريّةٌ — بلا انتظارِ الثانيةِ
   * التي وعدَت بها الترويسةُ — تُعيدُ جوابَ الرابحِ **بايتاً ببايتٍ**. أي أنَّ
   * `1` فائضٌ على المقيسِ (صفرٌ) لا عجزٌ عنهُ.
   *
   * والحلقةُ لأنَّ التسابُقَ لا يُفرَضُ من الخارجِ، **والسقوطُ صريحٌ إن لم يظهرِ
   * الرفضُ** فلا يمرُّ الاختبارُ بلا أن يقيسَ شيئاً.
   */
  it("رفضُ التزامُنِ يُعلِنُ `Retry-After: 1` على السلكِ، والإعادةُ الفوريّةُ تُثبِتُ صدقَهُ", async () => {
    const productId = await publishProduct();
    // مخزونٌ يكفي كلَّ دورةٍ: كلُّ دورةٍ رابحةٌ تحجزُ وحدةً، والبوّابةُ لا تُصفِّرُ
    // بينَ الدوراتِ — فنفادُهُ كانَ سيُنتِجُ 409 مخزونٍ يُشبِهُ المطلوبَ ولا يعنيهِ.
    const restocked = await call(gate.marketplaceBaseUrl, {
      method: "POST",
      path: `/products/${productId}/inventory`,
      body: { quantity_delta: 30, reason_code: "restock", actor_public_id: OWNER },
      idempotencyKey: nextKey("restock-race"),
    });
    expect(restocked.status, restocked.text).toBe(201);

    const body = {
      customer_ref: CUSTOMER,
      store_slug: STORE_SLUG,
      items: [{ product_id: productId, quantity: 1 }],
      delivery_fee_minor_units: DELIVERY_FEE_MINOR_UNITS,
    };

    let refusals = 0;
    for (let round = 0; round < 12 && refusals === 0; round += 1) {
      const key = nextKey(`race-${round}`);
      const [left, right] = await Promise.all([
        callDelivery(gate, { method: "POST", path: "/store-orders", body, idempotencyKey: key }),
        callDelivery(gate, { method: "POST", path: "/store-orders", body, idempotencyKey: key }),
      ]);

      const loser = left.status === 409 ? left : right.status === 409 ? right : null;
      /*
       * ولا طلبَ ثانياً في أيِّ دورةٍ — والعَدُّ **بالإنشاءِ لا بالحالِ**: قياسٌ
       * فعليٌّ أظهرَ دورةً أجابَت `201`/`201`، والثاني فيها **إعادةٌ** قرأَت صفَّ
       * الرابحِ المُثبَتَ (`Idempotent-Replay: true`) لا إنشاءً ثانياً. فتوكيدُ
       * «واحدٌ فقط 201» كانَ سيسقطُ على سلوكٍ صحيحٍ تماماً.
       */
      for (const r of [left, right]) expect([201, 409]).toContain(r.status);
      const created = [left, right].filter((r) => r.status === 201 && r.replayHeader === null);
      expect(created).toHaveLength(1);
      if (loser === null) continue;
      refusals += 1;

      const winner = loser === left ? right : left;
      expect(loser.body.error_code).toBe("DELIVERY_IDEMPOTENT_REQUEST_IN_FLIGHT");
      expect(loser.retryAfterHeader).toBe("1");
      // الجسمُ ثلاثةُ حقولٍ كما ينشرُ العقدُ — الترويسةُ سطحُ نقلٍ لا حقلٌ.
      expect(Object.keys(loser.body).sort()).toEqual(["error_code", "message", "trace_id"]);

      const retry = await callDelivery(gate, {
        method: "POST",
        path: "/store-orders",
        body,
        idempotencyKey: key,
      });
      expect(retry.status, retry.text).toBe(201);
      expect(retry.replayHeader).toBe("true");
      expect(canonicalJson(retry.body)).toBe(canonicalJson(winner.body));
      // والإعادةُ الناجحةُ لا تَعِدُ بشيءٍ.
      expect(retry.retryAfterHeader).toBeNull();
    }

    expect(
      refusals,
      "لم يظهرِ الرفضُ المتزامنُ في اثنتَي عشرةَ دورةً على السلكِ — لا قياسَ فلا مرورَ",
    ).toBe(1);
  });

  it("الجاهزيّةُ تُعلِنُ ما لا تدّعيهِ، والحياةُ لا تسألُ القاعدةَ", async () => {
    const ready = await callDelivery(gate, { method: "GET", path: "/delivery/ready" });
    expect(ready.status, ready.text).toBe(200);
    /*
     * والكتالوجُ **موصولٌ ومرصودٌ** الآنَ (المراجعةُ 15/N · §4.17): مسبارٌ حقيقيٌّ
     * يعبرُ حدَّ السوقِ بتوقيعٍ حقيقيٍّ بلا صلاحيّةٍ. فإفراغُ `not_claimed` هنا
     * ليسَ دعوى بل نتيجةُ سؤالٍ حصلَ — وهذا هوَ الفرقُ الذي كانَ الحقلُ يحفظُهُ
     * حينَ كانَ يقولُ `marketplace_catalog_not_probed` (§4.11).
     */
    expect(ready.body.not_claimed).toEqual([]);
    expect(ready.body.dependencies).toHaveLength(1);
    const observations = ready.body.dependencies as readonly Record<string, unknown>[];
    const observation = observations[0]!;
    expect(observation.name).toBe("marketplace_catalog");
    // `ok` حقيقيٌّ: `/health` السوقِ يسألُ قاعدتَهُ فعلاً، فالخُضرةُ تعني مخزناً يُجيبُ.
    expect(observation.ok, ready.text).toBe(true);
    expect(observation.detail).toBeUndefined();
    expect(observation.age_ms as number).toBeGreaterThanOrEqual(0);
    expect(Date.parse(observation.observed_at as string)).not.toBeNaN();
    /*
     * ومُعلِمٌ لا حاكمٌ: الحقلُ يُصرّحُ بذلكَ على السلكِ. ولو صارَ حاكماً لَأخرجَ
     * عطلُ السوقِ هذه الخدمةَ من الدورةِ بينما القراءةُ والإلغاءُ يعملانِ.
     */
    expect(observation.gates_readiness).toBe(false);
    expect(ready.body.status).toBe("ready");

    // ونبضةٌ ثانيةٌ تُقرأُ من الرصدِ المُخزَّنِ: عمرٌ لا يتراجعُ وحالةٌ لا تتبدّلُ.
    const second = await callDelivery(gate, { method: "GET", path: "/delivery/ready" });
    expect(second.status, second.text).toBe(200);
    const secondObservation = (second.body.dependencies as readonly Record<string, unknown>[])[0]!;
    expect(secondObservation.ok).toBe(true);
    expect(secondObservation.age_ms as number).toBeGreaterThanOrEqual(observation.age_ms as number);

    const health = await callDelivery(gate, { method: "GET", path: "/delivery/health" });
    expect(health.status, health.text).toBe(200);
  });

  it("طلبٌ لمنتجٍ غيرِ ظاهرٍ يُرفَضُ رفضاً دائماً — والسوقُ هوَ من قالَ ذلكَ", async () => {
    const market = gate.marketplaceBaseUrl;

    await call(market, {
      method: "POST",
      path: "/stores",
      body: {
        owner_public_id: OWNER,
        store_slug: STORE_SLUG,
        title_ar: "إلكترونيّات المدينة",
        category_slug: CATEGORY,
      },
      idempotencyKey: nextKey("register"),
    });
    await call(market, {
      method: "POST",
      path: `/stores/${STORE_SLUG}/review-requests`,
      body: { requested_by_public_id: OWNER },
      idempotencyKey: nextKey("review"),
    });
    await call(market, {
      method: "POST",
      path: `/stores/${STORE_SLUG}/decisions`,
      body: { decision: "approved", actor_type: "moderator", actor_public_id: MODERATOR },
      idempotencyKey: nextKey("store-decide"),
    });
    const created = await call(market, {
      method: "POST",
      path: `/stores/${STORE_SLUG}/products`,
      body: {
        sku: "SKU-GATE13-DRAFT",
        title_ar: "هاتفٌ مسوَّدةٌ",
        category_slug: CATEGORY,
        price_minor_units: UNIT_PRICE_MINOR_UNITS,
        currency_code: "SAR",
        created_by_public_id: OWNER,
      },
      idempotencyKey: nextKey("product"),
    });
    expect(created.status, created.text).toBe(201);
    const draftProductId = created.body.product_id as string;

    /*
     * منتجٌ مسوَّدةٌ: موجودٌ، وغيرُ ظاهرٍ. والفرقُ الذي تحرسُهُ هذه البوّابةُ أنَّ
     * الجوابَ **400-class** (رفضٌ دائمٌ) لا 503 (تعذُّرٌ عابرٌ): السوقُ أجابَ،
     * وجوابُهُ «لا يُطلَبُ». وخلطُ الاثنَينِ كانَ سيجعلَ العميلَ يُعيدُ المحاولةَ أبداً.
     */
    const refused = await callDelivery(gate, {
      method: "POST",
      path: "/store-orders",
      body: {
        customer_ref: CUSTOMER,
        store_slug: STORE_SLUG,
        items: [{ product_id: draftProductId, quantity: 1 }],
        delivery_fee_minor_units: DELIVERY_FEE_MINOR_UNITS,
      },
      idempotencyKey: nextKey("place-draft"),
    });
    expect(refused.status, refused.text).toBeLessThan(500);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.body.error_code).not.toBe("DELIVERY_MARKETPLACE_UNAVAILABLE");
    expect(await countRows(gate.pool, "store_orders")).toBe(0);
  });

  /*
   * المراجعةُ 11/N — الخصمُ النهائيُّ عندَ التسليمِ (ADR-026 §4.13).
   *
   * رحلةٌ كاملةٌ عبرَ HTTP من `confirmed` إلى `delivered`، يُثبتُ أنّ:
   *  - كلَّ انتقالاتِ الإكمالِ الستّةَ تُقطَعُ عبرَ سلكٍ حقيقيٍّ، لا بالقاعدةِ مباشرةً.
   *  - `delivered` يتطلَّبُ إثباتاً، وبدونِهِ يُرفَضُ.
   *  - الخصمُ النهائيُّ (`reserved → consumed`) يُكتَبُ في الصندوقِ في نفسِ المعاملةِ.
   *  - لا نداءَ للسوقِ عندَ الخصمِ: الحجزُ خصمٌ بالفعل.
   *  - الإلغاءُ بعدَ `consumed` لا يُطلِقُ الحجزَ.
   */
  it("الرحلةُ الكاملةُ confirmed → delivered عبرَ HTTP، والخصمُ النهائيُّ في الصندوقِ", async () => {
    const productId = await publishProduct();
    const order = await placeOrder(productId);
    const publicId = order.public_id as string;

    // المرآةُ والتأكيدُ كما في البوّابةِ السابقةِ.
    await callDelivery(gate, {
      method: "PUT",
      path: `/store-orders/${publicId}/payment-mirror`,
      body: { payment_state: "authorized", reason_code: "AUTHORIZATION_SUCCEEDED", payment_ref: PAYMENT_REF },
      idempotencyKey: nextKey("mirror"),
    });
    await callDelivery(gate, {
      method: "POST",
      path: `/store-orders/${publicId}/confirmation`,
      idempotencyKey: nextKey("confirm"),
    });

    // انتقالاتُ الإكمالِ الستّةُ عبرَ HTTP.
    const transitions: { to: string; proof?: { proof_type: string; proof_ref: string } }[] = [
      { to: "picking" },
      { to: "picked" },
      { to: "ready_for_delivery" },
      { to: "handed_to_courier" },
      { to: "delivered", proof: { proof_type: "otp", proof_ref: "OTP-GATE13-DELIVERED-001" } },
    ];

    for (const t of transitions) {
      const body: Record<string, unknown> = { to_state: t.to };
      if (t.proof) {
        body.proof_type = t.proof.proof_type;
        body.proof_ref = t.proof.proof_ref;
      }
      const res = await callDelivery(gate, {
        method: "POST",
        path: `/store-orders/${publicId}/fulfillment-transition`,
        body,
        idempotencyKey: nextKey(`ft-${t.to}`),
      });
      expect(res.status, res.text).toBe(200);
    }

    // القراءةُ الطازجةُ: `delivered` محفوظةٌ لا مُدَّعاةٌ.
    const read = await callDelivery(gate, {
      method: "GET",
      path: `/store-orders/${publicId}`,
    });
    expect(read.body.fulfillment_state).toBe("delivered");

    // والصندوقُ يحمِلُ حدثَ الخصمِ النهائيِّ في نفسِ المعاملةِ.
    const rows = await deliveryOutbox(gate.pool);
    const consumed = rows.find((row) => row.event.event_type === "store_order.inventory_consumed");
    expect(consumed, "لا حدثَ خصمٍ نهائيٍّ في الصندوقِ").toBeDefined();
    const consumedPayload = consumed!.event.payload as Record<string, unknown>;
    expect(consumedPayload.to_state).toBe("consumed");
    expect(consumedPayload.reason_code).toBe("INVENTORY_CONSUMED");

    // وكلُّ حدثٍ في الصندوقِ يُطابقُ العقدَ المنشورَ.
    const defs = contractEventDefs();
    expect(defs).toContain(defNameOf("store_order.inventory_consumed"));

    /*
     * والإلغاءُ بعدَ `delivered` و`consumed` لا يُطلِقُ الحجزَ: المخزونُ خُصِمَ بالفعل
     * عندَ الحجزِ، والخصمُ النهائيُّ قرارُ تسليمٍ داخليٌّ. ونداءُ `release` هنا كانَ
     * سيُعيدُ للمخزونِ ما لم يُحجَزْ أصلاً.
     */
    const cancel = await callDelivery(gate, {
      method: "POST",
      path: `/store-orders/${publicId}/cancellation`,
      body: { reason_code: "SYSTEM_MAINTENANCE" },
      idempotencyKey: nextKey("cancel-after-delivered"),
    });
    // `delivered` طرفيٌّ — لا حافّةَ منها إلى `cancelled`.
    expect(cancel.status).toBeGreaterThanOrEqual(400);
    expect(cancel.status).toBeLessThan(500);
  });

  /**
   * فرضُ الهويّةِ **على السلكِ** (`M1-04` · الموجةُ السادسةُ · المراجعةُ 17/N).
   *
   * واختباراتُ الوحدةِ تُثبِتُ المصفوفةَ كلَّها عبرَ `app.inject`، وهيَ لا تمرُّ
   * بمقبسٍ ولا بترجمةِ ترويساتٍ حقيقيّةٍ. وهذه الدعاوى الثلاثُ هيَ **الموضعُ
   * الوحيدُ** الذي يشهدُ أنَّ الحدَّ مفروضٌ على مُستمعٍ حقيقيٍّ كما سيكونُ في
   * الإنتاجِ — ولذلكَ تستعملُ `call` **عارياً** لا `callDelivery`.
   */
  describe("بوّابة الطور 13 — المصادقة الداخلة على مستمع حقيقي", () => {
    it("طلبٌ بلا توقيعٍ على مسارٍ مُغلَقٍ يُرَدُّ 401 بمغلّف عقد التوصيل", async () => {
      const res = await call(gate.deliveryBaseUrl, {
        method: "POST",
        path: "/store-orders",
        body: { customer_ref: CUSTOMER, store_slug: STORE_SLUG, items: [], delivery_fee_minor_units: 0 },
        idempotencyKey: nextKey("unsigned"),
      });
      expect(res.status, res.text).toBe(401);
      expect(res.body.error_code).toBe("AUTHN_UNAUTHENTICATED");
      expect(res.body.trace_id).toBeTruthy();
      // ولا `code`: مغلّفُ هذا الحدِّ `error_code` في الرفضِ كما في كلِّ خطأٍ.
      expect(res.body.code).toBeUndefined();
    });

    it("قراءةُ طلبٍ بلا توقيعٍ تُرَدُّ 401 لا 404 — لا استكشافَ مُعرِّفاتٍ بلا هويّةٍ", async () => {
      const res = await call(gate.deliveryBaseUrl, {
        method: "GET",
        path: "/store-orders/WS-0000000001",
      });
      expect(res.status, res.text).toBe(401);
    });

    it("`/delivery/health` يُجيبُ 200 بلا توقيعٍ — مفتوحٌ بقصدٍ لا سهواً", async () => {
      const res = await call(gate.deliveryBaseUrl, { method: "GET", path: "/delivery/health" });
      expect(res.status, res.text).toBe(200);
      expect(res.body.status).toBe("ok");
    });
  });

  /**
   * إقرارُ رايةِ تضاربٍ **على مقبسٍ حقيقيٍّ وقاعدةٍ حقيقيّةٍ** (المراجعةُ 18/N ·
   * ADR-026 §4.20).
   *
   * وما لا يُثبِتُهُ اختبارُ وحدةٍ ولا اختبارُ تكامُلٍ وحدَهُ:
   *
   *   • **الرايةُ نفسُها لم تُلفَّقْ**: طلبٌ حقيقيٌّ يحجزُ، ثمَّ السوقُ يكتبُ
   *     تعديلَ نقصٍ، ثمَّ الناقلُ يكشفُ — فالمُقَرُّ حادثةٌ وُلِدَتْ من الرحلةِ.
   *   • **البابانِ مفصولانِ فعلاً**: رمزٌ يحملُ `:read` وحدَهُ **لا يُقِرُّ**. وهذا
   *     هوَ مبرَّرُ الصلاحيّةِ العاشرةِ كلِّهِ، ولو مرَّ لصارَ كلُّ قارئِ لوحةٍ
   *     قادراً على إغلاقِ الحوادثِ باسمِهِ.
   *   • **التركيبُ في الجذرِ**: 404 لا 500 يشهدُ أنَّ المنفذَ مُركَّبٌ.
   */
  describe("بوّابة الطور 13 — إقرارُ رايةِ التضاربِ", () => {
    const UNKNOWN_ADJUSTMENT = "cccccccc-0000-0000-0000-0000000000ee";
    const ackPath = (adjustmentId: string) =>
      `/delivery/inventory-conflicts/${adjustmentId}/acknowledgement`;

    /** رحلةٌ كاملةٌ تُنتِجُ رايةً واحدةً، ويُعادُ مُعرِّفُ تعديلِها. */
    async function raiseOneConflict(): Promise<string> {
      const productId = await publishProduct();
      // الطلبُ يحجزُ فعلاً عبرَ حدِّ السوقِ — لا صفَّ حجزٍ مزروعٍ.
      await placeOrder(productId);

      const adjusted = await call(gate.marketplaceBaseUrl, {
        method: "POST",
        path: `/products/${productId}/inventory`,
        body: { quantity_delta: -7, reason_code: "shrinkage", actor_public_id: OWNER },
        idempotencyKey: nextKey("shrink-under-reservation"),
      });
      expect(adjusted.status, adjusted.text).toBe(201);

      const outcome = await gate.relayInventory();
      /*
       * ثلاثةُ أحداثِ مخزونٍ في هذهِ الرحلةِ: التخزينُ (+9) وخصمُ الحجزِ (−2)
       * والنقصُ (−7). واثنانِ يُطبَّقانِ **وواحدٌ يُسَمُّ** — وهذا عطبٌ حقيقيٌّ
       * رُصِدَ هنا أوّلَ مرّةٍ وسُجِّلَ `RISK-0035`، **ولا يُصلَحُ في هذهِ
       * المراجعةِ**: حدُّ السوقِ يكتبُ `actor_public_id: "system:delivery"` على
       * حدثِ خصمِ الحجزِ، ومُصنِّفُ ناقلِ التوصيلِ يشترطُ `^WS-[0-9]{10}$` فيَسُمُّ
       * الصفَّ وتتقدَّمُ نقطةُ التقدُّمِ فوقَهُ — أي حدثٌ **يُفقَدُ** لا يُعادُ.
       * وإصلاحُهُ يمسُّ إمّا حمولةَ حدثٍ منشورٍ أو مُصنِّفَ الناقلِ، وكلاهما موضوعٌ
       * قائمٌ بذاتِهِ لا يُدَسُّ في دَفعةِ مسارٍ آخرَ.
       *
       * وتوكيدُ الرقمِ صريحٌ لا متساهلٌ: `toBeGreaterThan` كانَ سيصمتُ لو صارَ
       * المسمومُ اثنَينِ، والعطبُ المُسجَّلُ يُقاسُ ولا يُغطّى.
       */
      expect({ applied: outcome.applied, poisoned: outcome.poisoned }).toEqual({
        applied: 2,
        poisoned: 1,
      });

      const conflicts = await gate.pool.query<{ adjustment_id: string }>(
        `SELECT adjustment_id::text FROM delivery_inventory_conflicts`,
      );
      expect(conflicts.rows, "لا رايةَ كُشِفَتْ من الرحلةِ").toHaveLength(1);
      return conflicts.rows[0]!.adjustment_id;
    }

    it("رمزٌ بصلاحيّةِ القراءةِ وحدَها لا يُقِرُّ — 403، والبابانِ مفصولانِ", async () => {
      const res = await callDelivery(gate, {
        method: "POST",
        path: ackPath(UNKNOWN_ADJUSTMENT),
        scopes: [DELIVERY_SCOPES.inventoryConflictsRead],
      });
      expect(res.status, res.text).toBe(403);
      // و403 قبلَ أيِّ لمسٍ للقاعدةِ: لا يُقالُ لمن لا يملكُ الصلاحيّةَ «لا رايةَ
      // بهذا المُعرِّفِ» — وذلكَ استكشافُ مُعرِّفاتٍ بلا حقٍّ.
      expect(res.body.error_code).toBe("AUTHZ_FORBIDDEN");
    });

    it("بلا توقيعٍ ⇒ 401 لا 404 ولا 400", async () => {
      const res = await call(gate.deliveryBaseUrl, {
        method: "POST",
        path: ackPath(UNKNOWN_ADJUSTMENT),
      });
      expect(res.status, res.text).toBe(401);
      expect(res.body.error_code).toBe("AUTHN_UNAUTHENTICATED");
    });

    it("مُعرِّفٌ لا رايةَ لهُ ⇒ 404 بالرمزِ الخاصِّ — لا 500، فالمنفذُ مُركَّبٌ", async () => {
      const res = await callDelivery(gate, {
        method: "POST",
        path: ackPath(UNKNOWN_ADJUSTMENT),
        scopes: [DELIVERY_SCOPES.inventoryConflictAcknowledge],
      });
      expect(res.status, res.text).toBe(404);
      expect(res.body.error_code).toBe("DELIVERY_INVENTORY_CONFLICT_NOT_FOUND");
    });

    it("جسمٌ يُسمّي المُقِرَّ يُرَدُّ 400 على السلكِ — المُقِرُّ من الرمزِ", async () => {
      const res = await callDelivery(gate, {
        method: "POST",
        path: ackPath(UNKNOWN_ADJUSTMENT),
        body: { acknowledged_by: "قسمُ العملياتِ" },
        scopes: [DELIVERY_SCOPES.inventoryConflictAcknowledge],
      });
      // 400 **قبلَ** 404: خطأُ نداءٍ يُقالُ قبلَ البحثِ، وإلّا لَظنَّ المنادي أنَّ
      // حقلَهُ مقبولٌ وأنَّ العيبَ في المُعرِّفِ وحدَهُ.
      expect(res.status, res.text).toBe(400);
      expect(res.body.error_code).toBe("DELIVERY_VALIDATION_FAILED");
    });

    it("رايةٌ حقيقيّةٌ من الرحلةِ: 200 `acknowledged` ثمَّ `already_acknowledged` باسمِ الأوّلِ", async () => {
      const adjustmentId = await raiseOneConflict();

      // وقبلَ الإقرارِ: اللوحةُ تُظهِرُها في غيرِ المُقَرِّ.
      const before = await callDelivery(gate, {
        method: "GET",
        path: "/delivery/inventory-conflicts?unacknowledged_only=true",
        scopes: [DELIVERY_SCOPES.inventoryConflictsRead],
      });
      expect(before.status, before.text).toBe(200);
      expect(before.body.count).toBe(1);

      const first = await callDelivery(gate, {
        method: "POST",
        path: ackPath(adjustmentId),
        scopes: [DELIVERY_SCOPES.inventoryConflictAcknowledge],
      });
      expect(first.status, first.text).toBe(200);
      expect(first.body.outcome).toBe("acknowledged");
      const conflict = first.body.conflict as Record<string, unknown>;
      // المُقِرُّ من الرمزِ الذي وقَّعَ هذا النداءَ (`core` في البوّابةِ)، ولا من
      // جسمٍ ولا من افتراضٍ.
      expect(conflict.acknowledged_by).toBe("service:core");
      expect(conflict.acknowledged_at).toBeTruthy();
      expect(conflict.adjustment_id).toBe(adjustmentId);
      // ورايةُ الإقرارِ لا تُغيِّرُ حالةَ طلبٍ (§4.18): الإقرارُ حُكمٌ بشريٌّ لا
      // انتقالُ حالةٍ.
      expect(conflict.changes_order_state).toBe(false);

      const second = await callDelivery(gate, {
        method: "POST",
        path: ackPath(adjustmentId),
        scopes: [DELIVERY_SCOPES.inventoryConflictAcknowledge],
      });
      expect(second.status, second.text).toBe(200);
      expect(second.body.outcome).toBe("already_acknowledged");
      expect((second.body.conflict as Record<string, unknown>).acknowledged_at).toBe(
        conflict.acknowledged_at,
      );

      // وبعدَ الإقرارِ تخرجُ من لوحةِ غيرِ المُقَرِّ: البابانِ على صفٍّ واحدٍ.
      const after = await callDelivery(gate, {
        method: "GET",
        path: "/delivery/inventory-conflicts?unacknowledged_only=true",
        scopes: [DELIVERY_SCOPES.inventoryConflictsRead],
      });
      expect(after.status, after.text).toBe(200);
      expect(after.body.count).toBe(0);
    });
  });
});
