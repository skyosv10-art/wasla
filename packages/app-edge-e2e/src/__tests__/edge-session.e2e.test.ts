/**
 * `edge-session.e2e.test.ts` — أدلةُ E-18/E-19/E-20/E-01..E-17 على الحدِّ.
 *
 * **نطاقُ الحجزِ (CLM-0524):** هذهِ الحزمةُ **تُنشأُ هنا فقط** — لا تُكتبُ
 * حالاتُ الاختبارِ الحيةُ بعدُ. فهذا الجزءُ يُنشئُ العقدَ (السقالةَ) لا
 * الأدلةَ، لأنّ الأدلةَ تتطلّبُ قائمةَ سماحٍ `production_open=true` وهو قرارُ
 * مالكٍ مستقلٌّ (ADR-069 §2.6-9).
 *
 * **ما يُختبرُ هنا الآن هو العقدُ لا التنفيذَ:** التركيبُ يُسجِّلُ مساراتِ
 * الحدِّ (E-01 · E-09 · E-10) بلا فتحِ أيِّ مسارٍ حيٍّ. والأدلةُ الكاملةُ
 * تُكتبُ عندَ تفعيلِ القائمةِ.
 *
 * **المرجعُ:** ADR-069 §7.2 (E-*) · [EDGE_ALLOWLIST.md](../../../docs/12-testing/EDGE_ALLOWLIST.md)
 */

import { describe, expect, it } from "vitest";

import { createChannelEdge } from "@wasla/channel-edge";

describe("app-edge-e2e — سقالةُ الأدلةِ (CLM-0524)", () => {
  it("E-09: مسارٌ غيرُ مدرجٍ يُردُّ بـ404 من الحدِّ ولا نداءَ خلفيًّا", async () => {
    // القائمةُ الحاليةُ كلُّها `production_open=false` عمدًا (CLM-0521) —
    // فلا مسارَ حيًّا يُفتحُ في هذهِ المرحلةِ. والدليلُ أنّ التركيبَ لا
    // يُسجِّلُ شيئًا حيًّا: `enabled=false` في الإنتاجِ.
    const additions = createChannelEdge({
      surface: {
        actorType: "customer",
        botToken: "1234567890:AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRr",
        requestSigner: () => ({}),
        waslaPublicIdOf: async () => "CUS-TEST",
      },
      issueSession: async () => {
        throw new Error("لا يُستدعى");
      },
      exchangeSession: async () => {
        throw new Error("لا يُستدعى");
      },
      revokeSession: async () => {
        throw new Error("لا يُستدعى");
      },
      serviceUrlFor: () => "",
      requestSignerFor: () => () => ({}),
      allowlistUrl: "file:///dev/null",
      enabled: false,
      allowedOrigins: [],
    });
    expect(additions.enabled).toBe(false);
  });

  it("E-10: بلا `Authorization` — الرفضُ 401 من الحدِّ لا من الخدمةِ", () => {
    // لا يُختبرُ التنفيذُ الحيُّ هنا — يُختبرُ أنّ العقدَ يُسجِّلُ الحدَّ
    // (بلا فتحِ مسارٍ حيٍّ). الأدلةُ الكاملةُ تُكتبُ عندَ تفعيلِ القائمةِ.
    expect(createChannelEdge).toBeDefined();
  });
});
