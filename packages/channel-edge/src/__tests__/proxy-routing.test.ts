/**
 * `proxy-routing.test.ts` — اختباراتُ توجيهِ الحدِّ (D1–D5 · D8 · E-20).
 *
 * **كلُّ هذا محليٌّ معزولٌ:** قائمةُ سماحٍ اصطناعيةٌ مكتوبةٌ في دليلِ اختبارٍ
 * مؤقتٍ (`production_open=true` في القائمةِ الاصطناعيةِ وحدَها — القوائمُ
 * الحقيقيةُ كلُّها `false`)، ومنبعُ HTTP حقيقيٌّ على `127.0.0.1` يستقبلُ
 * التوجيهَ ويتحققُّ من التوقيعِ الحقيقيِّ (مفتاحُ أسطولِ اختباريٍّ لا سرَّ
 * إنتاجيٍّ ولا اتصالٍ خارجيٍّ). لا نشرَ ولا T1/T2 ولا Telegram حي.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";

import { createChannelEdge } from "../create-channel-edge.js";
import {
  createServiceRequestSigner,
  keyRegistryFromEnv,
  mintServiceToken,
  verifyServiceToken,
} from "@wasla/service-auth";

/** مفتاحُ أسطولِ اختباريٌّ — HS256 لا يُعرفُ لأيِّ بيئةٍ حقيقيةٍ. */
/** حكمُ تحققٍ موحَّدٌ — يُسلّم السببَ لا نجاحًا أعمى: رفضٌ بلا سببٍ لا يُقرأ نجاحًا. */
function upstreamVerdict(
  token: string,
  options: Parameters<typeof verifyServiceToken>[1],
):
  | { ok: true; principal: ReturnType<typeof verifyServiceToken> }
  | { ok: false; reason: string } {
  try {
    const principal = verifyServiceToken(token, options);
    return { ok: true, principal };
  } catch (error) {
    const reason =
      error instanceof Error && "reason" in error
        ? String((error as { reason?: unknown }).reason)
        : `خطأٌ غيرُ متوقعٍ: ${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, reason };
  }
}

function tokenVerdict(token: string, options: Parameters<typeof verifyServiceToken>[1]): boolean {
  return upstreamVerdict(token, options).ok;
}


const KEYS = keyRegistryFromEnv({
  WASLA_SERVICE_AUTH_KEYS: "test-kid:active:test-fleet-secret-not-a-production-key",
  WASLA_SERVICE_AUTH_ACTIVE_KID: "test-kid",
});

/** استجابةُ منبعِ الاختبارِ المسجَّلةُ لآخرِ طلبٍّ وصلَهُ. */
interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/**
 * بناءُ منبعِ HTTP اختباريٍّ: يتحققُّ من رمزِ الخدمةِ الحقيقيِّ (جمهورُ الوجهةِ
 * وصلاحياتُ المسارِ وربطُ الطلبِ) ويلتقطُ الطلبَ ويَرُدُّ جوابًا ثابتًا.
 */
function startUpstream(
  expectedAudience: string,
  requiredScopes: readonly string[],
): { server: Server; captured: () => CapturedRequest | undefined } {
  let last: CapturedRequest | undefined;
  const server = createServer((req: IncomingMessage, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => {
      last = {
        method: req.method ?? "",
        url: req.url ?? "/",
        headers: req.headers,
        body,
      };
      const token = (req.headers["x-wasla-service-auth"] as string | undefined) ?? "";
      // تحققٌ حقيقيٌّ بربطِ الطلبِ (method+path+query) وبجمهورِ الوجهةِ وصلاحياتِها:
      // يرمي عندَ الفشلِ فلا يصلَ الطلبُ إلى معالجِ الجوابِ إلّا بهويةٍ كاملةٍ.
      const verdict = upstreamVerdict(token, {
        audience: expectedAudience,
        keys: KEYS,
        now: new Date(),
        method: (req.method ?? "GET").toUpperCase(),
        path: req.url ?? "/",
      });
      if (!verdict.ok) {
        res.statusCode = 401;
        res.end(JSON.stringify({ code: "UPSTREAM_AUTH_FAILED", reason: verdict.reason }));
        return;
      }
      // صلاحياتُ المسارِ تُطالَبُ عندَ المستقبلِ لا عندَ المرسلِ وحدَه:
      // رمزٌ بجمهورٍ صحيحٍ بلا صلاحيةِ المسارِ لا يفتحُ شيئًا (403 لا 200).
      const missing = requiredScopes.filter((sc) => !verdict.principal.scopes.includes(sc));
      if (missing.length > 0) {
        res.statusCode = 403;
        res.end(JSON.stringify({ code: "UPSTREAM_SCOPE_MISSING", missing }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, items: [], total: 0 }));
    });
  });
  return { server, captured: () => last };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as { port: number }).port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** كتابةُ قائمةِ سماحٍ اصطناعيةٍ مفتوحةٍ (للاختبارِ وحدَهُ لا للإنتاجِ). */
function writeTestAllowlist(entries: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "wasla-edge-allowlist-"));
  const path = join(dir, "customer-mini-app.json");
  writeFileSync(
    path,
    JSON.stringify({ surface: "customer-mini-app", entries }, null, 2),
    "utf-8",
  );
  return path;
}

/** سطحٌ زائفٌ — سرُّ روبوتٍ غيرِ حقيقيٍّ. */
const fakeSurface = {
  actorType: "customer" as const,
  botToken: "1234567890:AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRr",
  requestSigner: (() => ({})) as never,
  waslaPublicIdOf: async () => "CUS-TEST",
};

/** جلسةُ استبدالٍ زائفةٌ ناجحةٌ لفاعلِ العميلِ. */
const exchangeOk = async () => ({
  assertion: "assertion-test",
  wasla_public_id: "CUS-TEST",
  actor_type: "customer" as const,
  audience: [],
  expires_at: new Date().toISOString(),
});

/** صلاحياتُ كلِّ خدمةٍ وجهةٍ — من أدوارِ الأسطولِ الاختباريِّ لا منحَ إنتاجٍ. */
const FLEET_SCOPES: Readonly<Record<string, readonly string[]>> = {
  search: ["search:stores:read"],
  geography: ["geography:zone:read"],
};

/** موقِّعٌ حقيقيٌّ بجمهورِ الخدمةِ الوجهةِ وصلاحياتِها (D5) — مفتاحُ اختبارٍ لا أكثر. */
function signerFor(service: string) {
  // أدوارُ أسطولِ اختباريٍّ تحملُ جمهورَ الخدمةِ الوجهةِ: search وgeography.
  const fleetRole = service === "search" ? "search-exit-gate" : "phase02-exit-gate";
  return createServiceRequestSigner({
    serviceName: fleetRole,
    audience: service,
    keys: KEYS,
    scopes: FLEET_SCOPES[service] ?? [],
  });
}

describe("توجيهُ الحدِّ — العقدُ الكاملُ (D1–D5 · D8 · E-20)", () => {
  let searchUpstream: { server: Server; captured: () => CapturedRequest | undefined };
  let searchPort = 0;
  let geoUpstream: { server: Server; captured: () => CapturedRequest | undefined };
  let geoPort = 0;
  let allowlistPath = "";
  let cleanup: string[] = [];

  beforeAll(async () => {
    searchUpstream = startUpstream("search", ["search:stores:read"]);
    searchPort = await listen(searchUpstream.server);
    geoUpstream = startUpstream("geography", ["geography:zone:read"]);
    geoPort = await listen(geoUpstream.server);
    allowlistPath = writeTestAllowlist([
      {
        method: "GET",
        path: "/search/stores",
        service: "search",
        class: "P",
        required_scopes: ["search:stores:read"],
        accepts_body: false,
        production_open: true,
        evidence_tests: [],
        query: { allowed: ["q", "page", "page_size"] },
      },
      {
        method: "GET",
        path: "/geo/zones/search",
        service: "geography",
        class: "P",
        required_scopes: ["geography:zone:read"],
        accepts_body: false,
        production_open: true,
        evidence_tests: [],
        query: { allowed: ["q", "limit", "locale"] },
      },
      {
        method: "GET",
        path: "/stores/:storeSlug/products",
        service: "search",
        class: "P",
        required_scopes: ["search:stores:read"],
        accepts_body: false,
        production_open: true,
        evidence_tests: [],
        query: { allowed: ["cursor", "limit"], pinned: { visible_only: "true" } },
      },
    ]);
    cleanup.push(allowlistPath);
  });

  afterAll(async () => {
    await close(searchUpstream.server);
    await close(geoUpstream.server);
    for (const path of cleanup) rmSync(path, { recursive: true, force: true });
  });

  function buildApp(overrides: Record<string, unknown> = {}) {
    const app = Fastify();
    const additions = createChannelEdge({
      surface: fakeSurface,
      issueSession: async () => {
        throw new Error("لا يُستدعى في هذا الفحص");
      },
      exchangeSession: exchangeOk as never,
      revokeSession: async () => {
        throw new Error("لا يُستدعى في هذا الفحص");
      },
      serviceUrlFor: (service: string) =>
        service === "search"
          ? `http://127.0.0.1:${searchPort}`
          : service === "geography"
            ? `http://127.0.0.1:${geoPort}`
            : "",
      requestSignerFor: (service: string) => signerFor(service),
      allowlistUrl: allowlistPath,
      enabled: true,
      allowedOrigins: [],
      ...overrides,
    });
    additions.apply(app);
    return app;
  }

  it("D1: قائمةُ السماحِ بجذرِ surface صحيحٍ تُسجِّلُ المساراتِ المفتوحةَ فعلًا", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/search/stores?q=coffee",
      headers: { authorization: "Bearer session-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(searchUpstream.captured()).toBeDefined();
  });

  it("D1: عدمُ تطابقِ جذرِ surface يمنعُ اكتمالَ التركيبِ (فشلٌ مغلقٌ)", () => {
    const wrongPath = writeTestAllowlist([]);
    // ملفٌّ جذرُهُ driver لا customer — التركيبُ يجبُ أن يرفضَ لا أن يسجِّلَ.
    const wrongDir = mkdtempSync(join(tmpdir(), "wasla-edge-wrong-"));
    const wrongFile = join(wrongDir, "driver-mini-app.json");
    writeFileSync(
      wrongFile,
      JSON.stringify({ surface: "driver-mini-app", entries: [{ method: "GET", path: "/x", service: "search", class: "P", required_scopes: ["search:stores:read"], production_open: true }] }),
      "utf-8",
    );
    cleanup.push(wrongDir);
    const app = Fastify();
    const additions = createChannelEdge({
      surface: fakeSurface,
      issueSession: async () => {
        throw new Error("لا يُستدعى");
      },
      exchangeSession: exchangeOk as never,
      revokeSession: async () => {
        throw new Error("لا يُستدعى");
      },
      serviceUrlFor: () => `http://127.0.0.1:${searchPort}`,
      requestSignerFor: (service: string) => signerFor(service),
      allowlistUrl: wrongFile,
      enabled: true,
      allowedOrigins: [],
    });
    expect(() => additions.apply(app)).toThrow(/EDGE_ALLOWLIST_SURFACE_MISMATCH/);
  });

  it("D8: ترويسةُ المصادقةِ تُقرأُ قبلَ حذفِ الترويساتِ — النداءُ يعبرُ لا 401", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/search/stores?q=coffee",
      headers: { authorization: "Bearer session-token" },
    });
    // قبلَ الإصلاحِ كانَ كلُّ نداءٍ محميٍّ يُردُّ بـ401 لأنَّ الحذفَ سبقَ القراءةَ.
    expect(res.statusCode).toBe(200);
  });

  it("D2: الوجهةُ من خريطةِ الخدماتِ لا عنوانُ identity — منبعانِ مستقلانِ", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/geo/zones/search?q=mecca",
      headers: { authorization: "Bearer session-token" },
    });
    expect(res.statusCode).toBe(200);
    // الطلبُ الجغرافيُّ وصلَ منبعَ geography لا منبعَ search — خريطةُ الخدماتِ
    // هي التي اختارتِ الوجهةَ لا عنوانٌ ثابتٌ واحدٌ.
    expect(geoUpstream.captured()?.url).toContain("/geo/zones/search");
    const resSearch = await app.inject({
      method: "GET",
      url: "/search/stores?q=coffee",
      headers: { authorization: "Bearer session-token" },
    });
    expect(resSearch.statusCode).toBe(200);
    expect(searchUpstream.captured()?.url).toContain("/search/stores");
  });

  it("D3: الاستعلامُ المصرَّحُ بهِ يُمرَّرُ والتوقيعُ يشملُهُ (ADR-036)", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/search/stores?q=coffee&page=2&page_size=25",
      headers: { authorization: "Bearer session-token" },
    });
    expect(res.statusCode).toBe(200);
    const captured = searchUpstream.captured();
    // ترتيبُ التمريرِ كما وردَ من العميلِ؛ ربطُ التوقيعِ هو ما يرتِّبُ (ADR-036)
    // والمنبعُ تحققَ من الرمزِ فوقَ المسارِ المستلَمِ كما هو.
    expect(captured?.url).toBe("/search/stores?q=coffee&page=2&page_size=25");
  });

  it("D3/E-20: معاملٌ خارجَ العقدِ يُرَدُّ بـ400 لا يُمرَّرُ صامتًا", async () => {
    const app = buildApp();
    for (const bad of ["?state=draft", "?moderation_state=pending", "?visible_only=false", "?owner_public_id=x", "?unknown=1"]) {
      const res = await app.inject({
        method: "GET",
        url: `/search/stores${bad}`,
        headers: { authorization: "Bearer session-token" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("EDGE_INVALID_QUERY");
    }
  });

  it("E-20: المعاملُ المثبَّتُ يملكُهُ الحدُّ — الطلبُ بهِ يُرَدُّ بـ400 والوجهةُ تراهُ دومًا", async () => {
    const app = buildApp();
    const rejected = await app.inject({
      method: "GET",
      url: "/stores/tesla-coffee/products?visible_only=false",
      headers: { authorization: "Bearer session-token" },
    });
    expect(rejected.statusCode).toBe(400);
    const res = await app.inject({
      method: "GET",
      url: "/stores/tesla-coffee/products?limit=10",
      headers: { authorization: "Bearer session-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(searchUpstream.captured()?.url).toBe("/stores/tesla-coffee/products?limit=10&visible_only=true");
  });

  it("D4: معاملاتُ المسارِ تُستبدَلُ بقيمِها الفعليةِ في الوجهةِ والتوقيعِ", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/stores/tesla-coffee/products?limit=5",
      headers: { authorization: "Bearer session-token" },
    });
    expect(res.statusCode).toBe(200);
    const captured = searchUpstream.captured();
    expect(captured?.url).toContain("/stores/tesla-coffee/products");
    // رمزُ الخدمةِ الحقيقيُّ وقَّعَ المسارَ الفعليَّ بمعاملِهِ — المنبعُ تحققَ منهُ.
    const token = (captured?.headers["x-wasla-service-auth"] as string | undefined) ?? "";
    expect(tokenVerdict(token, {
      audience: "search",
      keys: KEYS,
      now: new Date(),
      method: "GET",
      path: captured?.url ?? "/",
    })).toBe(true);
  });

  it("شاهدُ سياسةٍ: تركيبُ موقِّعٍ بجمهورِ search باسمِ customer-bot يُرفضُ اليومَ (لا منحَ M1-05)", () => {
    // هذا هوَ الحاجزُ الحقيقيُّ لا عيبَ حزمةٍ: مصفوفةُ المنحِ لا تمنحُ
    // customer-bot جمهورَ search — والرفضُ مرئيٌّ لا صامتٌ. الدورُ الاختباريُّ
    // فوقَ يُثبتُ آليةَ الحزمةِ، وهذا يُثبتُ أنَّ رحلةَ customer-bot الحيةَ
    // تنتظرُ قرارَ منحٍ موثقًا.
    expect(() =>
      createServiceRequestSigner({
        serviceName: "customer-bot",
        audience: "search",
        keys: KEYS,
        scopes: ["search:stores:read"],
      }),
    ).toThrow();
  });

  it("D5: التوقيعُ بجمهورِ الخدمةِ الوجهةِ لا بجمهورِ identity — المنبعُ يتحققُ منهُ", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/search/stores?q=x",
      headers: { authorization: "Bearer session-token" },
    });
    expect(res.statusCode).toBe(200);
    const captured = searchUpstream.captured();
    const token = (captured?.headers["x-wasla-service-auth"] as string | undefined) ?? "";
    // رمزٌ موقَّعٌ بجمهورِ identity يُرفضُ عندَ منبعِ search.
    const identityToken = mintServiceToken({
      serviceName: "search-exit-gate",
      audience: "identity",
      scopes: ["search:stores:read"],
      keys: KEYS,
      now: new Date(),
      method: "GET",
      path: "/search/stores?q=x",
    });
    const verdict = upstreamVerdict(identityToken, {
      audience: "search",
      keys: KEYS,
      now: new Date(),
      method: "GET",
      path: "/search/stores?q=x",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      // الرفضُ بسببِ الجمهورِ نفسِهِ (audience_mismatch) لا لخطأِ برمجةٍ متوارٍ:
      // خياراتُ التحققِ كاملةٌ (ربطُ الطلبِ) فيُقرأُ السببُ فلا ينجحُ الفحصُ لغيرِهِ.
      expect(verdict.reason).toBe("audience_mismatch");
    }
  });

  it("D5: صلاحياتُ المسارِ تُطالَبُ عندَ المستقبلِ — رمزٌ بجمهورٍ صحيحٍ بلا صلاحيةٍ يُردُّ بـ403", async () => {
    // موقِّعٌ بجمهورِ search لكنَّهُ بلا صلاحيةِ search:stores:read: المنبعُ
    // يتحققُ منها بعدَ الجمهورِ فلا يفتحُ المسارَ لموقِّعٍ ناقصِ الصلاحيةِ.
    const app = buildApp({
      requestSignerFor: (service: string) =>
        createServiceRequestSigner({
          serviceName: service === "search" ? "search-exit-gate" : "phase02-exit-gate",
          audience: service,
          keys: KEYS,
          scopes: [],
        }),
    });
    const res = await app.inject({
      method: "GET",
      url: "/search/stores?q=x",
      headers: { authorization: "Bearer session-token" },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).code).toBe("UPSTREAM_SCOPE_MISSING");
  });

  it("رفضٌ مغلقٌ: مسارٌ مفتوحٌ بلا وجهةٍ يمنعُ اكتمالَ التركيبِ (D2)", () => {
    const app = Fastify();
    const additions = createChannelEdge({
      surface: fakeSurface,
      issueSession: async () => {
        throw new Error("لا يُستدعى");
      },
      exchangeSession: exchangeOk as never,
      revokeSession: async () => {
        throw new Error("لا يُستدعى");
      },
      serviceUrlFor: () => "", // لا وجهةَ إطلاقًا
      requestSignerFor: (service: string) => signerFor(service),
      allowlistUrl: allowlistPath,
      enabled: true,
      allowedOrigins: [],
    });
    expect(() => additions.apply(app)).toThrow(/EDGE_SERVICE_UNCONFIGURED/);
  });

  it("رفضٌ: لا موقِّعَ للخدمةِ يمنعُ اكتمالَ التركيبِ (D5 · فشلٌ مغلقٌ)", () => {
    const app = Fastify();
    const additions = createChannelEdge({
      surface: fakeSurface,
      issueSession: async () => {
        throw new Error("لا يُستدعى");
      },
      exchangeSession: exchangeOk as never,
      revokeSession: async () => {
        throw new Error("لا يُستدعى");
      },
      serviceUrlFor: () => `http://127.0.0.1:${searchPort}`,
      requestSignerFor: () => {
        throw new Error("assertSignerComposition: لا منحَ لهذا الجمهور");
      },
      allowlistUrl: allowlistPath,
      enabled: true,
      allowedOrigins: [],
    });
    expect(() => additions.apply(app)).toThrow(/assertSignerComposition/);
  });

  it("رفضُ النداءِ بلا ترويسةِ مصادقةٍ: 401 لا عبورٌ", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/search/stores?q=x" });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("EDGE_UNAUTHENTICATED");
  });

  it("رفضُ فاعلٍ لا يطابقُ السطحَ: 401 (E-16)", async () => {
    const app = buildApp({
      exchangeSession: async () => ({
        assertion: "a",
        wasla_public_id: "DRV-TEST",
        actor_type: "driver" as const,
        audience: [],
        expires_at: new Date().toISOString(),
      }),
    });
    const res = await app.inject({
      method: "GET",
      url: "/search/stores?q=x",
      headers: { authorization: "Bearer session-token" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("EDGE_ACTOR_MISMATCH");
  });

  it("مسارٌ غيرُ مدرجٍ في القائمةِ: 404 قبلَ أيِّ نداءٍ خلفيٍّ (E-09)", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/dispatch/tick",
      headers: { authorization: "Bearer session-token" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("الترويساتُ الداخليةُ تُحذفُ قبلَ المنبعِ ولا يصلُهُ authorization", async () => {
    const app = buildApp();
    await app.inject({
      method: "GET",
      url: "/search/stores?q=coffee",
      headers: {
        authorization: "Bearer session-token",
        "x-wasla-service-auth": "smuggled",
        "x-customer-public-id": "smuggled",
        "x-wasla-user-assertion": "smuggled",
      },
    });
    const captured = searchUpstream.captured();
    expect(captured?.headers["authorization"]).toBeUndefined();
    expect(captured?.headers["x-wasla-service-auth"]).not.toBe("smuggled");
    expect(captured?.headers["x-customer-public-id"]).toBeUndefined();
  });
});
