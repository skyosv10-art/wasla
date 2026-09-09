/**
 * بوّابةُ خروجِ الطورِ 12 — صلةٌ وحملٌ، على فهرسٍ بناهُ الناقلُ وخدمةٍ تُنادى عبرَ السلكِ.
 *
 * ثمانيةُ أبوابٍ، وكلُّ بابٍ يسألُ ما لا يستطيعُ اختبارُ خدمةٍ سؤالَه:
 *
 *   1. **خطُّ الأنابيبِ**  — هل الوثائقُ التي سيُبحَثُ فيها **من أحداثٍ** لا من `INSERT`؟
 *   2. **أحكامُ الصلةِ**   — هل يتصدَّرُ **مَن كُتِبَ أنّه يجبُ أن يتصدَّرَ** قبلَ القياسِ؟
 *   3. **الظهورُ مُشتقٌّ**  — هل تختفي خمسُ وثائقَ لخمسةِ أسبابٍ، وهي في الجدولِ لا محذوفةٌ؟
 *   4. **الظهورُ حيٌّ**    — هل يُخفي حدثُ مخزونٍ وثيقةً ثمّ يُعيدُها، بلا `DELETE` ولا رايةٍ؟
 *   5. **الترقيمُ والترتيبُ** — هل الصفحتانِ منفصلتانِ والمجموعُ ثابتٌ، والفرزُ فرزٌ فعلاً؟
 *   6. **الأخطاءُ على السلكِ** — هل يُردُّ 400 برمزٍ، ولا 500 بحالٍ؟
 *   7. **بوّابةُ الحملِ**  — هل يصمدُ الزمنُ على ألفَي وثيقةٍ، تسلسلاً وتزامناً؟
 *   8. **الحدُّ المُعلَنُ** — هل سقفُ المُرشَّحينَ 500 كما تقولُ الترويسةُ، أم قولٌ بلا قياسٍ؟
 *
 * وكلُّ بابٍ زائدٍ فوقَ ذلك يُكرِّرُ حارساً قائماً في `services/search/src/__tests__/` فيصيرُ
 * عبئاً يُعدَّلُ مرّتَين.
 *
 * Related Docs: docs/12-testing/PHASE12_EXIT_GATE_E2E.md
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CAT_APPLIANCES,
  CAT_LOAD,
  CAT_PHONES,
  DECLARED_RANKING_WINDOW,
  LOAD_FIXTURE_SIZE,
  PENDING_STORE_ID,
  PENDING_STORE_SLUG,
  PG_ENABLED,
  drainRelay,
  forceClose,
  get,
  printReport,
  reapplySchema,
  report,
  resetData,
  search,
  seedApprovedStore,
  seedInventoryAdjustment,
  seedLoadFixture,
  seedPendingStore,
  seedProduct,
  startGate,
  type GateContext,
  type ProductSpec,
  type SearchBody,
} from "../harness.js";

const CAT_COMPUTERS = "electronics-computers";

/** الظاهرةُ — خمسُ وثائقَ يجبُ أن تُرى، ولكلٍّ دورٌ في حكمٍ من أحكامِ الصلةِ. */
const VISIBLE: readonly ProductSpec[] = [
  {
    product_id: "cccccccc-0000-4000-8000-000000000001",
    sku: "SKU-PHONE-EXACT",
    title_ar: "هاتف",
    title_en: "Phone",
    price_minor_units: 99900,
    category_slug: CAT_PHONES,
  },
  {
    product_id: "cccccccc-0000-4000-8000-000000000002",
    sku: "SKU-PHONE-001",
    title_ar: "هاتف ذكي",
    title_en: "Smart Phone",
    price_minor_units: 249900,
    category_slug: CAT_PHONES,
  },
  {
    product_id: "cccccccc-0000-4000-8000-000000000003",
    sku: "SKU-PHONE-002",
    title_ar: "هاتف ذكي كبير",
    title_en: "Smart Phone Max",
    price_minor_units: 349900,
    category_slug: CAT_PHONES,
  },
  {
    product_id: "cccccccc-0000-4000-8000-000000000004",
    sku: "SKU-LAPTOP-001",
    title_ar: "حاسوب محمول",
    title_en: "Laptop Computer",
    price_minor_units: 599900,
    category_slug: CAT_COMPUTERS,
  },
  {
    product_id: "cccccccc-0000-4000-8000-000000000005",
    sku: "SKU-FRIDGE-001",
    title_ar: "ثلاجة",
    title_en: "Refrigerator",
    price_minor_units: 199900,
    category_slug: CAT_APPLIANCES,
  },
];

