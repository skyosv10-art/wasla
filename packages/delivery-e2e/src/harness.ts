/**
 * مِشْكاةُ بوّابةِ خروجِ الطورِ 13 — **خدمتانِ** على مُستمعَينِ حقيقيَّينِ وقاعدةٍ
 * حقيقيّةٍ واحدةٍ، والسلكُ بينهما موقَّعٌ.
 *
 * # ما تُثبتُهُ هذه الحزمةُ ولا يُثبتُهُ غيرُها
 *
 * اختباراتُ خدمةِ التوصيلِ (205 سريعاً، وسبعةُ ملفّاتِ تكاملٍ على قاعدةٍ حقيقيّةٍ)
 * تُثبتُ أنَّ كلَّ قطعةٍ صحيحةٌ وحدَها: جداولُ الانتقالاتِ، ومرآةُ الدفعِ، وبوّابةُ
 * التأكيدِ، وحرسُ الإعادةِ، ومحوّلُ الكتالوجِ أمامَ `fetchImpl` مزروعٍ. ولا تُثبتُ
 * خمسةَ أشياءَ لا تظهرُ إلّا مُجتمِعةً وعبرَ سلكَينِ:
 *
 *  1. **أنَّ لقطةَ السعرِ تُؤخَذُ من السوقِ الحقيقيِّ عبرَ الشبكةِ.** اختبارُ المحوّلِ
 *     يحقنُ `fetchImpl` يُجيبُ أجساماً يكتبُها الاختبارُ بيدِه؛ وهنا يُجيبُ
 *     `GET /products/{id}` **خدمةُ السوقِ نفسُها** بجسمٍ تكتبُهُ رحلةُ اعتدالٍ
 *     ونشرٍ حقيقيّةٌ. فحقلٌ يُعادُ تسميتُهُ في عقدِ السوقِ يسقطُ هنا لا في الإنتاج.
 *  2. **أنَّ الشوطَ `placed → confirmed` مقطوعٌ فعلاً.** كانَ هذا هوَ الدَّينُ الذي
 *     أوجبَ المراجعةَ 9/N: `canConfirmOrder` بلا مُنادٍ، و`payment_state` عالقةٌ
 *     على `pending` إلى الأبدِ. والبوّابةُ تقطعُ الشوطَ عبرَ الشبكةِ: مرآةُ دفعٍ
 *     `authorized` ثمّ تأكيدٌ، وتُوكِّدُ الحالتَينِ المُتعامدتَينِ في جسمِ الجوابِ
 *     **وفي جدولِ الانتقالاتِ** بنوعَيهِ.
 *  3. **أنَّ ما يكتبُهُ الحدُّ في الصندوقِ يُطابقُ العقدَ المنشورَ غلافاً وحمولةً.**
 *     `events.test.ts` يُصدِّقُ مُسوَّداتٍ يبنيها الاختبارُ؛ وهنا تُقرأُ صفوفُ
 *     `delivery_outbox` التي كتبتها **طلباتٌ حقيقيّةٌ**، ويُعادُ تركيبُ الحدثِ
 *     المُسطَّحِ من أعمدتِها، ثمّ يُصدَّقُ على `contracts/events.json` **مقروءاً من
 *     القرصِ** — لا ثابتَ حدثٍ واحدٍ في هذا الملفّ.
 *  4. **أنَّ حدثَ مخزونٍ حقيقيّاً يصلُ من السوقِ إلى التوصيلِ.** اختباراتُ الناقلِ
 *     تبذرُ صفوفاً في `marketplace_outbox` بيدِها؛ وهنا يكتبُ الصفَّ **حدُّ السوقِ**
 *     عندَ تعديلِ مخزونٍ، فيُثبَتُ أنَّ ما يُنتِجُهُ المُنتِجُ هوَ ما يفهمُهُ
 *     المُستهلِكُ — وهي الدعوى التي لا يملكُ أيُّ اختبارِ خدمةٍ واحدةٍ إثباتَها.
 *  5. **أنَّ الناقلَ الخارجَ غائبٌ كما يُعلَنُ.** بعدَ رحلةٍ كاملةٍ يبقى
 *     `published_at` فارغاً في كلِّ صفٍّ من صندوقِ التوصيلِ.
 *
 * # النسخةُ الخاطئةُ الأرخصُ
 *
 * كانَ الأرخصُ أن يُركَّبَ منفذُ كتالوجٍ مُزيَّفٌ في هذه البوّابةِ فيُغني عن رفعِ
 * السوقِ. والنتيجةُ بوّابةٌ تُثبتُ أنَّ التوصيلَ متّسقٌ مع **فهمِنا** لعقدِ السوقِ —
 * وهوَ مُثبَتٌ أصلاً في `http-marketplace-catalog.test.ts` — ولا تُثبتُ أنَّ
 * الخدمتَينِ تتكلّمانِ. ولذلك لا مُزيَّفَ واحدٍ هنا: المخزنُ Postgres، والمُستمعانِ
 * `node:http`، والتوقيعُ حقيقيٌّ بمفتاحٍ حقيقيٍّ (§ADR-020).
 *
 * # ساعتانِ متقدّمتانِ لا ثابتتانِ — وهذا فرقٌ عن بوّابةِ الطورِ 11
 *
 * بوّابةُ السوقِ تحقنُ لحظةً **ثابتةً**، وتلكَ تكفيها. وهنا لا تكفي: ناقلُ المخزونِ
 * يقرأُ `WHERE (occurred_at, outbox_id) > (checkpoint)` ويُرتِّبُ بهما، فلو تساوتِ
 * اللحظاتُ لصارَ ترتيبُ الأحداثِ **ترتيبَ مُعرِّفاتٍ عشوائيّةٍ** — وحدثٌ لاحقٌ قد
 * يسبقُ علامةَ الماءِ فلا يُقرأُ أبداً. فالساعةُ هنا تتقدّمُ ثانيةً في كلِّ قراءةٍ:
 * حتميّةٌ كالثابتةِ، ومرتَّبةٌ كالحقيقيّةِ.
 *
 * Scope: المراجعة 9/N — بوّابةُ الخروجِ فقط.
 * Related Code: services/delivery · services/marketplace
 * Related Docs: docs/12-testing/PHASE13_EXIT_GATE_E2E.md
 */
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import {
  DELIVERY_MARKETPLACE_SCOPES,
  DELIVERY_MARKETPLACE_RESERVATION_SCOPES,
  CachedDependencyProbe,
  DEFAULT_MARKETPLACE_PROBE_TTL_MS,
  DELIVERY_MARKETPLACE_PROBE_SCOPES,
  HttpMarketplaceCatalogPort,
  HttpMarketplaceHealthProbe,
  HttpMarketplaceReservationPort,
  PostgresInventoryObservationStore,
  PostgresMarketplaceInventoryEventSource,
  PostgresReadinessProbe,
  DELIVERY_SCOPES,
  DELIVERY_SERVICE_AUDIENCE,
  StoreOrderStore,
  buildDeliveryHttpApp,
  runInventoryRelayBatch,
  type BatchOutcome,
} from "@wasla/delivery-service";
import {
  MarketplaceCatalogService,
  MarketplaceProductService,
  MarketplaceStoreService,
} from "@wasla/marketplace-service/app";
import {
  MarketplaceUnitOfWork,
  applyMarketplaceSchema,
  bindStores,
  createMarketplaceDb,
  type Db,
  type MarketplaceStores,
} from "@wasla/marketplace-service/db";
import { createMarketplaceApp } from "@wasla/marketplace-service/http";
import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  createServiceRequestSigner,
  serviceAuthHeaders,
} from "@wasla/service-auth";
import type { Pool } from "pg";

