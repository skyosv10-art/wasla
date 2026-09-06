/**
 * إثباتُ الفرضِ على **حدِّ الهويّةِ** (`M1-04` · الموجةُ الثالثةُ).
 *
 * هذا الملفُّ وحدَه يستعملُ `rawInject` **بلا توقيعٍ**؛ فبقيّةُ اختباراتِ HTTP
 * يوقِّعُ لها السندُ تلقائيّاً، ولو أُثبِتَ الفرضُ بها لأُثبِتَ السندُ لا الحدُّ.
 *
 * المصفوفةُ المطلوبةُ: لا هويّةَ → 401 · منتحلةٌ → 401 · صحيحةٌ → مقبولٌ ·
 * صحيحةٌ بصلاحيّةٍ ناقصةٍ → 403. ويُضافُ: رمزٌ معادٌ → 401 · مخزنٌ لا يجيبُ → 503 ·
 * رمزُ مسارٍ آخرَ لا يُقبَلُ · `/health` مفتوحٌ بقصدٍ · مسارٌ بلا تصنيفٍ يُسقِطُ
 * الإقلاعَ · **والصلاحيّتانِ الخطيرتانِ (الربطُ والاستعادةُ) لا تُنالانِ برمزِ
 * قراءةٍ** — وهي العلّةُ التي قدَّمَت هذا الحدَّ على حدِّ التوزيعِ.
 */

import { AuthErrorCode } from "@wasla/auth-sdk";
import {
  InMemoryServiceTokenReplayGuard,
  ServiceTokenReplayStoreUnavailableError,
  type ServiceTokenReplayGuard,
} from "@wasla/service-auth";
import { describe, expect, it } from "vitest";

import { createIdentityApp } from "../../http/app.js";
import { IDENTITY_SCOPES } from "../../http/service-identity.js";

import {
  ALL_IDENTITY_SCOPES,
  buildInMemoryDeps,
  createIdentityHttpHarness,
  createTestKeyRegistry,
  signFor,
  TEST_FORGED_SECRET,
} from "./support.js";

const RESOLVE = "/identity/resolve";

/** جسمُ حلٍّ صحيحٌ — كي يكونَ الرفضُ عن الهويّةِ لا عن التحقّقِ من الجسمِ. */
function resolveBody(telegramUserId = 555111222): Record<string, unknown> {
  return {
    telegram_user_id: telegramUserId,
    telegram_username: "identity_matrix",
    source: "customer_bot",
  };
}

function appWithGuard(replayGuard: ServiceTokenReplayGuard) {
  const keys = createTestKeyRegistry();
  const app = createIdentityApp({
    deps: buildInMemoryDeps(),
    logger: false,
    serviceIdentity: { keys, replayGuard },
  });
  return { app, keys };
}

/** يُنشئُ مستخدماً بمسارٍ موقَّعٍ ويعيدُ مُعرِّفَه العامَّ. */
async function seedUser(
  harness: ReturnType<typeof createIdentityHttpHarness>,
  telegramUserId: number,
): Promise<string> {
  const created = await harness.app.inject({
    method: "POST",
    url: RESOLVE,
    payload: resolveBody(telegramUserId),
  });
  expect(created.statusCode).toBe(201);
  return (created.json() as { wasla_public_id: string }).wasla_public_id;
}

