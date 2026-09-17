/**
 * إثباتُ الفرضِ على **حدِّ العميلِ** (`M1-04` · الموجةُ التاسعةُ · `CLM-0197`).
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
 * في المسارِ → **404 لا 403** (`ADR-009`)؛ وهيَ الدعوى التي تُغلِقُ بابَ
 * «رمزٌ واحدٌ يقرأُ ملفَّ كلِّ عميلٍ بتبديلِ حرفٍ في المسارِ» — الوجهُ نفسُهُ
 * الذي أُغلِقَ على حدِّ الطلباتِ في `M1-05B`.
 *
 * **ولِمَ نمطُ الذاكرةِ في كلِّ هذهِ الدعاوى:** المطلوبُ إثباتُ أنَّ القرارَ
 * يُتَّخَذُ **قبلَ** أن يُسألَ المجالُ. فالنداءُ المقبولُ هنا يبلغُ المجالَ
 * فيُجابُ بجوابِ المجالِ (200 لملفٍّ مزروعٍ · 404 لغيرِ المزروعِ) — وهوَ
 * **دليلُ العبورِ**: لا 401 ولا 403. ولو احتاجَتِ الدعوى قاعدةً لصارت بوّابةَ
 * تكاملٍ تُتَخطّى حيثُ لا قاعدةَ، فيصيرُ أهمُّ اختبارٍ أمنيٍّ هوَ أوّلَ ما
 * يُسكَتُ.
 */

import {
  ServiceTokenReplayStoreUnavailableError,
  serviceAuthHeaders,
  type ServiceTokenReplayGuard,
} from "@wasla/service-auth";
import { describe, expect, it } from "vitest";

import { createCustomerApp } from "../http/app.js";
import { CUSTOMER_SCOPES } from "../http/service-identity.js";

import { CUSTOMER, OTHER_CUSTOMER, makeContext, seedProfile } from "./helpers.js";
import {
  ALL_CUSTOMER_SCOPES,
  buildSignedCustomerApp,
  createTestKeyRegistry,
  signFor,
  TEST_FORGED_SECRET,
} from "./service-identity-support.js";

/** رمزَا الرفضِ بلا سابقةِ `CUSTOMER_` — مفرداتُ ADR-020 لا مفرداتُ خدمةٍ. */
const UNAUTHENTICATED = "AUTHN_UNAUTHENTICATED";
const FORBIDDEN = "AUTHZ_FORBIDDEN";

const PROFILE = `/customers/${CUSTOMER}/profile`;

/** سندٌ بملفٍّ مزروعٍ: كي يكونَ جوابُ العبورِ 200 لا 404 فيُقاسَ العبورُ. */
async function harnessApp(): Promise<ReturnType<typeof buildSignedCustomerApp>> {
  const ctx = makeContext();
  await seedProfile(ctx);
  return buildSignedCustomerApp({ deps: ctx });
}

/** تطبيقٌ بمخزنِ آثارٍ يُقرِّرُهُ الاختبارُ — لإثباتِ الإغلاقِ عندَ العجزِ. */
async function appWithGuard(replayGuard: ServiceTokenReplayGuard) {
  const ctx = makeContext();
  await seedProfile(ctx);
  const keys = createTestKeyRegistry();
  const app = createCustomerApp({ deps: ctx, serviceIdentity: { keys, replayGuard } });
  return { app, keys };
}