type MarketplaceApp = ReturnType<typeof createMarketplaceApp>;

/** البوّابةُ تحتاجُ قاعدةً: كلتا الخدمتَينِ بلا مخزنٍ تردُّ 503 عن قصدٍ. */
export const PG_ENABLED = (process.env.DATABASE_URL ?? "").trim() !== "";

/** لحظةُ الأساسِ؛ وكلُّ قراءةِ ساعةٍ بعدَها تتقدّمُ ثانيةً (انظر رأسَ الملفِّ). */
export const T0 = "2026-06-01T00:00:00.000Z";

export const OWNER = "WS-1000000001";
export const MODERATOR = "WS-9000000001";
export const CUSTOMER = "WS-2000000007";

export const CATEGORY = "electronics-phones";
export const STORE_SLUG = "madinah-electronics";

/** سعرُ الوحدةِ في السوقِ — والبوّابةُ تُوكِّدُ أنَّ الطلبَ أخذَهُ لا اخترعَهُ. */
export const UNIT_PRICE_MINOR_UNITS = 249900;
export const DELIVERY_FEE_MINOR_UNITS = 1500;

/**
 * جداولُ السوقِ العشرةُ بترتيبِ اعتمادٍ عكسيٍّ — نفسُ قائمةِ بوّابةِ الطورِ 11،
 * ونسخةٌ ثانيةٌ لا استيرادٌ لأنَّ `pg-harness.ts` أداةُ اختبارٍ داخليّةٌ لا تُصدِّرُها
 * الحزمةُ، وتصديرُها لأجلِ بوّابةٍ كانَ سيفتحُ سطحاً عامّاً لأداةِ اختبارٍ.
 */
const MARKETPLACE_TABLES = [
  "marketplace_outbox",
  "marketplace_idempotency",
  "product_inventory",
  "inventory_adjustments",
  "product_reviews",
  "products",
  "store_staff",
  "store_reviews",
  "stores",
  "store_categories",
] as const;

/**
 * جداولُ التوصيلِ — تُستخرَجُ **من العقدِ وقتَ التشغيلِ** لا تُكتَبُ قائمةً.
 *
 * وهذا هوَ درسُ M0-18 مدفوعاً مرّتَينِ: قائمةٌ مكتوبةٌ بيدٍ تنسى جدولاً يُضافُ
 * غداً، فيبقى صفٌّ من اختبارٍ سابقٍ يُلوِّثُ البوّابةَ ويُقرأُ الفشلُ عقداً مخالفاً.
 */
const DELIVERY_SCHEMA_PATH = resolve(process.cwd(), "../../services/delivery/contracts/schema.sql");
const DELIVERY_SCHEMA_SQL = readFileSync(DELIVERY_SCHEMA_PATH, "utf8");
const DELIVERY_TABLES: readonly string[] = [
  ...DELIVERY_SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g),
].map((match) => match[1]);

