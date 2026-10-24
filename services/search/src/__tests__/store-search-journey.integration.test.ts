/**
 * G-S9.7 — اختبارُ الرحلةِ الكاملةِ عبرَ الحدودِ (المرحلةُ السادسةُ · `CLM-0684`).
 *
 * هذا الملفُّ يُثبتُ **السلكَ** الذي لا يُثبتُهُ اختبارُ أيِّ وحدةٍ بمفردها:
 * عميلٌ (تطبيقُ العميلِ) → **الحدُّ الحقيقيُّ** (`channel-edge` مركَّبٌ على
 * Fastify بقائمةِ سماحٍ اصطناعيةٍ للاختبارِ وحدَهُ) → **حدُّ البحثِ الحقيقيُّ**
 * (تطبيقُ HTTP مفروضُ الهويّةِ بمفتاحِ خدمةٍ حقيقيٍّ يُنشئُهُ سجلُّ مفاتيحٍ
 * اختباريٌّ) → **PostgreSQL حقيقيٌّ** (مُخرَجُ الأحداثِ → المُرحِّلُ →
 * `search_store_index` → `StoreSearchReader`).
 *
 * القاعدةُ الحاكمةُ (`docs/05-architecture`): لا شيءَ في هذهِ الرحلةِ مُحوَّرٌ
 * إلى `spy` يُدَّعى عليه؛ **الوحدةُ الوحيدةُ المُحوَّرةُ هي `exchangeSession`**
 * — منفذُ جلبِ جلسةِ العميلِ — لأنها مُثبَتةٌ بذاتِها في
 * `app-edge-e2e` (رحلةُ الجلسةِ) وكلَّ تبديلٍ حقيقيٍّ لها هنا يتطلّبُ مفتاحَ
 * روبوتٍ إنتاجياً. وكلُّ ما عداها حقيقيٌّ: التوقيعُ يُنشئُهُ `channel-edge`
 * بمفتاحِ الخدمةِ، والتحققُ يُؤدّيهِ حدُّ البحثِ نفسُهُ، والاستعلامُ يُنفَّذُ
 * على قاعدةِ بياناتٍ حقيقيةٍ.
 *
 * الحالاتُ:
 * 1. النجاحُ: متجرٌ مؤهَّلٌ (معتمَدٌ + منتجٌ ظاهرٌ) وحدهُ يظهرُ، وحدودُ
 *    الإسقاطِ (ثلاثةُ حقولٍ) تُحفَظُ عبرَ الحدِّ كاملِهِ.
 * 2. بلا جلسةٍ → 401 من الحدِّ قبلَ أيِّ نداءٍ خلفيٍّ.
 * 3. مفتاحُ توقيعٍ مزوَّفٌ → 401 من حدِّ البحثِ نفسِهِ (التحققُ حقيقيٌّ).
 * 4. جمهورٌ صحيحٌ بلا صلاحيةِ المسارِ → 403 من حدِّ البحثِ.
 * 5. معاملُ استعلامٍ غيرُ مصرَّحٍ بهِ (`store_state`) → 400 من الحدِّ
 *    (رفضٌ مغلقٌ · `E-20`): لا تمريرَ لأيِّ معاملٍ لم يُعلَنْ.
 * 6. حدودُ العقدِ عبرَ الحدودِ: استعلامٌ فارغٌ / حجمُ صفحةٍ فوقَ الحدِّ →
 *    400 من حدِّ البحثِ (الحدُّ يمرِّرُ والحدُّ الخلفيُّ يرفضُ).
 *
 * يعملُ تحتَ `DATABASE_URL` (مهامُ `db-integration` في CI) ويتخطّى بلا
 * قاعدةٍ — تخطّياً صامتاً لا نجاحاً مُدَّعىً.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createChannelEdge } from "@wasla/channel-edge";
import { STORE_SEARCH_LIMITS } from "@wasla/contracts-search";
import {
  InMemoryServiceTokenReplayGuard,
  createServiceRequestSigner,
} from "@wasla/service-auth";

import { StoreSearchReader } from "../infrastructure/store-search-reader.js";
import { PostgresMarketplaceEventSource } from "../infrastructure/marketplace-event-source.js";
import { PostgresProjectionStore } from "../infrastructure/projection-store.js";
import { DEFAULT_RELAY_CONFIG, runRelayBatch, type RelayDeps } from "../relay.js";
import { buildSearchHttpApp } from "../http/app.js";
import { SEARCH_SCOPES, SEARCH_SERVICE_AUDIENCE } from "../http/service-identity.js";
import type { CatalogReadPort } from "../ports.js";
import type { CatalogProduct } from "../domain/consumed-events.js";
import { FakeStoreCatalog } from "./support/fake-store-catalog.js";
import { createTestKeyRegistry, fakeEmptyReadPort } from "./service-identity-support.js";
import { PG_ENABLED, T0, resetData, seedOutboxEvent, setupPostgres, type PgFixture } from "./pg-harness.js";

/* ── هندسةُ العالمِ: مُخرَجُ أحداثٍ حقيقيٌّ يُغذّي مُرحِّلاً حقيقياً ── */

