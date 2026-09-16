/**
 * إثباتُ الفرضِ على **حدِّ السوقِ** (`M1-04` · المراجعةُ 29/N).
 *
 * هذا الملفُّ وحدَه يستعملُ `rawInject` **بلا توقيعٍ**؛ فبقيّةُ اختباراتِ HTTP
 * يوقِّعُ لها السندُ تلقائيّاً، ولو أُثبِتَ الفرضُ بها لأُثبِتَ **السندُ** لا
 * الحدُّ. وهذا هوَ الفرقُ بينَ اختبارٍ يطمئنُ واختبارٍ يشهدُ.
 *
 * المصفوفةُ المطلوبةُ (ADR-020 · ADR-021): لا هويّةَ → 401 · منتحلةٌ → 401 ·
 * منتهيةٌ → 401 · جمهورٌ آخرُ → 401 · مسارٌ أو طريقةٌ أخرى → 401 · رمزٌ معادٌ →
 * 401 · صحيحةٌ بصلاحيّةٍ ناقصةٍ → 403 · مخزنُ الآثارِ صامتٌ → 503 · مسارٌ
 * مجهولٌ → 401 قبلَ 404 · مسارٌ بلا تصنيفٍ → سقوطُ الإقلاعِ.
 *
 * **وثلاثةُ أكوادٍ لا كودانِ** — قِيسَ ولم يُفتَرَض: الوسيطُ المشتركُ يُميِّزُ
 * الانتهاءَ (`AUTHN_EXPIRED`) وعدمَ مطابقةِ الجمهورِ (`AUTHN_AUDIENCE_MISMATCH`)
 * عن الغالبِ (`AUTHN_UNAUTHENTICATED`) بقصدٍ مكتوبٍ في
 * [`errors.ts`](../../../../packages/service-auth/src/errors.ts)، ولا يُنطَقُ
 * بهما إلّا **بعدَ** إثباتِ التوقيعِ. وحدُّ السوقِ **يورِثُ** هذا ولا يُخصِّصُهُ.
 *
 * ويُضافُ ما يخصُّ **هذا** الحدَّ وحدَهُ ثلاثةُ فصولٍ **مقيسةٌ لا موصوفةٌ**:
 * أنَّ رمزَ طلبِ المراجعةِ لا يبتُّ فيها، وأنَّ رمزَ كتابةِ منتجٍ لا يَنشُرُهُ،
 * وأنَّ رمزَ الحجزِ لا يُفرِجُ ولا العكسَ. وكلُّها حدودُ خطرٍ لا تصنيفاتٌ
 * إداريّةٌ (انظرْ ترويسةَ `http/service-identity.ts`).
 *
 * **ولمَ نمطُ الذاكرةِ في كلِّ هذهِ الدعاوى:** المطلوبُ إثباتُ أنَّ القرارَ
 * يُتَّخَذُ **قبلَ** أن يُسألَ المجالُ. فالنداءُ المقبولُ هنا يصلُ إلى المجالِ
 * فيُجابُ `503 MARKETPLACE_UNAVAILABLE` — وهوَ **دليلُ العبورِ**: لا 401 ولا
 * 403. ولو احتاجَتِ الدعوى قاعدةً لصارت بوّابةَ تكاملٍ تُتَخطّى حيثُ لا قاعدةَ،
 * فيصيرُ أهمُّ اختبارٍ أمنيٍّ هوَ أوّلَ ما يُسكَتُ.
 */

import {
  InMemoryServiceTokenReplayGuard,
  ServiceTokenReplayStoreUnavailableError,
  serviceAuthHeaders,
  type ServiceTokenReplayGuard,
} from "@wasla/service-auth";
import { describe, expect, it } from "vitest";

import { createMarketplaceApp, MARKETPLACE_SCOPES } from "../http/app.js";

import {
  ALL_MARKETPLACE_SCOPES,
  buildSignedMarketplaceApp,
  createTestKeyRegistry,
  signFor,
  TEST_FORGED_SECRET,
} from "./service-identity-support.js";

/** رمزَا الرفضِ بلا سابقةِ `MARKETPLACE_` — مفرداتُ ADR-020 لا مفرداتُ خدمةٍ. */
const UNAUTHENTICATED = "AUTHN_UNAUTHENTICATED";
const FORBIDDEN = "AUTHZ_FORBIDDEN";

const STORES = "/stores";
const SLUG = "madinah-electronics";
const PRODUCT = "11111111-1111-4111-8111-111111111111";

let keyCounter = 0;
function idempotency(): Record<string, string> {
  keyCounter += 1;
  return { "idempotency-key": `identity-key-${String(keyCounter).padStart(6, "0")}` };
}

