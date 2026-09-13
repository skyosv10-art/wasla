/**
 * إثباتُ الفرضِ على **حدِّ المفاوضاتِ** (`M1-04` · المراجعةُ 26/N — الحدُّ
 * السابعُ).
 *
 * هذا الملفُّ وحدَهُ يستعملُ `rawInject` **بلا توقيعٍ**؛ فبقيّةُ اختباراتِ HTTP
 * يوقِّعُ لها السندُ تلقائيّاً، ولو أُثبِتَ الفرضُ بها لأُثبِتَ السندُ لا الحدُّ.
 *
 * المصفوفةُ المطلوبةُ: لا هويّةَ → 401 · منتحلةٌ → 401 · صحيحةٌ → مقبولٌ ·
 * صحيحةٌ بصلاحيّةٍ ناقصةٍ → 403. ويُضافُ ما يخصُّ **هذا** الحدَّ: رمزٌ معادٌ →
 * 401 · مخزنٌ لا يجيبُ → 503 · رمزُ مسارٍ آخرَ لا يُقبَلُ · `/health` مفتوحٌ
 * بقصدٍ · مسارٌ بلا تصنيفٍ يُسقِطُ الإقلاعَ · **ورمزُ الاقتراحِ لا يَقبَلُ
 * دوراً**، و**رمزُ بوتٍ لا يُشغِّلُ النبضةَ**.
 *
 * وآخِرُ بندَينِ هما جوهرُ سببِ وجودِ هذا الحدِّ: القبولُ يُنشئُ اتّفاقاً
 * ويُحرِّكُ سعراً، والنبضةُ تكتبُ على خيوطِ كلِّ المستعملينَ — فلو كانا في
 * صلاحيّةِ «كتابةٍ» واحدةٍ لكانَ رمزٌ طُلِبَ لاقتراحِ دورٍ كافياً لإنهاءِ
 * التفاوضِ أو لإغلاقِ خيوطِ الناسِ جميعاً.
 */

import { AuthErrorCode } from "@wasla/auth-sdk";
import {
  InMemoryServiceTokenReplayGuard,
  ServiceTokenReplayStoreUnavailableError,
  type ServiceTokenReplayGuard,
} from "@wasla/service-auth";
import { describe, expect, it } from "vitest";

import { createNegotiationApp } from "../http/app.js";
import { NEGOTIATIONS_SCOPES } from "../http/service-identity.js";
import { createDirectNegotiationRunner } from "../runner.js";

import { ORDER_ID, key, makeDeps, openInput } from "./helpers.js";
import {
  ALL_NEGOTIATIONS_SCOPES,
  buildSignedNegotiationApp,
  createTestKeyRegistry,
  signFor,
  TEST_FORGED_SECRET,
} from "./service-identity-support.js";

const THREADS = "/negotiations";
const S = NEGOTIATIONS_SCOPES;
/**
 * سردٌ **بمُرشِّحٍ**: `listNegotiations` يرفعُ `NEGOTIATION_FILTER_REQUIRED` على
 * السردِ المطلقِ، فلو وُقِّعَ على `/negotiations` عارياً لأتى `400` مجاليٌّ
 * وأخفى ما نقيسُهُ — وهوَ أنَّ الهويّةَ الصحيحةَ **تَمُرُّ** إلى العقدِ.
 */
const THREADS_LIST = `${THREADS}?orderPublicId=${ORDER_ID}`;

/** ترويساتُ كتابةٍ مجاليّةٌ — لا هويّةٌ: كي يكونَ الرفضُ عن الهويّةِ لا عن الشكلِ. */
function writeOnly(label = "k"): Record<string, string> {
  return { "idempotency-key": key(label), "content-type": "application/json" };
}

function signedApp() {
  return buildSignedNegotiationApp({ runner: createDirectNegotiationRunner(makeDeps()) });
}

function appWithGuard(replayGuard: ServiceTokenReplayGuard) {
  const keys = createTestKeyRegistry();
  const app = createNegotiationApp({
    runner: createDirectNegotiationRunner(makeDeps()),
    serviceIdentity: { keys, replayGuard },
  });
  return { app, keys };
}