const sid = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pid = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

class FakeProducts implements CatalogReadPort {
  private readonly data = new Map<string, CatalogProduct>();
  set(p: CatalogProduct): this {
    this.data.set(p.product_id, p);
    return this;
  }
  async getProduct(id: string): Promise<CatalogProduct | null> {
    return this.data.get(id) ?? null;
  }
}

/** بذورُ أحداثِ السوقِ بخواتمَ زمنيةٍ متزايدةٍ صارمةً (نمطُ اختبارِ المتاجرِ). */
class JourneyWorld {
  private tick = 0;
  private readonly seq = new Map<string, number>();
  readonly products = new FakeProducts();
  readonly stores = new FakeStoreCatalog();

  constructor(private readonly pool: PgFixture["pool"]) {}

  private ts(): string {
    this.tick += 1;
    return new Date(Date.parse(T0) + this.tick * 60_000).toISOString();
  }

  private next(key: string): number {
    const n = (this.seq.get(key) ?? 0) + 1;
    this.seq.set(key, n);
    return n;
  }

  private async emit(
    event_type: string,
    aggregate_type: string,
    aggregate_id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const at = this.ts();
    await seedOutboxEvent(this.pool, {
      event_type,
      aggregate_type,
      aggregate_id,
      occurred_at: at,
      created_at: at,
      payload: { ...payload, occurred_for: at },
    });
  }

  /** متجرٌ بأسماءٍ في منفذِ القراءةِ المُوقَّعِ الوهميِّ (أسماءٌ فقط — لا أحكامَ). */
  async registerStore(
    n: number,
    slug: string,
    category: string,
    title: string,
  ): Promise<void> {
    this.stores.set({
      store_id: sid(n),
      store_slug: slug,
      title_ar: title,
      title_en: null,
      title_ur: null,
    });
    await this.emit("marketplace.store_registered", "store", sid(n), {
      store_id: sid(n),
      store_slug: slug,
      owner_public_id: "CUS-JOURNEY",
      category_slug: category,
      to_state: "pending_review",
      state_sequence: this.next(`s${n}`),
      actor_type: "owner",
    });
  }

  async storeDecision(
    n: number,
    slug: string,
    category: string,
    type: string,
    from: string,
    to: string,
  ): Promise<void> {
    await this.emit(`marketplace.store_${type}`, "store", sid(n), {
      store_id: sid(n),
      store_slug: slug,
      owner_public_id: "CUS-JOURNEY",
      category_slug: category,
      from_state: from,
      to_state: to,
      state_sequence: this.next(`s${n}`),
      actor_type: "moderator",
    });
  }