describe("حد العميل — مصفوفة المصادقة الداخلة", () => {
  it("لا هوية → 401 بمغلف عقد العميل (code مسطَّح) ولا يُسمّى سبب الرفض", async () => {
    const { app, rawInject } = await harnessApp();
    const response = await rawInject({ method: "GET", url: PROFILE });

    expect(response.statusCode).toBe(401);
    const body = response.json() as Record<string, unknown>;
    // شكلُ العقدِ المنشورِ لهذا الحدِّ: `code` **مسطَّحٌ** و`trace_id` — لا
    // `error` مُعشَّشٌ كحدِّ السوقِ. ومنادٍ يقرأُ `code` في كلِّ خطأٍ يقرأُ رفضَهُ.
    expect(body.code).toBe(UNAUTHENTICATED);
    expect(body.trace_id).toBeTruthy();
    // السببُ يُسجَّلُ ولا يُعادُ: «رمزٌ منتهٍ» و«توقيعٌ خاطئٌ» فرقٌ يفيدُ المهاجمَ.
    expect(String(body.message)).not.toMatch(/توقيع|منته|kid|صلاحي|جمهور/u);
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
    expect(response.json().code).toBe(UNAUTHENTICATED);
    await app.close();
  });

  it("رمز منتهٍ → 401؛ فالزمن جزء من الرمز لا زينة", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: PROFILE,
      // ساعةٌ قبلَ الآنَ: أطولُ من أيِّ عمرٍ مسموحٍ ومن أيِّ انحرافٍ مقبولٍ.
      headers: signFor("GET", PROFILE, { keys, now: new Date(Date.now() - 3_600_000) }),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("AUTHN_EXPIRED");
    await app.close();
  });

  it("جمهور آخر → 401 بكود الجمهور: خطأ نشرٍ يُشخّص ولا يُخفى", async () => {
    const { app, rawInject, keys } = await harnessApp();
    // رمزٌ صحيحُ التوقيعِ موجَّهٌ إلى حدِّ الطلباتِ لا إلى حدِّ العميلِ.
    const headers = serviceAuthHeaders({
      serviceName: "orders",
      audience: "orders",
      method: "GET",
      path: PROFILE,
      keys,
      now: new Date(),
      scopes: ALL_CUSTOMER_SCOPES,
      onBehalfOfPublicId: CUSTOMER,
    });
    const response = await rawInject({ method: "GET", url: PROFILE, headers });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("AUTHN_AUDIENCE_MISMATCH");
    await app.close();
  });

  it("رمز موقَّع لمسار آخر → 401: الربط بالمسار لا بالترويسة وحدها", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: PROFILE,
      headers: signFor("GET", `/customers/${CUSTOMER}/places`, { keys }),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe(UNAUTHENTICATED);
    await app.close();
  });

  it("هوية صحيحة بالصلاحية والمُنتَفِع → يعبر الطلب إلى المجال (200)", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: PROFILE,
      headers: signFor("GET", PROFILE, { keys, scopes: [CUSTOMER_SCOPES.profileRead] }),
    });

    // الفرضُ **يسمحُ** كما يمنعُ: حدٌّ يرفضُ كلَّ شيءٍ ليسَ مفروضاً بل معطَّلاً.
    expect(response.statusCode).toBe(200);
    expect(response.json().wasla_public_id).toBe(CUSTOMER);
    await app.close();
  });

  it("هوية صحيحة وصلاحية ناقصة → 403 لا 401", async () => {
    const { app, rawInject, keys } = await harnessApp();
    // منادٍ يملكُ قراءةَ الملفِّ ويحاولُ كتابتَهُ: الفرقُ بينَ «مَن أنتَ»
    // و«ماذا تملكُ».
    const response = await rawInject({
      method: "PUT",
      url: PROFILE,
      headers: signFor("PUT", PROFILE, { keys, scopes: [CUSTOMER_SCOPES.profileRead] }),
      payload: { display_name: "نورة" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(FORBIDDEN);
    await app.close();
  });

  it("رمز صحيح بلا مُنتَفِع → 403 عند الوسيط قبل أن يُسأل المخزن", async () => {
    const { app, rawInject, keys } = await harnessApp();
    // `beneficiary: "required"` ليسَ زينةً: رمزُ خدمةٍ بلا إنسانٍ يقفُ خلفَهُ
    // لا يقرأُ مَورِداً مملوكاً، ولو كانَ يحملُ كلَّ الصلاحيّاتِ.
    const response = await rawInject({
      method: "GET",
      url: PROFILE,
      headers: signFor("GET", PROFILE, { keys, onBehalfOfPublicId: null }),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(FORBIDDEN);
    await app.close();
  });

  it("مُنتَفِعٌ يخالف :waslaPublicId → 404 لا 403 ولا 200 (ADR-009)", async () => {
    const { app, rawInject, keys } = await harnessApp();
    // **هذهِ هيَ الدعوى الأصليّةُ لهذا الحدِّ:** الصلاحيّةُ وحدَها لا تقولُ
    // **أيَّ عميلٍ**، فرمزٌ صحيحٌ لعميلٍ آخرَ لا يقرأُ ملفَّ هذا العميلِ.
    const response = await rawInject({
      method: "GET",
      url: PROFILE,
      headers: signFor("GET", PROFILE, { keys, onBehalfOfPublicId: OTHER_CUSTOMER }),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("CUSTOMER_PROFILE_NOT_FOUND");
    // ولا يُفصَحُ أيُّهما لهُ ملفٌّ: لا 403 يُثبِتُ وجودَ المَورِدِ.
    expect(response.statusCode).not.toBe(403);
    await app.close();
  });

  it("الرمز نفسه مرتين → 401 في الثانية (إعادة · ADR-021)", async () => {
    const { app, rawInject, keys } = await harnessApp();
    const headers = signFor("GET", PROFILE, { keys, scopes: [CUSTOMER_SCOPES.profileRead] });
    const first = await rawInject({ method: "GET", url: PROFILE, headers });
    const second = await rawInject({ method: "GET", url: PROFILE, headers });

    // الأوّلُ عبرَ إلى المجالِ (200)، والثاني رُدَّ عندَ الحدِّ.
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(401);
    await app.close();
  });

  it("مخزن الآثار لا يجيب → 503 برمز الحدّ لا برمز تعذّرِ العميل", async () => {
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
    // **والتمييزُ هوَ الدعوى**: عجزُ حاجزِ الإعادةِ لا يُقرأُ «تعذُّرَ خدمةٍ»
    // فيُهمَلُ إلى الأبدِ.
    expect(response.json().code).toBe("SERVICE_AUTH_REPLAY_STORE_UNAVAILABLE");
    await app.close();
  });

  it("مسار مجهول → 401 قبل 404: الحدّ لا يرسم خريطته لمن لا هوية له", async () => {
    const { app, rawInject } = await harnessApp();
    const response = await rawInject({
      method: "GET",
      url: `/customers/${CUSTOMER}/there-is-no-such-route`,
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("/health مفتوحٌ بقصدٍ: يُجيب بلا هوية", async () => {
    const { app, rawInject } = await harnessApp();
    const response = await rawInject({ method: "GET", url: "/health" });

    // الفحصُ الصحّيُّ لا يقرأُ بياناتٍ مجاليّةً، وإغلاقُهُ يُعمي المُوازِنَ.
    expect(response.statusCode).toBe(200);
    expect(response.json().service).toBe("customers-service");
    await app.close();
  });
});
