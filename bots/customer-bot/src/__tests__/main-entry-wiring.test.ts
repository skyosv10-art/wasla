/**
 * اختبارٌ سلوكيٌّ لترطيبِ مدخلِ بوتِ العميلِ (D6 · CLM-0691/0693).
 *
 * الحارسُ 29 يقيسُ **النصَّ** (استيرادٌ وتمريرٌ)؛ هذا الاختبارُ يقيسُ **السلوكَ**:
 * استيرادُ `main.ts` — عبرَ محاكاةِ `runBotApp` لا تشغيلِهِ — يجبُ أن يُمرِّرَ إلى
 * المُطلِقِ `buildAppWithEdge` نفسِها (هُويّةً لا نصًّا)، وبناءُ التطبيقِ عبرَ الدالةِ
 * المُمرَّرةِ فعلاً يجبُ أن يُبقيَ مساراتِ النطاقِ من `server.ts` (البوتُ حيٌّ) وأن
 * يسجّلَ مساراتِ الحدِّ فقطَ متى مُكِّنَ عبرَ `env` الترتيبِ — لا `process.env`.
 *
 * لا يفتحُ الاختبارُ منفذًا: `runBotApp` وحدها من تفتحُ، وقد مُحِكَت هنا.
 */

import { FakeIdentityBootstrap, MockChannelAdapter } from "@wasla/channel-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// محاكاةُ المُطلِق: التقاطُ ما يُمرَّرُ إليهِ بدلَ تشغيلِ عمليةٍ حيّةٍ.
type Captured = { bot: unknown; build: unknown };
const captured: Captured[] = [];
vi.mock("@wasla/bot-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wasla/bot-runtime")>();
  return {
    ...actual,
    runBotApp: (bot: unknown, build: unknown) => {
      captured.push({ bot, build });
      return Promise.resolve();
    },
  };
});

const { BOT } = await import("../server.js");
const { buildAppWithEdge } = await import("../edge.js");
await import("../main.js"); // يُنفِّذُ `void runBotApp(BOT, buildAppWithEdge)` عبرَ المحاكاةِ

/** بيئةُ تركيبٍ مكتملةٌ — مفتاحُ اختبارٍ لا يُعرفُ لأيِّ بيئةٍ حقيقيةٍ (كسابقةِ D2). */
const ENV = {
  CUSTOMER_BOT_TOKEN: "token-value",
  CUSTOMER_BOT_WEBHOOK_SECRET: "customer-bot-test-webhook-secret",
  CUSTOMER_BOT_MINI_APP_URL: "https://apps.wasla.test/customer",
  IDENTITY_SERVICE_URL: "http://identity:8080",
  WASLA_SERVICE_AUTH_KEYS: "test-active:active:bots-test-secret-0123456789abcdef",
  WASLA_SERVICE_AUTH_ACTIVE_KID: "test-active",
  WASLA_SERVICE_TOKEN_REPLAY_MODE: "memory",
  WASLA_EDGE_ENABLED: "true",
};

function build(env: Record<string, string | undefined>) {
  const { app } = buildAppWithEdge({
    env,
    channel: new MockChannelAdapter(),
    identity: new FakeIdentityBootstrap(),
    logger: false,
  });
  return app;
}

describe("ترطيبُ مدخلِ بوتِ العميلِ سلوكًا (D6 · CLM-0693)", () => {
  beforeEach(() => {
    delete process.env.WASLA_EDGE_ENABLED;
  });

  it("استيرادُ main.ts يُمرِّرُ BOT وbuildAppWithEdge إلى runBotApp — هُويّةً لا نصًّا", () => {
    expect(captured.length).toBe(1);
    expect(captured[0]!.bot).toBe(BOT);
    // الدالةُ المُمرَّرةُ هيَ buildAppWithEdge نفسُها لا غلافًا حولَ buildApp
    expect(captured[0]!.build).toBe(buildAppWithEdge);
  });

  it("الدالةُ المُمرَّرةُ تبني بلا حدٍّ متى لم يُمكَّن: مساراتُ النطاقِ حاضرةٌ والحدُّ غائبٌ", async () => {
    const { WASLA_EDGE_ENABLED: _enabled, ...withoutEnabled } = ENV;
    void _enabled;
    const app = build(withoutEnabled);
    // مسارُ النطاقِ من server.ts (عبرَ buildBotApp) مسجَّلٌ — البوتُ حيٌّ لا هيكلًا
    const webhook = await app.inject({ method: "POST", url: "/channel/customer/webhook" });
    expect(webhook.statusCode).not.toBe(404);
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    // الحدُّ غيرُ مسجَّلٍ: الطلبُ يصلُ حاجزَ هويةِ الخدمةِ فيُرَدُّ بـ401 لا 404
    const edge = await app.inject({ method: "POST", url: "/edge/session", payload: {} });
    expect(edge.statusCode).toBe(401);
  });

  it("الدالةُ المُمرَّرةُ تسجّلُ مساراتِ الحدِّ متى مُكِّنَ من env الترتيبِ", async () => {
    const app = build(ENV);
    // المسارُ مسجَّلٌ: الرفضُ إن جاءَ فهو دلاليٌّ (جسمٌ غيرُ صالحٍ) لا غيابٌ (404)
    const edge = await app.inject({ method: "POST", url: "/edge/session", payload: {} });
    expect(edge.statusCode).not.toBe(404);
    // ومساراتُ النطاقِ باقيةٌ في الحالتينِ
    const webhook = await app.inject({ method: "POST", url: "/channel/customer/webhook" });
    expect(webhook.statusCode).not.toBe(404);
  });
});
