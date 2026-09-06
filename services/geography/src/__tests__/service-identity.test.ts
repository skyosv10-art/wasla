/**
 * إثباتُ الفرضِ على **حدِّ الجغرافيا** (`M1-04` · الموجةُ الخامسةُ — آخرُ
 * الحدودِ الخمسةِ).
 *
 * هذا الملفُّ وحدَه يستعملُ `rawInject` **بلا توقيعٍ**؛ فبقيّةُ اختباراتِ HTTP
 * يوقِّعُ لها السندُ تلقائيّاً، ولو أُثبِتَ الفرضُ بها لأُثبِتَ السندُ لا الحدُّ.
 *
 * المصفوفةُ المطلوبةُ: لا هويّةَ → 401 · منتحلةٌ → 401 · صحيحةٌ → مقبولٌ ·
 * صحيحةٌ بصلاحيّةٍ ناقصةٍ → 403. ويُضافُ: رمزٌ معادٌ → 401 · مخزنٌ لا يجيبُ →
 * 503 · رمزُ مسارٍ آخرَ لا يُقبَلُ · `/health` مفتوحٌ بقصدٍ · مسارٌ بلا تصنيفٍ
 * يُسقِطُ الإقلاعَ · **وكتابةُ الموقعِ لا تُنالُ برمزِ قراءةٍ**.
 */

import { AuthErrorCode } from "@wasla/auth-sdk";
import {
  InMemoryServiceTokenReplayGuard,
  ServiceTokenReplayStoreUnavailableError,
  type ServiceTokenReplayGuard,
} from "@wasla/service-auth";
import { describe, expect, it } from "vitest";

import { createGeographyApp } from "../http/app.js";
import { GEO_SCOPES } from "../http/service-identity.js";
import {
  SAUDI_FIXTURE_IDS,
  InMemoryGeographyRepository,
  InMemoryIdentityLookupPort,
  InMemoryOutbox,
  SystemClock,
  CryptoIdGenerator,
} from "../infrastructure/in-memory.js";
import type { UseCaseDeps } from "../use-cases/deps.js";

import {
  ALL_GEO_SCOPES,
  buildSignedGeographyApp,
  createTestKeyRegistry,
  signFor,
  TEST_FORGED_SECRET,
} from "./service-identity-support.js";

const I = SAUDI_FIXTURE_IDS;
const USER = "WS-0000000001";
const ZONES = "/geo/zones";
const COUNTRIES = "/geo/countries";
const LOCATION = (publicId: string): string => `/geo/users/${publicId}/location`;

/** جسمُ كتابةٍ صحيحٌ — كي يكونَ الرفضُ عن الهويّةِ لا عن التحقّقِ من الجسمِ. */
function locationBody(zoneId = I.zoneHaraEast): Record<string, unknown> {
  return { zone_id: zoneId, source: "customer_bot" };
}

function deps(): UseCaseDeps {
  return {
    repo: new InMemoryGeographyRepository(),
    outbox: new InMemoryOutbox(),
    clock: new SystemClock(),
    idGen: new CryptoIdGenerator(),
    identityLookup: new InMemoryIdentityLookupPort([USER]),
  };
}

function appWithGuard(replayGuard: ServiceTokenReplayGuard) {
  const keys = createTestKeyRegistry();
  const app = createGeographyApp({
    deps: deps(),
    serviceIdentity: { keys, replayGuard },
  });
  return { app, keys };
}