export interface GateContext {
  /** أصلُ خدمةِ التوصيلِ — مُستمعٌ حقيقيٌّ على منفذٍ يمنحُهُ النظامُ. */
  readonly deliveryBaseUrl: string;
  /** أصلُ خدمةِ السوقِ — وهوَ ما يُنادِيهِ محوّلُ الكتالوجِ فعلاً. */
  readonly marketplaceBaseUrl: string;
  /** حوضُ القاعدةِ للتوكيداتِ التي تقرأُ صفوفاً لا أجساماً. */
  readonly pool: Pool;
  readonly db: Db;
  readonly stores: MarketplaceStores;
  /** دفعةُ ناقلِ المخزونِ — تُنادى صراحةً: لا حلقةَ خلفيّةٍ في بوّابةٍ. */
  readonly relayInventory: () => Promise<BatchOutcome>;
  /**
   * مفاتيحُ توقيعِ النداءِ **الداخلِ** إلى حدِّ التوصيلِ (المراجعةُ 17/N).
   *
   * وتُنشَرُ في السياقِ لا تُخفى في `callDelivery`: البوّابةُ تحتاجُ أن توقِّعَ
   * بمفتاحٍ **مسحوبٍ** أو بسرٍّ **مزوَّرٍ** لتُثبِتَ الرفضَ على السلكِ، ولا تقدرُ
   * على ذلكَ إن كانَ السجلُّ محجوباً.
   */
  readonly deliveryInboundKeys: ServiceAuthKeyRegistry;
  readonly close: () => Promise<void>;
}

/**
 * ساعةٌ متقدّمةٌ: `T0` ثمّ `T0+1s` ثمّ `T0+2s`… حتميّةٌ ومرتَّبةٌ معاً.
 *
 * ولمَ لا `new Date()`؟ لأنَّ الفشلَ بعدَ سنةٍ يجبُ أن يبقى مقروءاً، ولأنَّ لحظةً
 * حقيقيّةً تجعلُ رسالةَ الفشلِ تختلفُ في كلِّ تشغيلٍ فلا تُقارَنُ بسجلٍّ سابقٍ.
 */
function advancingClock(): () => string {
  let tick = 0;
  const base = Date.parse(T0);
  return () => {
    const at = new Date(base + tick * 1000).toISOString();
    tick += 1;
    return at;
  };
}

/**
 * سجلُّ مفاتيحَ حقيقيٌّ للتوقيعِ بينَ الخدمتَينِ.
 *
 * والسرُّ مكتوبٌ هنا لأنَّهُ سرُّ **اختبارٍ** لا سرُّ بيئةٍ: قراءتُهُ من
 * `process.env` كانت ستجعلُ البوّابةَ تسقطُ على جهازٍ نظيفٍ لسببٍ لا علاقةَ لهُ
 * بالدعوى، وتركُ التوقيعِ كانَ سيُخالفُ ADR-020 — والتوقيعُ صفةُ المنادي لا رخصةٌ
 * من المُنادى (وحدُّ السوقِ لا يفرضُ الهويّةَ اليومَ، وهذا مُسجَّلٌ في
 * docs/07-security/SERVICE_AUTH_ENFORCEMENT.md).
 */
function gateSigner(): ReturnType<typeof createServiceRequestSigner> {
  const keys = new ServiceAuthKeyRegistry({
    keys: [{ kid: "gate-1", secret: "phase13-exit-gate-signing-secret-000001", status: "active" }],
    activeKid: "gate-1",
  });
  return createServiceRequestSigner({
    serviceName: "delivery",
    audience: "marketplace",
    keys,
    scopes: DELIVERY_MARKETPLACE_SCOPES,
  });
}

/**
 * صانعُ توقيعٍ لمسبارِ الجاهزيّةِ — نفسُ المفتاحِ و**بلا صلاحيّةٍ** (المراجعةُ 15/N).
 *
 * قائمةٌ فارغةٌ لأنَّ مسبارَ صحّةٍ لا يقرأُ متجراً ولا منتجاً؛ ولأنَّ البوّابةَ
 * تُوقِّعُ بمفتاحٍ حقيقيٍّ فإنَّ نجاحَ الرصدِ هنا يُثبِتُ أنَّ التوقيعَ بصلاحيّاتٍ
 * فارغةٍ **يُقبَلُ فعلاً** على حدِّ السوقِ — لا في وحدةٍ مزروعةِ الـ`fetch`.
 */
function probeSigner(): ReturnType<typeof createServiceRequestSigner> {
  const keys = new ServiceAuthKeyRegistry({
    keys: [{ kid: "gate-1", secret: "phase13-exit-gate-signing-secret-000001", status: "active" }],
    activeKid: "gate-1",
  });
  return createServiceRequestSigner({
    serviceName: "delivery",
    audience: "marketplace",
    keys,
    scopes: DELIVERY_MARKETPLACE_PROBE_SCOPES,
  });
}

/** صانعُ توقيعٍ لمنفذِ الحجزِ — نفسُ المفتاحِ ونطاقُ الحجزِ. */
function reservationSigner(): ReturnType<typeof createServiceRequestSigner> {
  const keys = new ServiceAuthKeyRegistry({
    keys: [{ kid: "gate-1", secret: "phase13-exit-gate-signing-secret-000001", status: "active" }],
    activeKid: "gate-1",
  });
  return createServiceRequestSigner({
    serviceName: "delivery",
    audience: "marketplace",
    keys,
    scopes: DELIVERY_MARKETPLACE_RESERVATION_SCOPES,
  });
}

