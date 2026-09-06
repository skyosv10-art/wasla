/**
 * إثباتُ الوسيطِ المركزيِّ لفرضِ هويّةِ الخدمةِ على Fastify (عنصرُ العمل **M1-04**).
 *
 * ── لماذا يوجدُ هذا الملفُّ وعندَ المطابقةِ اختبارٌ يشبهُه ─────────────────
 * `services/matching/src/__tests__/http-service-identity.test.ts` يُثبِتُ
 * **حدَّ المطابقةِ**: مسارَاتُه وصلاحيّاتُه ومغلَّفُ خطئِه. وهو يمرُّ بالوسيطِ
 * عَرَضاً لا قصداً، فلا يستطيعُ أن يُثبِتَ الدعوى التي وُجِدَ الوسيطُ لها:
 * **أنَّ الفرضَ نفسَه يصحُّ على حدٍّ لم يُكتَبْ بعدُ**. فهنا حدَّانِ صناعيّانِ
 * لا خدمةَ لهما — `alpha` و`beta` — يُبنَيانِ من الوسيطِ نفسِه.
 *
 * والدعوى المركزيّةُ التي **لا يقدرُ عليها اختبارُ حدٍّ واحدٍ**:
 * **رمزٌ سليمٌ تماماً موقَّعٌ بالمفتاحِ الصحيحِ لجمهورِ `alpha` يُرَدُّ `401` عندَ
 * `beta`**. فلو كان للجمهورِ قيمةٌ افتراضيّةٌ في الوسيطِ لصارت كلُّ خدمتَينِ
 * تقبلانِ رمزَ بعضِهما، وهي ثغرةٌ **لا يراها** اختبارُ خدمةٍ واحدةٍ إطلاقاً.
 *
 * ── ما لا يُدَّعى هنا ─────────────────────────────────────────────────────
 * - **ليس إثباتاً لأيِّ حدٍّ حقيقيٍّ.** لا خدمةَ في المستودعِ اسمُها `alpha`؛
 *   تغطيةُ الحدودِ الفعليّةِ خريطتُها `docs/07-security/SERVICE_AUTH_ENFORCEMENT.md`
 *   وحارسُها `scripts/checks/validate-service-auth-coverage.sh`.
 * - **ليس إثباتاً للتوقيعِ ولا للطزاجةِ:** تلك اختباراتُ `token.ts` و`replay.ts`
 *   و`enforce.ts` عندَ أنفسِها. المقيسُ هنا **الربطُ** وحدَه.
 * - **`InMemoryServiceTokenReplayGuard` لا يكفي لعمليّاتٍ متعدِّدةٍ** — مقولٌ في
 *   `replay.ts` ومُسجَّلٌ خطراً `RISK-0015`، ولا يُغيِّرُه نجاحُ هذا الملفِّ.
 */

import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import {
  registerServiceIdentityOnFastify,
  type ServiceIdentityDenial,
} from "../fastify.js";
import { ServiceAuthKeyRegistry } from "../keys.js";
import { InMemoryServiceTokenReplayGuard } from "../replay.js";
import { SERVICE_AUTH_HEADER } from "../http.js";
import { createServiceRequestSigner } from "../outbound.js";

const KID = "k-test-0001";
const SECRET = "test-secret-0123456789abcdefghijkl";
const SCOPE = "alpha:thing:read";

function registry(secret = SECRET): ServiceAuthKeyRegistry {
  return new ServiceAuthKeyRegistry({
    keys: [{ kid: KID, secret, status: "active" }],
    activeKid: KID,
  });
}

/** مغلَّفُ خطأٍ صناعيٌّ **مميَّزٌ بقصدٍ**: يُثبِتُ أنَّ الوسيطَ يستعملُ مغلَّفَ الحدِّ لا مغلَّفاً من عندِه. */
function denialBody(denial: ServiceIdentityDenial, traceId: string) {
  return { envelope: "boundary-owned", code: denial.code, trace: traceId };
}

interface BoundaryOptions {
  readonly audience: string;
  readonly keys?: ServiceAuthKeyRegistry;
  readonly classifyThing?: boolean;
}

/** حدٌّ صناعيٌّ: `/health` مفتوحٌ، و`/thing` بصلاحيّةٍ مُعلَنةٍ. */
function boundary(options: BoundaryOptions): FastifyInstance {
  const app = Fastify({ logger: false, requestIdHeader: "x-request-id" });
  registerServiceIdentityOnFastify(app, {
    audience: options.audience,
    keys: options.keys ?? registry(),
    replayGuard: new InMemoryServiceTokenReplayGuard(),
    denialBody,
    boundaryLabel: `حد ${options.audience}`,
  });
  app.get("/health", { config: { serviceIdentity: "open" } }, async () => ({ ok: true }));
  if (options.classifyThing !== false) {
    app.get(
      "/thing",
      { config: { serviceIdentity: { scopes: [SCOPE] } } },
      async (request) => ({ caller: request.serviceCaller?.serviceName ?? null }),
    );
  } else {
    // مسارٌ بلا تصنيفٍ بقصدٍ: يُثبِتُ حاجزَ الإقلاعِ.
    app.get("/thing", async () => ({ ok: true }));
  }
  return app;
}

