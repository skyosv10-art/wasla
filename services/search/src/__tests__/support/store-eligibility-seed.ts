/**
 * بذرةُ أهليّةِ المتاجرِ — `E-20:store-eligible` (ADR-025 §6.7 D4.2 · CLM-0689).
 *
 * يُعلِنُ كلُّ صفٍّ حالتَينِ **منفصلتَين** لا تحلُّ إحداهما محلَّ الأخرى:
 *   - `store`   — حالةُ المتجرِ: `approved` · `suspended` · `archived`.
 *   - `product` — حالةُ منتجِه الوحيدِ: `visible` (منشورٌ معتمَدٌ بكميةٍ) ·
 *                 `archived` (نُشِرَ ثمّ أُرشِفَ) · `none` (لا منتجَ).
 *
 * المؤهَّلُ وحدَه `store=approved ∧ product=visible` (ADR-025 §6.3). البذرةُ
 * تكتبُ أحداثَ السوقِ الحقيقيّةَ في المُخرَجِ، وتُفرِغُها عبرَ المُرحِّلِ
 * الحقيقيِّ، ثمّ **تقرأُ الحالتَينِ من جداولِ البحثِ نفسِها** وتُسقِطُ الاختبارَ
 * إن خالفَ المُسقَطُ المُعلَنَ — فلا يُعَدُّ صفٌّ «مؤرشَفًا» لأنّه سُمِّيَ كذلك.
 *
 * الحارسُ 28 (`scripts/checks/lib/edge_allowlist_guard.py`) يقرأُ الصفوفَ
 * الحرفيّةَ من نداءِ `seedStoreEligibility` داخلَ الحالةِ، ويشترطُ أن يكونَ
 * الاسمُ مستورَدًا من هذا الملفِّ بعينِه.
 */
import type { Pool } from "pg";

import type { CatalogReadPort } from "../../ports.js";
import type { CatalogProduct } from "../../domain/consumed-events.js";
import { PostgresMarketplaceEventSource } from "../../infrastructure/marketplace-event-source.js";
import { PostgresProjectionStore } from "../../infrastructure/projection-store.js";
import { DEFAULT_RELAY_CONFIG, runRelayBatch } from "../../relay.js";
import { FakeStoreCatalog } from "./fake-store-catalog.js";
import { seedOutboxEvent } from "../pg-harness.js";

export type FixtureStoreState = "approved" | "suspended" | "archived";
export type FixtureProductState = "visible" | "archived" | "none";

export interface StoreEligibilityFixture {
  readonly slug: string;
  readonly title: string;
  readonly store: FixtureStoreState;
  readonly product: FixtureProductState;
}

/** الحالتانِ كما أسقطَهما المُرحِّلُ في جداولِ البحثِ — منفصلتَين. */
export interface SeededStoreEligibility {
  readonly storeState: Readonly<Record<string, string>>;
  readonly productState: Readonly<Record<string, string>>;
  /** المؤهَّلُ وفقَ الإعلانِ (`approved ∧ visible`)، مرتَّبًا بالمعرِّف. */
  readonly eligible: readonly string[];
}

const STORE_STATES: readonly FixtureStoreState[] = ["approved", "suspended", "archived"];
const PRODUCT_STATES: readonly FixtureProductState[] = ["visible", "archived", "none"];
const CATEGORY = "groceries";
const ACTOR = "CUS-ELIGIBILITY";

class Products implements CatalogReadPort {
  private readonly data = new Map<string, CatalogProduct>();
  set(p: CatalogProduct): void {
    this.data.set(p.product_id, p);
  }
  async getProduct(id: string): Promise<CatalogProduct | null> {
    return this.data.get(id) ?? null;
  }
}

/** معرِّفاتٌ ثابتةٌ في نطاقٍ لا تتقاطعُ مع بذورِ الملفّاتِ الأخرى (`c…`/`d…`). */
const storeId = (i: number) => `c0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
const productId = (i: number) => `d0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;