/**
 * المخفيّةُ — خمسٌ، **وكلُّها تحملُ كلمةَ «هاتف» في عنوانِها عن قصدٍ**.
 *
 * فلو انكسرَ شرطُ الظهورِ لظهرت في أوسعِ استعلامٍ في مجموعةِ الأحكامِ، ولَما نجا الاختبارُ
 * بمصادفةِ أنّ أحداً لم يسألْ عنها. ومخفيٌّ بمفرداتٍ لا يسألُ عنها أحدٌ ليس مخفيّاً — هو **غيرُ
 * مسؤولٍ عنه**.
 */
const HIDDEN: readonly ProductSpec[] = [
  {
    product_id: "dddddddd-0000-4000-8000-000000000001",
    sku: "SKU-HIDDEN-STORE",
    title_ar: "هاتف متجر غير معتمد",
    title_en: "Phone Pending Store",
    price_minor_units: 111100,
    category_slug: CAT_PHONES,
    store_id: PENDING_STORE_ID,
    store_slug: PENDING_STORE_SLUG,
  },
  {
    product_id: "dddddddd-0000-4000-8000-000000000002",
    sku: "SKU-HIDDEN-DRAFT",
    title_ar: "هاتف مسودة",
    title_en: "Phone Draft",
    price_minor_units: 111200,
    category_slug: CAT_PHONES,
    lifecycle: "draft",
  },
  {
    product_id: "dddddddd-0000-4000-8000-000000000003",
    sku: "SKU-HIDDEN-REJECTED",
    title_ar: "هاتف اعتدال مرفوض",
    title_en: "Phone Rejected",
    price_minor_units: 111300,
    category_slug: CAT_PHONES,
    lifecycle: "rejected",
  },
  {
    product_id: "dddddddd-0000-4000-8000-000000000004",
    sku: "SKU-HIDDEN-STOCK",
    title_ar: "هاتف بلا مخزون",
    title_en: "Phone Out Of Stock",
    price_minor_units: 111400,
    category_slug: CAT_PHONES,
    lifecycle: "out_of_stock",
  },
  {
    product_id: "dddddddd-0000-4000-8000-000000000005",
    sku: "SKU-HIDDEN-ARCHIVED",
    title_ar: "هاتف مؤرشف",
    title_en: "Phone Archived",
    price_minor_units: 111500,
    category_slug: CAT_PHONES,
    lifecycle: "archived",
  },
];

const HIDDEN_SKUS = HIDDEN.map((p) => p.sku);

/**
 * حكمُ صلةٍ واحدٌ — **مكتوبٌ قبلَ القياسِ**.
 *
 * `top` هو ما يجبُ أن يتصدَّرَ، و`contains` ما يجبُ أن يكونَ في الصفحةِ، و`absent` ما يجبُ ألّا
 * يكونَ. وثلاثتُها معاً لا `top` وحدَه: بوّابةٌ تسألُ عن الأوّلِ فقط تمرُّ على فهرسٍ فيه وثيقةٌ
 * واحدةٌ صحيحةٌ وأربعٌ ضائعةٌ.
 */
interface Judgment {
  readonly name: string;
  readonly params: Readonly<Record<string, string | number>>;
  readonly top?: string;
  readonly minTopScore?: number;
  readonly contains: readonly string[];
  readonly absent?: readonly string[];
  readonly expectTotal?: number;
}