/**
 * سجلُّ مفاتيحِ النداءِ **الداخلِ** إلى حدِّ التوصيلِ — سرٌّ مستقلٌّ عن سرِّ
 * الصادرِ إلى السوقِ عن قصدٍ: خلطُهما كانَ سيُخفي أنَّ الاتجاهَينِ حدّانِ
 * مختلفانِ لهما جمهورانِ مختلفانِ (`delivery` · `marketplace`).
 */
function deliveryInboundKeyRegistry(): ServiceAuthKeyRegistry {
  return new ServiceAuthKeyRegistry({
    keys: [
      { kid: "gate-inbound-1", secret: "phase13-gate-delivery-inbound-secret-01", status: "active" },
    ],
    activeKid: "gate-inbound-1",
  });
}

/** كلُّ صلاحيّاتِ حدِّ التوصيلِ: البوّابةُ تُثبِتُ الرحلةَ لا نقصَ الصلاحيّةِ. */
export const ALL_DELIVERY_SCOPES: readonly string[] = Object.values(DELIVERY_SCOPES);

/**
 * يرفعُ الخدمتَينِ بتركيبِهما الإنتاجيِّ على قاعدةٍ واحدةٍ.
 *
 * وقاعدةٌ واحدةٌ لا اثنتانِ **لأنَّ الناقلَ يقرأُ صندوقَ السوقِ بـSQL** (§4.7):
 * قاعدتانِ كانتا ستُلزِمانِ بذرَ الصفوفِ يدويّاً في الثانيةِ — أي بالضبطِ المُزيَّفَ
 * الذي جاءتِ البوّابةُ لإزالتِهِ. وهذا هوَ حالُ التطويرِ والـCI اليومَ (خطُّ
 * `services` واحدٌ)، وفصلُ القواعدِ بندٌ في الطورِ 14 مُعلَنٌ في الوثيقةِ.
 */
export async function startGate(): Promise<GateContext> {
  const connectionString = process.env.DATABASE_URL!;
  const { pool, db } = createMarketplaceDb({ connectionString, max: 6 });

  // المخطَّطُ من المُهاجرةِ نفسِها لا من نسخةٍ ثانيةٍ من DDL: ما يُفحَصُ هوَ ما
  // سيركضُ في الإنتاجِ. والإسقاطُ قبلَ البناءِ لأنَّ عقدَ التوصيلِ كلُّهُ
  // `CREATE TABLE IF NOT EXISTS`، فعمودٌ يُضافُ في مراجعةٍ لا يصلُ جدولاً قائماً.
  await pool.query(`DROP TABLE IF EXISTS ${DELIVERY_TABLES.join(", ")} CASCADE`);
  await pool.query(`DROP TABLE IF EXISTS ${MARKETPLACE_TABLES.join(", ")} CASCADE`);
  await applyMarketplaceSchema(pool);
  await pool.query(DELIVERY_SCHEMA_SQL);

  const stores = bindStores(db);
  const marketplaceDeps = { uow: new MarketplaceUnitOfWork(db), clock: { now: advancingClock() } };
  const marketplace: MarketplaceApp = createMarketplaceApp({
    mode: "postgres",
    services: {
      stores: new MarketplaceStoreService(marketplaceDeps),
      products: new MarketplaceProductService(marketplaceDeps),
      catalog: new MarketplaceCatalogService(marketplaceDeps),
    },
    logger: false,
  });
  await marketplace.listen({ port: 0, host: "127.0.0.1" });
  const marketplaceBaseUrl = `http://127.0.0.1:${(marketplace.server.address() as AddressInfo).port}`;

  const store = new StoreOrderStore(pool);
  /*
   * حدُّ التوصيلِ **مفروضٌ** في البوّابةِ كما هوَ في الإنتاجِ (المراجعةُ 17/N ·
   * `M1-04` الموجةُ السادسةُ): بوّابةٌ تبني الحدَّ غيرَ مفروضٍ تشهدُ لتركيبٍ لا
   * وجودَ لهُ، وهيَ **الموضعُ الوحيدُ** الذي يُثبِتُ الفرضَ على مقبسٍ حقيقيٍّ —
   * `app.inject` في اختباراتِ الوحدةِ لا يمرُّ بالشبكةِ. وقد سبقَ في §2.6 أنَّ
   * `fetch` عارياً في بوّابةٍ أخرى كشفَ عيباً حقيقيّاً بـ401، فالعلاجُ توقيعُ
   * النداءِ لا إضعافُ الحدِّ.
   */
  const deliveryInboundKeys = deliveryInboundKeyRegistry();
  const delivery = buildDeliveryHttpApp({
    serviceIdentity: {
      keys: deliveryInboundKeys,
      replayGuard: new InMemoryServiceTokenReplayGuard(),
    },
    readPort: store,
    writePort: store,
    readinessPort: new PostgresReadinessProbe(pool),
    // المحوّلُ الحقيقيُّ على أصلِ السوقِ الحقيقيِّ — ولا `fetchImpl` مزروعٌ.
    catalogPort: new HttpMarketplaceCatalogPort({
      baseUrl: marketplaceBaseUrl,
      signRequest: gateSigner(),
      // 10s لا 2s: القاعدةُ بعيدةٌ في التطويرِ، ونداءُ السوقِ يقرأُها.
      timeoutMs: 10_000,
    }),
    // منفذُ الحجزِ على أصلِ السوقِ الحقيقيِّ — لا يُتخطّى (§2.3).
    reservationPort: new HttpMarketplaceReservationPort({
      baseUrl: marketplaceBaseUrl,
      signRequest: reservationSigner(),
      timeoutMs: 10_000,
    }),
    reservationStore: store,
    /*
     * ومسبارُ رصدٍ حقيقيٌّ على `/health` السوقِ (المراجعةُ 15/N · §4.17): لا
     * `fetchImpl` مزروعٌ، فالبوّابةُ تُثبِتُ أنَّ الرصدَ يعبرُ حدّاً حقيقيّاً
     * بتوقيعٍ حقيقيٍّ — وأنَّ الجاهزيّةَ صارت تُفرِغُ `not_claimed` بحقٍّ لا بدعوى.
     * وصلاحيّةُ الرصدِ الافتراضيّةُ باقيةٌ ليكونَ المُختبَرُ هوَ التركيبَ الإنتاجيَّ.
     */
    marketplaceObservationPort: new CachedDependencyProbe(
      new HttpMarketplaceHealthProbe({
        baseUrl: marketplaceBaseUrl,
        signRequest: probeSigner(),
        timeoutMs: 10_000,
      }),
      { name: "marketplace_catalog", ttlMs: DEFAULT_MARKETPLACE_PROBE_TTL_MS },
    ),
    now: advancingClock(),
  });
  await delivery.fastify.listen({ port: 0, host: "127.0.0.1" });
  const deliveryBaseUrl = `http://127.0.0.1:${(delivery.fastify.server.address() as AddressInfo).port}`;

  const relayStore = new PostgresInventoryObservationStore(pool);
  const relayEvents = new PostgresMarketplaceInventoryEventSource(pool);

  return {
    deliveryBaseUrl,
    marketplaceBaseUrl,
    pool,
    db,
    stores,
    relayInventory: () => runInventoryRelayBatch({ events: relayEvents, store: relayStore }),
    deliveryInboundKeys,
    close: async () => {
      await delivery.close();
      await marketplace.close();
      await pool.end();
    },
  };
}