/** يفتحُ خيطاً عبرَ التطبيقِ الموقَّعِ ويُعيدُ مُعرّفَهُ. */
async function openThreadOverHttp(app: { inject: Function }): Promise<string> {
  const response = await (app.inject as (o: unknown) => Promise<{ statusCode: number; json: () => { id: string } }>)({
    method: "POST",
    url: THREADS,
    headers: writeOnly("open"),
    payload: openInput(),
  });
  expect(response.statusCode).toBe(201);
  return response.json().id;
}

describe("حد المفاوضات — المصفوفة الأربع", () => {
  it("لا هوية → 401 بمغلف العقد ولا يُسمّى سبب الرفض في الرد", async () => {
    const { app, rawInject } = signedApp();
    const response = await rawInject({ method: "GET", url: THREADS });
    expect(response.statusCode).toBe(401);
    const body = response.json() as {
      error: { code: string; message: string };
      trace_id: string;
    };
    expect(body.error.code).toBe(AuthErrorCode.UNAUTHENTICATED);
    expect(body.trace_id).toBeTruthy();
    // السببُ يُسجَّلُ ولا يُعادُ: «رمزٌ منتهٍ» و«توقيعٌ خاطئٌ» فرقٌ يفيدُ المهاجمَ وحدَهُ.
    expect(body.error.message).not.toMatch(/توقيع|منته|kid|صلاحي/u);
    await app.close();
  });

  it("هوية منتحلة → 401 لا 403 ولا 500", async () => {
    const { app, rawInject } = signedApp();
    const response = await rawInject({
      method: "GET",
      url: THREADS,
      headers: signFor("GET", THREADS, { keys: createTestKeyRegistry(TEST_FORGED_SECRET) }),
    });
    expect(response.statusCode).toBe(401);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      AuthErrorCode.UNAUTHENTICATED,
    );
    await app.close();
  });

  it("هوية صحيحة بالصلاحية المطلوبة → يمر الطلب إلى العقد", async () => {
    const { app, rawInject, keys } = signedApp();
    const response = await rawInject({
      method: "GET",
      url: THREADS_LIST,
      headers: signFor("GET", THREADS_LIST, {
        keys,
        serviceName: "customer-bot",
        scopes: [S.threadRead],
      }),
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("هوية صحيحة وصلاحية ناقصة → 403 لا 401", async () => {
    const { app, rawInject, keys } = signedApp();
    // مُنادٍ يملكُ قراءةَ الخيوطِ ويحاولُ فتحَ خيطٍ: الفرقُ بينَ «مَن أنتَ» و«ماذا تملكُ».
    const response = await rawInject({
      method: "POST",
      url: THREADS,
      headers: {
        ...signFor("POST", THREADS, { keys, serviceName: "driver-bot", scopes: [S.threadRead] }),
        ...writeOnly("scope"),
      },
      payload: openInput(),
    });
    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      AuthErrorCode.FORBIDDEN,
    );
    await app.close();
  });

  it("الرمز نفسه مرتين → 401 في الثانية", async () => {
    const { app, rawInject, keys } = signedApp();
    const headers = signFor("GET", THREADS_LIST, { keys, scopes: [S.threadRead] });
    const first = await rawInject({ method: "GET", url: THREADS_LIST, headers });
    const second = await rawInject({ method: "GET", url: THREADS_LIST, headers });
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
      url: THREADS,
      headers: signFor("GET", THREADS, { scopes: [S.threadRead] }),
    });
    expect(response.statusCode).toBe(503);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      "SERVICE_AUTH_REPLAY_STORE_UNAVAILABLE",
    );
    await app.close();
  });
});

