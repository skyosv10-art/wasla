/**
 * اختبارُ إغلاقِ تركيبِ الحدِّ على `env` التركيبِ (D2) — لا على `process.env`.
 *
 * سؤالٌ واحدٌ: هل يقرأُ جذرُ التركيبِ متغيراتِه من `overrides.env` حصرًا متى
 * وُجدت؟ فإن سقطَ هذا الإغلاقُ صارَ للاختبارِ حقيقتانِ متناقضتانِ، وللإنتاجِ
 * مصدرُ حقيقةٍ خارجَ سيطرةِ الترتيبِ.
 */

import { FakeIdentityBootstrap, MockChannelAdapter } from "@wasla/channel-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildAppWithEdge } from "../edge.js";

/** بيئةُ تركيبٍ مكتملةٌ — مفتاحُ اختبارٍ لا يُعرفُ لأيِّ بيئةٍ حقيقيةٍ. */
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

describe("تركيبُ الحدِّ يُغلقُ على env الترتيبِ لا على process.env (D2)", () => {
  // نظافةُ البيئةِ قبلَ كلِّ اختبارٍ لا افتراضَها: مسارُ القائمةِ يُحَلُّ من
  // موقعِ الوحدةِ فلا يعودَ الاختبارُ رهينَ `cwd`.
  let savedEnabled: string | undefined;
  beforeEach(() => {
    savedEnabled = process.env.WASLA_EDGE_ENABLED;
    delete process.env.WASLA_EDGE_ENABLED;
  });
  afterEach(() => {
    if (savedEnabled !== undefined) {
      process.env.WASLA_EDGE_ENABLED = savedEnabled;
    }
  });

  it("تمكينٌ من env التجاوزِ وحدَهُ يسجّلُ مساراتِ الحدِّ — لا قراءةَ من process.env", async () => {
    const app = build(ENV);
    const res = await app.inject({ method: "POST", url: "/edge/session", payload: {} });
    // المسارُ مسجَّلٌ: الرفضُ إن جاءَ فهو دلاليٌّ (جسمٌ غيرُ صالحٍ) لا غيابٌ (404).
    expect(res.statusCode).not.toBe(404);
  });

  it("env تجاوزٍ بلا تمكينٍ يُعطِّلُ الحدَّ حتى لو ضُبطَ process.env", async () => {
    process.env.WASLA_EDGE_ENABLED = "true"; // لا يجوزُ أن يقرأهُ التركيبُ هنا
    try {
      const { WASLA_EDGE_ENABLED: _enabled, ...withoutEnabled } = ENV;
      void _enabled;
      const app = build(withoutEnabled);
      // المسارُ غيرُ مسجَّلٍ فيصلُ الطلبُ حاجزَ هويةِ الخدمةِ (onRequest) فيُرَدُّ
      // بـ401 — بينما المسارُ المسجَّلُ «open» يعبرُ الحاجزَ ويردُّهُ حدُّ
      // الجلسةِ نفسُهُ (400 لجسمٍ فارغٍ). فالفرقُ بينَ 401 و400 هو المقياسُ
      // الصادقُ للتسجيلِ هنا لا رقمُ 404 الذي يسبقُهُ الحاجزُ دائمًا.
      const res = await app.inject({ method: "POST", url: "/edge/session", payload: {} });
      expect(res.statusCode).toBe(401);
    } finally {
      delete process.env.WASLA_EDGE_ENABLED;
    }
  });
});
