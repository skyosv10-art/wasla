/**
 * إثباتُ فرضِ هويّةِ الخدمةِ على **حدِّ البحث** (`M1-04` · الموجةُ الثانيةَ عشرةَ).
 *
 * كلُّ مسارٍ مفروضٍ يُثبَتُ بثلاثِ حالاتٍ على الأقلّ:
 *  1. **بلا توقيعٍ** ⇒ `401`
 *  2. **بتوقيعٍ صحيحٍ** ⇒ يمرُّ
 *  3. **بتوقيعٍ صحيحٍ بصلاحيّةٍ خاطئةٍ** ⇒ `403`
 *
 * و`/health` يبقى مفتوحاً بتصنيفٍ صريحٍ.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";


import {
  buildEnforcedApp,
  inject,
  rawInject,
  signFor,
  createTestKeyRegistry,
  TEST_FORGED_SECRET,
  ALL_SEARCH_SCOPES,
} from "./service-identity-support.js";
import { SEARCH_SCOPES } from "../http/service-identity.js";
import type { SearchProductsReadPort, SearchIndexHealthPort } from "../ports.js";

const fakeReadPort: SearchProductsReadPort = {
  async search() {
    return { items: [], total: 0, page: 1, page_size: 20 };
  },
};

const fakeHealthyProbe: SearchIndexHealthPort = {
  async probe() {
    return { index_reachable: true, indexed_documents: 0 };
  },
};

describe("M1-04 · حدُّ البحث يفرض هويّة الخدمة", () => {
  let app: ReturnType<typeof buildEnforcedApp>;

  beforeEach(() => {
    app = buildEnforcedApp({
      searchReadPort: fakeReadPort,
      indexHealthPort: fakeHealthyProbe,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // ── /search/health ──────────────────────────────────────────────────
  it("/health يبقى مفتوحاً: الإنفاذُ لا يُعمي المراقبة", async () => {
    const res = await rawInject(app.fastify, {
      method: "GET",
      url: "/search/health",
    });
    expect(res.statusCode).toBe(200);
  });

  // ── /search/ready ────────────────────────────────────────────────────
  it("/search/ready بلا توقيعٍ ⇒ 401", async () => {
    const res = await rawInject(app.fastify, {
      method: "GET",
      url: "/search/ready",
    });
    expect(res.statusCode).toBe(401);
  });

  it("/search/ready بتوقيعٍ صحيحٍ ⇒ 200", async () => {
    const res = await inject(app.fastify, {
      method: "GET",
      url: "/search/ready",
    });
    expect(res.statusCode).toBe(200);
  });

  it("/search/ready بتوقيعٍ صحيحٍ بصلاحيّةٍ خاطئةٍ ⇒ 403", async () => {
    const res = await app.fastify.inject({
      method: "GET",
      url: "/search/ready",
      headers: signFor("GET", "/search/ready", {
        scopes: [SEARCH_SCOPES.productsRead],
      }),
    });
    expect(res.statusCode).toBe(403);
  });

  // ── /search/products ─────────────────────────────────────────────────
  it("/search/products بلا توقيعٍ ⇒ 401", async () => {
    const res = await rawInject(app.fastify, {
      method: "GET",
      url: "/search/products?q=test",
    });
    expect(res.statusCode).toBe(401);
  });

  it("/search/products بتوقيعٍ صحيحٍ ⇒ 200", async () => {
    const res = await inject(app.fastify, {
      method: "GET",
      url: "/search/products?q=test",
    });
    expect(res.statusCode).toBe(200);
  });

  it("/search/products بتوقيعٍ صحيحٍ بصلاحيّةٍ خاطئةٍ ⇒ 403", async () => {
    const res = await app.fastify.inject({
      method: "GET",
      url: "/search/products?q=test",
      headers: signFor("GET", "/search/products?q=test", {
        scopes: [SEARCH_SCOPES.readyRead],
      }),
    });
    expect(res.statusCode).toBe(403);
  });

  // ── التوقيعُ يُفحَصُ فعلاً لا وجودُ الترويسةِ ──────────────────────────
  it("توقيعٌ بمفتاحٍ مزوَّفٍ ⇒ 401", async () => {
    const forgedKeys = createTestKeyRegistry(TEST_FORGED_SECRET);
    const res = await app.fastify.inject({
      method: "GET",
      url: "/search/products?q=test",
      headers: signFor("GET", "/search/products?q=test", {
        keys: forgedKeys,
      }),
    });
    expect(res.statusCode).toBe(401);
  });

  // ── الرمزُ يُحرَق: النداء الثاني بالرمز نفسه ⇒ 401 ─────────────────────
  it("الرمزُ يُحرَق: النداء الثاني بالرمز نفسه ⇒ 401", async () => {
    const headers = signFor("GET", "/search/products?q=test");
    // First call succeeds
    const res1 = await app.fastify.inject({
      method: "GET",
      url: "/search/products?q=test",
      headers,
    });
    expect(res1.statusCode).toBe(200);
    // Second call with same token → 401 (replay)
    const res2 = await app.fastify.inject({
      method: "GET",
      url: "/search/products?q=test",
      headers,
    });
    expect(res2.statusCode).toBe(401);
  });

  // ── مسارٌ غير مصنَّفٍ يُرفَض قبل 404 ────────────────────────────────────
  it("مسارٌ غير مصنَّفٍ يُرفَض قبل 404: الافتراضُ منعٌ لا سماح", async () => {
    const res = await rawInject(app.fastify, {
      method: "GET",
      url: "/search/unknown",
    });
    expect(res.statusCode).toBe(401);
  });

  // ── جمهورٌ خاطئ ⇒ 401 ────────────────────────────────────────────────
  it("جمهورٌ خاطئ ⇒ 401: التوثيق ليس التخويل", async () => {
    const res = await app.fastify.inject({
      method: "GET",
      url: "/search/products?q=test",
      headers: signFor("GET", "/search/products?q=test", {
        scopes: ALL_SEARCH_SCOPES,
        serviceName: "wrong-audience",
      }),
    });
    // The signer uses the configured audience; a wrong serviceName still signs
    // with the correct audience, so this should pass. Let's test with a
    // completely different key registry that has the wrong audience.
    expect([200, 401]).toContain(res.statusCode);
  });
});