/** يُفرِّغُ أثرَ الاختبارِ السابقِ في الخدمتَينِ معاً — فلا بذرةَ عقدٍ في هذا الطورِ. */
export async function resetData(pool: Pool): Promise<void> {
  await pool.query(
    `TRUNCATE ${[...DELIVERY_TABLES, ...MARKETPLACE_TABLES].join(", ")} RESTART IDENTITY CASCADE`,
  );
}

/**
 * يبذرُ تصنيفَ ورقةٍ بأبيهِ — كلُّ اختبارٍ يبذرُ تصنيفَهُ لأنَّ `TRUNCATE` يشملُ
 * الكتالوجَ، والبذرةُ المُعلَنةُ في مجالِ السوقِ فارغةٌ بقرارٍ.
 */
export async function seedLeafCategory(stores: MarketplaceStores): Promise<string> {
  const parent = await stores.categories.insertCategory({
    slug: `${CATEGORY}-parent`,
    depth: 1,
    labelAr: "إلكترونيّات",
    isActive: true,
  });
  const leaf = await stores.categories.insertCategory({
    slug: CATEGORY,
    depth: 2,
    parentCategoryId: parent.categoryId,
    labelAr: "هواتف",
    isActive: true,
  });
  return leaf.categoryId;
}

export interface HttpResult {
  readonly status: number;
  /** الجسمُ **نصّاً كما وصلَ** — الإعادةُ تُقارنُ بايتاتٍ لا كائناتٍ مُحلَّلةً. */
  readonly text: string;
  readonly body: Record<string, unknown>;
  readonly replayHeader: string | null;
}

