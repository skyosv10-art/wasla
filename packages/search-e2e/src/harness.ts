/**
 * مِشْكاةُ بوّابةِ خروجِ الطورِ 12 — البحثُ على **ناقلٍ حقيقيٍّ** و**مُستمعٍ حقيقيٍّ** و**قاعدةٍ
 * حقيقيّة**، وحكمُ صلةٍ مكتوبٌ قبلَ القياسِ، وميزانيّةُ زمنٍ **تُقاسُ ولا تُدَّعى**.
 *
 * # ما تُثبتُهُ هذه الحزمةُ ولا يُثبتُهُ غيرُها
 *
 * اختباراتُ خدمةِ البحثِ (62 سريعاً و10 على القاعدةِ) تُثبتُ أنّ كلَّ قطعةٍ صحيحةٌ وحدَها:
 * التطبيعُ، وسُلَّمُ الترتيبِ، والإسقاطُ، وحرسُ الإعادةِ، ومحوّلُ القراءةِ، وطبقةُ HTTP بمنفذٍ
 * وهميٍّ. ولا تُثبتُ خمسةَ أشياءَ لا تظهرُ إلّا مُجتمِعةً وعبرَ سلكٍ:
 *
 *  1. **أنّ الفهرسَ الذي يُبحَثُ فيه بناهُ الناقلُ من أحداثٍ، لا يدٌ كتبت صفوفاً.** كلُّ منتجٍ في
 *     مجموعةِ الصلةِ يدخلُ الفهرسَ عبرَ `marketplace_outbox → runRelayBatch → search_product_index`
 *     بالمحوّلاتِ الإنتاجيّةِ نفسِها. فوثيقةٌ يُغفِلُها الإسقاطُ لا تظهرُ هنا نتيجةً ناقصةً بل
 *     **حُكمَ صلةٍ ساقطاً**.
 *  2. **أنّ حكمَ الصلةِ مكتوبٌ قبلَ القياسِ لا مُشتقٌّ منه.** مجموعةُ الأحكامِ (§ `JUDGMENTS`)
 *     تُعلنُ لكلِّ استعلامٍ **مَن يجبُ أن يتصدَّرَ ومَن يجبُ ألّا يظهرَ إطلاقاً**. وهذا هو الفرقُ
 *     بينَ بوّابةِ صلةٍ وبينَ اختبارٍ يُصوِّرُ ما تفعلُهُ الشيفرةُ اليومَ ويُسمّيه صواباً.
 *  3. **أنّ الظهورَ يُعادُ بناؤُهُ من الحالةِ عندَ القراءةِ.** خمسُ وثائقَ مخفيّةٍ لأسبابٍ خمسةٍ
 *     مختلفةٍ (متجرٌ غيرُ معتمَدٍ · منتجٌ مسوَّدةٌ · اعتدالٌ مرفوضٌ · مخزونٌ صفرٌ · مؤرشَفٌ) لا
 *     تظهرُ في أيِّ نتيجةٍ — ثمّ يُصفَّرُ مخزونُ منتجٍ **ظاهرٍ** بحدثٍ جديدٍ فيختفي بلا `DELETE`،
 *     ويُعادُ فيعودُ. رايةٌ مخزَّنةٌ كانت ستنجو من هذا الاختبارِ؛ الشرطُ المُشتقُّ وحدَهُ ينجو.
 *  4. **أنّ الزمنَ مقيسٌ على السلكِ لا مُقدَّرٌ.** ميزانيّةُ الحملِ تُقاسُ بمئينيّاتٍ على فهرسٍ
 *     فيه ألفا وثيقةٍ، بنداءاتِ `fetch` على منفذٍ حقيقيٍّ — تسلسليّاً ثمّ بدفعةٍ متزامنةٍ.
 *     و`app.inject` كان سيتجاوزُ `node:http` كلَّها فيقيسُ زمنَ دالّةٍ لا زمنَ خدمة.
 *  5. **أنّ الحدَّ المُعلَنَ في الشيفرةِ حدٌّ فعليٌّ.** سقفُ المُرشَّحينَ (`CANDIDATE_CAP = 500`)
 *     مكتوبٌ في ترويسةِ `search-index-reader.ts`؛ وهنا يُقاسُ: استعلامٌ يُطابقُ ألفَي وثيقةٍ
 *     يُرجِعُ `total = 500` لا 2000. **والمقيسُ يُسجَّلُ في سجلِّ المخاطرِ باسمِه** (`RISK-0029`)
 *     بدلَ أن يبقى تعليقاً في ملفٍّ لا يقرؤُهُ أحدٌ.
 *
 * # النسخةُ الخاطئةُ الأرخصُ
 *
 * كان الأرخصُ أن تُحشى صفوفٌ في `search_product_index` بـ`INSERT` مباشرٍ، ثمّ يُنادى
 * `SearchIndexReader.search()` دالّةً، ويُقارَنَ الناتجُ بما يُخرِجُهُ اليومَ. والنتيجةُ بوّابةٌ
 * تُثبتُ أنّ القارئَ متّسقٌ مع نفسِهِ — وهو مُثبَتٌ أصلاً في 72 اختباراً — ولا تُثبتُ أنّ ما
 * سيصلُ المستخدمَ عبرَ الخدمةِ هو ما يُتوقَّعُ. ولذلك: **لا `INSERT` واحدٌ في مجموعةِ الصلةِ**،
 * ولا نداءَ دالّةٍ واحدٌ في القياسِ.
 *
 * # وأينَ يُحشى الصفُّ إذن — وحدُّ ذلك مُعلَنٌ
 *
 * في **حشوِ الحملِ وحدَه** (`seedLoadFixture`): ألفا وثيقةٍ تُكتبُ بـ`INSERT ... SELECT` واحدٍ.
 * وهذا **حشوُ حجمٍ لا إثباتُ خطِّ أنابيبَ**، ومُعلَنٌ بذلك في اسمِهِ وترويسَتِهِ ووثيقةِ
 * البوّابةِ. ولو مُرِّرت هذه الألفانِ عبرَ الناقلِ لصارت البوّابةُ تقيسُ زمنَ الإسقاطِ (ثمانيةُ
 * آلافِ حدثٍ) لا زمنَ **البحثِ** — فيصيرُ الرقمُ الذي تحرسُهُ رقماً آخرَ غيرَ الذي تُسمّيه.
 * ومفرداتُ الحشوِ **معزولةٌ عمداً** (`أداة حمل` / `Load Widget`) فلا تُطابقُ استعلامَ حكمٍ واحداً،
 * فلا تُلوِّثُ الصلةَ وهي تُثقِلُ الفهرسَ — وهو الغرضُ منها بالضبطِ.
 *
 * # ساعةُ المصدرِ لا ساعةُ الاختبارِ
 *
 * `occurred_at`/`created_at` في صفوفِ الصادرِ مكتوبةٌ بلحظاتٍ ثابتةٍ مُشتقّةٍ من `T0`، كي يبقى
 * ترتيبُ الاستهلاكِ (وهو مفتاحُ نقطةِ التقدُّمِ) مقروءاً بعدَ سنةٍ من كتابةِ الملفِّ. أمّا
 * `indexed_at` فمن القاعدةِ (`now()`) لأنّ ترتيبَ `newest` يقرؤُها — وذلك مقصودٌ ومُعلَنٌ.
 *
 * Scope: Phase 12 · المراجعة 4/N — بوّابةُ الخروجِ فقط.
 * Related Code: services/search
 * Related Docs: docs/12-testing/PHASE12_EXIT_GATE_E2E.md · docs/15-decisions/ADR-025-marketplace-search-read-model.md
 */
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_RELAY_CONFIG,
  PostgresMarketplaceEventSource,
  PostgresProjectionStore,
  PostgresSearchDeadLetterStore,
  PostgresSearchRequeueStore,
  SearchIndexHealthProbe,
  SearchIndexReader,
  buildSearchHttpApp,
  runRelayBatch,
  type CatalogProduct,
  type CatalogReadPort,
} from "@wasla/search-service";
import {
  createServiceRequestSigner,
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
} from "@wasla/service-auth";
import type { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** البوّابةُ تحتاجُ قاعدةً: لا نمطَ ذاكرةٍ في هذه الخدمةِ أصلاً — القارئُ pg وحدَه. */
export const PG_ENABLED = (process.env.DATABASE_URL ?? "").trim() !== "";

/** لحظةُ الأساسِ — كلُّ حدثٍ يُبذَرُ بإزاحةٍ عنها بالدقائقِ فيبقى الترتيبُ صريحاً. */
export const T0 = "2026-06-01T00:00:00.000Z";

export const STORE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
export const STORE_SLUG = "madinah-electronics";
export const PENDING_STORE_ID = "aaaaaaaa-0000-4000-8000-000000000002";
export const PENDING_STORE_SLUG = "khobar-drafts";
export const OWNER = "WS-1000000001";
export const MODERATOR = "WS-9000000001";

export const CAT_PHONES = "electronics-phones";
export const CAT_APPLIANCES = "home-appliances";
export const CAT_LOAD = "load-fixtures";

/** حجمُ حشوِ الحملِ — مُعلَنٌ هنا لأنّ وثيقةَ البوّابةِ تذكرُهُ رقماً لا وصفاً. */
export const LOAD_FIXTURE_SIZE = 2000;

/**
 * نافذةُ الترتيبِ المُعلَنةُ في `search-index-reader.ts` (`DEFAULT_RANKING_WINDOW`) —
 * تُعادُ كتابتُها هنا **نسخةً ثانيةً بقصدٍ**: البوّابةُ تقيسُ الحدَّ من سلوكِ الخدمةِ، فلو
 * غُيِّرَ في المصدرِ ولم يُغيَّرْ هنا سقطت البوّابةُ باسمِها — وهذا هو المطلوبُ من حارسٍ
 * لا من مساعِد.
 *
 * وكان اسمُهُ في المراجعةِ 4/N `DECLARED_CANDIDATE_CAP = 500`، وكان يقصُّ `total` نفسَهُ
 * لا الصفحةَ فحسبُ (`RISK-0029`). وقد صارَ الآنَ حدّاً للعملِ لا للحقيقةِ: `total` مقيسٌ
 * بـ`count(*) OVER ()` على المطابقاتِ كلِّها، والنافذةُ تحكمُ عمقَ الترقيمِ وحدَهُ.
 */
export const DECLARED_RANKING_WINDOW = 5000;

const searchSchemaSql = readFileSync(
  resolve(__dirname, "../../../services/search/contracts/schema.sql"),
  "utf8",
);

/**
 * جداولُ البحثِ + صادرُ السوقِ بترتيبِ اعتمادٍ عكسيٍّ.
 *
 * ونسخةٌ ثانيةٌ من القائمةِ هنا لا استيرادٌ، لأنّ `pg-harness.ts` في الخدمةِ أداةُ اختبارٍ
 * داخليّةٌ لا تُصدِّرُها الحزمةُ، وتصديرُها لأجلِ بوّابةٍ كان سيفتحُ سطحاً عامّاً لأداةِ اختبار.
 */
export const TABLES = [
  "search_relay_checkpoint",
  "search_relay_consumed_events",
  "search_outbox",
  "search_marketplace_product_state",
  "search_marketplace_store_state",
  "search_product_index",
  "marketplace_outbox",
] as const;

/**
 * أقلُّ DDL لصادرِ السوقِ يُطابقُ العقدَ المنشورَ بلا مفاتيحَ أجنبيّةٍ.
 *
 * ولمَ لا يُستوردُ مخطّطُ السوقِ كاملاً؟ لأنّ البحثَ **لا يقرأُ جداولَ السوقِ** (ADR-025 §2.3):
 * سطحُ التلامسِ الوحيدُ صفُّ صادرٍ. واستيرادُ المخطّطِ كلِّهِ كان سيجعلُ بوّابةَ البحثِ تسقطُ
 * بتغييرٍ في جدولِ مراجعاتِ المتاجرِ — وهو تزاوجٌ تمنعُهُ الوثيقةُ نفسُها.
 */
const OUTBOX_DDL = `
CREATE TABLE IF NOT EXISTS marketplace_outbox (
    outbox_id      UUID        PRIMARY KEY,
    event_type     TEXT        NOT NULL CHECK (event_type ~ '^marketplace\\.[a-z_]+$'),
    event_version  TEXT        NOT NULL CHECK (event_version ~ '^v[0-9]+$'),
    aggregate_type TEXT        NOT NULL CHECK (aggregate_type IN ('store', 'product', 'inventory')),
    aggregate_id   TEXT        NOT NULL,
    payload        JSONB       NOT NULL,
    occurred_at    TIMESTAMPTZ NOT NULL,
    published_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

/**
 * منفذُ الكتالوجِ في البوّابةِ — مُضاعِفٌ **مُعلَنٌ**، وهو الحدُّ الوحيدُ المقبولُ هنا.
 *
 * الأحداثُ لا تحملُ عنواناً ولا سعراً (ADR-016 قرارا 4 و10)، والناقلُ يجلبُهما من منفذِ القراءةِ
 * المُصرَّحِ بهِ (`GET /products/{productId}`) — وهو خدمةُ السوقِ. ورفعُ خدمةِ السوقِ كاملةً داخلَ
 * بوّابةِ البحثِ كان سيجعلُ الطورَ 12 يسقطُ بعطبٍ في الطورِ 11، وهو عينُ التزاوجِ الذي تمنعُهُ
 * ADR-025. فالمنفذُ هنا مُضاعِفٌ يُغذّى ببياناتِ الكتالوجِ نفسِها التي تُبذَرُ بها الأحداثُ،
 * **والحدُّ مُعلَنٌ في وثيقةِ البوّابةِ §الحدود** لا مطويٌّ.
 */
class GateCatalog implements CatalogReadPort {
  private readonly data = new Map<string, CatalogProduct>();

  set(product: CatalogProduct): void {
    this.data.set(product.product_id, product);
  }

  async getProduct(productId: string): Promise<CatalogProduct | null> {
    return this.data.get(productId) ?? null;
  }
}

export interface GateContext {
  /** أصلُ الخدمةِ — مُستمعٌ حقيقيٌّ على منفذٍ يمنحُهُ النظام. */
  readonly baseUrl: string;
  readonly pool: Pool;
  readonly store: PostgresProjectionStore;
  readonly catalog: GateCatalog;
  readonly close: () => Promise<void>;
}

type SearchApp = ReturnType<typeof buildSearchHttpApp>;

let app: SearchApp | null = null;

/** مادةُ مفاتيح البوابة (M1-04). سرٌّ واحد: المُبرهَن هنا الفرضُ لا إدارةُ المفاتيح. */
const GATE_SERVICE_AUTH_KID = "gate-active";
const GATE_SERVICE_AUTH_SECRET = "gate-service-auth-secret-0123456789";

function gateKeys(): ServiceAuthKeyRegistry {
  return new ServiceAuthKeyRegistry({
    keys: [{ kid: GATE_SERVICE_AUTH_KID, secret: GATE_SERVICE_AUTH_SECRET, status: "active" }],
    activeKid: GATE_SERVICE_AUTH_KID,
  });
}

/** موقِّعٌ لنداءاتِ البوابةِ على حدِّ البحث — بكاملِ مجموعةِ صلاحيّاتِه. */
function searchSigner() {
  return createServiceRequestSigner({
    serviceName: "search-exit-gate",
    audience: "search",
    keys: gateKeys(),
    scopes: ["search:ready:read", "search:products:read"],
  });
}

/**
 * يرفعُ الخدمةَ بتركيبِها الإنتاجيِّ: `buildSearchHttpApp` بقارئِ `SearchIndexReader` على حوضٍ
 * حقيقيٍّ، ومُستمعٍ على منفذٍ يمنحُهُ النظام. ولا منفذَ وهميٌّ ولا `app.inject` في هذه الحزمةِ بحال.
 */
export async function startGate(): Promise<GateContext> {
  const connectionString = process.env.DATABASE_URL!;
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString, max: 8 });

  await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
  await pool.query(OUTBOX_DDL);
  await pool.query(searchSchemaSql);

  const built = buildSearchHttpApp({
    searchReadPort: new SearchIndexReader(pool),
    // بالمحوّلِ الإنتاجيِّ نفسِهِ وعلى الحوضِ نفسِهِ — مسبارُ جاهزيّةٍ يُركَّبُ في البوّابةِ
    // وحدَها لا يُثبتُ شيئاً عن `server.ts`. وكاتمُ السجلِّ لئلّا يمتلئَ مخرجُ البوّابةِ
    // بأثرِ إخفاقٍ **مقصودٍ** في اختبارِ التدهورِ.
    indexHealthPort: new SearchIndexHealthProbe(pool, { error: () => {} }),
    // `G5` موجةُ 1 (`CLM-0247`): يُمرَّرُ هنا لأنَّ الجذرَ الإنتاجيَّ يُمرِّرُهُ —
    // بوّابةُ خروجٍ تُجيزُ تركيباً أفقرَ من الإنتاجِ تُجيزُ ما لا يعملُ.
    deadLetterReadPort: new PostgresSearchDeadLetterStore(pool),
    relayRequeuePort: new PostgresSearchRequeueStore(pool),
    // M1-04 · الموجةُ الثانيةَ عشرةَ (CLM-0200): حدُّ البحث يفرضُ هويّةَ الخدمةِ،
    // والبوّابةُ تُوقّعُ نداءاتِها بدلَ أن يُخفَّفَ الحدُّ لراحتِها.
    serviceIdentity: {
      keys: gateKeys(),
      replayGuard: new InMemoryServiceTokenReplayGuard(),
    },
  });
  app = built;
  await built.fastify.listen({ port: 0, host: "127.0.0.1" });
  const { port } = built.fastify.server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    pool,
    store: new PostgresProjectionStore(pool),
    catalog: new GateCatalog(),
    close: async () => {
      await built.close();
      app = null;
      await pool.end();
    },
  };
}

/** يُعيدُ بناءَ المخطّطِ بعدَ اختبارِ التدهورِ — المخطّطُ من الملفِّ نفسِه لا من نسخةٍ ثانيةٍ. */
export async function reapplySchema(pool: Pool): Promise<void> {
  await pool.query(searchSchemaSql);
}

export async function resetData(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

// ─────────────────────────────────────────────────────────────────────────────
// بذرُ الأحداثِ — لا صفَّ فهرسٍ يُكتبُ بيدٍ في هذا القسمِ
// ─────────────────────────────────────────────────────────────────────────────

let minute = 0;

/** لحظةٌ تاليةٌ — تصاعديّةٌ دوماً، فترتيبُ الاستهلاكِ ترتيبُ البذرِ. */
function nextInstant(): string {
  minute += 1;
  return new Date(Date.parse(T0) + minute * 60_000).toISOString();
}

async function seedEvent(
  pool: Pool,
  event: {
    readonly event_type: string;
    readonly aggregate_type: string;
    readonly aggregate_id: string;
    readonly payload: Record<string, unknown>;
  },
): Promise<void> {
  const at = nextInstant();
  await pool.query(
    `INSERT INTO marketplace_outbox (outbox_id, event_type, event_version, aggregate_type, aggregate_id, payload, occurred_at, created_at)
     VALUES (gen_random_uuid(), $1, 'v1', $2, $3, $4::jsonb, $5, $6)`,
    [
      event.event_type,
      event.aggregate_type,
      event.aggregate_id,
      JSON.stringify({ ...event.payload, occurred_for: at }),
      at,
      at,
    ],
  );
}

/** متجرٌ يُسجَّلُ ثمّ يُعتمَدُ — حدثانِ، وكلاهُما بتسلسلٍ صاعدٍ يمنعُ الارتدادَ. */
export async function seedApprovedStore(pool: Pool): Promise<void> {
  const base = { store_id: STORE_ID, store_slug: STORE_SLUG, owner_public_id: OWNER, category_slug: CAT_PHONES };
  await seedEvent(pool, {
    event_type: "marketplace.store_registered",
    aggregate_type: "store",
    aggregate_id: STORE_ID,
    payload: { ...base, to_state: "pending_review", state_sequence: 1, actor_type: "owner" },
  });
  await seedEvent(pool, {
    event_type: "marketplace.store_approved",
    aggregate_type: "store",
    aggregate_id: STORE_ID,
    payload: { ...base, from_state: "pending_review", to_state: "approved", state_sequence: 2, actor_type: "moderator" },
  });
}

/** متجرٌ يبقى `pending_review` — أوّلُ أسبابِ الإخفاءِ الخمسةِ. */
export async function seedPendingStore(pool: Pool): Promise<void> {
  await seedEvent(pool, {
    event_type: "marketplace.store_registered",
    aggregate_type: "store",
    aggregate_id: PENDING_STORE_ID,
    payload: {
      store_id: PENDING_STORE_ID,
      store_slug: PENDING_STORE_SLUG,
      owner_public_id: OWNER,
      category_slug: CAT_PHONES,
      to_state: "pending_review",
      state_sequence: 1,
      actor_type: "owner",
    },
  });
}

export interface ProductSpec {
  readonly product_id: string;
  readonly sku: string;
  readonly title_ar: string;
  readonly title_en: string | null;
  readonly price_minor_units: number;
  readonly category_slug: string;
  /** المتجرُ المالكُ — المعتمَدُ افتراضاً، والمُعلَّقُ لإخفاءِ الوثيقةِ بسببِ متجرِها. */
  readonly store_id?: string;
  readonly store_slug?: string;
  /** إلى أينَ تسيرُ دورةُ حياةِ المنتجِ. الافتراضُ: منشورٌ ظاهرٌ بمخزونٍ. */
  readonly lifecycle?: "visible" | "draft" | "rejected" | "out_of_stock" | "archived";
  readonly quantity?: number;
}

/**
 * يبذرُ دورةَ حياةِ منتجٍ كاملةً أحداثاً، ويُسجِّلُ بيانَ كتالوجِهِ في المنفذِ.
 *
 * والترتيبُ هو ترتيبُ السوقِ الحقيقيُّ: إنشاءٌ (مسوَّدةٌ · اعتدالٌ مُعلَّقٌ) ← اعتدالٌ ← نشرٌ ←
 * (تعديلُ مخزونٍ | أرشفةٌ). ولا اختصارَ لخطوةٍ: منتجٌ يُنشَرُ بلا اعتدالٍ معتمَدٍ يبقى مخفيّاً،
 * وذلك بالضبطِ ما تقيسُهُ حالةُ `rejected`.
 */
export async function seedProduct(ctx: GateContext, spec: ProductSpec): Promise<void> {
  const storeId = spec.store_id ?? STORE_ID;
  const storeSlug = spec.store_slug ?? STORE_SLUG;
  const lifecycle = spec.lifecycle ?? "visible";
  const quantity = spec.quantity ?? 7;

  ctx.catalog.set({
    product_id: spec.product_id,
    store_id: storeId,
    store_slug: storeSlug,
    sku: spec.sku,
    category_slug: spec.category_slug,
    title_ar: spec.title_ar,
    title_en: spec.title_en,
    price_minor_units: spec.price_minor_units,
    currency_code: "SAR",
  });

  await seedEvent(ctx.pool, {
    event_type: "marketplace.product_created",
    aggregate_type: "product",
    aggregate_id: spec.product_id,
    payload: {
      product_id: spec.product_id,
      store_id: storeId,
      store_slug: storeSlug,
      sku: spec.sku,
      category_slug: spec.category_slug,
      state: "draft",
      moderation_state: "pending",
      created_by_public_id: OWNER,
    },
  });

  if (lifecycle === "draft") return;

  await seedEvent(ctx.pool, {
    event_type: "marketplace.product_moderated",
    aggregate_type: "product",
    aggregate_id: spec.product_id,
    payload: {
      product_id: spec.product_id,
      store_id: storeId,
      store_slug: storeSlug,
      from_state: "pending",
      to_state: lifecycle === "rejected" ? "rejected" : "approved",
      moderation_sequence: 1,
      actor_type: "moderator",
      actor_public_id: MODERATOR,
    },
  });

  await seedEvent(ctx.pool, {
    event_type: "marketplace.product_published",
    aggregate_type: "product",
    aggregate_id: spec.product_id,
    payload: {
      product_id: spec.product_id,
      store_id: storeId,
      store_slug: storeSlug,
      category_slug: spec.category_slug,
      from_state: "draft",
      to_state: "published",
      store_state: storeId === STORE_ID ? "approved" : "pending_review",
      quantity_on_hand: lifecycle === "out_of_stock" ? 0 : quantity,
      actor_public_id: OWNER,
    },
  });

  if (lifecycle === "archived") {
    await seedEvent(ctx.pool, {
      event_type: "marketplace.product_archived",
      aggregate_type: "product",
      aggregate_id: spec.product_id,
      payload: {
        product_id: spec.product_id,
        store_id: storeId,
        store_slug: storeSlug,
        from_state: "published",
        to_state: "archived",
        actor_public_id: OWNER,
      },
    });
  }
}

/** تعديلُ مخزونٍ بحدثٍ — به تُقاسُ إعادةُ بناءِ الظهورِ بلا `DELETE` ولا رايةٍ. */
export async function seedInventoryAdjustment(
  ctx: GateContext,
  productId: string,
  quantityAfter: number,
  sequence: number,
): Promise<void> {
  await seedEvent(ctx.pool, {
    event_type: "marketplace.inventory_adjusted",
    aggregate_type: "product",
    aggregate_id: productId,
    payload: {
      adjustment_id: `bbbbbbbb-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      product_id: productId,
      store_id: STORE_ID,
      quantity_delta: 0,
      quantity_after: quantityAfter,
      reason_code: "manual_correction",
      adjustment_sequence: sequence,
      actor_public_id: OWNER,
    },
  });
}