const JUDGMENTS: readonly Judgment[] = [
  {
    name: "مطابقةٌ تامّةٌ بالعنوانِ العربيِّ تتصدَّرُ على المطابقةِ الجزئيّةِ",
    params: { q: "هاتف" },
    top: "SKU-PHONE-EXACT",
    minTopScore: 1,
    contains: ["SKU-PHONE-EXACT", "SKU-PHONE-001", "SKU-PHONE-002"],
  },
  {
    name: "التشكيلُ والتطويلُ لا يُغيِّرانِ النتيجةَ (التطبيعُ يعملُ عبرَ السلكِ)",
    params: { q: "هَـاتِفٌ" },
    top: "SKU-PHONE-EXACT",
    minTopScore: 1,
    contains: ["SKU-PHONE-EXACT", "SKU-PHONE-001"],
  },
  {
    name: "رمزُ المنتجِ الكاملُ مطابقةٌ تامّةٌ",
    params: { q: "SKU-PHONE-001" },
    top: "SKU-PHONE-001",
    minTopScore: 1,
    contains: ["SKU-PHONE-001"],
  },
  {
    name: "الإنجليزيّةُ تجدُ ما تجدُهُ العربيّةُ (ثنائيّةُ اللغةِ)",
    params: { q: "smart phone", locale: "en" },
    top: "SKU-PHONE-001",
    contains: ["SKU-PHONE-001", "SKU-PHONE-002"],
  },
  {
    name: "بادئةٌ عربيّةٌ ناقصةٌ تجدُ المنتجَ",
    params: { q: "حاسو" },
    top: "SKU-LAPTOP-001",
    contains: ["SKU-LAPTOP-001"],
  },
  {
    name: "خطأٌ إملائيٌّ عربيٌّ يجدُ المنتجَ (تقاربُ الثلاثيّاتِ)",
    params: { q: "ثلاجه" },
    contains: ["SKU-FRIDGE-001"],
  },
  {
    name: "كلمةٌ إنجليزيّةٌ واحدةٌ تجدُ منتجَ العنوانِ الإنجليزيِّ",
    params: { q: "refrigerator", locale: "en" },
    contains: ["SKU-FRIDGE-001"],
  },
  {
    name: "مُرشِّحُ التصنيفِ يُضيِّقُ فعلاً — لا هاتفَ في الأجهزةِ المنزليّةِ",
    params: { q: "هاتف", category_slug: CAT_APPLIANCES },
    contains: [],
    expectTotal: 0,
  },
];

// ── ميزانيّاتُ الحملِ ─────────────────────────────────────────────────────────
//
// أرقامٌ **مقيسةٌ ثمّ مضروبةٌ بهامشٍ**، لا أرقامٌ مُشتهاةٌ. المقيسُ محلّيّاً على PostgreSQL 18
// وفهرسٍ فيه 2006 وثيقةً (2026-09-08):
//
//   تسلسلاً (n=200): p50 = 13.3ms · p95 = 14.4ms · p99 = 18.6ms · max = 24.1ms · errors = 0
//   تزامناً  (n=60):  p50 = 238.8ms · p95 = 382.0ms · max = 393.2ms · wall = 402ms · errors = 0
//
// والميزانيّةُ أدناهُ أوسعُ من المقيسِ بأضعافٍ لأنّ حاويةَ CI باردةٌ وقرصُها مشتركٌ — والغرضُ
// حراسةُ **انهيارِ رتبةٍ** (استعلامٌ يصيرُ مسحاً كاملاً، أو حوضٌ ينفدُ) لا مطاردةُ مللي ثانيةٍ
// في عدّاءٍ متغيّرٍ. وميزانيّةٌ ملتصقةٌ بالمقيسِ كانت ستُخفِقُ لأسبابٍ ليست من الشيفرةِ، فتُعطَّلَ
// بعدَ ثالثِ إخفاقٍ — وبوّابةٌ مُعطَّلةٌ أسوأُ من بوّابةٍ واسعةٍ.
//
// وميزانيّةُ التزامنِ أوسعُ من ميزانيّةِ التسلسلِ لأنّ حوضَ الاتّصالِ ثمانيةٌ وطالبوهُ ستّون:
// الانتظارُ في الطابورِ زمنٌ حقيقيٌّ يراهُ المستخدمُ، فلا يُستثنى من القياسِ — ويُقاسُ بميزانيّةٍ
// تعرفُ أنّه طابورٌ.
const SEQUENTIAL_QUERIES = 200;
const SEQUENTIAL_P95_BUDGET_MS = 300;
const SEQUENTIAL_P50_BUDGET_MS = 120;
const CONCURRENT_QUERIES = 60;
const CONCURRENT_P95_BUDGET_MS = 1500;

/** مزيجُ استعلاماتِ الحملِ — أربعةُ مساراتِ مطابقةٍ مختلفةٍ، لا استعلامٌ واحدٌ مُكرَّرٌ. */
const LOAD_QUERIES: readonly Readonly<Record<string, string | number>>[] = [
  { q: "هاتف" },
  { q: "أداة حمل" },
  { q: "Load Widget", locale: "en" },
  { q: "SKU-LOAD-001234" },
  { q: "ثلاجه" },
  { q: "smart phone", locale: "en", sort: "price_asc" },
];