  /** منتجٌ ينتهي ظاهراً: إنشاءٌ → موافقةٌ → نشرٌ بكميةٍ. */
  async visibleProduct(
    n: number,
    slug: string,
    category: string,
    p: number,
    qty = 5,
  ): Promise<void> {
    this.products.set({
      product_id: pid(p),
      store_id: sid(n),
      store_slug: slug,
      sku: `sku-${p}`,
      category_slug: category,
      title_ar: `منتج ${p}`,
      title_en: `Product ${p}`,
      price_minor_units: 1000,
      currency_code: "SAR",
    });
    await this.emit("marketplace.product_created", "product", pid(p), {
      product_id: pid(p),
      store_id: sid(n),
      store_slug: slug,
      sku: `sku-${p}`,
      category_slug: category,
      state: "draft",
      moderation_state: "pending",
      created_by_public_id: "CUS-JOURNEY",
    });
    await this.emit("marketplace.product_moderated", "product", pid(p), {
      product_id: pid(p),
      store_id: sid(n),
      store_slug: slug,
      from_state: "pending",
      to_state: "approved",
      moderation_sequence: this.next(`m${p}`),
      actor_type: "moderator",
    });
    await this.emit("marketplace.product_published", "product", pid(p), {
      product_id: pid(p),
      store_id: sid(n),
      store_slug: slug,
      category_slug: category,
      from_state: "draft",
      to_state: "published",
      store_state: "approved",
      quantity_on_hand: qty,
      actor_public_id: "CUS-JOURNEY",
    });
  }

  /** أرشفةُ منتجٍ كانت ظاهراً — يُثبتُ أنَّ الأرشفةَ تُخرِجُ المتجرَ من الأهليّةِ. */
  async archiveProduct(n: number, slug: string, p: number): Promise<void> {
    await this.emit("marketplace.product_archived", "product", pid(p), {
      product_id: pid(p),
      store_id: sid(n),
      store_slug: slug,
      from_state: "published",
      to_state: "archived",
      actor_public_id: "CUS-JOURNEY",
    });
  }
}

async function drainRelay(deps: RelayDeps): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const out = await runRelayBatch(deps);
    if (out.processed === 0) return;
  }
  throw new Error("المُرحِّلُ لم يفرُغِ الطابورَ");
}

/* ── قائمةُ سماحٍ اصطناعيةٌ للرحلةِ — للاختبارِ وحدَهُ (لا تُنشرُ ولا تُقرأُ من الإنتاجِ) ── */

function writeJourneyAllowlist(): string {
  const dir = mkdtempSync(join(tmpdir(), "wasla-journey-allowlist-"));
  const path = join(dir, "customer-mini-app.json");
  writeFileSync(
    path,
    JSON.stringify(
      {
        surface: "customer-mini-app",
        entries: [
          {
            method: "GET",
            path: "/search/stores",
            service: "search",
            class: "P",
            required_scopes: ["search:stores:read"],
            accepts_body: false,
            production_open: true,
            evidence_tests: ["store-search-journey.integration.test.ts"],
            query: { allowed: ["q", "locale", "page", "page_size"] },
          },
        ],
      },
      null,
      2,
    ),
    "utf-8",
  );
  return path;
}

/* ── الرحلةُ ── */

