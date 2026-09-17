/**
 * إثباتُ الفرضِ على **حدِّ السائقين** (`M1-04` · الموجةُ العاشرةُ · `CLM-0198`).
 *
 * هذا الملفُّ وحدَه يستعملُ `rawInject` **بلا توقيعٍ** أو بتوقيعٍ صريحٍ مُخالِفٍ؛
 * فبقيّةُ اختباراتِ HTTP يوقِّعُ لها السندُ تلقائيّاً، ولو أُثبِتَ الفرضُ بها
 * لأُثبِتَ **السندُ** لا الحدُّ. وهذا هوَ الفرقُ بينَ اختبارٍ يطمئنُ واختبارٍ
 * يشهدُ.
 *
 * المصفوفةُ المطلوبةُ (ADR-020 · ADR-021): لا هويّةَ → 401 · منتحلةٌ → 401 ·
 * منتهيةٌ → 401 · جمهورٌ آخرُ → 401 · مسارٌ أو طريقةٌ أخرى → 401 · رمزٌ معادٌ →
 * 401 · صحيحةٌ بصلاحيّةٍ ناقصةٍ → 403 · بلا مُنتَفِعٍ → 403 · مسارٌ مجهولٌ →
 * 401 قبلَ 404 · و`/health` مفتوحٌ بقصدٍ مكتوبٍ.
 *
 * **وما يخصُّ هذا الحدَّ وحدَهُ:** مُنتَفِعٌ في الرمزِ يخالفُ `:waslaPublicId`
 * في المسارِ → **404 لا 403** (ADR-009).
 */

import {
  ServiceTokenReplayStoreUnavailableError,
  serviceAuthHeaders,
  type ServiceTokenReplayGuard,
} from "@wasla/service-auth";
import { describe, expect, it } from "vitest";

import { createDriverApp } from "../http/app.js";
import { DRIVER_SCOPES } from "../http/service-identity.js";

import { DRIVER, environment } from "./helpers.js";
import {
  ALL_DRIVER_SCOPES,
  buildSignedDriverApp,
  createTestKeyRegistry,
  signFor,
  TEST_FORGED_SECRET,
} from "./service-identity-support.js";

/** رمزُ الرفضِ بلا سابقةِ `DRIVER_` — مفرداتُ ADR-020 لا مفرداتُ خدمةٍ. */
const UNAUTHENTICATED = "AUTHN_UNAUTHENTICATED";

const PROFILE = `/drivers/${DRIVER}`;

/** سندٌ بملفٍّ مزروعٍ: كي يكونَ جوابُ العبورِ 200 لا 404 فيُقاسَ العبورُ. */
async function harnessApp() {
  const env = environment();
  // Seed a driver profile so the beneficiary check can reach the domain (200, not 404)
  const { registerDriver } = await import("../use-cases/register-driver.js");
  const runner = (await import("../runner.js")).createDirectRunner(env);
  await runner.write(async (deps) => {
    await registerDriver(deps, {
      waslaPublicId: DRIVER,
      displayName: "سائق تجربة",
      preferredLocale: "ar",
      workCityZoneId: null,
      serviceKinds: ["ride"],
      traceId: "seed",
    });
  });
  return buildSignedDriverApp({ runner });
}

/** تطبيقٌ بمخزنِ آثارٍ يُقرِّرُهُ الاختبارُ — لإثباتِ الإغلاقِ عندَ العجزِ. */
async function appWithGuard(replayGuard: ServiceTokenReplayGuard) {
  const env = environment();
  const { registerDriver } = await import("../use-cases/register-driver.js");
  const runner = (await import("../runner.js")).createDirectRunner(env);
  await runner.write(async (deps) => {
    await registerDriver(deps, {
      waslaPublicId: DRIVER,
      displayName: "سائق تجربة",
      preferredLocale: "ar",
      workCityZoneId: null,
      serviceKinds: ["ride"],
      traceId: "seed",
    });
  });
  const keys = createTestKeyRegistry();
  const app = createDriverApp({
    runner,
    serviceIdentity: { keys, replayGuard },
  });
  return { app, keys };
}