/**
 * حارسُ الخُضرةِ الصامتةِ — **خارجَ المجموعةِ المتخطّاةِ عمداً**.
 *
 * `describe.skipIf` نعمةٌ للمُطوّرِ بلا قاعدةٍ، وخطرٌ في CI: وصلٌ منسيٌّ يجعلُ `vitest`
 * تخرجُ بصفرٍ والوظيفةُ خضراءَ **ولم يُقَسْ شيءٌ** — وهو `RISK-0022` بعينِه. فتُعلِنُ
 * الوظيفةُ `EXIT_GATE_REQUIRE_DB=1` فيصيرُ التخطّي إخفاقاً باسمِه **داخلَ الملفِّ نفسِه**،
 * لا بمُرشِّحِ نصٍ على سجلٍ ينكسرُ بتغييرِ صياغةِ `vitest`.
 */
it("البوّابةُ لا تُتخطّى صامتةً حيثُ أُعلِنَ أنّها واجبةٌ", () => {
  if ((process.env.EXIT_GATE_REQUIRE_DB ?? "").trim() !== "1") return;
  expect(
    PG_ENABLED,
    "EXIT_GATE_REQUIRE_DB=1 ولا DATABASE_URL — البوّابةُ كانت ستُتخطّى وتُعلَنُ خضراءَ",
  ).toBe(true);
});