function headersFor(
  audience: string,
  scopes: readonly string[],
  keys = registry(),
): Record<string, string> {
  const sign = createServiceRequestSigner({
    serviceName: "caller",
    audience,
    keys,
    scopes,
  });
  return sign("GET", "/thing");
}

describe("الوسيطُ المركزيُّ — المصفوفةُ الأربعُ على حدٍّ لا خدمةَ له", () => {
  it("لا هويّةَ ⇒ 401 بمغلَّفِ الحدِّ لا بمغلَّفِ الوسيطِ", async () => {
    const app = boundary({ audience: "alpha" });
    const response = await app.inject({ method: "GET", url: "/thing" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ envelope: "boundary-owned" });
    await app.close();
  });

  it("هويّةٌ منتحلةٌ بسرٍّ آخرَ ⇒ 401: التوقيعُ يُفحَصُ لا وجودُ الترويسةِ", async () => {
    const app = boundary({ audience: "alpha" });
    const forged = headersFor("alpha", [SCOPE], registry("forged-secret-0123456789abcdefghijkl"));
    const response = await app.inject({ method: "GET", url: "/thing", headers: forged });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("هويّةٌ صحيحةٌ ⇒ يمرُّ الطلبُ ويُملأُ `serviceCaller`", async () => {
    const app = boundary({ audience: "alpha" });
    const response = await app.inject({
      method: "GET",
      url: "/thing",
      headers: headersFor("alpha", [SCOPE]),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ caller: "caller" });
    await app.close();
  });

  it("هويّةٌ صحيحةٌ وصلاحيّةٌ ناقصةٌ ⇒ 403 لا 401: التوثيقُ ليس التخويلَ", async () => {
    const app = boundary({ audience: "alpha" });
    const response = await app.inject({
      method: "GET",
      url: "/thing",
      headers: headersFor("alpha", ["alpha:other:read"]),
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe("الوسيطُ المركزيُّ — الجمهورُ يفصلُ الحدودَ", () => {
  it("رمزُ `alpha` السليمُ بمفتاحِه الصحيحِ ⇒ 401 عندَ `beta`", async () => {
    const alphaToken = headersFor("alpha", [SCOPE]);

    // يُقبَل عندَ صاحبِه — كي لا يكون الرفضُ عندَ `beta` عيباً في الرمزِ.
    const alpha = boundary({ audience: "alpha" });
    expect(
      (await alpha.inject({ method: "GET", url: "/thing", headers: alphaToken })).statusCode,
    ).toBe(200);
    await alpha.close();

    // والمفتاحُ نفسُه والسرُّ نفسُه: الفارقُ الجمهورُ وحدَه.
    const beta = boundary({ audience: "beta" });
    const response = await beta.inject({ method: "GET", url: "/thing", headers: alphaToken });
    expect(response.statusCode).toBe(401);
    await beta.close();
  });
});

describe("الوسيطُ المركزيُّ — حاجزُ التصنيفِ والافتراضُ المغلقُ", () => {
  it("`/health` مفتوحٌ بإعلانٍ ⇒ 200 بلا هويّةٍ: الإنفاذُ لا يُعمي المراقبةَ", async () => {
    const app = boundary({ audience: "alpha" });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("مسارٌ غيرُ معروفٍ ⇒ 401 قبلَ 404: لا استكشافَ مسارَاتٍ بلا هويّةٍ", async () => {
    const app = boundary({ audience: "alpha" });
    const response = await app.inject({ method: "GET", url: "/does-not-exist" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("مسارٌ يُسجَّلُ بلا تصنيفٍ ⇒ يسقطُ التطبيقُ عندَ التسجيلِ لا عندَ أوّلِ طلبٍ", () => {
    expect(() => boundary({ audience: "alpha", classifyThing: false })).toThrow(
      /بلا تصنيف هوية خدمة/,
    );
  });

  it("سلسلةُ الاستعلامِ ليست من الربطِ — دَينٌ مُعلَنٌ في ADR-021 §4", async () => {
    const app = boundary({ audience: "alpha" });
    const response = await app.inject({
      method: "GET",
      url: "/thing?anything=here",
      headers: headersFor("alpha", [SCOPE]),
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("الرمزُ يُحرَقُ: النداءُ الثاني بالرمزِ نفسِه ⇒ 401 (ADR-021)", async () => {
    const app = boundary({ audience: "alpha" });
    const headers = headersFor("alpha", [SCOPE]);
    expect((await app.inject({ method: "GET", url: "/thing", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/thing", headers })).statusCode).toBe(401);
    await app.close();
  });

  it("الترويسةُ المفروضةُ هي `SERVICE_AUTH_HEADER` لا اسماً مكتوباً بيدٍ", () => {
    const headers = headersFor("alpha", [SCOPE]);
    expect(Object.keys(headers)).toContain(SERVICE_AUTH_HEADER);
  });
});
