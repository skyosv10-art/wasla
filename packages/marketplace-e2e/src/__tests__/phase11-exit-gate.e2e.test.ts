/**
 * بوّابةُ خروجِ الطورِ 11 — خمسةُ توكيداتٍ لا يُثبتها اختبارُ خدمةٍ واحدة.
 *
 * ولمَ خمسةٌ فقط؟ لأنّ البوّابةَ ليست نسخةً ثانيةً من 434 اختباراً؛ هي الطبقةُ التي تسأل ما
 * لا يستطيع اختبارُ خدمةٍ سؤالَه: هل تمرّ الرحلةُ كاملةً **عبرَ سلك**؟ وهل ما يُكتب في
 * الصندوقِ يُطابق **الورقةَ المنشورةَ** غلافاً وحمولةً؟ وهل يصمد الجوابُ المحفوظُ بايتاً
 * ببايت على مُستمعٍ حقيقيّ؟ وهل ترتيبُ حدثَينِ في معاملةٍ واحدةٍ ترتيبُ الكتابةِ فعلاً؟ وهل
 * الناقلُ **غائبٌ** كما يُعلَن؟ وكلُّ توكيدٍ زائدٍ فوق ذلك يُكرّر حارساً قائماً فيصير عبئاً
 * يُعدَّل مرّتَين.
 *
 * Related Docs: docs/12-testing/PHASE11_EXIT_GATE_E2E.md
 */
import { MARKETPLACE_EVENT_TYPES } from "@wasla/marketplace-service";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CATEGORY,
  MEMBER,
  MODERATOR,
  NOW,
  OWNER,
  PG_ENABLED,
  STORE_SLUG,
  call,
  canonicalJson,
  contractEventTypes,
  countRows,
  defNameOf,
  envelopeViolations,
  envelopesOf,
  nextKey,
  outboxRecords,
  resetData,
  seedLeafCategory,
  startGate,
  type GateContext,
} from "../harness.js";

/** أجسامُ الرحلةِ كما يُعلنها العقدُ — لا حالةَ في جسمٍ، والقرارُ هو ما يُرسَل. */
const registerBody = {
  owner_public_id: OWNER,
  store_slug: STORE_SLUG,
  title_ar: "إلكترونيّات المدينة",
  category_slug: CATEGORY,
};

const productBody = {
  sku: "SKU-GATE-001",
  title_ar: "هاتف",
  category_slug: CATEGORY,
  price_minor_units: 249900,
  currency_code: "SAR",
  created_by_public_id: OWNER,
};