describe("حد المفاوضات — الكتابة الخطيرة", () => {
  it("رمز اقتراح دورٍ لا يَقبَل دوراً → 403 قبل أن يُسأل المجال", async () => {
    // القبولُ يُنشئُ اتّفاقاً ويُحرِّكُ سعراً؛ فلو كانَ في `round:write` لكانَ
    // رمزٌ طُلِبَ لاقتراحِ عرضٍ كافياً لإنهاءِ التفاوضِ على العرضِ الآخرِ.
    const { app, rawInject, keys } = signedApp();
    const threadId = await openThreadOverHttp(app);
    const path = `${THREADS}/${threadId}/rounds/1/accept`;
    const response = await rawInject({
      method: "POST",
      url: path,
      headers: {
        ...signFor("POST", path, {
          keys,
          scopes: [S.threadRead, S.threadWrite, S.roundRead, S.roundWrite],
        }),
        ...writeOnly("accept"),
      },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      AuthErrorCode.FORBIDDEN,
    );
    await app.close();
  });

  it("رمزٌ بكل صلاحيات الخيوط والأدوار لا يُشغّل النبضة → 403", async () => {
    // النبضةُ كتابةٌ جماعيّةٌ على خيوطِ كلِّ المستعملينَ، ومُنادِيها مُجدولٌ
    // تشغيليٌّ لا بوتُ مستعملٍ — فصلاحيّتُها مستقلّةٌ عن كلِّ ما سبقَ.
    const { app, rawInject, keys } = signedApp();
    const path = `${THREADS}/tick`;
    const response = await rawInject({
      method: "POST",
      url: path,
      headers: {
        ...signFor("POST", path, {
          keys,
          scopes: [
            S.threadRead,
            S.threadWrite,
            S.roundRead,
            S.roundWrite,
            S.roundDecide,
            S.messageRead,
            S.messageWrite,
            S.agreementRead,
          ],
        }),
        ...writeOnly("tick"),
      },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("فتحُ خيطٍ بلا هوية خدمة أصلاً → 401 لا 4xx مجالي", async () => {
    const { app, rawInject } = signedApp();
    const response = await rawInject({
      method: "POST",
      url: THREADS,
      headers: writeOnly("nohdr"),
      payload: openInput(),
    });
    expect(response.statusCode).toBe(401);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      AuthErrorCode.UNAUTHENTICATED,
    );
    await app.close();
  });

  it("رمز خيطٍ لا يقرأ خيطاً آخر — المُعرّف داخل الربط", async () => {
    // المُعرِّفُ جزءٌ من **المسارِ** لا من سلسلةِ الاستفسارِ، والربطُ يغطّي
    // المسارَ (ADR-021 §4) — فرمزٌ وُقِّعَ لخيطٍ لا يصلحُ لغيرِهِ. وهذا يُقاسُ لا يُدَّعى.
    const { app, rawInject, keys } = signedApp();
    const mine = await openThreadOverHttp(app);
    const response = await rawInject({
      method: "GET",
      url: `${THREADS}/11111111-2222-4333-8444-555555555555`,
      headers: signFor("GET", `${THREADS}/${mine}`, { keys, scopes: [S.threadRead] }),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe("حد المفاوضات — حدود الربط والتصنيف", () => {
  it("رمز مسار آخر لا يُقبل على هذا المسار", async () => {
    const { app, rawInject, keys } = signedApp();
    const response = await rawInject({
      method: "GET",
      url: THREADS,
      headers: signFor("GET", `${THREADS}/tick`, { keys, scopes: ALL_NEGOTIATIONS_SCOPES }),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("`/health` مفتوح بقصد ومعلن — لا هوية ولا 401", async () => {
    const { app, rawInject } = signedApp();
    const response = await rawInject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("مسار غير معروف يُرَدّ 401 قبل 404 — لا استكشاف مسارات بلا هوية", async () => {
    const { app, rawInject } = signedApp();
    const response = await rawInject({ method: "GET", url: "/negotiations-secret/internal" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("مسار يُسجّل بلا تصنيف يُسقط التطبيق عند الإقلاع لا عند أول طلب", () => {
    const app = createNegotiationApp({
      runner: createDirectNegotiationRunner(makeDeps()),
      serviceIdentity: {
        keys: createTestKeyRegistry(),
        replayGuard: new InMemoryServiceTokenReplayGuard(),
      },
    });
    expect(() => {
      app.get("/negotiations/forgotten", async () => ({ ok: true }));
    }).toThrow(/بلا تصنيف هوية خدمة/u);
  });
});