describe("حد الجغرافيا — المصفوفة الأربع", () => {
  it("لا هوية → 401 بمغلف العقد ولا يُسمّى سبب الرفض في الرد", async () => {
    const { app, rawInject } = buildSignedGeographyApp({ deps: deps() });
    const response = await rawInject({
      method: "GET",
      url: `${ZONES}/${I.zoneHaraEast}`,
    });
    expect(response.statusCode).toBe(401);
    const body = response.json() as { code: string; message: string; trace_id: string };
    expect(body.code).toBe(AuthErrorCode.UNAUTHENTICATED);
    expect(body.trace_id).toBeTruthy();
    // السبب يُسجَّل ولا يُعاد: «رمز منتهٍ» و«توقيع خاطئ» فرقٌ يفيد المهاجم وحده.
    expect(body.message).not.toMatch(/توقيع|منته|kid|صلاحي/u);
    await app.close();
  });

  it("هوية منتحلة → 401 لا 403 ولا 500", async () => {
    const { app, rawInject } = buildSignedGeographyApp({ deps: deps() });
    const response = await rawInject({
      method: "GET",
      url: `${ZONES}/${I.zoneHaraEast}`,
      headers: signFor("GET", `${ZONES}/${I.zoneHaraEast}`, {
        keys: createTestKeyRegistry(TEST_FORGED_SECRET),
      }),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe(AuthErrorCode.UNAUTHENTICATED);
    await app.close();
  });

  it("هوية صحيحة بالصلاحية المطلوبة → يمر الطلب إلى العقد", async () => {
    const { app, rawInject, keys } = buildSignedGeographyApp({ deps: deps() });
    const response = await rawInject({
      method: "GET",
      url: `${ZONES}/${I.zoneHaraEast}`,
      headers: signFor("GET", `${ZONES}/${I.zoneHaraEast}`, {
        keys,
        serviceName: "customers",
        scopes: [GEO_SCOPES.zoneRead],
      }),
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("هوية صحيحة وصلاحية ناقصة → 403 لا 401", async () => {
    const { app, rawInject, keys } = buildSignedGeographyApp({ deps: deps() });
    // منادٍ يملك قراءة الموقع ويحاول كتابته: الفرق بين «من أنت» و«ماذا تملك».
    const response = await rawInject({
      method: "PUT",
      url: LOCATION(USER),
      headers: signFor("PUT", LOCATION(USER), {
        keys,
        serviceName: "dispatch",
        scopes: [GEO_SCOPES.locationRead],
      }),
      payload: locationBody(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(AuthErrorCode.FORBIDDEN);
    await app.close();
  });

  it("الرمز نفسه مرتين → 401 في الثانية", async () => {
    const { app, rawInject, keys } = buildSignedGeographyApp({ deps: deps() });
    const path = `${ZONES}/${I.zoneHaraEast}`;
    const headers = signFor("GET", path, { keys, scopes: [GEO_SCOPES.zoneRead] });
    const first = await rawInject({ method: "GET", url: path, headers });
    const second = await rawInject({ method: "GET", url: path, headers });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(401);
    await app.close();
  });

  it("مخزن الآثار لا يجيب → 503 لا 200", async () => {
    const { app } = appWithGuard({
      remember() {
        throw new ServiceTokenReplayStoreUnavailableError("المخزن صامت.");
      },
    });
    const response = await app.inject({
      method: "GET",
      url: COUNTRIES,
      headers: signFor("GET", COUNTRIES, { scopes: [GEO_SCOPES.hierarchyRead] }),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("SERVICE_AUTH_REPLAY_STORE_UNAVAILABLE");
    await app.close();
  });
});

describe("حد الجغرافيا — الكتابة الخطيرة", () => {
  it("رمز قراءة هرمٍ لا يكتب موقعاً → 403 قبل أن يُسأل المجال", async () => {
    const { app, rawInject, keys } = buildSignedGeographyApp({ deps: deps() });
    const response = await rawInject({
      method: "PUT",
      url: LOCATION(USER),
      headers: signFor("PUT", LOCATION(USER), {
        keys,
        scopes: [GEO_SCOPES.hierarchyRead, GEO_SCOPES.zoneRead, GEO_SCOPES.locationRead],
      }),
      payload: locationBody(),
    });
    // 403 قبلَ فحصِ الهويّةِ المجاليّةِ: الرفضُ عن الصلاحيّةِ لا عن «مستخدم مجهول».
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(AuthErrorCode.FORBIDDEN);
    await app.close();
  });

  it("كتابة الموقع بلا هوية خدمة أصلاً → 401 لا 4xx مجالي", async () => {
    const { app, rawInject } = buildSignedGeographyApp({ deps: deps() });
    const response = await rawInject({
      method: "PUT",
      url: LOCATION(USER),
      payload: locationBody(),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe(AuthErrorCode.UNAUTHENTICATED);
    await app.close();
  });

  it("رمز قراءة منطقةٍ لا يقرأ منطقةً أخرى — المُعرّف داخل الربط", async () => {
    // المُعرِّفُ جزءٌ من **المسارِ** لا من سلسلةِ الاستفسارِ، والربطُ يغطّي
    // المسارَ (ADR-021 §4) — فرمزٌ وُقِّعَ لمنطقةٍ لا يصلحُ لغيرِها. وهذا
    // يُقاسُ لا يُدَّعى.
    const { app, rawInject, keys } = buildSignedGeographyApp({ deps: deps() });
    const response = await rawInject({
      method: "GET",
      url: `${ZONES}/${I.zoneQubaNorth}`,
      headers: signFor("GET", `${ZONES}/${I.zoneHaraEast}`, {
        keys,
        scopes: [GEO_SCOPES.zoneRead],
      }),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe("حد الجغرافيا — حدود الربط والتصنيف", () => {
  it("رمز مسار آخر لا يُقبل على هذا المسار", async () => {
    const { app, rawInject, keys } = buildSignedGeographyApp({ deps: deps() });
    const response = await rawInject({
      method: "GET",
      url: COUNTRIES,
      headers: signFor("GET", `${ZONES}/${I.zoneHaraEast}`, {
        keys,
        scopes: ALL_GEO_SCOPES,
      }),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("`/health` مفتوح بقصد ومعلن — لا هوية ولا 401", async () => {
    const { app, rawInject } = buildSignedGeographyApp({ deps: deps() });
    const response = await rawInject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("مسار غير معروف يُرَدّ 401 قبل 404 — لا استكشاف مسارات بلا هوية", async () => {
    const { app, rawInject } = buildSignedGeographyApp({ deps: deps() });
    const response = await rawInject({
      method: "GET",
      url: "/geo/does-not-exist/secret",
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("مسار يُسجّل بلا تصنيف يُسقط التطبيق عند الإقلاع لا عند أول طلب", () => {
    const app = createGeographyApp({
      deps: deps(),
      serviceIdentity: {
        keys: createTestKeyRegistry(),
        replayGuard: new InMemoryServiceTokenReplayGuard(),
      },
    });
    expect(() => {
      app.get("/geo/forgotten", async () => ({ ok: true }));
    }).toThrow(/بلا تصنيف هوية خدمة/u);
  });
});
