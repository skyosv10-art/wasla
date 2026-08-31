/**
 * اختبارٌ من طرفٍ إلى طرفٍ عبرَ **مقبسٍ حقيقيٍّ** (M1-03 · DoD: «رفضُ نداءٍ
 * غيرِ موثَّقٍ مُثبَتٌ e2e»).
 *
 * لماذا مقبسٌ حقيقيٌّ ولا خريطةُ ترويساتٍ مُصطنعةٌ؟ لأنّ الحارسَ الذي يُختبَر
 * باستدعاءِ دالّتِه مباشرةً يُثبِت أنّ **الدالّةَ** تعمل، لا أنّ **الحدَّ**
 * محميٌّ. وطبقةُ HTTP هي حيث تنشأ الفروقُ الفعليّةُ: أسماءُ ترويساتٍ تُطبَّع،
 * وترويساتٌ تُكرَّر، ومسارٌ يحمل سلسلةَ استعلامٍ. فيُشغَّل خادمٌ من `node:http`
 * على منفذٍ عشوائيٍّ، ويُنادى بـ`fetch` حقيقيٍّ.
 *
 * وحدُّ هذا الاختبارِ يُقال صريحاً: الخادمُ هنا **مثالُ تركيبٍ** لا الوسيطُ
 * المركزيُّ. تركيبُ الحارسِ على الخدماتِ الأربعَ عشرةَ عنصرُ `M1-04`.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authenticateServiceRequest, serviceAuthHeaders } from "../http.js";
import { MIN_SECRET_BYTES, ServiceAuthKeyRegistry } from "../keys.js";

const SECRET = "e".repeat(MIN_SECRET_BYTES);
const keys = new ServiceAuthKeyRegistry({
  keys: [{ kid: "k1", secret: SECRET, status: "active" }],
  activeKid: "k1",
});

const AUDIENCE = "matching";
const PROTECTED_PATH = "/matching/offers";

let server: Server;
let baseUrl: string;
/** ما رآه الخادمُ من رفضٍ — يُثبِت أنّ السببَ يُسجَّل داخليّاً لا يُرَدُّ. */
const observedRejections: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const method = request.method ?? "GET";
    const path = request.url ?? "/";

    const { principal, rejection } = authenticateServiceRequest(
      request.headers,
      { audience: AUDIENCE, method, path, keys, now: new Date() },
    );

    if (rejection !== undefined) observedRejections.push(rejection.reason);

    if (principal.kind !== "service") {
      // الردُّ **موحَّدٌ**: لا يُفصح عن أيِّ بابٍ أخفقَ.
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "AUTHN_UNAUTHENTICATED" }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ caller: principal.serviceName, scopes: principal.scopes }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function mint(overrides: Partial<Parameters<typeof serviceAuthHeaders>[0]> = {}) {
  return serviceAuthHeaders({
    serviceName: "dispatch",
    audience: AUDIENCE,
    scopes: ["matching:offers:write"],
    method: "POST",
    path: PROTECTED_PATH,
    keys,
    now: new Date(),
    ...overrides,
  });
}

describe("حدُّ خدمةٍ حقيقيٌّ عبرَ HTTP", () => {
  it("200 لنداءٍ موقَّعٍ صحيحٍ", async () => {
    const response = await fetch(`${baseUrl}${PROTECTED_PATH}`, {
      method: "POST",
      headers: mint(),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      caller: "dispatch",
      scopes: ["matching:offers:write"],
    });
  });

  it("401 لنداءٍ بلا أيِّ إثباتٍ — وهذا هو وضعُ AUD-004 اليوم", async () => {
    const response = await fetch(`${baseUrl}${PROTECTED_PATH}`, {
      method: "POST",
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "AUTHN_UNAUTHENTICATED",
    });
  });

  it("401 لترويسةِ Authorization وحدَها — لا خلطَ بينَ الهويّتَين", async () => {
    const response = await fetch(`${baseUrl}${PROTECTED_PATH}`, {
      method: "POST",
      headers: { authorization: "Bearer something" },
    });
    expect(response.status).toBe(401);
  });

  it("401 لرمزٍ مُوقَّعٍ بسرٍّ آخرَ", async () => {
    const forged = new ServiceAuthKeyRegistry({
      keys: [{ kid: "k1", secret: "f".repeat(MIN_SECRET_BYTES), status: "active" }],
      activeKid: "k1",
    });
    const response = await fetch(`${baseUrl}${PROTECTED_PATH}`, {
      method: "POST",
      headers: mint({ keys: forged }),
    });
    expect(response.status).toBe(401);
    expect(observedRejections).toContain("bad_signature");
  });

  it("401 لرمزٍ انتهى", async () => {
    const response = await fetch(`${baseUrl}${PROTECTED_PATH}`, {
      method: "POST",
      headers: mint({ now: new Date(Date.now() - 10 * 60_000) }),
    });
    expect(response.status).toBe(401);
    expect(observedRejections).toContain("expired");
  });

  it("401 لرمزٍ موجَّهٍ إلى خدمةٍ أخرى", async () => {
    const response = await fetch(`${baseUrl}${PROTECTED_PATH}`, {
      method: "POST",
      headers: mint({ audience: "orders" }),
    });
    expect(response.status).toBe(401);
    expect(observedRejections).toContain("audience_mismatch");
  });

  it("401 لإعادةِ استخدامِ رمزٍ على مسارٍ آخرَ — رمزُ القراءةِ لا يحذف", async () => {
    const readHeaders = mint({ method: "GET", path: "/matching/offers/42" });
    const response = await fetch(`${baseUrl}/matching/offers/42`, {
      method: "DELETE",
      headers: readHeaders,
    });
    expect(response.status).toBe(401);
    expect(observedRejections).toContain("request_binding_mismatch");
  });

  it("401 لترويسةٍ مكرَّرةٍ ولو كانت إحداهما صحيحةً", async () => {
    const token = mint()["x-wasla-service-auth"] as string;
    // `fetch` يدمج المكرَّرَ بفاصلةٍ؛ و`node:http` يُسلِّمه نصّاً واحداً.
    // فالنتيجةُ رمزٌ مشوَّهٌ يُرفَض — وهو المطلوب: لا اختيارَ لإحداهما.
    const response = await fetch(`${baseUrl}${PROTECTED_PATH}`, {
      method: "POST",
      headers: [
        ["x-wasla-service-auth", token],
        ["x-wasla-service-auth", token],
      ],
    });
    expect(response.status).toBe(401);
  });

  it("الردُّ لا يحمل سبباً تشخيصيّاً ولا سرّاً", async () => {
    const response = await fetch(`${baseUrl}${PROTECTED_PATH}`, {
      method: "POST",
      headers: mint({ audience: "orders" }),
    });
    const body = await response.text();
    expect(body).not.toContain("audience");
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain("kid");
  });

  it("يقبل نداءً صحيحاً بسلسلةِ استعلامٍ زائدةٍ — التطبيعُ يعمل على السلك", async () => {
    const headers = mint({ path: PROTECTED_PATH });
    const response = await fetch(`${baseUrl}${PROTECTED_PATH}?trace=abc`, {
      method: "POST",
      headers,
    });
    expect(response.status).toBe(200);
  });
});
