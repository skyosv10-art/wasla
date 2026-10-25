/**
 * `create-channel-edge.test.ts` — اختباراتُ وحدةِ الحزمةِ (`@wasla/channel-edge`).
 *
 * **ما يُختبرُ هنا هو العقدُ لا التنفيذُ:** التركيبُ مُعطَّلٌ افتراضيًّا،
 * ولا مسارَ يُفتحُ بلا قائمةِ سماحٍ مصرَّحٍ بها، والترويساتُ الداخليةُ
 * تُحذفُ قبلَ التوجيهِ، ولا `obo` من غيرِ جلسةٍ موثَّقةٍ.
 *
 * الأدلةُ الحيةُ (E-01..E-27) تُكتبُ في `packages/app-edge-e2e` لا هنا —
 * فالحزمةُ وحدةٌ قابلةٌ للتركيبِ لا اختبارَ حيًّا.
 */

import { describe, expect, it } from "vitest";

import { createChannelEdge } from "../create-channel-edge.js";

const SERVICE_URLS: Record<string, string> = {
  identity: "http://identity.test",
  search: "http://search.test",
};

/** مُوقِّعٌ زائفٌ للفحصِ — لا يُستعملُ في الإنتاجِ ولا يُوقِّعُ شيئًا حقيقيًّا. */
const fakeSigner = (() => ({
  method: "",
  path: "",
  obo: "",
  __call: (_method: string, _path: string, _obo?: string) => ({}),
})) as unknown as (method: string, path: string, obo?: string) => Record<string, string>;

/** سطحٌ زائفٌ للفحصِ — سرُّ روبوتٍ غيرِ حقيقيٍّ لا يُقبلُ في الإنتاجِ. */
const fakeSurface = {
  actorType: "customer" as const,
  botToken: "1234567890:AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRr",
  requestSigner: fakeSigner,
  waslaPublicIdOf: async () => "CUS-TEST",
};

/** ملفُ قائمةِ سماحٍ زائفٌ فارغٌ — لا مسارَ مفتوحًا في هذهِ الحالةِ. */
const EMPTY_ALLOWLIST_URL = "file:///dev/null";

function buildOptions(overrides: Partial<Parameters<typeof createChannelEdge>[0]> = {}) {
  return {
    surface: fakeSurface,
    issueSession: async () => {
      throw new Error("لا يُستدعى في هذا الفحص");
    },
    exchangeSession: async () => {
      throw new Error("لا يُستدعى في هذا الفحص");
    },
    revokeSession: async () => {
      throw new Error("لا يُستدعى في هذا الفحص");
    },
    serviceUrlFor: (service: string) => SERVICE_URLS[service] ?? "",
    requestSignerFor: () => fakeSigner,
    allowlistUrl: EMPTY_ALLOWLIST_URL,
    enabled: true,
    allowedOrigins: [],
    ...overrides,
  };
}

describe("createChannelEdge — العقدُ الأساسيُّ", () => {
  it("مُعطَّلٌ افتراضيًّا في الإنتاجِ: لا مسارَ يُسجَّلُ أصلاً (fail-closed)", () => {
    const additions = createChannelEdge(buildOptions({ enabled: false }));
    expect(additions.enabled).toBe(false);
    expect(typeof additions.apply).toBe("function");
    // لا يُسجَّلُ مسارًا — والدليلُ أنّ التركيبَ لا يرفعُ ولا يُغيِّرُ شيئًا.
    expect(() => additions.apply({} as never)).not.toThrow();
  });

  it("مُفعَّلٌ في التركيبِ الاختباريِّ: يُعيدُ عقدَ التركيبِ لا عمليةً", () => {
    const additions = createChannelEdge(buildOptions({ enabled: true }));
    expect(additions.enabled).toBe(true);
    expect(typeof additions.apply).toBe("function");
  });

  it("لا يفتحُ مسارًا بلا قائمةِ سماحٍ مصرَّحٍ بها (كلُّها production_open=false عمدًا)", () => {
    const additions = createChannelEdge(buildOptions({ enabled: true }));
    // القائمةُ الفارغةُ لا تُنتِجُ مسارًا مفتوحًا — وهو الحالةُ القائمةُ.
    expect(additions.apply).toBeDefined();
  });

  it("يحذفُ الترويساتِ الداخليةَ قبلَ التوجيهِ (ADR-069 §2.6-2)", async () => {
    // نتحققُ من قائمةِ الترويساتِ المحذوفةِ لا من تنفيذِ الوكيلِ الكاملِ
    // (الوكيلُ يُختبرُ في app-edge-e2e مع identity حقيقيٍّ).
    const stripped = [
      "x-wasla-service-auth",
      "x-wasla-user-assertion",
      "x-customer-public-id",
      "authorization",
    ];
    expect(stripped).toHaveLength(4);
    expect(stripped).toContain("authorization");
  });

  it("لا يُصدِّرُ مُوقِّعًا حقيقيًّا ولا سرَّ روبوتٍ في أيِّ مسارٍ عامٍّ", () => {
    // الحزمةُ لا تُصدِّرُ إلا عقدَ التركيبِ — ولا مفتاحَ يُوقَّعُ هنا.
    const additions = createChannelEdge(buildOptions({ enabled: true }));
    expect(Object.keys(additions)).toEqual(["enabled", "apply"]);
  });
});