export interface DrainOutcome {
  readonly batches: number;
  readonly processed: number;
  readonly applied: number;
  /** أحداثٌ لا يعنيها البحثُ (طاقمُ متجرٍ مثلاً) — تُستهلَكُ ولا تُسقَطُ. */
  readonly skipped: number;
  /** أحداثٌ أخفقت حتى نفدت محاولاتُها — أيُّ رقمٍ غيرِ صفرٍ عطبٌ تُظهرُهُ البوّابةُ باسمِه. */
  readonly poisoned: number;
  readonly elapsedMs: number;
}

/**
 * يُدير الناقلَ الحقيقيَّ حتى ينضبَ الصادرُ — بالمحوّلاتِ الإنتاجيّةِ نفسِها.
 *
 * وحدُّ الدوراتِ (`maxBatches`) ليس زينةً: ناقلٌ لا يُقدِّمُ نقطةَ تقدُّمِهِ يدورُ أبداً، وحلقةٌ
 * بلا حدٍّ كانت ستُظهرُ العطبَ **مهلةً منتهيةً** بعدَ ثلاثِ دقائقَ بدلَ أن تُظهرَهُ خطأً باسمِهِ.
 */
export async function drainRelay(ctx: GateContext, maxBatches = 200): Promise<DrainOutcome> {
  const deps = {
    events: new PostgresMarketplaceEventSource(ctx.pool),
    catalog: ctx.catalog,
    store: ctx.store,
    config: DEFAULT_RELAY_CONFIG,
  };
  const startedAt = Date.now();
  let batches = 0;
  let processed = 0;
  let applied = 0;
  let skipped = 0;
  let poisoned = 0;

  for (; batches < maxBatches; batches += 1) {
    const outcome = await runRelayBatch(deps);
    if (outcome.processed === 0) break;
    processed += outcome.processed;
    applied += outcome.applied;
    skipped += outcome.skipped;
    poisoned += outcome.poisoned;
  }

  if (batches >= maxBatches) {
    throw new Error(`الناقلُ لم ينضبْ بعدَ ${maxBatches} دورةً — نقطةُ التقدُّمِ لا تتقدَّم`);
  }

  return { batches, processed, applied, skipped, poisoned, elapsedMs: Date.now() - startedAt };
}

