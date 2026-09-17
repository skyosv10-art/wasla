/**
 * إثباتُ الفرضِ على **حدِّ الاشتراك** (`M1-04` · الموجةُ الثالثةَ عشرةَ · `CLM-0201`).
 *
 * هذا الملفُّ وحدَه يستعملُ `rawInject` **بلا توقيعٍ** أو بتوقيعٍ صريحٍ مُخالِفٍ؛
 * فبقيّةُ اختباراتِ HTTP يوقِّعُ لها السندُ تلقائيّاً، ولو أُثبِتَ الفرضُ بها
 * لأُثبِتَ **السندُ** لا الحدُّ. وهذا هوَ الفرقُ بينَ اختبارٍ يطمئنُ واختبارٍ
 * يشهدُ.
 *
 * المصفوفةُ المطلوبةُ (ADR-020 · ADR-021): لا هويّةَ → 401 · منتحلةٌ → 401 ·
 * صحيحةٌ بصلاحيّةٍ ناقصةٍ → 403 · بلا مُنتَفِعٍ → 403 · مسارٌ مجهولٌ →
 * 401 قبلَ 404 · و`/health` مفتوحٌ بقصدٍ مكتوبٍ.
 *
 * **وما يخصُّ هذا الحدَّ وحدَهُ:** مُنتَفِعٌ في الرمزِ يخالفُ `:driverPublicId`
 * في المسارِ → **404 لا 403** (ADR-009).
 */

import {
  ServiceTokenReplayStoreUnavailableError,
  serviceAuthHeaders,
  type ServiceTokenReplayGuard,
} from "@wasla/service-auth";
import { describe, expect, it } from "vitest";

import { createSubscriptionApp } from "../http/app.js";
import { SUBSCRIPTIONS_SCOPES } from "../http/service-identity.js";

import {
  ALL_SUBSCRIPTIONS_SCOPES,
  buildSignedSubscriptionsApp,
  createTestKeyRegistry,
  signFor,
  TEST_FORGED_SECRET,
} from "./service-identity-support.js";

/** رمزُ الرفضِ بلا سابقةِ `SUBSCRIPTION_` — مفرداتُ ADR-020 لا مفرداتُ خدمةٍ. */
const UNAUTHENTICATED = "AUTHN_UNAUTHENTICATED";

const DRIVER = "WS-1000000001";

/** مسارُ قراءةِ الحالةِ — مربوطٌ بالمُنتَفِعِ. */
const STATE_URL = `/subscriptions/${DRIVER}`;

/** سندٌ بنتيجةٍ مزروعةٍ: كي يكونَ جوابُ العبورِ 200 لا 404 فيُقاسَ العبورُ. */
async function harnessApp() {
  // وضعُ الذاكرةِ يكفي لإثباتِ الفرضِ: الحدُّ يردُّ قبلَ أن يُسألَ المخزن.
  return buildSignedSubscriptionsApp({});
}

/** تطبيقٌ بمخزنِ آثارٍ يُقرِّرُهُ الاختبارُ — لإثباتِ الإغلاقِ عندَ العجزِ. */
async function appWithGuard(replayGuard: ServiceTokenReplayGuard) {
  const keys = createTestKeyRegistry();
  const app = createSubscriptionApp({
    serviceIdentity: { keys, replayGuard },
  });
  return { app, keys };
}

describe("حد الاشتراك — مصفوفة المصادقة الداخلة", () => {
  it("لا هوية → 401 بمغلف عقد الاشتراك (error.code مُعشَّش) ولا يُسمّى سبب الرفض", async () => {
    const { app, rawInject } = await harnessApp();
    const response = await rawInject({ method: "GET", url: STATE_URL });

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
      url: STATE_URL,
      headers: signFor("GET", STATE_URL, { keys: createTestKeyRegistry(TEST_FORGED_SECRET) }),
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("رمز منتهٍ → 401", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: STATE_URL,
      headers: signFor("GET", STATE_URL, { keys, now: new Date(Date.now() - 3_600_000) }),
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("جمهور آخر → 401", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const headers = serviceAuthHeaders({
      serviceName: "orders",
      audience: "orders",
      method: "GET",
      path: STATE_URL,
      keys,
      now: new Date(),
      scopes: ALL_SUBSCRIPTIONS_SCOPES,
      onBehalfOfPublicId: DRIVER,
    });
    const response = await rawInject({ method: "GET", url: STATE_URL, headers });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("رمز موقَّع لمسار آخر → 401", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: STATE_URL,
      headers: signFor("GET", `/subscriptions/WS-9999999999`, { keys }),
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("هوية صحيحة بالصلاحية والمُنتَفِع → يعبر الطلب إلى المجال (503 لا 401)", async () => {
    const { app, rawInject, keys } = await harnessApp();
    // وضعُ الذاكرةِ: لا مخزنَ، فالحدُّ يردّ 503 بعدَ عبورِ الهويّةِ. 503 يُثبتُ أنَّ
    // الهويّةَ عُبِرَت — لا أنَّها رُفِضَت (401/403).
    const response = await rawInject({
      method: "GET",
      url: STATE_URL,
      headers: signFor("GET", STATE_URL, { keys, scopes: [SUBSCRIPTIONS_SCOPES.stateRead] }),
    });

    expect(response.statusCode).not.toBe(401);
    expect(response.statusCode).not.toBe(403);
    await app.close();
  });

  it("هوية صحيحة وصلاحية ناقصة → 403 لا 401", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: `/subscriptions/plans`,
      headers: signFor("GET", `/subscriptions/plans`, { keys, scopes: [SUBSCRIPTIONS_SCOPES.stateRead] }),
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("رمز صحيح بلا مُنتَفِع → 403 عند الوسيط قبل أن يُسأل المخزن", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: STATE_URL,
      headers: signFor("GET", STATE_URL, { keys, onBehalfOfPublicId: null }),
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("مُنتَفِعٌ يخالف :driverPublicId → 404 لا 403 ولا 200 (ADR-009)", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: STATE_URL,
      headers: signFor("GET", STATE_URL, { keys, onBehalfOfPublicId: "WS-9999999999" }),
    });

    expect(response.statusCode).toBe(404);
    expect(response.statusCode).not.toBe(403);
    await app.close();
  });

  it("الرمز نفسه مرتين → 401 في الثانية (إعادة · ADR-021)", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const headers = signFor("GET", STATE_URL, { keys, scopes: [SUBSCRIPTIONS_SCOPES.stateRead] });
    const first = await rawInject({ method: "GET", url: STATE_URL, headers });
    const second = await rawInject({ method: "GET", url: STATE_URL, headers });

    expect(first.statusCode).not.toBe(401);
    expect(second.statusCode).toBe(401);
    await app.close();
  });

  it("مخزن الآثار لا يجيب → 503 برمز الحدّ لا برمز تعذّرِ الاشتراك", async () => {
    const { app, keys } = await appWithGuard({
      remember() {
        throw new ServiceTokenReplayStoreUnavailableError("المخزن صامت.");
      },
    });
    const response = await app.inject({
      method: "GET",
      url: STATE_URL,
      headers: signFor("GET", STATE_URL, { keys }),
    });

    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it("مسار مجهول → 401 قبل 404", async () => {
    const { app, rawInject } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: "/subscriptions/there-is-no-such-route",
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

  it("مسارٌ داخليٌّ (GET /subscriptions/plans) يفرضُ الصلاحيّةَ بلا مُنتَفِعٍ", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: "/subscriptions/plans",
      headers: signFor("GET", "/subscriptions/plans", { keys, scopes: [SUBSCRIPTIONS_SCOPES.stateRead] }),
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