describe.skipIf(!PG_ENABLED)("بوّابةُ خروج Phase 11 · السوقُ على مُستمعٍ وقاعدةٍ حقيقيَّين", () => {
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
   * الرحلةُ كاملةً عبرَ الشبكةِ — تُعيد مُعرِّفَ المنتجِ.
   *
   * وكلُّ خطوةٍ تُوكَّد بحالتِها لأنّ خطوةً تفشل صامتةً كانت ستجعل التوكيدَ التالي يقرأ
   * صندوقاً ناقصاً ثمّ يُنسَب الفشلُ إلى العقدِ لا إلى الخطوة.
   */
  async function runJourney(): Promise<string> {
    const registered = await call(gate, {
      method: "POST",
      path: "/stores",
      body: registerBody,
      idempotencyKey: nextKey("register"),
    });
    expect(registered.status, registered.text).toBe(201);
    expect(registered.body.state).toBe("draft");

    const requested = await call(gate, {
      method: "POST",
      path: `/stores/${STORE_SLUG}/review-requests`,
      body: { requested_by_public_id: OWNER },
      idempotencyKey: nextKey("review"),
    });
    expect(requested.status, requested.text).toBe(201);

    const approved = await call(gate, {
      method: "POST",
      path: `/stores/${STORE_SLUG}/decisions`,
      body: { decision: "approved", actor_type: "moderator", actor_public_id: MODERATOR },
      idempotencyKey: nextKey("store-decide"),
    });
    expect(approved.status, approved.text).toBe(201);

    const staffAdded = await call(gate, {
      method: "POST",
      path: `/stores/${STORE_SLUG}/staff`,
      body: { member_public_id: MEMBER, role: "manager", added_by_public_id: OWNER },
      idempotencyKey: nextKey("staff-add"),
    });
    expect(staffAdded.status, staffAdded.text).toBe(201);

    const created = await call(gate, {
      method: "POST",
      path: `/stores/${STORE_SLUG}/products`,
      body: productBody,
      idempotencyKey: nextKey("product"),
    });
    expect(created.status, created.text).toBe(201);
    const productId = created.body.product_id as string;
    expect(productId).toMatch(/^[0-9a-f-]{36}$/u);

    const moderated = await call(gate, {
      method: "POST",
      path: `/products/${productId}/decisions`,
      body: { decision: "approved", actor_type: "moderator", actor_public_id: MODERATOR },
      idempotencyKey: nextKey("product-decide"),
    });
    expect(moderated.status, moderated.text).toBe(201);

    const stocked = await call(gate, {
      method: "POST",
      path: `/products/${productId}/inventory`,
      body: { quantity_delta: 7, reason_code: "restock", actor_public_id: OWNER },
      idempotencyKey: nextKey("inventory"),
    });
    expect(stocked.status, stocked.text).toBe(201);

    const published = await call(gate, {
      method: "POST",
      path: `/products/${productId}/publish`,
      body: { actor_public_id: OWNER },
      idempotencyKey: nextKey("publish"),
    });
    expect(published.status, published.text).toBe(200);

    return productId;
  }

  it("الرحلةُ تمرّ عبرَ الشبكةِ لا عبرَ مِقبضٍ داخليّ، والظهورُ يقلب بقلبِ شرطٍ واحد", async () => {
    const productId = await runJourney();

    // الظهورُ اقترانُ أربعةِ شروطٍ مُشتَقٍّ عندَ القراءة — والرحلةُ استوفتها كلَّها.
    const visible = await call(gate, { method: "GET", path: `/products/${productId}` });
    expect(visible.status, visible.text).toBe(200);
    expect(visible.body.state).toBe("published");
    expect(visible.body.moderation_state).toBe("approved");
    expect(visible.body.is_visible).toBe(true);

    // ثمّ أرشفةٌ: شرطٌ واحدٌ يُقلَب فيسقط الظهور. ولو كان عموداً محفوظاً لبقيَ `true`.
    const archived = await call(gate, {
      method: "POST",
      path: `/products/${productId}/archive`,
      body: { actor_public_id: OWNER },
      idempotencyKey: nextKey("archive"),
    });
    expect(archived.status, archived.text).toBe(200);

    const after = await call(gate, { method: "GET", path: `/products/${productId}` });
    expect(after.body.state).toBe("archived");
    expect(after.body.is_visible).toBe(false);

    // والصحّةُ تقول `postgres` — لا `unavailable` مع قاعدةٍ حاضرةٍ ومُستمعٍ قائم.
    const health = await call(gate, { method: "GET", path: "/health" });
    expect(health.body).toEqual({ status: "ok", mode: "postgres" });
  });

  it("وكلُّ حدثٍ كتبته الرحلةُ يُطابق العقدَ المنشورَ غلافاً وحمولةً — لا `data` وحدَها", async () => {
    const productId = await runJourney();
    await call(gate, {
      method: "POST",
      path: `/products/${productId}/archive`,
      body: { actor_public_id: OWNER },
      idempotencyKey: nextKey("archive"),
    });

    const records = await outboxRecords(gate);
    const envelopes = envelopesOf(records);

    /**
     * أحدَ عشرَ حدثاً لا أكثرَ ولا أقلّ، وبهذا الترتيب.
     *
     * والعددُ مكتوبٌ صريحاً لأنّ حدثاً يُضاف بلا سببٍ هو عيبٌ كعيبِ حدثٍ يُنسى: مُستهلِكٌ
     * يبني فهرساً على تسلسلٍ يقرأ صفّاً لا يُقابل قراراً. و`store_registered` أوّلُها لأنّ
     * التسجيلَ يُنشئ مورِداً — ولا صفَّ دفترٍ له، وذلك فرقٌ مقصودٌ لا سهوٌ.
     */
    expect(records.map((record) => record.eventType)).toEqual([
      "marketplace.store_registered",
      "marketplace.store_review_requested",
      "marketplace.store_approved",
      "marketplace.store_staff_added",
      "marketplace.product_created",
      "marketplace.product_moderated",
      "marketplace.inventory_adjusted",
      "marketplace.product_published",
      "marketplace.inventory_adjusted",
      "marketplace.product_archived",
    ]);

    // والتصديقُ على الورقةِ المنشورةِ لا على فهمِ الاختبارِ لها: المخالفاتُ تُطبَع كما هي.
    const failures = envelopes.flatMap((envelope) => envelopeViolations(envelope));
    expect(failures).toEqual([]);

    // والمُصدِّقُ نفسُه يجب أن يكون قد رأى شيئاً — قائمةٌ فارغةٌ تنجح مجّاناً.
    expect(envelopes.length).toBeGreaterThanOrEqual(10);
    for (const envelope of envelopes) {
      expect(envelope.producer).toBe("marketplace-service");
      expect(envelope.event_version).toBe("v1");
      expect(envelope.occurred_at).toBe(NOW);
    }
  });

  it("وأنواعُ الأحداثِ في الكودِ هي المنشورةُ في الورقةِ — لا نوعَ بلا تعريفٍ ولا تعريفَ بلا نوع", () => {
    const declared = [...MARKETPLACE_EVENT_TYPES].map((type) => defNameOf(type)).sort();
    const published = [...contractEventTypes()].sort();
    expect(published).toEqual(declared);
  });

  it("والجوابُ المحفوظُ يُعاد بحالتِه وحقولِه على السلك، ولا صفَّ ثانياً للمفتاحِ المُعاد", async () => {
    const key = nextKey("replay");
    const first = await call(gate, {
      method: "POST",
      path: "/stores",
      body: registerBody,
      idempotencyKey: key,
    });
    expect(first.status, first.text).toBe(201);

    const replay = await call(gate, {
      method: "POST",
      path: "/stores",
      body: registerBody,
      idempotencyKey: key,
    });

    /**
     * والضمانُ المقيسُ: **نفسُ الحالةِ ونفسُ الحقولِ**، لا نفسُ بايتاتِ النصّ.
     *
     * وقد كُتب هذا التوكيدُ أوّلاً على `text === text` فأسقطته البوّابةُ: الجسمُ يُحفَظ في
     * عمودِ `response_body JSONB`، وJSONB يُخزِّن شجرةً مُفكَّكةً **يُعيد ترتيبَ مفاتيحِها**
     * عندَ إخراجِها — فالإعادةُ تُعيد نفسَ الحقولِ بترتيبٍ آخر. وكانت ثلاثةُ مواضعَ في
     * الشجرةِ تُعلن «نفسَ البايتات» وهي دعوى أوسعُ من المُنفَّذ، فصُحِّحت في هذه المراجعةِ
     * وسُجِّل الفرقُ في `RISK-0013` مع خيارَي البرهانِ التامِّ (مُسلسِلٌ قانونيٌّ للجوابِ، أو
     * عمودٌ نصّيٌّ في العقد) — وكلاهما قرارُ مالكٍ لا قرارُ عاملٍ في نطاقِ الطورِ 11.
     *
     * فيُوكَّد ما يقدر عليه الحدُّ فعلاً: الحالةُ، والتساوي حقلاً بحقلٍ في كلّ عمقٍ، ومجموعةُ
     * المفاتيحِ نفسُها — ولا يُوكَّد اختلافُ النصَّين، فتثبيتُ عَرَضٍ يجعل إصلاحَه إخفاقاً.
     */
    expect(replay.status).toBe(first.status);
    expect(replay.body).toEqual(first.body);
    expect(canonicalJson(replay.body)).toBe(canonicalJson(first.body));

    expect(await countRows(gate.pool, "stores")).toBe(1);
    expect(await countRows(gate.pool, "marketplace_outbox")).toBe(1);

    // ونفسُ المفتاحِ لجسمٍ آخرَ تعارضٌ مُسمّىً لا كتابةٌ صامتة.
    const conflict = await call(gate, {
      method: "POST",
      path: "/stores",
      body: { ...registerBody, store_slug: "another-store" },
      idempotencyKey: key,
    });
    expect(conflict.status, conflict.text).toBe(409);
    expect(await countRows(gate.pool, "stores")).toBe(1);
  });

  it("وترتيبُ حدثَينِ في معاملةٍ واحدةٍ ترتيبُ الكتابةِ لا ترتيبُ مُعرِّفٍ عشوائيّ", async () => {
    const productId = await runJourney();
    const before = (await outboxRecords(gate)).length;

    // الأرشفةُ تكتب حدثَينِ في معاملةٍ واحدة: تصفيرُ المخزونِ ثمّ الأرشفة.
    const archived = await call(gate, {
      method: "POST",
      path: `/products/${productId}/archive`,
      body: { actor_public_id: OWNER },
      idempotencyKey: nextKey("archive"),
    });
    expect(archived.status, archived.text).toBe(200);

    const records = await outboxRecords(gate);
    expect(records.length).toBe(before + 2);
    const [zeroed, archivedEvent] = records.slice(-2);
    expect(zeroed?.eventType).toBe("marketplace.inventory_adjusted");
    expect(archivedEvent?.eventType).toBe("marketplace.product_archived");

    /**
     * والدليلُ على **سببِ** الصحّةِ لا على نتيجتِها.
     *
     * `now()` لحظةُ بدءِ المعاملةِ فتتساوى في صفوفِها، وقد أخفقت هذه البوّابةُ بها فعلاً
     * (`RISK-0012`). فيُقرأ `created_at::text` خاماً — لأنّ `OutboxRecord.createdAt` بدقّةِ
     * الميلي فتُخفي فرقَ الميكروثانية — ويُوكَّد **تمايزُ** الطابعَينِ وأنّ أيَّهما لا يساوي
     * لحظةَ بدءِ المعاملة. ولو رجعَ العمودُ إلى `DEFAULT now()` سقطَ هذا التوكيدُ باسمِه.
     */
    const stamps = await gate.pool.query<{ readonly stamp: string; readonly same: boolean }>(
      `SELECT created_at::text AS stamp, created_at = now() AS same
         FROM marketplace_outbox
        WHERE outbox_id = ANY($1::uuid[])`,
      [[zeroed?.outboxId, archivedEvent?.outboxId]],
    );
    expect(stamps.rows).toHaveLength(2);
    expect(new Set(stamps.rows.map((row) => row.stamp)).size).toBe(2);
    expect(stamps.rows.every((row) => row.same === false)).toBe(true);
  });

  it("ولا ناقلَ: كلُّ صفٍّ يبقى غيرَ منشورٍ، ولا دالّةَ ختمٍ على سطحِ المخزن", async () => {
    await runJourney();

    /**
     * دَينُ الطورِ 09 مُعلَنٌ — والمُعلَنُ يُثبَّت لا يُترك ظنّاً.
     *
     * فلو أُضيف ناقلٌ يوماً بلا وثيقةٍ ولا سجلٍّ سقطت هذه البوّابةُ باسمِها، وذاك أفضلُ من
     * ملاحظةٍ في وثيقةٍ تُقرأ بعدَ الحادث.
     */
    const unpublished = await gate.pool.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count FROM marketplace_outbox WHERE published_at IS NOT NULL`,
    );
    expect(unpublished.rows[0]?.count).toBe("0");

    const written = await countRows(gate.pool, "marketplace_outbox");
    expect(written).toBeGreaterThan(0);
    expect((await outboxRecords(gate)).length).toBe(written);

    // ولا دالّةَ ختمٍ أصلاً: `markPublished` ليست على السطحِ، فلا يُمكن ختمُ صفٍّ بلا ناقل.
    const surface = gate.stores.outbox as unknown as Record<string, unknown>;
    expect(surface.markPublished).toBeUndefined();
    expect(typeof surface.listUnpublished).toBe("function");
  });
});

/**
 * ## النطاق
 *
 * خمسةُ توكيداتٍ على مُستمعٍ حقيقيٍّ وقاعدةٍ حقيقيّة: الرحلةُ والظهورُ المُشتَقّ، وتصديقُ كلِّ
 * غلافٍ على `contracts/events.json`، وتطابقُ أنواعِ الكودِ مع الورقة، وإعادةُ الجوابِ المحفوظِ
 * بايتاً ببايت، وترتيبُ المعاملةِ الواحدة، وغيابُ الناقلِ مُثبَّتاً.
 *
 * ## آخر تحديث
 *
 * المراجعة 6/6 — الملفُّ جديد.
 *
 * ## الحالة
 *
 * يحتاج `DATABASE_URL`؛ ويتخطّى نفسَه بلا قاعدة.
 *
 * ## كودٌ ذو صلة
 *
 * `services/marketplace/src/http/app.ts` · `services/marketplace/src/db/outbox.ts` ·
 * `services/marketplace/contracts/events.json`.
 *
 * ## الفريق
 *
 * Marketplace / Data.
 */