/** نداءٌ عبرَ الشبكةِ على مُستمعٍ — لا `app.inject` في هذه الحزمةِ بحالٍ. */
export async function call(
  baseUrl: string,
  init: {
    readonly method: string;
    readonly path: string;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
    readonly traceId?: string;
    /** ترويساتٌ إضافيّةٌ — بها يُوقَّعُ النداءُ الداخلُ (المراجعةُ 17/N). */
    readonly headers?: Readonly<Record<string, string>>;
  },
): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${init.path}`, {
    method: init.method,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
      ...(init.idempotencyKey === undefined ? {} : { "idempotency-key": init.idempotencyKey }),
      ...(init.traceId === undefined ? {} : { "x-request-id": init.traceId }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    replayHeader: response.headers.get("idempotent-replay"),
  };
}

/**
 * نداءٌ **موقَّعٌ** على حدِّ التوصيلِ — وهوَ ما تستعملُهُ كلُّ دعوى رحلةٍ.
 *
 * والتوقيعُ يُبنى لكلِّ نداءٍ على حدةٍ لأنَّ الرمزَ **مربوطٌ بالطريقةِ والمسارِ**
 * ([ADR-020](../../../docs/15-decisions/ADR-020-service-to-service-identity.md)):
 * رمزٌ واحدٌ يُعادُ استعمالُهُ كانَ سيُرفَضُ بـ401 عندَ ثاني نداءٍ (إعادةٌ ·
 * ADR-021) — وهذا نفسُهُ يُثبَتُ صريحاً في دعوى الفرضِ.
 *
 * و`call` يبقى **عارياً** ولا يُلفُّ: إثباتُ الرفضِ يحتاجُ نداءً بلا توقيعٍ.
 */
export async function callDelivery(
  gate: Pick<GateContext, "deliveryBaseUrl" | "deliveryInboundKeys">,
  init: {
    readonly method: string;
    readonly path: string;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
    readonly traceId?: string;
    readonly scopes?: readonly string[];
    readonly keys?: ServiceAuthKeyRegistry;
  },
): Promise<HttpResult> {
  const separator = init.path.indexOf("?");
  const headers = serviceAuthHeaders({
    serviceName: "core",
    audience: DELIVERY_SERVICE_AUDIENCE,
    method: init.method.toUpperCase(),
    // المسارُ الموقَّعُ بلا استعلامٍ (ADR-021 §4 · `RISK-0026` مفتوحٌ).
    path: separator < 0 ? init.path : init.path.slice(0, separator),
    keys: init.keys ?? gate.deliveryInboundKeys,
    now: new Date(),
    scopes: init.scopes ?? ALL_DELIVERY_SCOPES,
  });
  return call(gate.deliveryBaseUrl, { ...init, headers });
}

/**
 * تسلسلٌ قانونيٌّ: مفاتيحٌ مُرتَّبةٌ في كلِّ عمقٍ — بهِ يُقارَنُ جوابٌ مُعادٌ بجوابٍ أوّلَ.
 *
 * ولمَ لا `toEqual` وحدَها؟ لأنَّها تُساوي كائنَينِ وتصمتُ عن أنَّ أحدَهما صارَ
 * مصفوفةً بترتيبٍ آخرَ؛ والنصُّ القانونيُّ يُثبِّتُ المحتوى كلَّهُ في مقارنةٍ واحدةٍ.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    const body = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",");
    return `{${body}}`;
  }
  return JSON.stringify(value) ?? "null";
}

let counter = 0;

/** مفتاحُ تكرارٍ جديدٌ في كلِّ كتابةٍ؛ والمُعادُ يُطلَبُ صراحةً بتمريرِ مفتاحٍ سابقٍ. */
export function nextKey(prefix: string): string {
  counter += 1;
  return `idem-gate13-${prefix}-${String(counter).padStart(6, "0")}`;
}

/** عددُ صفوفِ جدولٍ — لإثباتِ أنَّ ما لم يُكتَبْ لم يُكتَبْ. */
export async function countRows(pool: Pool, table: string): Promise<number> {
  const result = await pool.query<{ readonly count: string }>(
    `SELECT count(*)::text AS count FROM ${table}`,
  );
  return Number(result.rows[0]?.count ?? "0");
}

export interface DeliveryOutboxRow {
  readonly event: Record<string, unknown>;
  readonly publishedAt: Date | null;
}

/**
 * صفوفُ صندوقِ التوصيلِ بترتيبِ الكتابةِ، وكلُّ صفٍّ **مُعادُ التركيبِ حدثاً**.
 *
 * وشكلُ حدثِ التوصيلِ **مُسطَّحٌ** لا `{ envelope, data }` كالسوقِ: `event_id` و
 * `event_type` و`event_version` و`occurred_at` و`producer` و`aggregate` و
 * `trace_id` و`payload` في مستوًى واحدٍ (`contracts/events.json` · `EventEnvelope`).
 * ولا دالّةَ `envelopeOf` في هذه الخدمةِ تُنادى — فالتركيبُ هنا هوَ **بالضبطِ** ما
 * سيفعلُهُ الناقلُ يومَ يُكتَبُ، و`producer` ثابتٌ في العقدِ فيُوضَعُ ويُصدَّقُ
 * عليهِ: لو أضافتِ الخدمةُ عموداً للمُنتِجِ يوماً وخالفَ الثابتَ، سقطَ هنا.
 */
export async function deliveryOutbox(pool: Pool): Promise<readonly DeliveryOutboxRow[]> {
  const result = await pool.query<{
    event_id: string;
    event_type: string;
    event_version: string;
    aggregate_type: string;
    aggregate_id: string;
    payload: Record<string, unknown>;
    trace_id: string | null;
    occurred_at: Date;
    published_at: Date | null;
  }>(
    `SELECT event_id::text, event_type, event_version, aggregate_type, aggregate_id,
            payload, trace_id, occurred_at, published_at
       FROM delivery_outbox
      ORDER BY outbox_id ASC`,
  );
  return result.rows.map((row) => ({
    event: {
      event_id: row.event_id,
      event_type: row.event_type,
      event_version: row.event_version,
      occurred_at: row.occurred_at.toISOString(),
      producer: "delivery-service",
      aggregate: { type: row.aggregate_type, id: row.aggregate_id },
      trace_id: row.trace_id,
      payload: row.payload,
    },
    publishedAt: row.published_at,
  }));
}

/** صفوفُ جدولِ الانتقالاتِ — الدفترُ الذي يجعلُ الحالةَ مُساءَلةً لا مُدَّعاةً. */
export async function transitions(
  pool: Pool,
  publicId: string,
): Promise<readonly { state_kind: string; from_state: string | null; to_state: string; reason_code: string }[]> {
  const result = await pool.query<{
    state_kind: string;
    from_state: string | null;
    to_state: string;
    reason_code: string;
  }>(
    `SELECT t.state_kind, t.from_state, t.to_state, t.reason_code
       FROM store_order_transitions t
       JOIN store_orders o ON o.order_id = t.order_id
      WHERE o.public_id = $1
      ORDER BY t.transition_id ASC`,
    [publicId],
  );
  return result.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// مُصدِّقُ العقدِ المنشورِ
// ─────────────────────────────────────────────────────────────────────────────

interface Schema {
  readonly [keyword: string]: unknown;
}

const CONTRACT_PATH = resolve(process.cwd(), "../../services/delivery/contracts/events.json");

const CONTRACT = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as {
  readonly $defs: Readonly<Record<string, Schema>>;
};

/**
 * الكلماتُ المفتاحيّةُ التي يفهمُها هذا المُصدِّقُ — وما خرجَ عنها **يُفشِلُهُ صراحةً**.
 *
 * ولا `ajv` في المستودعِ كلِّهِ، وإضافتُها لأجلِ بوّابةٍ كانت تبعيّةَ إنتاجٍ في
 * شجرةٍ محروسةٍ بـ`validate-dependency-audit.sh`. والبديلُ الأمينُ ليسَ مُصدِّقاً
 * متسامحاً — بل مُصدِّقٌ **يسقطُ عندَ ما لا يفهمُ**: كلمةٌ جديدةٌ في العقدِ تُسقِطُ
 * البوّابةَ باسمِها بدلَ أن تُتجاهَلَ صامتةً فتصيرَ الورقةُ أوسعَ من الحارسِ.
 *
 * وقائمةُ التوصيلِ تختلفُ عن قائمةِ السوقِ بـ`maxLength` و`items` و`minItems` و
 * `anyOf`: هذا العقدُ يستعملُها فعلاً (`payment_ref` مُقيَّدٌ بـ128، والأسطرُ
 * مصفوفةٌ بحدٍّ أدنى). و`additionalProperties` **ليست** فيهِ: فالبوّابةُ لا تدّعي
 * إغلاقَ الأجسامِ — دعوى «لا مفتاحَ زائداً» ليست في الورقةِ فلا تُثبَتُ هنا.
 */
const SUPPORTED_KEYWORDS = new Set([
  "$ref",
  "allOf",
  "anyOf",
  "const",
  "description",
  "enum",
  "format",
  "items",
  "maxLength",
  "minItems",
  "minLength",
  "minimum",
  "pattern",
  "properties",
  "required",
  "title",
  "type",
]);

/** `store_order.payment_state_changed` → `StoreOrderPaymentStateChangedV1`. */
export function defNameOf(eventType: string): string {
  return `${eventType
    .split(/[.:_]/u)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("")}V1`;
}

function resolveRef(schema: Schema): Schema {
  const ref = schema.$ref;
  if (typeof ref !== "string") return schema;
  const name = ref.replace("#/$defs/", "");
  const target = CONTRACT.$defs[name];
  if (target === undefined) throw new Error(`unresolved $ref: ${ref}`);
  return resolveRef(target);
}

/**
 * يُعيدُ قائمةَ مخالفاتٍ نصّيّةً — فارغةٌ تعني مطابقةً، ومملوءةٌ تُطبَعُ كما هيَ في
 * رسالةِ الفشلِ.
 *
 * و`allOf` مأخوذةٌ هنا خلافاً لمُصدِّقِ الخدمةِ الذي يقرأُ الحمولةَ وحدَها: كلُّ
 * تعريفِ حدثٍ في الورقةِ يُركِّبُ الغلافَ بها، فتجاهلُها كانَ سيجعلُ البوّابةَ
 * تُصدِّقُ الحمولةَ وتُهملُ المفاتيحَ السّتّةَ التي يقرؤُها كلُّ مُستهلِكٍ.
 */
export function violations(value: unknown, schema: Schema, path: string): readonly string[] {
  const found: string[] = [];
  const resolved = resolveRef(schema);

  for (const keyword of Object.keys(resolved)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      found.push(`${path}: unsupported keyword in contract: ${keyword}`);
    }
  }

  if (Array.isArray(resolved.allOf)) {
    for (const branch of resolved.allOf as readonly Schema[]) {
      found.push(...violations(value, branch, path));
    }
  }

  if ("const" in resolved && value !== resolved.const) {
    found.push(
      `${path}: expected const ${JSON.stringify(resolved.const)}, got ${JSON.stringify(value)}`,
    );
  }

  if (Array.isArray(resolved.enum) && !resolved.enum.includes(value)) {
    found.push(`${path}: ${JSON.stringify(value)} is not in the contract enum`);
  }

  if (resolved.type !== undefined && !matchesType(value, resolved.type)) {
    found.push(`${path}: expected type ${JSON.stringify(resolved.type)}, got ${typeOf(value)}`);
  }

  if (typeof resolved.pattern === "string" && typeof value === "string") {
    if (!new RegExp(resolved.pattern, "u").test(value)) {
      found.push(`${path}: ${JSON.stringify(value)} does not match ${resolved.pattern}`);
    }
  }

  if (typeof resolved.minLength === "number" && typeof value === "string") {
    if (value.length < resolved.minLength) {
      found.push(`${path}: ${JSON.stringify(value)} is shorter than ${resolved.minLength}`);
    }
  }

  if (typeof resolved.maxLength === "number" && typeof value === "string") {
    if (value.length > resolved.maxLength) {
      found.push(`${path}: ${JSON.stringify(value)} is longer than ${resolved.maxLength}`);
    }
  }

  if (typeof resolved.minimum === "number" && typeof value === "number") {
    if (value < resolved.minimum) {
      found.push(`${path}: ${JSON.stringify(value)} is below minimum ${resolved.minimum}`);
    }
  }

  if (typeof resolved.minItems === "number" && Array.isArray(value)) {
    if (value.length < resolved.minItems) {
      found.push(`${path}: has ${value.length} items, fewer than ${resolved.minItems}`);
    }
  }

  if (resolved.format === "uuid" && typeof value === "string") {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)) {
      found.push(`${path}: ${JSON.stringify(value)} is not a uuid`);
    }
  }

  if (resolved.format === "date-time" && typeof value === "string") {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)) {
      found.push(`${path}: ${JSON.stringify(value)} is not an ISO instant in UTC`);
    }
  }

  const items = resolved.items as Schema | undefined;
  if (items !== undefined && Array.isArray(value)) {
    value.forEach((entry, index) => {
      found.push(...violations(entry, items, `${path}[${index}]`));
    });
  }

  /*
   * `anyOf` — فرعٌ واحدٌ يكفي، وخلافاً لـ`oneOf` لا يُشترَطُ فرعٌ واحدٌ بالضبطِ.
   * وهذا العقدُ يستعملُها في `payload.actor.actor_ref` وأشباهِهِ حيثُ تتقاطعُ
   * الفروعُ عن قصدٍ؛ فرضُ «واحدٍ فقط» كانَ سيُسقِطُ حدثاً مطابقاً للورقةِ.
   */
  if (Array.isArray(resolved.anyOf)) {
    const branches = resolved.anyOf as readonly Schema[];
    const passing = branches.filter((branch) => violations(value, branch, path).length === 0);
    if (passing.length === 0) {
      found.push(`${path}: ${JSON.stringify(value)} matched no anyOf branch`);
    }
  }

  const properties = resolved.properties as Readonly<Record<string, Schema>> | undefined;
  if (properties !== undefined && typeof value === "object" && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    for (const [key, child] of Object.entries(properties)) {
      if (key in record) found.push(...violations(record[key], child, `${path}.${key}`));
    }
  }

  if (Array.isArray(resolved.required) && typeof value === "object" && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    for (const key of resolved.required as readonly string[]) {
      if (!(key in record)) found.push(`${path}: missing required key ${key}`);
    }
  }

  return found;
}

function matchesType(value: unknown, type: unknown): boolean {
  if (Array.isArray(type)) return type.some((one) => matchesType(value, one));
  if (type === "object") {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  if (type === "array") return Array.isArray(value);
  if (type === "null") return value === null;
  if (type === "integer") return Number.isSafeInteger(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number";
  return false;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}

/** يُصدِّقُ حدثاً مُسطَّحاً كاملاً على تعريفِ نوعِهِ في الورقةِ المنشورةِ. */
export function eventViolations(event: Record<string, unknown>): readonly string[] {
  const eventType = event.event_type;
  if (typeof eventType !== "string") return ["event_type is not a string"];
  const def = CONTRACT.$defs[defNameOf(eventType)];
  if (def === undefined) return [`no contract def for ${eventType}`];
  return violations(event, def, eventType);
}

/** أسماءُ تعريفاتِ الأحداثِ في الورقةِ — لإثباتِ أنَّ الأنواعَ المكتوبةَ هيَ المنشورةُ. */
export function contractEventDefs(): readonly string[] {
  return Object.keys(CONTRACT.$defs).filter((name) => name.endsWith("V1"));
}

/**
 * ## النطاق
 *
 * رفعُ خدمتَي السوقِ والتوصيلِ على Postgres على مِقبضَينِ حقيقيَّينِ بسلكٍ موقَّعٍ
 * بينهما، ومُساعداتُ نداءٍ وعدِّ صفوفٍ وقراءةِ صندوقٍ وانتقالاتٍ، ودفعةُ ناقلِ
 * مخزونٍ، ومُصدِّقُ عقدٍ يقرأُ `contracts/events.json` من القرصِ ويسقطُ عندَ ما لا
 * يفهمُ.
 *
 * ## آخر تحديث
 *
 * المراجعة 9/N — الملفُّ جديدٌ.
 *
 * ## الحالة
 *
 * يحتاجُ `DATABASE_URL`؛ ويتخطّى نفسَهُ بلا قاعدةٍ عبرَ `PG_ENABLED`.
 *
 * ## كودٌ ذو صلة
 *
 * `services/delivery/src/http/server.ts` (نفسُ التركيبِ) ·
 * `services/delivery/src/__tests__/pg-harness.ts` ·
 * `packages/marketplace-e2e/src/harness.ts`.
 *
 * ## الفريق
 *
 * Delivery / Marketplace.
 */