describe("حد الهويّة — المصفوفة الأربع", () => {
  it("لا هوية → 401 بمغلف العقد ولا يُسمّى سبب الرفض في الرد", async () => {
    const { app, rawInject } = createIdentityHttpHarness();
    const response = await rawInject({
      method: "POST",
      url: RESOLVE,
      payload: resolveBody(),
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
    const { app, rawInject } = createIdentityHttpHarness();
    const response = await rawInject({
      method: "POST",
      url: RESOLVE,
      headers: signFor("POST", RESOLVE, { keys: createTestKeyRegistry(TEST_FORGED_SECRET) }),
      payload: resolveBody(),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe(AuthErrorCode.UNAUTHENTICATED);
    await app.close();
  });

  it("هوية صحيحة بالصلاحية المطلوبة → يمر الطلب إلى العقد", async () => {
    const { app, rawInject, keys } = createIdentityHttpHarness();
    const response = await rawInject({
      method: "POST",
      url: RESOLVE,
      headers: signFor("POST", RESOLVE, {
        keys,
        serviceName: "customer-bot",
        scopes: [IDENTITY_SCOPES.resolveWrite],
      }),
      payload: resolveBody(),
    });
    expect(response.statusCode).toBe(201);
    await app.close();
  });

  it("هوية صحيحة وصلاحية ناقصة → 403 لا 401", async () => {
    const { app, rawInject, keys } = createIdentityHttpHarness();
    // منادٍ يملك القراءة ويحاول الكتابة: الفرق بين «من أنت» و«ماذا تملك».
    const response = await rawInject({
      method: "POST",
      url: RESOLVE,
      headers: signFor("POST", RESOLVE, {
        keys,
        serviceName: "geography",
        scopes: [IDENTITY_SCOPES.userRead],
      }),
      payload: resolveBody(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(AuthErrorCode.FORBIDDEN);
    await app.close();
  });

  it("الرمز نفسه مرتين → 401 في الثانية", async () => {
    const harness = createIdentityHttpHarness();
    const waslaPublicId = await seedUser(harness, 555111333);
    const path = `/identity/users/${waslaPublicId}`;
    const headers = signFor("GET", path, {
      keys: harness.keys,
      scopes: [IDENTITY_SCOPES.userRead],
    });
    const first = await harness.rawInject({ method: "GET", url: path, headers });
    const second = await harness.rawInject({ method: "GET", url: path, headers });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(401);
    await harness.app.close();
  });

  it("مخزن الآثار لا يجيب → 503 لا 200", async () => {
    const { app } = appWithGuard({
      remember() {
        throw new ServiceTokenReplayStoreUnavailableError("المخزن صامت.");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: RESOLVE,
      headers: signFor("POST", RESOLVE),
      payload: resolveBody(),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("SERVICE_AUTH_REPLAY_STORE_UNAVAILABLE");
    await app.close();
  });
});

describe("حد الهويّة — الكتابتان الخطيرتان", () => {
  it("رمز قراءةٍ لا يربط هويّة خارجيّة بحسابٍ قائم → 403", async () => {
    const harness = createIdentityHttpHarness();
    const waslaPublicId = await seedUser(harness, 555111444);
    const path = `/identity/users/${waslaPublicId}/links`;
    const response = await harness.rawInject({
      method: "POST",
      url: path,
      headers: signFor("POST", path, {
        keys: harness.keys,
        scopes: [IDENTITY_SCOPES.userRead, IDENTITY_SCOPES.historyRead],
      }),
      payload: { provider: "telegram", external_id: "999888777" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(AuthErrorCode.FORBIDDEN);
    await harness.app.close();
  });

  it("رمز قراءةٍ لا يبدأ استعادة حساب → 403", async () => {
    const harness = createIdentityHttpHarness();
    const waslaPublicId = await seedUser(harness, 555111555);
    const path = `/identity/users/${waslaPublicId}/recovery`;
    const response = await harness.rawInject({
      method: "POST",
      url: path,
      headers: signFor("POST", path, {
        keys: harness.keys,
        scopes: [IDENTITY_SCOPES.userRead],
      }),
      payload: { reason: "lost_device" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(AuthErrorCode.FORBIDDEN);
    await harness.app.close();
  });

  it("الاستعادة بلا هوية خدمة أصلاً → 401 لا 4xx مجالي", async () => {
    const harness = createIdentityHttpHarness();
    const waslaPublicId = await seedUser(harness, 555111666);
    const response = await harness.rawInject({
      method: "POST",
      url: `/identity/users/${waslaPublicId}/recovery`,
      payload: { reason: "lost_device" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe(AuthErrorCode.UNAUTHENTICATED);
    await harness.app.close();
  });
});

describe("حد الهويّة — حدود الربط والتصنيف", () => {
  it("رمز مسار آخر لا يُقبل على هذا المسار", async () => {
    const { app, rawInject, keys } = createIdentityHttpHarness();
    const response = await rawInject({
      method: "POST",
      url: RESOLVE,
      headers: signFor("POST", "/identity/users/WSL-0000000001/links", {
        keys,
        scopes: ALL_IDENTITY_SCOPES,
      }),
      payload: resolveBody(),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("رمز مستخدمٍ لا يقرأ مستخدماً آخر — المُعرّف داخل الربط", async () => {
    // **الفرقُ عن `RISK-0026`:** المُعرِّفُ هنا جزءٌ من **المسارِ** لا من سلسلةِ
    // الاستفسارِ، والربطُ يغطّي المسارَ (ADR-021 §4) — فرمزٌ وُقِّعَ لقراءةِ
    // مستخدمٍ لا يصلحُ لقراءةِ غيرِه. وهذا يُقاسُ لا يُدَّعى.
    const harness = createIdentityHttpHarness();
    const first = await seedUser(harness, 555111777);
    const second = await seedUser(harness, 555111888);
    const headers = signFor("GET", `/identity/users/${first}`, {
      keys: harness.keys,
      scopes: [IDENTITY_SCOPES.userRead],
    });
    const response = await harness.rawInject({
      method: "GET",
      url: `/identity/users/${second}`,
      headers,
    });
    expect(response.statusCode).toBe(401);
    await harness.app.close();
  });

  it("`/health` مفتوح بقصد ومعلن — لا هوية ولا 401", async () => {
    const { app, rawInject } = createIdentityHttpHarness();
    const response = await rawInject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("مسار غير معروف يُرَدّ 401 قبل 404 — لا استكشاف مسارات بلا هوية", async () => {
    const { app, rawInject } = createIdentityHttpHarness();
    const response = await rawInject({ method: "GET", url: "/identity/does-not-exist/secret" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("مسار يُسجّل بلا تصنيف يُسقط التطبيق عند الإقلاع لا عند أول طلب", () => {
    const app = createIdentityApp({
      deps: buildInMemoryDeps(),
      logger: false,
      serviceIdentity: {
        keys: createTestKeyRegistry(),
        replayGuard: new InMemoryServiceTokenReplayGuard(),
      },
    });
    expect(() => {
      app.get("/identity/forgotten", async () => ({ ok: true }));
    }).toThrow(/بلا تصنيف هوية خدمة/u);
  });
});