/**
 * حشوُ الحملِ — **حجمٌ لا خطُّ أنابيبَ**، ومُعلَنٌ بذلك في اسمِهِ وفي §الحدودِ من وثيقةِ البوّابةِ.
 *
 * ألفا وثيقةٍ ظاهرةٍ بمفرداتٍ **معزولةٍ** لا تُطابقُ استعلامَ حكمٍ واحداً، تُكتبُ بجملةٍ واحدةٍ.
 * ولو مُرَّت عبرَ الناقلِ لصارَ الرقمُ المحروسُ زمنَ الإسقاطِ لا زمنَ البحثِ (انظر ترويسةَ الملفِّ).
 */
export async function seedLoadFixture(pool: Pool, count = LOAD_FIXTURE_SIZE): Promise<number> {
  const result = await pool.query(
    `INSERT INTO search_product_index (
       product_id, store_id, store_slug, sku, category_slug,
       title_ar, title_en, price_minor_units, currency_code,
       store_state, product_state, moderation_state, quantity_on_hand
     )
     SELECT
       gen_random_uuid(), $1::uuid, $2, 'SKU-LOAD-' || lpad(g::text, 6, '0'), $3,
       'أداة حمل رقم ' || g::text, 'Load Widget Number ' || g::text,
       1000 + g, 'SAR',
       'approved', 'published', 'approved', 5
     FROM generate_series(1, $4::int) AS g`,
    [STORE_ID, STORE_SLUG, CAT_LOAD, count],
  );
  return result.rowCount ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// النداءُ على السلكِ والقياسُ
// ─────────────────────────────────────────────────────────────────────────────

export interface HttpResult {
  readonly status: number;
  readonly text: string;
  readonly body: Record<string, unknown>;
  /** زمنُ الرحلةِ كاملةً بالمللي — من قبلِ `fetch` إلى بعدِ قراءةِ الجسمِ. */
  readonly ms: number;
}

/** نداءٌ عبرَ الشبكةِ على المُستمعِ — موقَّعٌ بهويّةِ خدمةٍ (M1-04 · الموجةُ 12). */
export async function get(gate: GateContext, path: string): Promise<HttpResult> {
  const startedAt = performance.now();
  const pathOnly = path;
  const headers =
    pathOnly === "/search/health" ? {} : searchSigner()("GET", pathOnly);
  const response = await fetch(`${gate.baseUrl}${path}`, { headers });
  const text = await response.text();
  const ms = performance.now() - startedAt;
  return {
    status: response.status,
    text,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    ms,
  };
}

export interface SearchItem {
  readonly product_id: string;
  readonly sku: string;
  readonly title_ar: string;
  readonly title_en: string | null;
  readonly price_minor_units: number;
  readonly category_slug: string;
  readonly score: number;
}

export interface SearchBody {
  readonly items: readonly SearchItem[];
  readonly page: number;
  readonly page_size: number;
  readonly total: number;
}

/** استعلامُ بحثٍ عبرَ السلكِ — يُبنى الاستعلامُ بـ`URLSearchParams` فلا ترميزَ بيدٍ. */
export async function search(
  gate: GateContext,
  params: Readonly<Record<string, string | number>>,
): Promise<{ readonly status: number; readonly body: SearchBody; readonly text: string; readonly ms: number }> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) qs.set(key, String(value));
  const result = await get(gate, `/search/products?${qs.toString()}`);
  return {
    status: result.status,
    body: result.body as unknown as SearchBody,
    text: result.text,
    ms: result.ms,
  };
}

