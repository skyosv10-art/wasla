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
    const placed = await call(gate.deliveryBaseUrl, {
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
    const mirrored = await call(gate.deliveryBaseUrl, {
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
    const confirmed = await call(gate.deliveryBaseUrl, {
      method: "POST",
      path: `/store-orders/${publicId}/confirmation`,
      idempotencyKey: nextKey("confirm"),
    });
    expect(confirmed.status, confirmed.text).toBe(200);
    expect(confirmed.body.fulfillment_state).toBe("confirmed");
    expect(confirmed.body.payment_state).toBe("authorized");

    // والقراءةُ الطازجةُ من القاعدةِ لا من الجوابِ المُعادِ — الحالةُ محفوظةٌ لا مُدَّعاةٌ.
    const read = await call(gate.deliveryBaseUrl, {
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

    await call(gate.deliveryBaseUrl, {
      method: "PUT",
      path: `/store-orders/${publicId}/payment-mirror`,
      body: { payment_state: "authorized", reason_code: "AUTHORIZATION_SUCCEEDED", payment_ref: PAYMENT_REF },
      idempotencyKey: nextKey("mirror"),
    });
    await call(gate.deliveryBaseUrl, {
      method: "POST",
      path: `/store-orders/${publicId}/confirmation`,
      idempotencyKey: nextKey("confirm"),
    });

    const rows = await deliveryOutbox(gate.pool);

    // ثلاثةُ أحداثٍ لا أكثرَ: الطلبُ، ثمّ محورُ الدفعِ، ثمّ محورُ التنفيذِ.
    // الترتيبُ مقروءٌ لا مُفترَضٌ: الإيداعُ يكتبُ حدثَ الطلبِ وحدثَ المهمّةِ في
    // معاملةٍ واحدةٍ، ثمَّ تأتي المرآةُ فالتأكيدُ. وأيُّ زيادةٍ صامتةٍ هنا تُسقِطُ
    // البوّابةَ — وهوَ المطلوبُ: ناشرٌ جديدٌ يُعلَنُ في العقدِ لا يُكتشَفُ لاحقاً.
    expect(rows.map((row) => row.event.event_type)).toEqual([
      "store_order.created",
      "delivery.task_created",
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

    const first = await call(gate.deliveryBaseUrl, {
      method: "PUT",
      path: `/store-orders/${publicId}/payment-mirror`,
      body: { payment_state: "authorized", reason_code: "AUTHORIZATION_SUCCEEDED", payment_ref: PAYMENT_REF },
      idempotencyKey: key,
    });
    expect(first.status, first.text).toBe(200);
    expect(first.replayHeader).toBeNull();

    const replay = await call(gate.deliveryBaseUrl, {
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
    const reused = await call(gate.deliveryBaseUrl, {
      method: "PUT",
      path: `/store-orders/${publicId}/payment-mirror`,
      body: { payment_state: "authorized", reason_code: "AUTHORIZATION_SUCCEEDED", payment_ref: "psp_other_ref" },
      idempotencyKey: key,
    });
    expect(reused.status, reused.text).toBe(409);
    expect(reused.body.error_code).toBe("DELIVERY_IDEMPOTENCY_KEY_REUSED");
  });

  it("الجاهزيّةُ تُعلِنُ ما لا تدّعيهِ، والحياةُ لا تسألُ القاعدةَ", async () => {
    const ready = await call(gate.deliveryBaseUrl, { method: "GET", path: "/delivery/ready" });
    expect(ready.status, ready.text).toBe(200);
    /*
     * الكتالوجُ **موصولٌ** هنا (محوّلٌ حقيقيٌّ على أصلٍ حقيقيٍّ)، ومع ذلكَ يبقى في
     * `not_claimed` بعلامةِ «غيرُ مفحوصٍ»: الجاهزيّةُ لا تفحصُ حدَّ السوقِ فلا
     * تدّعي صحّتَهُ. وإفراغُ الحقلِ عندَ الوصلِ كانَ سيكونُ الكذبةَ التي أُنشِئَ
     * الحقلُ لمنعِها (§4.11).
     */
    expect(ready.body.not_claimed).toEqual(["marketplace_catalog_not_probed"]);

    const health = await call(gate.deliveryBaseUrl, { method: "GET", path: "/delivery/health" });
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
    const refused = await call(gate.deliveryBaseUrl, {
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
});