export async function seedStoreEligibility(
  pool: Pool,
  fixtures: readonly StoreEligibilityFixture[],
): Promise<SeededStoreEligibility> {
  if (fixtures.length === 0) throw new Error("بذرةٌ فارغةٌ — لا تُثبتُ أهليّةً");
  const slugs = new Set<string>();
  for (const f of fixtures) {
    if (!STORE_STATES.includes(f.store)) throw new Error(`حالةُ متجرٍ غيرُ معروفةٍ: ${String(f.store)}`);
    if (!PRODUCT_STATES.includes(f.product)) throw new Error(`حالةُ منتجٍ غيرُ معروفةٍ: ${String(f.product)}`);
    if (slugs.has(f.slug)) throw new Error(`معرِّفٌ مكرَّرٌ: ${f.slug}`);
    slugs.add(f.slug);
  }

  const products = new Products();
  const stores = new FakeStoreCatalog();
  const seq = new Map<string, number>();
  const next = (k: string) => {
    const n = (seq.get(k) ?? 0) + 1;
    seq.set(k, n);
    return n;
  };
  // الزمنُ بعدَ كلِّ بذرةٍ سابقةٍ في القاعدةِ: الأحداثُ تُرتَّبُ بالمُخرَجِ لا بالساعة،
  // لكنّ `occurred_for` المتزايدَ يُبقي سجلَّ الأحداثِ قابلًا للقراءة.
  const { rows } = await pool.query<{ t: Date | null }>(
    "SELECT max(created_at) AS t FROM marketplace_outbox",
  );
  let clock = (rows[0]?.t ? new Date(rows[0].t).getTime() : Date.parse("2026-03-01T00:00:00.000Z")) + 3_600_000;
  const emit = async (event_type: string, aggregate_type: string, aggregate_id: string, payload: Record<string, unknown>) => {
    clock += 60_000;
    const at = new Date(clock).toISOString();
    await seedOutboxEvent(pool, {
      event_type,
      aggregate_type,
      aggregate_id,
      occurred_at: at,
      created_at: at,
      payload: { ...payload, occurred_for: at },
    });
  };
  const storeEvent = async (i: number, f: StoreEligibilityFixture, type: string, from: string | null, to: string) => {
    await emit(`marketplace.store_${type}`, "store", storeId(i), {
      store_id: storeId(i),
      store_slug: f.slug,
      owner_public_id: ACTOR,
      category_slug: CATEGORY,
      ...(from === null ? {} : { from_state: from }),
      to_state: to,
      state_sequence: next(`s${i}`),
      actor_type: from === null ? "owner" : "moderator",
    });
  };

  for (const [i, f] of fixtures.entries()) {
    stores.set({ store_id: storeId(i), store_slug: f.slug, title_ar: f.title, title_en: null, title_ur: null });
    // كلُّ متجرٍ يبدأُ معتمَدًا: المنتجُ يُنشَرُ تحتَ متجرٍ معتمَدٍ، ثمّ تتغيّرُ حالةُ المتجرِ.
    await storeEvent(i, f, "registered", null, "pending_review");
    await storeEvent(i, f, "approved", "pending_review", "approved");

    if (f.product !== "none") {
      const p = productId(i);
      products.set({
        product_id: p,
        store_id: storeId(i),
        store_slug: f.slug,
        sku: `elig-${i + 1}`,
        category_slug: CATEGORY,
        title_ar: `منتج ${f.slug}`,
        title_en: null,
        price_minor_units: 1000,
        currency_code: "SAR",
      });
      await emit("marketplace.product_created", "product", p, {
        product_id: p, store_id: storeId(i), store_slug: f.slug, sku: `elig-${i + 1}`,
        category_slug: CATEGORY, state: "draft", moderation_state: "pending", created_by_public_id: ACTOR,
      });
      await emit("marketplace.product_moderated", "product", p, {
        product_id: p, store_id: storeId(i), store_slug: f.slug, from_state: "pending", to_state: "approved",
        moderation_sequence: next(`m${i}`), actor_type: "moderator",
      });
      await emit("marketplace.product_published", "product", p, {
        product_id: p, store_id: storeId(i), store_slug: f.slug, category_slug: CATEGORY,
        from_state: "draft", to_state: "published", store_state: "approved", quantity_on_hand: 5, actor_public_id: ACTOR,
      });
      if (f.product === "archived") {
        await emit("marketplace.product_archived", "product", p, {
          product_id: p, store_id: storeId(i), store_slug: f.slug, from_state: "published", to_state: "archived",
          actor_public_id: ACTOR,
        });
      }
    }
    if (f.store !== "approved") await storeEvent(i, f, f.store, "approved", f.store);
  }

  const deps = {
    events: new PostgresMarketplaceEventSource(pool),
    catalog: products,
    storeCatalog: stores,
    store: new PostgresProjectionStore(pool),
    config: DEFAULT_RELAY_CONFIG,
  };
  let drained = false;
  for (let k = 0; k < 50; k += 1) {
    if ((await runRelayBatch(deps)).processed === 0) {
      drained = true;
      break;
    }
  }
  if (!drained) throw new Error("المُرحِّلُ لم يفرُغِ الطابورَ");

  // القراءةُ من الإسقاطِ: حالةُ المتجرِ من جدولِه، وحالةُ المنتجِ من جدولِه — منفصلتَين.
  const ids = fixtures.map((_, i) => storeId(i));
  const st = await pool.query<{ store_id: string; store_state: string }>(
    "SELECT store_id::text, store_state FROM search_marketplace_store_state WHERE store_id = ANY($1::uuid[])",
    [ids],
  );
  const pr = await pool.query<{ store_id: string; product_state: string; archived: boolean; visible: boolean }>(
    `SELECT store_id::text, product_state, archived_at IS NOT NULL AS archived,
            (product_state = 'published' AND moderation_state = 'approved'
              AND quantity_on_hand > 0 AND archived_at IS NULL) AS visible
       FROM search_marketplace_product_state WHERE store_id = ANY($1::uuid[])`,
    [ids],
  );
  const storeState: Record<string, string> = {};
  const productState: Record<string, string> = {};
  for (const [i, f] of fixtures.entries()) {
    storeState[f.slug] = st.rows.find((r) => r.store_id === storeId(i))?.store_state ?? "missing";
    const prod = pr.rows.filter((r) => r.store_id === storeId(i));
    productState[f.slug] =
      prod.length === 0 ? "none" : prod.length > 1 ? "multiple" :
      prod[0].visible ? "visible" : prod[0].archived ? "archived" : `other:${prod[0].product_state}`;
    if (storeState[f.slug] !== f.store) {
      throw new Error(`البذرةُ لم تُسقِطْ حالةَ المتجرِ المُعلَنةَ لـ${f.slug}: ${storeState[f.slug]} ≠ ${f.store}`);
    }
    if (productState[f.slug] !== f.product) {
      throw new Error(`البذرةُ لم تُسقِطْ حالةَ المنتجِ المُعلَنةَ لـ${f.slug}: ${productState[f.slug]} ≠ ${f.product}`);
    }
  }
  const eligible = fixtures
    .filter((f) => f.store === "approved" && f.product === "visible")
    .map((f) => f.slug)
    .sort();
  return { storeState, productState, eligible };
}