describe("حد السائقين — مصفوفة المصادقة الداخلة", () => {
  it("لا هوية → 401 بمغلف عقد السائقين (error.code مسطَّح) ولا يُسمّى سبب الرفض", async () => {
    const { app, rawInject } = await harnessApp();
    const response = await rawInject({ method: "GET", url: PROFILE });

    expect(response.statusCode).toBe(401);
    const body = response.json() as Record<string, unknown>;
    // شكلُ العقدِ المنشورِ لهذا الحدِّ: `error.code` **مُعشَّشٌ** و`trace_id`.
    expect(body.error).toBeDefined();
    expect((body.error as Record<string, unknown>).code).toBe(UNAUTHENTICATED);
    expect(body.trace_id).toBeTruthy();
    expect(String((body.error as Record<string, unknown>).message)).not.toMatch(
      /توقيع|منته|kid|صلاحي|جمهور/u,
    );
    await app.close();
  });

  it("هوية منتحلة بسر آخر → 401 لا 403 ولا 500", async () => {
    const { app, rawInject } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: PROFILE,
      headers: signFor("GET", PROFILE, { keys: createTestKeyRegistry(TEST_FORGED_SECRET) }),
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("رمز منتهٍ → 401", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: PROFILE,
      headers: signFor("GET", PROFILE, { keys, now: new Date(Date.now() - 3_600_000) }),
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("جمهور آخر → 401 بكود الجمهور", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const headers = serviceAuthHeaders({
      serviceName: "orders",
      audience: "orders",
      method: "GET",
      path: PROFILE,
      keys,
      now: new Date(),
      scopes: ALL_DRIVER_SCOPES,
      onBehalfOfPublicId: DRIVER,
    });
    const response = await rawInject({ method: "GET", url: PROFILE, headers });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("رمز موقَّع لمسار آخر → 401", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: PROFILE,
      headers: signFor("GET", `/drivers/${DRIVER}/vehicles`, { keys }),
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("هوية صحيحة بالصلاحية والمُنتَفِع → يعبر الطلب إلى المجال (200)", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: PROFILE,
      headers: signFor("GET", PROFILE, { keys, scopes: [DRIVER_SCOPES.profileRead] }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().wasla_public_id).toBe(DRIVER);
    await app.close();
  });

  it("هوية صحيحة وصلاحية ناقصة → 403 لا 401", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "PATCH",
      url: PROFILE,
      headers: signFor("PATCH", PROFILE, { keys, scopes: [DRIVER_SCOPES.profileRead] }),
      payload: { display_name: "سائق معدّل" },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("رمز صحيح بلا مُنتَفِع → 403 عند الوسيط قبل أن يُسأل المخزن", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: PROFILE,
      headers: signFor("GET", PROFILE, { keys, onBehalfOfPublicId: null }),
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("مُنتَفِعٌ يخالف :waslaPublicId → 404 لا 403 ولا 200 (ADR-009)", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: PROFILE,
      headers: signFor("GET", PROFILE, { keys, onBehalfOfPublicId: "WS-9999999999" }),
    });

    expect(response.statusCode).toBe(404);
    expect(response.statusCode).not.toBe(403);
    await app.close();
  });

  it("الرمز نفسه مرتين → 401 في الثانية (إعادة · ADR-021)", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const headers = signFor("GET", PROFILE, { keys, scopes: [DRIVER_SCOPES.profileRead] });
    const first = await rawInject({ method: "GET", url: PROFILE, headers });
    const second = await rawInject({ method: "GET", url: PROFILE, headers });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(401);
    await app.close();
  });

  it("مخزن الآثار لا يجيب → 503 برمز الحدّ لا برمز تعذّرِ السائق", async () => {
    const { app, keys } = await appWithGuard({
      remember() {
        throw new ServiceTokenReplayStoreUnavailableError("المخزن صامت.");
      },
    });
    const response = await app.inject({
      method: "GET",
      url: PROFILE,
      headers: signFor("GET", PROFILE, { keys }),
    });

    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it("مسار مجهول → 401 قبل 404", async () => {
    const { app, rawInject } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: `/drivers/${DRIVER}/there-is-no-such-route`,
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("/health مفتوحٌ بقصدٍ: يُجيب بلا هوية", async () => {
    const { app, rawInject } = await harnessApp();
    const response = await rawInject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    await app.close();
  });
});