(PG_ENABLED ? describe : describe.skip)(
  "G-S9.7 — رحلةُ بحثِ المتاجرِ عبرَ الحدودِ: الحدُّ الحقيقيُّ يوقِّعُ ويُحوِّلُ إلى حدِّ بحثٍ حقيقيٍّ",
  () => {
    let pool: PgFixture["pool"];
    let closePg: () => Promise<void>;
    let searchPort = 0;
    let searchApp: ReturnType<typeof buildSearchHttpApp>;
    let edgeApp: FastifyInstance;
    let allowlistPath = "";

    beforeAll(async () => {
      // 1) قاعدةٌ حقيقيةٌ + عالمُ أحداثٍ حقيقيٌّ يُفرَغُ عبرَ المُرحِّلِ الحقيقيِّ.
      const fixture = await setupPostgres();
      pool = fixture.pool;
      closePg = fixture.close;
      await resetData(pool);

      const world = new JourneyWorld(pool);
      // مؤهَّلٌ: معتمَدٌ + منتجٌ ظاهرٌ.
      await world.registerStore(1, "journey-acme", "groceries", "متجر الرحلة أ");
      await world.storeDecision(1, "journey-acme", "groceries", "approved", "pending_review", "approved");
      await world.visibleProduct(1, "journey-acme", "groceries", 101);
      // معتمَدٌ بلا منتجٍ ظاهرٍ (منتجُهُ أُرشِفَ) → خارجُ الأهليّةِ.
      await world.registerStore(2, "journey-beta", "groceries", "متجر الرحلة ب");
      await world.storeDecision(2, "journey-beta", "groceries", "approved", "pending_review", "approved");
      await world.visibleProduct(2, "journey-beta", "groceries", 102);
      await world.archiveProduct(2, "journey-beta", 102);
      // موقوفٌ مع منتجٍ ظاهرٍ → خارجُ الأهليّةِ رغمَ المنتجِ.
      await world.registerStore(3, "journey-gamma", "groceries", "متجر الرحلة ج");
      await world.storeDecision(3, "journey-gamma", "groceries", "approved", "pending_review", "approved");
      await world.visibleProduct(3, "journey-gamma", "groceries", 103);
      await world.storeDecision(3, "journey-gamma", "groceries", "suspended", "approved", "suspended");

      await drainRelay({
        events: new PostgresMarketplaceEventSource(pool),
        catalog: world.products,
        storeCatalog: world.stores,
        store: new PostgresProjectionStore(pool),
        config: DEFAULT_RELAY_CONFIG,
      });

      // 2) حدُّ البحثِ الحقيقيُّ: تطبيقُ HTTP مفروضُ الهويّةِ يقرأُ من القاعدةِ.
      searchApp = buildSearchHttpApp({
        searchReadPort: fakeEmptyReadPort(),
        storeSearchReadPort: new StoreSearchReader(pool),
        serviceIdentity: {
          keys: createTestKeyRegistry(),
          replayGuard: new InMemoryServiceTokenReplayGuard(),
        },
      });
      await searchApp.fastify.listen({ port: 0, host: "127.0.0.1" });
      searchPort = (searchApp.fastify.server.address() as { port: number }).port;

      // 3) الحدُّ الحقيقيُّ: قائمةُ سماحٍ اصطناعيةٌ وموقِّعٌ بنفسِ مفتاحِ الخدمةِ.
      allowlistPath = writeJourneyAllowlist();
      const edge = Fastify();
      const additions = createChannelEdge({
        surface: {
          actorType: "customer",
          botToken: "1234567890:AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRr",
          requestSigner: (() => ({})) as never,
          waslaPublicIdOf: async () => "CUS-JOURNEY",
        },
        issueSession: async () => {
          throw new Error("لا يُستدعى في هذهِ الرحلةِ");
        },
        // الوحدةُ الوحيدةُ المُحوَّرةُ: جلسةُ العميلِ (مُثبَتةٌ بذاتِها في app-edge-e2e).
        exchangeSession: (async () => ({
          assertion: "assertion-journey",
          wasla_public_id: "CUS-JOURNEY",
          actor_type: "customer",
          audience: [],
          expires_at: new Date().toISOString(),
        })) as never,
        revokeSession: async () => {
          throw new Error("لا يُستدعى في هذهِ الرحلةِ");
        },
        serviceUrlFor: () => `http://127.0.0.1:${searchPort}`,
        requestSignerFor: () =>
          createServiceRequestSigner({
            serviceName: "search-exit-gate",
            audience: SEARCH_SERVICE_AUDIENCE,
            keys: createTestKeyRegistry(),
            scopes: [SEARCH_SCOPES.storesRead],
          }),
        allowlistUrl: allowlistPath,
        enabled: true,
        allowedOrigins: [],
      });
      additions.apply(edge);
      edgeApp = edge;
      await edgeApp.ready();
    });

    afterAll(async () => {
      if (edgeApp) await edgeApp.close();
      if (searchApp) await searchApp.close();
      if (allowlistPath) rmSync(allowlistPath, { recursive: true, force: true });
      if (closePg) await closePg();
    });

    /** نداءُ العميلِ عبرَ الحدِّ: `Bearer` جلسةٌ + استعلامٌ كما يُرسِلُهُ التطبيقُ. */
    async function callEdge(
      query: Record<string, string>,
      headers: Record<string, string> = { authorization: "Bearer journey-session" },
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const res = await edgeApp.inject({
        method: "GET",
        url: "/search/stores",
        headers,
        query,
      });
      return { status: res.statusCode, body: res.json() as Record<string, unknown> };
    }

    it("النجاحُ: المؤهَّلُ وحدَهُ يظهرُ عبرَ الحدِّ كاملِهِ، والإسقاطُ ثلاثةُ حقولٍ لا غير", async () => {
      const res = await callEdge({ q: "متجر الرحلة" });
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      const items = res.body.items as Array<Record<string, unknown>>;
      expect(items.map((i) => i.store_slug)).toEqual(["journey-acme"]);
      // الإسقاطُ العامُّ (ADR-025 §6.3): ثلاثةُ حقولٍ بالضبطِ — ولا تسريبَ لعمودٍ داخليٍّ.
      expect(Object.keys(items[0]).sort()).toEqual(["category_slug", "store_slug", "title"]);
      expect(items[0].title).toBe("متجر الرحلة أ");
      expect(res.body.page).toBe(1);
      expect(res.body.page_size).toBe(STORE_SEARCH_LIMITS.pageSizeDefault);
    });

    it("بلا جلسةٍ → 401 من الحدِّ قبلَ أيِّ نداءٍ خلفيٍّ", async () => {
      const res = await callEdge({ q: "متجر الرحلة" }, {});
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("EDGE_UNAUTHENTICATED");
    });

    it("مفتاحُ توقيعٍ مزوَّفٌ → 401 من حدِّ البحثِ نفسِهِ (التحققُ حقيقيٌّ لا شكليٌّ)", async () => {
      // حدٌّ ثانٍ بنفسِ كلِّ شيءٍ إلا مفتاحَ التوقيعِ: يوقِّعُ ويُحوِّلُ ويُرفَضُ عندَ الفحصِ.
      const forged = Fastify();
      const additions = createChannelEdge({
        surface: {
          actorType: "customer",
          botToken: "1234567890:AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRr",
          requestSigner: (() => ({})) as never,
          waslaPublicIdOf: async () => "CUS-JOURNEY",
        },
        issueSession: async () => {
          throw new Error("لا يُستدعى");
        },
        exchangeSession: (async () => ({
          assertion: "assertion-journey",
          wasla_public_id: "CUS-JOURNEY",
          actor_type: "customer",
          audience: [],
          expires_at: new Date().toISOString(),
        })) as never,
        revokeSession: async () => {
          throw new Error("لا يُستدعى");
        },
        serviceUrlFor: () => `http://127.0.0.1:${searchPort}`,
        requestSignerFor: () =>
          createServiceRequestSigner({
            serviceName: "search-exit-gate",
            audience: SEARCH_SERVICE_AUDIENCE,
            // مفتاحٌ آخرُ: الترويسةُ تشكلياً سليمةٌ والتحققُ هو الذي يُسقِطُها.
            keys: createTestKeyRegistry("search-forged-secret-0123456789abcdef"),
            scopes: [SEARCH_SCOPES.storesRead],
          }),
        allowlistUrl: allowlistPath,
        enabled: true,
        allowedOrigins: [],
      });
      additions.apply(forged);
      await forged.ready();
      try {
        const res = await forged.inject({
          method: "GET",
          url: "/search/stores",
          headers: { authorization: "Bearer journey-session" },
          query: { q: "متجر الرحلة" },
        });
        expect(res.statusCode).toBe(401);
        // الكودُ المُعلَنُ في عقدِ الرفضِ: `AUTHN_UNAUTHENTICATED` — لا تفصيلَ على أبوابِ الفحصِ.
        expect((res.json() as { code: string }).code).toBe("AUTHN_UNAUTHENTICATED");
      } finally {
        await forged.close();
      }
    });

    it("جمهورٌ صحيحٌ بلا صلاحيةِ المسارِ → 403 من حدِّ البحثِ (الصلاحيةُ تُفحَصُ عندَ المستقبلِ)", async () => {
      const scoped = Fastify();
      const additions = createChannelEdge({
        surface: {
          actorType: "customer",
          botToken: "1234567890:AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRr",
          requestSigner: (() => ({})) as never,
          waslaPublicIdOf: async () => "CUS-JOURNEY",
        },
        issueSession: async () => {
          throw new Error("لا يُستدعى");
        },
        exchangeSession: (async () => ({
          assertion: "assertion-journey",
          wasla_public_id: "CUS-JOURNEY",
          actor_type: "customer",
          audience: [],
          expires_at: new Date().toISOString(),
        })) as never,
        revokeSession: async () => {
          throw new Error("لا يُستدعى");
        },
        serviceUrlFor: () => `http://127.0.0.1:${searchPort}`,
        requestSignerFor: () =>
          createServiceRequestSigner({
            serviceName: "search-exit-gate",
            audience: SEARCH_SERVICE_AUDIENCE,
            keys: createTestKeyRegistry(),
            // مفتاحٌ صحيحٌ وجمهورٌ صحيحٌ ولا صلاحيةَ للمسارِ: 403 لا 200.
            scopes: [],
          }),
        allowlistUrl: allowlistPath,
        enabled: true,
        allowedOrigins: [],
      });
      additions.apply(scoped);
      await scoped.ready();
      try {
        const res = await scoped.inject({
          method: "GET",
          url: "/search/stores",
          headers: { authorization: "Bearer journey-session" },
          query: { q: "متجر الرحلة" },
        });
        expect(res.statusCode).toBe(403);
        // الردُّ مطابقٌ حرفاً لردِّ حدِّ البحثِ: `AUTHZ_FORBIDDEN` بلا تفصيلِ الصلاحيّةِ الناقصةِ.
        expect((res.json() as { code: string }).code).toBe("AUTHZ_FORBIDDEN");
      } finally {
        await scoped.close();
      }
    });

    it("معاملٌ غيرُ مصرَّحٍ بهِ (`store_state`) → 400 من الحدِّ: رفضٌ مغلقٌ (E-20)", async () => {
      const res = await callEdge({ q: "متجر الرحلة", store_state: "approved" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("EDGE_INVALID_QUERY");
    });

    it("حدودُ العقدِ عبرَ الحدودِ: تطويلٌ خالصٌ يُطبَّعُ فراغاً → 400 من حدِّ البحثِ (`SEARCH_QUERY_EMPTY`)", async () => {
      // «ـ» تطويلٌ خالصٌ: يمرُّ فحصَ قيمةِ الحدِّ (غيرُ فارغٍ) ويرفضُهُ حدُّ البحثِ
      // بعدَ التطبيعِ — إثباتٌ أنَّ حدودَ العقدِ تُطبَّقُ عندَ المستقبِلِ لا عندَ المُرسِلِ وحده.
      const res = await callEdge({ q: "ـ" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("SEARCH_QUERY_EMPTY");
    });

    it("حدودُ العقدِ عبرَ الحدودِ: حجمُ صفحةٍ فوقَ الحدِّ → 400 من حدِّ البحثِ (`SEARCH_PAGE_SIZE_INVALID`)", async () => {
      const res = await callEdge({
        q: "متجر الرحلة",
        page_size: String(STORE_SEARCH_LIMITS.pageSizeMax + 1),
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("SEARCH_PAGE_SIZE_INVALID");
    });
  },
);