describe.skipIf(!PG_ENABLED)("بوّابةُ خروج Phase 12 · البحثُ صلةً وحملاً على السلكِ", () => {
  let gate: GateContext;
  let drained: Awaited<ReturnType<typeof drainRelay>>;
  let loadRows = 0;

  beforeAll(async () => {
    try {
      gate = await startGate();
      await resetData(gate.pool);

      await seedApprovedStore(gate.pool);
      await seedPendingStore(gate.pool);
      for (const spec of [...VISIBLE, ...HIDDEN]) {
        await seedProduct(gate, spec);
      }

      drained = await drainRelay(gate);
      loadRows = await seedLoadFixture(gate.pool);
    } catch (error) {
      await forceClose();
      throw error;
    }
  });

  afterAll(async () => {
    await gate?.close();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1) خطُّ الأنابيبِ — الفهرسُ من أحداثٍ لا من يدٍ
  // ───────────────────────────────────────────────────────────────────────────

  it("الفهرسُ بناهُ الناقلُ من صندوقِ صادرِ السوقِ — لا صفَّ وثيقةٍ كُتِبَ بيدٍ", async () => {
    // عشرُ منتجاتٍ: خمسٌ ظاهرةٌ وخمسٌ مخفيّةٌ. أحداثُها: متجرانِ (3) + منتجاتٌ.
    expect(drained.applied).toBeGreaterThan(0);
    expect(drained.batches).toBeGreaterThan(0);
    expect(drained.poisoned, "حدثٌ مسمومٌ واحدٌ يعني فهرساً ناقصاً — والبوّابةُ تقولُ ذلك باسمِه").toBe(0);

    const consumed = await gate.pool.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count FROM search_relay_consumed_events WHERE status = 'applied'`,
    );
    expect(Number(consumed.rows[0].count)).toBe(drained.applied);

    // **قاعدةٌ مقيسةٌ لا مُفترَضةٌ:** الوثيقةُ تُكتبُ عندَ `became_visible` وحدَهُ
    // (`projector.ts` §`indexEffectFor`). فمنتجٌ لم يَظهرْ قطُّ لا وثيقةَ لهُ أصلاً، ومنتجٌ
    // ظهرَ ثمّ خُفِيَ **تبقى وثيقتُهُ** ويُستبعَدُ بشرطِ القراءةِ. وهذا هو الفرقُ الذي تحرسُهُ
    // البوّابةُ: خمسٌ ظاهرةٌ + المؤرشَفُ (ظهرَ ثمّ أُرشِفَ) = ستٌّ، لا عشرٌ ولا خمسٌ.
    const docs = await gate.pool.query<{ readonly sku: string }>(
      `SELECT sku FROM search_product_index WHERE category_slug <> $1 ORDER BY sku`,
      [CAT_LOAD],
    );
    expect(docs.rows.map((row) => row.sku).sort()).toEqual(
      [...VISIBLE.map((p) => p.sku), "SKU-HIDDEN-ARCHIVED"].sort(),
    );

    // ولا يكتبُ البحثُ في صادرِ السوقِ — التقدُّمُ ملكُهُ (ADR-025 §2.3 · GAP-3).
    const unpublished = await gate.pool.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count FROM marketplace_outbox WHERE published_at IS NOT NULL`,
    );
    expect(Number(unpublished.rows[0].count)).toBe(0);

    expect(loadRows).toBe(LOAD_FIXTURE_SIZE);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2) أحكامُ الصلةِ — مكتوبةٌ قبلَ القياسِ
  // ───────────────────────────────────────────────────────────────────────────

  describe("أحكامُ الصلةِ (relevance judgments)", () => {
    for (const judgment of JUDGMENTS) {
      it(judgment.name, async () => {
        const response = await search(gate, { ...judgment.params, page_size: 50 });
        expect(response.status, response.text).toBe(200);

        const skus = response.body.items.map((item) => item.sku);

        if (judgment.top !== undefined) {
          expect(skus[0], `المتصدِّرُ المتوقَّعُ ${judgment.top} · المقيسُ ${skus.join(",")}`).toBe(
            judgment.top,
          );
        }
        if (judgment.minTopScore !== undefined) {
          expect(response.body.items[0].score).toBeGreaterThanOrEqual(judgment.minTopScore);
        }
        for (const sku of judgment.contains) {
          expect(skus, `${sku} مفقودٌ من نتيجةِ «${judgment.name}»`).toContain(sku);
        }
        for (const sku of [...HIDDEN_SKUS, ...(judgment.absent ?? [])]) {
          expect(skus, `${sku} ظهرَ وهو يجبُ ألّا يظهرَ`).not.toContain(sku);
        }
        if (judgment.expectTotal !== undefined) {
          expect(response.body.total).toBe(judgment.expectTotal);
        }
      });
    }

    it("سُلَّمُ الترتيبِ نازلٌ لا يرتدُّ — exact > prefix > fts > trigram", async () => {
      const response = await search(gate, { q: "هاتف", page_size: 50 });
      expect(response.status).toBe(200);
      const scores = response.body.items.map((item) => item.score);
      expect(scores.length).toBeGreaterThan(1);
      for (let i = 1; i < scores.length; i += 1) {
        expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
      }
      expect(scores[0]).toBe(1);
      expect(scores[scores.length - 1]).toBeGreaterThan(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3) الظهورُ مُشتقٌّ من الحالةِ — والوثائقُ في الجدولِ لا محذوفةٌ
  // ───────────────────────────────────────────────────────────────────────────

  it("خمسُ وثائقَ مخفيّةٍ لخمسةِ أسبابٍ — موجودةٌ في الجدولِ وغائبةٌ عن النتيجةِ", async () => {
    const response = await search(gate, { q: "هاتف", page_size: 50 });
    expect(response.status).toBe(200);
    const skus = response.body.items.map((item) => item.sku);
    for (const sku of HIDDEN_SKUS) expect(skus).not.toContain(sku);

    // والغيابُ **مُعلَّلٌ بحالةٍ مُسقَطةٍ** لا بصدفةٍ: أربعةٌ لم تَبلُغِ الظهورَ قطُّ فحالتُها
    // مكتوبةٌ في جداولِ الحالةِ بلا وثيقةٍ، والخامسُ ظهرَ ثمّ أُرشِفَ **فوثيقتُهُ باقيةٌ**.
    // ولولا هذا الشقُّ لكانَ الاختبارُ يمرُّ على ناقلٍ لا يُسقِطُ شيئاً أصلاً.
    const states = await gate.pool.query<{
      readonly product_id: string;
      readonly sku: string;
      readonly product_state: string;
      readonly moderation_state: string;
      readonly quantity_on_hand: number;
      readonly archived_at: Date | null;
    }>(
      `SELECT product_id, sku, product_state, moderation_state, quantity_on_hand, archived_at
       FROM search_marketplace_product_state WHERE sku = ANY($1::text[])`,
      [HIDDEN_SKUS],
    );
    const bySku = new Map(states.rows.map((row) => [row.sku, row]));

    expect(bySku.get("SKU-HIDDEN-DRAFT")?.product_state).toBe("draft");
    expect(bySku.get("SKU-HIDDEN-REJECTED")?.moderation_state).toBe("rejected");
    expect(bySku.get("SKU-HIDDEN-STOCK")?.quantity_on_hand).toBe(0);
    expect(bySku.get("SKU-HIDDEN-ARCHIVED")?.archived_at).not.toBeNull();

    // متجرٌ غيرُ معتمَدٍ: المنتجُ سليمٌ بذاتِهِ والإخفاءُ آتٍ من **حالةِ متجرِهِ** وحدَها.
    const pendingStore = await gate.pool.query<{ readonly store_state: string }>(
      `SELECT store_state FROM search_marketplace_store_state WHERE store_id = $1::uuid`,
      [PENDING_STORE_ID],
    );
    expect(pendingStore.rows[0]?.store_state).not.toBe("approved");

    // ووثيقةُ المؤرشَفِ **باقيةٌ في الفهرسِ** — الإخفاءُ شرطُ قراءةٍ لا حذفٌ ولا رايةٌ.
    const archived = await gate.pool.query<{ readonly archived_at: Date | null }>(
      `SELECT archived_at FROM search_product_index WHERE sku = 'SKU-HIDDEN-ARCHIVED'`,
    );
    expect(archived.rowCount).toBe(1);
    expect(archived.rows[0].archived_at).not.toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4) الظهورُ حيٌّ — حدثٌ يُخفي ثمّ حدثٌ يُعيدُ، بلا حذفٍ
  // ───────────────────────────────────────────────────────────────────────────

  it("تصفيرُ المخزونِ بحدثٍ يُخفي الوثيقةَ، وإعادتُهُ تُعيدُها — بلا DELETE", async () => {
    const target = "SKU-PHONE-002";
    const productId = VISIBLE[2].product_id;

    const before = await search(gate, { q: "هاتف", page_size: 50 });
    expect(before.body.items.map((i) => i.sku)).toContain(target);

    await seedInventoryAdjustment(gate, productId, 0, 1);
    await drainRelay(gate);

    const during = await search(gate, { q: "هاتف", page_size: 50 });
    expect(during.body.items.map((i) => i.sku)).not.toContain(target);

    const stillThere = await gate.pool.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count FROM search_product_index WHERE sku = $1`,
      [target],
    );
    expect(Number(stillThere.rows[0].count), "الوثيقةُ تُخفى ولا تُحذفُ").toBe(1);

    await seedInventoryAdjustment(gate, productId, 4, 2);
    await drainRelay(gate);

    const after = await search(gate, { q: "هاتف", page_size: 50 });
    expect(after.body.items.map((i) => i.sku)).toContain(target);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5) الترقيمُ والترتيبُ
  // ───────────────────────────────────────────────────────────────────────────

  it("الصفحتانِ منفصلتانِ والمجموعُ ثابتٌ", async () => {
    const first = await search(gate, { q: "هاتف", page: 1, page_size: 2 });
    const second = await search(gate, { q: "هاتف", page: 2, page_size: 2 });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.total).toBe(second.body.total);
    expect(first.body.items.length).toBe(2);

    const firstIds = new Set(first.body.items.map((i) => i.product_id));
    for (const item of second.body.items) expect(firstIds.has(item.product_id)).toBe(false);
  });

  it("الفرزُ بالسعرِ فرزٌ فعليٌّ صعوداً وهبوطاً", async () => {
    const asc = await search(gate, { q: "هاتف", sort: "price_asc", page_size: 50 });
    const desc = await search(gate, { q: "هاتف", sort: "price_desc", page_size: 50 });
    expect(asc.status).toBe(200);
    expect(desc.status).toBe(200);

    const ascPrices = asc.body.items.map((i) => i.price_minor_units);
    const descPrices = desc.body.items.map((i) => i.price_minor_units);
    expect(ascPrices).toEqual([...ascPrices].sort((a, b) => a - b));
    expect(descPrices).toEqual([...descPrices].sort((a, b) => b - a));
    expect(asc.body.total).toBe(desc.body.total);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6) الأخطاءُ على السلكِ — 400 برمزٍ، ولا 500 بحالٍ
  // ───────────────────────────────────────────────────────────────────────────

  it("الطلباتُ المعطوبةُ تُردُّ 400 برمزٍ مقروءٍ", async () => {
    const cases: readonly { readonly path: string; readonly code: string }[] = [
      { path: "/search/products", code: "SEARCH_QUERY_EMPTY" },
      { path: "/search/products?q=%20%20", code: "SEARCH_QUERY_EMPTY" },
      { path: `/search/products?q=${"ا".repeat(201)}`, code: "SEARCH_QUERY_TOO_LONG" },
      { path: "/search/products?q=هاتف&sort=cheapest", code: "SEARCH_SORT_INVALID" },
      { path: "/search/products?q=هاتف&page_size=51", code: "SEARCH_PAGE_SIZE_INVALID" },
      { path: "/search/products?q=هاتف&page=0", code: "SEARCH_PAGE_OUT_OF_RANGE" },
      { path: "/search/products?q=هاتف&locale=fr", code: "SEARCH_UNSUPPORTED_LOCALE" },
    ];

    for (const testCase of cases) {
      const response = await get(gate, testCase.path);
      expect(response.status, `${testCase.path} → ${response.text}`).toBe(400);
      expect(response.body.code, testCase.path).toBe(testCase.code);
      expect(response.body.trace_id, "كلُّ خطأٍ يحملُ أثراً").toBeTruthy();
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7) بوّابةُ الحملِ — الزمنُ مقيسٌ على السلكِ
  // ───────────────────────────────────────────────────────────────────────────

  it(`تسلسلاً: ${SEQUENTIAL_QUERIES} استعلاماً على ${LOAD_FIXTURE_SIZE}+ وثيقةٍ ضمنَ الميزانيّةِ`, async () => {
    // إحماءٌ: أوّلُ نداءٍ يدفعُ ثمنَ فتحِ الاتّصالِ وتخطيطِ الاستعلامِ، وإدخالُهُ في العيّنةِ
    // كان سيجعلُ المئينيّةَ 99 تقيسُ الإقلاعَ لا الخدمةَ.
    for (const params of LOAD_QUERIES) await search(gate, params);

    const samples: number[] = [];
    let errors = 0;
    for (let i = 0; i < SEQUENTIAL_QUERIES; i += 1) {
      const params = LOAD_QUERIES[i % LOAD_QUERIES.length];
      const response = await search(gate, { ...params, page_size: 20 });
      if (response.status !== 200) errors += 1;
      samples.push(response.ms);
    }

    const measured = report(samples, errors);
    printReport("sequential", measured);

    expect(measured.errors).toBe(0);
    expect(measured.p50).toBeLessThan(SEQUENTIAL_P50_BUDGET_MS);
    expect(measured.p95).toBeLessThan(SEQUENTIAL_P95_BUDGET_MS);
  });

  it(`تزامناً: ${CONCURRENT_QUERIES} استعلاماً في دفعةٍ واحدةٍ بلا خطأٍ وضمنَ الميزانيّةِ`, async () => {
    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_QUERIES }, (_unused, i) =>
        search(gate, { ...LOAD_QUERIES[i % LOAD_QUERIES.length], page_size: 20 }),
      ),
    );
    const wallMs = Date.now() - started;

    const errors = results.filter((r) => r.status !== 200).length;
    const measured = report(
      results.map((r) => r.ms),
      errors,
    );
    printReport(`concurrent (wall=${wallMs}ms)`, measured);

    expect(measured.errors).toBe(0);
    expect(measured.p95).toBeLessThan(CONCURRENT_P95_BUDGET_MS);
    // ولا وثيقةَ حملٍ تُسرِّبُ نفسَها إلى نتيجةِ استعلامٍ عربيٍّ ليست منه.
    const arabicPage = results[0].body;
    expect(arabicPage.items.every((item) => item.category_slug !== CAT_LOAD)).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8) المجموعُ صادقٌ — والعمقُ يُرفَضُ جهراً (RISK-0029 · مُغلَقٌ في المراجعةِ 5/N)
  // ───────────────────────────────────────────────────────────────────────────

  it(`استعلامٌ يُطابقُ ${LOAD_FIXTURE_SIZE} وثيقةً يُرجِعُ المجموعَ كاملاً لا مقصوصاً`, async () => {
    const response = await search(gate, { q: "أداة حمل", page_size: 50 });
    expect(response.status).toBe(200);

    const matching = await gate.pool.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count FROM search_product_index WHERE category_slug = $1`,
      [CAT_LOAD],
    );
    expect(Number(matching.rows[0].count)).toBe(LOAD_FIXTURE_SIZE);

    // كان هذا التوكيدُ في المراجعةِ 4/N يُثبتُ الكذبةَ: `total === 500`. صار يُثبتُ
    // إغلاقَها — القاعدةُ تَعُدُّ المطابقاتِ كلَّها قبلَ `LIMIT`، فالمجموعُ يُطابقُ ما في
    // الجدولِ عدداً بعدد. ولو عادَ القصُّ سقطت البوّابةُ ها هنا.
    expect(response.body.total).toBe(LOAD_FIXTURE_SIZE);
    expect(response.body.items).toHaveLength(50);
  });

  it("صفحةٌ أعمقُ من نافذةِ الترتيبِ تُرفَضُ 400 لا تُخدَمُ من مجموعةٍ مقصوصةٍ", async () => {
    // آخِرُ صفٍّ في الصفحةِ يقعُ عندَ 5050 > 5000 — فالصفحةُ خارجَ النطاقِ.
    const response = await search(gate, {
      q: "أداة حمل",
      page: Math.floor(DECLARED_RANKING_WINDOW / 50) + 1,
      page_size: 50,
    });

    expect(response.status, response.text).toBe(400);
    expect((response.body as unknown as Record<string, unknown>).code).toBe(
      "SEARCH_PAGE_OUT_OF_RANGE",
    );
  });

  it("آخِرُ صفحةٍ تقعُ داخلَ النافذةِ تماماً تُخدَمُ 200", async () => {
    const response = await search(gate, {
      q: "أداة حمل",
      page: DECLARED_RANKING_WINDOW / 50,
      page_size: 50,
    });

    expect(response.status, response.text).toBe(200);
    expect(response.body.total).toBe(LOAD_FIXTURE_SIZE);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 9) التدهورُ — 503 لا 500، والصحّةُ ليست بوّابةَ جاهزيّةٍ (حدٌّ مقيسٌ)
  //    آخِرُ ما يجري في الملفِّ: يُسقِطُ الجدولَ فيُفسِدُ ما بعدَهُ.
  // ───────────────────────────────────────────────────────────────────────────

  it("فهرسٌ غائبٌ يُردُّ 503 — والجاهزيّةُ تحمرُّ معَهُ بينما تبقى الحياةُ خضراءَ", async () => {
    const healthy = await get(gate, "/search/health");
    expect(healthy.status).toBe(200);
    expect(healthy.body.status).toBe("ok");

    // وقبلَ الإسقاطِ: الجاهزيّةُ خضراءُ لأنّها سألت الفهرسَ فأجابَ.
    const readyBefore = await get(gate, "/search/ready");
    expect(readyBefore.status, readyBefore.text).toBe(200);
    expect(readyBefore.body.status).toBe("ready");

    await gate.pool.query("DROP TABLE search_product_index CASCADE");

    const degraded = await search(gate, { q: "هاتف" });
    expect(degraded.status, degraded.text).toBe(503);
    expect((degraded.body as unknown as Record<string, unknown>).code).toBe("SEARCH_INDEX_DEGRADED");

    // **`RISK-0030` مُغلَقٌ ومقيسٌ:** الجاهزيّةُ تحمرُّ معَ الفهرسِ الغائبِ، فلا يُوجِّهُ
    // موازِنُ الحملِ إلى نسخةٍ لا تخدمُ. وكانت هذه الصفحةُ في المراجعةِ 4/N تُثبتُ العكسَ.
    const readyAfter = await get(gate, "/search/ready");
    expect(readyAfter.status, readyAfter.text).toBe(503);
    expect((readyAfter.body as unknown as Record<string, unknown>).code).toBe(
      "SEARCH_INDEX_DEGRADED",
    );

    // والحياةُ تبقى خضراءَ: العمليّةُ حيّةٌ ولا تُعادُ تشغيلاً لأنّ نموذجَ قراءتِها غابَ.
    const stillOk = await get(gate, "/search/health");
    expect(stillOk.status).toBe(200);
    expect(stillOk.body.status).toBe("ok");

    await reapplySchema(gate.pool);
  });
});

/** نوعُ الجسمِ مُستعمَلٌ في التوكيداتِ أعلاهُ — يُعلَنُ هنا كي لا يُستوردَ بلا استعمالٍ. */
export type { SearchBody };