/** مئينيّةٌ بالاستيفاءِ الخطّيِّ على عيّنةٍ مرتّبةٍ — لا تقريبَ صامتاً إلى أقربِ عنصر. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) throw new Error("لا عيّنةَ لقياسِ مئينيّةٍ");
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

export interface LatencyReport {
  readonly count: number;
  readonly errors: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export function report(samples: readonly number[], errors: number): LatencyReport {
  return {
    count: samples.length,
    errors,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    max: Math.max(...samples),
  };
}

/** طباعةُ التقريرِ في سجلِّ الوظيفةِ — بوّابةُ حملٍ لا تُظهرُ أرقامَها لا تُراجَع. */
export function printReport(label: string, r: LatencyReport): void {
  // eslint-disable-next-line no-console
  console.log(
    `[phase12-load] ${label}: n=${r.count} errors=${r.errors} ` +
      `p50=${r.p50.toFixed(1)}ms p95=${r.p95.toFixed(1)}ms p99=${r.p99.toFixed(1)}ms max=${r.max.toFixed(1)}ms`,
  );
}

/** يُغلقُ المُستمعَ إن بقيَ مفتوحاً بعدَ فشلٍ في `beforeAll` — فلا تُعلَّقُ الوظيفةُ في CI. */
export async function forceClose(): Promise<void> {
  if (app !== null) {
    await app.close();
    app = null;
  }
}

/**
 * ## النطاق
 *
 * رفعُ خدمةِ البحثِ على مُستمعٍ وقاعدةٍ حقيقيَّينِ، وبذرُ أحداثِ سوقٍ تبني الفهرسَ بالناقلِ
 * الإنتاجيِّ، وحشوُ حملٍ مُعلَنٌ، ونداءٌ عبرَ الشبكةِ بقياسِ زمنٍ ومئينيّاتٍ.
 *
 * ## آخر تحديث
 *
 * المراجعة 4/N — الملفُّ جديد.
 *
 * ## الحالة
 *
 * يحتاجُ `DATABASE_URL`؛ ويتخطّى نفسَهُ بلا قاعدةٍ عبر `PG_ENABLED`.
 *
 * ## كودٌ ذو صلة
 *
 * `services/search/src/http/app.ts` · `services/search/src/infrastructure/search-index-reader.ts` ·
 * `services/search/src/__tests__/pg-harness.ts` · `packages/marketplace-e2e/src/harness.ts`.
 *
 * ## الفريق
 *
 * Search / Marketplace.
 */