/** جسمُ تسجيلٍ **صحيحٌ** كي يكونَ الرفضُ عن الهويّةِ لا عن التحقّقِ من الجسمِ. */
const registration = {
  owner_public_id: "WS-1000000001",
  title_ar: "متجرُ الإلكترونيّاتِ",
  store_slug: SLUG,
  category_slug: "electronics-phones",
};

function harnessApp() {
  return buildSignedMarketplaceApp({ mode: "memory" });
}

/** تطبيقٌ بمخزنِ آثارٍ يُقرِّرُهُ الاختبارُ — لإثباتِ الإغلاقِ عندَ العجزِ. */
function appWithGuard(replayGuard: ServiceTokenReplayGuard) {
  const keys = createTestKeyRegistry();
  const app = createMarketplaceApp({ mode: "memory", serviceIdentity: { keys, replayGuard } });
  return { app, keys };
}

describe("حد السوق — مصفوفة المصادقة الداخلة", () => {
  it("لا هوية → 401 بمغلف عقد السوق (error.code) ولا يُسمّى سبب الرفض", async () => {
    const { app, rawInject } = harnessApp();
    const response = await rawInject({
      method: "POST",
      url: STORES,
      headers: idempotency(),
      payload: registration,
    });
    expect(response.statusCode).toBe(401);
    const body = response.json() as Record<string, unknown>;
    // شكلُ العقدِ المنشورِ: `error` مُعشَّشٌ و`trace_id` — لا `error_code` مسطَّحٌ
    // كحدِّ التوصيلِ. ومنادٍ يقرأُ `error.code` في كلِّ خطأٍ يقرأُ رفضَهُ أيضاً.
    expect(Object.keys(body).sort()).toEqual(["error", "trace_id"]);
    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe(UNAUTHENTICATED);
    expect(body.trace_id).toBeTruthy();
    expect(body.error_code).toBeUndefined();
    expect(Object.keys(error).sort()).toEqual(["code", "message"]);
    // `details` متروكةٌ: مفاتيحُها وصفُ خطأٍ مجاليٍّ، ورفضُ هويّةٍ ليسَ مجاليّاً.
    expect(error.details).toBeUndefined();
    // السببُ يُسجَّلُ ولا يُعادُ: «رمزٌ منتهٍ» و«توقيعٌ خاطئٌ» فرقٌ يفيدُ المهاجمَ.
    expect(String(error.message)).not.toMatch(/توقيع|منته|kid|صلاحي|جمهور/u);
    await app.close();
  });

  it("هوية منتحلة بسر آخر → 401 لا 403 ولا 500", async () => {
    const { app, rawInject } = harnessApp();
    const response = await rawInject({
      method: "POST",
      url: STORES,
      headers: {
        ...idempotency(),
        ...signFor("POST", STORES, { keys: createTestKeyRegistry(TEST_FORGED_SECRET) }),
      },
      payload: registration,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe(UNAUTHENTICATED);
    await app.close();
  });

  it("رمز منتهٍ → 401؛ فالزمن جزء من الرمز لا زينة", async () => {
    const { app, rawInject, keys } = harnessApp();
    const response = await rawInject({
      method: "POST",
      url: STORES,
      headers: {
        ...idempotency(),
        // ساعةٌ قبلَ الآنَ: أطولُ من أيِّ عمرٍ مسموحٍ ومن أيِّ انحرافٍ مقبولٍ.
        ...signFor("POST", STORES, { keys, now: new Date(Date.now() - 3_600_000) }),
      },
      payload: registration,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTHN_EXPIRED");
    await app.close();
  });

  it("جمهور آخر → 401 بكود الجمهور: خطأ نشرٍ يُشخّص ولا يُخفى", async () => {
    const { app, rawInject, keys } = harnessApp();
    // رمزٌ صحيحُ التوقيعِ موجَّهٌ إلى حدِّ التوصيلِ لا إلى حدِّ السوقِ.
    const headers = serviceAuthHeaders({
      serviceName: "delivery",
      audience: "delivery",
      method: "POST",
      path: STORES,
      keys,
      now: new Date(),
      scopes: ALL_MARKETPLACE_SCOPES,
    });
    const response = await rawInject({
      method: "POST",
      url: STORES,
      headers: { ...idempotency(), ...headers },
      payload: registration,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTHN_AUDIENCE_MISMATCH");
    await app.close();
  });

  it("هوية صحيحة بالصلاحية المطلوبة → يعبر الطلب إلى المجال (503 لا 401 ولا 403)", async () => {
    const { app, rawInject, keys } = harnessApp();
    const response = await rawInject({
      method: "POST",
      url: STORES,
      headers: {
        ...idempotency(),
        ...signFor("POST", STORES, { keys, scopes: [MARKETPLACE_SCOPES.storeWrite] }),
      },
      payload: registration,
    });
    // الفرضُ **يسمحُ** كما يمنعُ: حدٌّ يرفضُ كلَّ شيءٍ ليسَ مفروضاً بل معطَّلاً.
    // و`503` جوابُ نمطِ الذاكرةِ الصادقُ — فالنداءُ بلغَ المجالَ.
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("MARKETPLACE_UNAVAILABLE");
    await app.close();
  });

  it("هوية صحيحة وصلاحية ناقصة → 403 لا 401", async () => {
    const { app, rawInject, keys } = harnessApp();
    // منادٍ يملكُ القراءةَ ويحاولُ التسجيلَ: الفرقُ بينَ «مَن أنتَ» و«ماذا تملكُ».
    const response = await rawInject({
      method: "POST",
      url: STORES,
      headers: {
        ...idempotency(),
        ...signFor("POST", STORES, { keys, scopes: [MARKETPLACE_SCOPES.storeRead] }),
      },
      payload: registration,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe(FORBIDDEN);
    await app.close();
  });

  it("الرمز نفسه مرتين → 401 في الثانية (إعادة · ADR-021)", async () => {
    const { app, rawInject, keys } = harnessApp();
    const headers = signFor("GET", "/categories", {
      keys,
      scopes: [MARKETPLACE_SCOPES.categoryRead],
    });
    const first = await rawInject({ method: "GET", url: "/categories", headers });
    const second = await rawInject({ method: "GET", url: "/categories", headers });
    // الأوّلُ عبرَ إلى المجالِ (503 نمطِ الذاكرةِ)، والثاني رُدَّ عندَ الحدِّ.
    expect(first.statusCode).toBe(503);
    expect(second.statusCode).toBe(401);
    await app.close();
  });

  it("مخزن الآثار لا يجيب → 503 برمز الحدّ لا برمز تعذّرِ السوق", async () => {
    const { app } = appWithGuard({
      remember() {
        throw new ServiceTokenReplayStoreUnavailableError("المخزن صامت.");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: STORES,
      headers: { ...idempotency(), ...signFor("POST", STORES) },
      payload: registration,
    });
    expect(response.statusCode).toBe(503);
    // **والتمييزُ هوَ الدعوى**: نمطُ الذاكرةِ يردُّ 503 أيضاً، فلو تساوى الرمزانِ
    // لصارَ عجزُ حاجزِ الإعادةِ يُقرأُ «قاعدةٌ غائبةٌ» فيُهمَلُ إلى الأبدِ.
    expect(response.json().error.code).toBe("SERVICE_AUTH_REPLAY_STORE_UNAVAILABLE");
    expect(response.json().error.code).not.toBe("MARKETPLACE_UNAVAILABLE");
    await app.close();
  });

  it("مسار مجهول → 401 قبل 404: الحدّ لا يرسم خريطته لمن لا هوية له", async () => {
    const { app, rawInject } = harnessApp();
    const response = await rawInject({ method: "GET", url: "/stores/x/there-is-no-such-route" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe("حد السوق — الهوية تُفحَص قبل مفتاح التفرّد", () => {
  it("نداءٌ بلا هوية وبلا مفتاح تفرّد → 401 لا 400", async () => {
    // **ترتيبُ الخطّافَينِ هوَ الدعوى** لا وجودُهما: عكسُهُ كانَ يُعطي مجهولاً
    // خريطةَ شروطِ الحدِّ نداءً بعدَ نداءٍ («مفتاحُكَ ناقصٌ» ثمَّ «جسمُكَ ناقصٌ»)
    // قبلَ أن يُسألَ عن هويّتِهِ أصلاً.
    const { app, rawInject } = harnessApp();
    const response = await rawInject({ method: "POST", url: STORES, payload: registration });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe(UNAUTHENTICATED);
    expect(response.json().error.code).not.toBe("MARKETPLACE_IDEMPOTENCY_KEY_REQUIRED");
    await app.close();
  });

  it("هويّةٌ صحيحةٌ وبلا مفتاح تفرّد → 400 بخطأ العقد: الحاجزُ لم يُلتَهم", async () => {
    const { app, rawInject, keys } = harnessApp();
    const response = await rawInject({
      method: "POST",
      url: STORES,
      headers: signFor("POST", STORES, { keys, scopes: [MARKETPLACE_SCOPES.storeWrite] }),
      payload: registration,
    });
    // فالترتيبُ قدَّمَ الهويّةَ ولم يُلغِ ما بعدَها.
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("MARKETPLACE_IDEMPOTENCY_KEY_REQUIRED");
    await app.close();
  });
});

describe("حد السوق — فصلُ الخطرِ في الصلاحيّات", () => {
  it("رمزُ طلبِ مراجعةٍ لا يبتُّ فيها → 403", async () => {
    // مَن يقولُ «انظُرْ في متجري» لا يقولُ «وافقْ عليهِ». والبتُّ يُظهِرُ متجراً
    // للناسِ أو يُخفيهِ، وهوَ حدُّ المتجرِ عنِ الإدارةِ.
    const { app, rawInject, keys } = harnessApp();
    const path = `${STORES}/${SLUG}/decisions`;
    const response = await rawInject({
      method: "POST",
      url: path,
      headers: {
        ...idempotency(),
        ...signFor("POST", path, { keys, scopes: [MARKETPLACE_SCOPES.storeReviewRequest] }),
      },
      payload: { decision: "approve", actor_public_id: "WS-9000000001" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe(FORBIDDEN);
    await app.close();
  });

  it("رمزُ كتابةِ منتجٍ لا يَنشُرُهُ ولا يؤرشفُهُ → 403", async () => {
    // الكتابةُ تُنشئُ مسوَّدةً، والنشرُ يُبدِّلُ ما تراهُ خدمةٌ أخرى في الكتالوجِ.
    const { app, rawInject, keys } = harnessApp();
    for (const action of ["publish", "archive"] as const) {
      const path = `/products/${PRODUCT}/${action}`;
      const response = await rawInject({
        method: "POST",
        url: path,
        headers: {
          ...idempotency(),
          ...signFor("POST", path, { keys, scopes: [MARKETPLACE_SCOPES.productWrite] }),
        },
        payload: { actor_public_id: "WS-1000000001" },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe(FORBIDDEN);
    }
    await app.close();
  });

  it("رمزُ الحجزِ لا يُفرِجُ ولا رمزُ الإفراجِ يحجزُ → 403 في الاتجاهَين", async () => {
    // **الفصلُ مقصودٌ** (`ADR-026 §2.3`): الحجزُ يأخذُ مخزوناً والإفراجُ تعويضٌ
    // في مسارِ فشلٍ. فمن يملكُ الإفراجَ وحدَهُ لا يستنزفُ مخزوناً، ومن يملكُ
    // الحجزَ وحدَهُ لا يُفرِجُ عن حجزِ غيرِهِ.
    const { app, rawInject, keys } = harnessApp();
    const cases = [
      { path: `${STORES}/${SLUG}/inventory/reserve`, scope: MARKETPLACE_SCOPES.inventoryRelease },
      { path: `${STORES}/${SLUG}/inventory/release`, scope: MARKETPLACE_SCOPES.inventoryReserve },
    ];
    for (const { path, scope } of cases) {
      const response = await rawInject({
        method: "POST",
        url: path,
        headers: { ...idempotency(), ...signFor("POST", path, { keys, scopes: [scope] }) },
        payload: { reservation_ref: "RES-1", items: [{ product_id: PRODUCT, quantity: 1 }] },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe(FORBIDDEN);
    }
    await app.close();
  });

  it("رمزُ قراءةِ مخزونٍ لا يُعدِّلُهُ → 403؛ والدفترُ فروقٌ موقَّعةٌ لا رقمٌ يُدهَس", async () => {
    const { app, rawInject, keys } = harnessApp();
    const path = `/products/${PRODUCT}/inventory`;
    const response = await rawInject({
      method: "POST",
      url: path,
      headers: {
        ...idempotency(),
        ...signFor("POST", path, { keys, scopes: [MARKETPLACE_SCOPES.inventoryRead] }),
      },
      payload: { quantity_delta: -3, reason_code: "shrinkage", actor_public_id: "WS-1000000001" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe(FORBIDDEN);
    await app.close();
  });

  it("رمزُ قراءةِ متجرٍ لا يُدير طاقمَهُ → 403 في الإضافةِ والحذفِ", async () => {
    const { app, rawInject, keys } = harnessApp();
    const add = `${STORES}/${SLUG}/staff`;
    const remove = `${add}/WS-1000000003`;
    const first = await rawInject({
      method: "POST",
      url: add,
      headers: {
        ...idempotency(),
        ...signFor("POST", add, { keys, scopes: [MARKETPLACE_SCOPES.staffRead] }),
      },
      payload: { member_public_id: "WS-1000000003", role: "staff", added_by_public_id: "WS-1000000001" },
    });
    const second = await rawInject({
      method: "DELETE",
      url: remove,
      headers: {
        ...idempotency(),
        ...signFor("DELETE", remove, { keys, scopes: [MARKETPLACE_SCOPES.staffRead] }),
      },
      payload: { removed_by_public_id: "WS-1000000001" },
    });
    expect(first.statusCode).toBe(403);
    expect(second.statusCode).toBe(403);
    await app.close();
  });
});

describe("حد السوق — حدود الربط والتصنيف", () => {
  it("رمز مسارٍ آخر لا يُقبل ولو حمل كل الصلاحيات", async () => {
    const { app, rawInject, keys } = harnessApp();
    const path = `${STORES}/${SLUG}/review-requests`;
    const response = await rawInject({
      method: "POST",
      url: path,
      headers: {
        ...idempotency(),
        ...signFor("POST", STORES, { keys, scopes: ALL_MARKETPLACE_SCOPES }),
      },
      payload: { requested_by_public_id: "WS-1000000001" },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("رمز طريقةٍ أخرى على المسار نفسه لا يُقبل", async () => {
    const { app, rawInject, keys } = harnessApp();
    const response = await rawInject({
      method: "GET",
      url: STORES,
      headers: signFor("POST", STORES, { keys, scopes: ALL_MARKETPLACE_SCOPES }),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("رمز متجرٍ لا يقرأ متجراً آخر — المُعرّف داخل الربط لا خارجه", async () => {
    // **الفرقُ عن `RISK-0026`:** المُعرِّفُ هنا جزءٌ من **المسارِ** لا من سلسلةِ
    // الاستعلامِ، والربطُ يغطّي المسارَ (ADR-021 §4). وهذا يُقاسُ لا يُدَّعى.
    const { app, rawInject, keys } = harnessApp();
    const headers = signFor("GET", `${STORES}/${SLUG}`, {
      keys,
      scopes: [MARKETPLACE_SCOPES.storeRead],
    });
    const response = await rawInject({ method: "GET", url: `${STORES}/another-store`, headers });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("سلسلةُ الاستعلامِ خارجَ الربطِ — `RISK-0026` مقيسٌ لا مُدَّعى", async () => {
    // هذهِ الدعوى **تُثبِتُ عيباً مفتوحاً لا فضيلةً**: رمزٌ وُقِّعَ لـ`/stores`
    // يُقبَلُ على `/stores?owner_public_id=…` لأنَّ الربطَ لا يشملُ الاستعلامَ
    // (ADR-021 §4). وتوثيقُها اختباراً يجعلُ إغلاقَ الخطرِ غداً **يُكسِرُ** هذا
    // السطرَ فيُقرأَ قصداً — بخلافِ خطرٍ يبقى سطراً في سجلٍّ لا يُقاسُ.
    const { app, rawInject, keys } = harnessApp();
    const headers = signFor("GET", STORES, { keys, scopes: [MARKETPLACE_SCOPES.storeRead] });
    const response = await rawInject({
      method: "GET",
      url: `${STORES}?owner_public_id=WS-1000000001`,
      headers,
    });
    expect(response.statusCode).not.toBe(401);
    await app.close();
  });

  it("`/health` مفتوح بقصد معلن — لا هوية ولا 401", async () => {
    // إغلاقُهُ يوقفُ النشرَ لا المهاجمَ: منسّقُ الحاوياتِ ومسبارُ التسليمِ
    // يقرآنِهِ، وما فيهِ `status` و`mode` لا مُعرِّفَ متجرٍ ولا رصيدَ مخزونٍ.
    const { app, rawInject } = harnessApp();
    const response = await rawInject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "unavailable", mode: "memory" });
    await app.close();
  });

  it("ومسبارُ التسليمِ يُقبَلُ على `/health` موقَّعاً بلا صلاحيّةٍ", async () => {
    // العميلُ الإنتاجيُّ (`http-marketplace-probe.ts`) يوقِّعُ بقائمةٍ فارغةٍ،
    // فلو ردَّ الحدُّ توقيعاً بلا صلاحيّةٍ لسقطت جاهزيّةُ التوصيلِ عندَ النشرِ.
    const { app, rawInject, keys } = harnessApp();
    const response = await rawInject({
      method: "GET",
      url: "/health",
      headers: signFor("GET", "/health", { keys, scopes: [] }),
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});

describe("حد السوق — الحاجزُ نفسُه يعمل", () => {
  it("مسارٌ يُسجَّل بلا تصنيفٍ يُسقِطُ الإقلاعَ — فلا يمرّ مسار جديد صامتاً", async () => {
    const keys = createTestKeyRegistry();
    const app = createMarketplaceApp({
      mode: "memory",
      serviceIdentity: { keys, replayGuard: new InMemoryServiceTokenReplayGuard() },
    });
    // مسارٌ يُضافُ بعدَ التركيبِ بلا `config` — كما قد يُضافُ في مراجعةٍ قادمةٍ.
    expect(() => {
      app.get("/an-unclassified-route", async () => ({ ok: true }));
    }).toThrow();
    await app.close();
  });

  it("والصلاحيّاتُ المُعلَنةُ لمُنادي التوصيلِ موجودةٌ في مفرداتِ الحدِّ", async () => {
    // العملاءُ الثلاثةُ في `services/delivery` يوقِّعونَ بهذهِ الأسماءِ حرفاً منذُ
    // قبلَ الفرضِ؛ فغيابُ أحدِها من المفرداتِ كانَ سيُرَدُّ `403` في الإنتاجِ
    // ويُنسَبُ إلى «الفرضِ» فيُطالَبُ بتعطيلِهِ.
    for (const declared of [
      "marketplace:store:read",
      "marketplace:product:read",
      "marketplace:inventory:reserve",
      "marketplace:inventory:release",
    ]) {
      expect(ALL_MARKETPLACE_SCOPES).toContain(declared);
    }
  });
});

// ── الحاجزُ الثاني: المُستأجِرُ (`M1-05B` الموجةُ 2 · `CLM-0179`) ─────────────
/**
 * **لماذا هنا وحدَهُ:** سندُ اختباراتِ العقدِ صارَ يشتقُّ `obo` من جسمِ الطلبِ
 * (`attachSigningInject`)، فهوَ **يُمرِّرُ الحاجزَ دائماً ويعميها عنهُ**. وهذا
 * قِيلَ صراحةً في ترويسةِ السندِ ولم يُخفَ. فإثباتُ الحاجزِ لا يصحُّ إلّا
 * بتوقيعٍ يكتبُهُ الاختبارُ بيدِهِ — وهوَ ما يلي.
 *
 * **ونمطُ الذاكرةِ يكفي للدعوى الأولى ولا يكفي للثانيةِ:** رفضُ «رمزٍ بلا
 * مُنتَفِعٍ» يقعُ في الوسيطِ **قبلَ** المُعالِجِ، فيُقاسُ `403` هنا. أمّا رفضُ
 * «`obo` لغيرِ عضوٍ» فيقعُ داخلَ المعاملةِ ويحتاجُ قاعدةً — ومكانُهُ
 * `staff.integration.test.ts`، ولا يُدّعى أنَّهُ مُثبَتٌ هنا.
 */
describe("حد السوق — الرمزُ بلا مُنتَفِعٍ لا يمسُّ مُستأجِراً", () => {
  /**
   * المربوطةُ: طريقةٌ · مسارٌ · صلاحيّةٌ · جسمٌ صالحٌ. خمسٌ من الموجةِ الثانيةِ
   * (`CLM-0179`) وثلاثٌ من الموجةِ الرابعةِ (`CLM-0185`) في دورةِ حياةِ
   * المنتجِ. و`mismatchCode` يميّزُ رمزَ الرفضِ عندَ تنافُرِ `obo` معَ فاعلِ
   * الجسمِ: مساراتُ المتجرِ تُجيبُ `STORE_NOT_FOUND` ومساراتُ المنتجِ
   * **`PRODUCT_NOT_FOUND`** — لأنَّ المَورِدَ المُعنوَنَ في المسارِ هوَ الذي
   * يُسمّى غائباً، فلا يصيرُ الحدُّ عرّافاً في أيٍّ من البُعدَينِ.
   */
  const BOUND = [
    {
      name: "POST /stores/:slug/review-requests",
      method: "POST" as const,
      url: `${STORES}/${SLUG}/review-requests`,
      scope: MARKETPLACE_SCOPES.storeReviewRequest,
      payload: { requested_by_public_id: "WS-1000000001" },
      bodyActor: "WS-1000000001",
      mismatchCode: "STORE_NOT_FOUND",
    },
    {
      name: "GET /stores/:slug/staff",
      method: "GET" as const,
      url: `${STORES}/${SLUG}/staff`,
      scope: MARKETPLACE_SCOPES.staffRead,
      payload: undefined,
      bodyActor: undefined,
    },
    {
      name: "POST /stores/:slug/staff",
      method: "POST" as const,
      url: `${STORES}/${SLUG}/staff`,
      scope: MARKETPLACE_SCOPES.staffWrite,
      payload: {
        member_public_id: "WS-1000000003",
        role: "staff",
        added_by_public_id: "WS-1000000001",
      },
      bodyActor: "WS-1000000001",
      mismatchCode: "STORE_NOT_FOUND",
    },
    {
      name: "DELETE /stores/:slug/staff/:memberPublicId",
      method: "DELETE" as const,
      url: `${STORES}/${SLUG}/staff/WS-1000000003`,
      scope: MARKETPLACE_SCOPES.staffWrite,
      payload: { removed_by_public_id: "WS-1000000001" },
      bodyActor: "WS-1000000001",
      mismatchCode: "STORE_NOT_FOUND",
    },
    {
      name: "POST /stores/:slug/products",
      method: "POST" as const,
      url: `${STORES}/${SLUG}/products`,
      scope: MARKETPLACE_SCOPES.productWrite,
      payload: {
        sku: "SKU-TENANT-001",
        title_ar: "هاتفٌ",
        category_slug: "electronics-phones",
        price_minor_units: 249900,
        currency_code: "SAR",
        created_by_public_id: "WS-1000000001",
      },
      bodyActor: "WS-1000000001",
      mismatchCode: "STORE_NOT_FOUND",
    },
    {
      name: "POST /products/:productId/publish",
      method: "POST" as const,
      url: `/products/${PRODUCT}/publish`,
      scope: MARKETPLACE_SCOPES.productLifecycle,
      payload: { actor_public_id: "WS-1000000001" },
      bodyActor: "WS-1000000001",
      mismatchCode: "PRODUCT_NOT_FOUND",
    },
    {
      name: "POST /products/:productId/archive",
      method: "POST" as const,
      url: `/products/${PRODUCT}/archive`,
      scope: MARKETPLACE_SCOPES.productLifecycle,
      payload: { actor_public_id: "WS-1000000001" },
      bodyActor: "WS-1000000001",
      mismatchCode: "PRODUCT_NOT_FOUND",
    },
    {
      name: "POST /products/:productId/inventory",
      method: "POST" as const,
      url: `/products/${PRODUCT}/inventory`,
      scope: MARKETPLACE_SCOPES.inventoryAdjust,
      payload: {
        quantity_delta: 5,
        reason_code: "restock",
        actor_public_id: "WS-1000000001",
      },
      bodyActor: "WS-1000000001",
      mismatchCode: "PRODUCT_NOT_FOUND",
    },
  ];

  for (const route of BOUND) {
    it(`${route.name} — رمزٌ كاملُ الصلاحيّاتِ بلا \`obo\` يُرَدُّ 403 لا 503`, async () => {
      // **الفرقُ بينَ 403 و503 هوَ كلُّ الدعوى**: 503 يعني أنَّ النداءَ عبرَ
      // الحاجزَ وبلغَ المجالَ فوجدَهُ بلا قاعدةٍ، و403 يعني أنَّ الحاجزَ ردَّهُ
      // **قبلَ** أن يُمَسَّ المتجرُ. ولو كُتِبَتْ `not.toBe(201)` لمرَّتْ
      // بإزالةِ `beneficiary: "required"` كاملةً.
      const { app, rawInject, keys } = harnessApp();
      const response = await rawInject({
        method: route.method,
        url: route.url,
        headers: {
          ...idempotency(),
          ...signFor(route.method, route.url, { keys, scopes: ALL_MARKETPLACE_SCOPES }),
        },
        ...(route.payload === undefined ? {} : { payload: route.payload }),
      });
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json().error.code).toBe(FORBIDDEN);
      await app.close();
    });

    it(`${route.name} — وبصلاحيّتِهِ وحدَها معَ \`obo\` يعبُرُ الحاجزَ إلى المجالِ`, async () => {
      // الوجهُ الموجبُ: بلا هذهِ الدعوى يُقرأُ `403` أعلاهُ «رفضاً دائماً»
      // ويُرضي حارساً مكسوراً يردُّ كلَّ شيءٍ. والعبورُ يُقاسُ بـ`503` من
      // المجالِ بلا قاعدةٍ — وهوَ **دليلُ عبورٍ** لا نجاحُ عمليّةٍ.
      const { app, rawInject, keys } = harnessApp();
      const response = await rawInject({
        method: route.method,
        url: route.url,
        headers: {
          ...idempotency(),
          ...signFor(route.method, route.url, {
            keys,
            scopes: [route.scope],
            onBehalfOfPublicId: "WS-1000000001",
          }),
        },
        ...(route.payload === undefined ? {} : { payload: route.payload }),
      });
      expect(response.statusCode, response.body).toBe(503);
      expect(response.json().error.code).toBe("MARKETPLACE_UNAVAILABLE");
      await app.close();
    });
  }

  for (const route of BOUND.filter((r) => r.bodyActor !== undefined)) {
    it(`${route.name} — \`obo\` يخالفُ فاعلَ الجسمِ يُرَدُّ 404 لا يُنفَّذُ باسمِ الجسمِ`, async () => {
      // **النائبُ المُرتبِكُ**: بوّابةٌ تُوقِّعُ لإنسانٍ ثمَّ تُمرِّرُ جسماً
      // يُسمّي إنساناً آخرَ. ويُقاسُ في نمطِ الذاكرةِ لأنَّ `tenantActor`
      // يسبقُ سؤالَ المجالِ — فالفرقُ عن `503` هوَ نفسُهُ الدليلُ.
      const { app, rawInject, keys } = harnessApp();
      const response = await rawInject({
        method: route.method,
        url: route.url,
        headers: {
          ...idempotency(),
          ...signFor(route.method, route.url, {
            keys,
            scopes: [route.scope],
            onBehalfOfPublicId: "WS-1000000009",
          }),
        },
        payload: route.payload,
      });
      expect(response.statusCode, response.body).toBe(404);
      // مساراتُ المنتجِ (الموجةُ 4) تُسمّي **المنتجَ** غائباً لا المتجرَ —
      // لأنَّ مَورِدَ المسارِ هوَ الذي يُعلَنُ، فلا يُعرَفَ أيُّهما انتُقِلَ إليه.
      expect(response.json().error.code).toBe(route.mismatchCode);
      await app.close();
    });
  }
});

/**
 * **وما لم يُربَطْ يُقاسُ أيضاً** — وإلّا صارَ الحارسُ يُثبِتُ الشدَّةَ ولا
 * يُثبِتُ **دقّتَها**. فربطٌ زائدٌ على مسارٍ يُنادِيهِ التوصيلُ كخدمةٍ يُسقِطُ
 * مسارَ طلبٍ حقيقيٍّ في الإنتاجِ، ويُنسَبُ العطبُ إلى «الفرضِ» فيُطالَبُ
 * بتعطيلِهِ — وهوَ أسوأُ ما قد ينتجَ عن دفعةٍ أمنيّةٍ.
 */
describe("حد السوق — لا ربطَ زائداً على ما لا مُنتَفِعَ لهُ", () => {
  const UNBOUND = [
    {
      name: "GET /stores/:slug",
      method: "GET" as const,
      url: `${STORES}/${SLUG}`,
      scope: MARKETPLACE_SCOPES.storeRead,
      payload: undefined,
    },
    {
      name: "GET /stores/:slug/reviews",
      method: "GET" as const,
      url: `${STORES}/${SLUG}/reviews`,
      scope: MARKETPLACE_SCOPES.storeReviewRead,
      payload: undefined,
    },
    {
      name: "GET /stores/:slug/products",
      method: "GET" as const,
      url: `${STORES}/${SLUG}/products`,
      scope: MARKETPLACE_SCOPES.productRead,
      payload: undefined,
    },
    {
      name: "POST /stores/:slug/decisions",
      method: "POST" as const,
      url: `${STORES}/${SLUG}/decisions`,
      scope: MARKETPLACE_SCOPES.storeReviewDecide,
      payload: {
        decision: "approved",
        actor_type: "moderator",
        actor_public_id: "WS-1000000002",
      },
    },
    {
      name: "POST /stores/:slug/inventory/reserve",
      method: "POST" as const,
      url: `${STORES}/${SLUG}/inventory/reserve`,
      scope: MARKETPLACE_SCOPES.inventoryReserve,
      payload: {
        order_public_id: "ORDER-TENANT-001",
        items: [{ product_id: PRODUCT, quantity: 1 }],
        idempotency_key: "reserve-tenant-001",
      },
    },
    {
      name: "POST /stores/:slug/inventory/release",
      method: "POST" as const,
      url: `${STORES}/${SLUG}/inventory/release`,
      scope: MARKETPLACE_SCOPES.inventoryRelease,
      payload: {
        order_public_id: "ORDER-TENANT-001",
        items: [{ product_id: PRODUCT, quantity: 1 }],
        idempotency_key: "release-tenant-001",
      },
    },
  ];

  for (const route of UNBOUND) {
    it(`${route.name} — يعبُرُ بلا \`obo\`: مُنادِيهِ خدمةٌ لا إنسانٌ`, async () => {
      const { app, rawInject, keys } = harnessApp();
      const response = await rawInject({
        method: route.method,
        url: route.url,
        headers: {
          ...idempotency(),
          ...signFor(route.method, route.url, { keys, scopes: [route.scope] }),
        },
        ...(route.payload === undefined ? {} : { payload: route.payload }),
      });
      expect(response.statusCode, response.body).not.toBe(403);
      expect(response.statusCode, response.body).toBe(503);
      await app.close();
    });
  }
});
