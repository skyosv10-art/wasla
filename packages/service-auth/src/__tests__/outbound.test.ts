/** المُوقِّعُ الصادرُ (M1-03): رمزٌ لكلِّ نداءٍ، ومُوقِّعٌ رافضٌ عندَ نسيانِ الإعداد. */

import { describe, expect, it } from "vitest";

import {
  createServiceRequestSigner,
  refusingServiceRequestSigner,
} from "../outbound.js";
import { SERVICE_AUTH_HEADER } from "../http.js";
import { MIN_SECRET_BYTES, ServiceAuthKeyRegistry } from "../keys.js";
import { mintServiceToken, verifyServiceToken } from "../token.js";

const keys = new ServiceAuthKeyRegistry({
  keys: [{ kid: "k1", secret: "s".repeat(MIN_SECRET_BYTES), status: "active" }],
  activeKid: "k1",
});

const NOW = new Date("2026-08-31T05:00:00.000Z");

function signer() {
  return createServiceRequestSigner({
    serviceName: "dispatch",
    audience: "matching",
    keys,
    scopes: ["matching:candidates:evaluate"],
    now: () => NOW,
  });
}

describe("createServiceRequestSigner", () => {
  it("يُنتِج ترويسةً يقبلها المُتحقِّقُ على نفسِ الطريقةِ والمسار", () => {
    const headers = signer()("POST", "/matching/candidates");
    const principal = verifyServiceToken(headers[SERVICE_AUTH_HEADER] as string, {
      audience: "matching",
      method: "POST",
      path: "/matching/candidates",
      keys,
      now: NOW,
    });
    expect(principal.serviceName).toBe("dispatch");
    expect(principal.scopes).toEqual(["matching:candidates:evaluate"]);
  });

  it("ولا يقبله على مسارٍ آخرَ — الربطُ يعمل عبرَ المُوقِّع", () => {
    const headers = signer()("POST", "/matching/candidates");
    expect(() =>
      verifyServiceToken(headers[SERVICE_AUTH_HEADER] as string, {
        audience: "matching",
        method: "POST",
        path: "/matching/other",
        keys,
        now: NOW,
      }),
    ).toThrow();
  });

  it("يُنتِج رمزاً جديداً لكلِّ نداءٍ — لا إعادةَ استعمالٍ تُحرَق على الحد", () => {
    const sign = signer();
    const first = sign("GET", "/matching/rulesets")[SERVICE_AUTH_HEADER];
    const second = sign("GET", "/matching/rulesets")[SERVICE_AUTH_HEADER];
    expect(first).not.toBe(second);
  });
});

describe("refusingServiceRequestSigner", () => {
  it("يرمي بسببٍ مقروءٍ عندَ أوّلِ نداءٍ", () => {
    const sign = refusingServiceRequestSigner("مفاتيحُ الهويّةِ غيرُ مُعَدّةٍ في هذه البيئة");
    expect(() => sign("GET", "/x")).toThrow(/غيرُ مُعَدّةٍ/);
  });
});

/**
 * الموجةُ 3 من `M1-05B` (ADR-030): المُوقِّعُ يُنفِذُ مصفوفةَ `M1-05` **في زمنِ
 * التشغيلِ** لا في البوّابةِ وحدَها.
 *
 * وموضعُ الرفضِ **البناءُ** لا النداءُ: الثلاثيّةُ (دورٌ · جمهورٌ · صلاحيّاتٌ)
 * ثابتةٌ في المُوقِّعِ، فتأخيرُ الحكمِ إلى أوّلِ نداءٍ كانَ سيُخفِي عطلَ إعدادٍ
 * في مسارٍ باردٍ حتّى يُطرَقَ في الإنتاجِ.
 */
describe("إنفاذُ مصفوفةِ التفويضِ عندَ بناءِ المُوقِّعِ", () => {
  it("تركيبٌ فوقَ سقفِ منحِ دورِهِ ⇒ يموتُ عندَ البناءِ لا عندَ النداءِ", () => {
    expect(() =>
      createServiceRequestSigner({
        serviceName: "dispatch",
        audience: "matching",
        keys,
        scopes: ["matching:candidates:evaluate", "matching:rulesets:read"],
        now: () => NOW,
      }),
    ).toThrow(/خارجَ منحِه/);
  });

  it("دورٌ لا إعلانَ لهُ في المصفوفةِ ⇒ يُرفَضُ ولو كانتِ المفاتيحُ صحيحةً", () => {
    expect(() =>
      createServiceRequestSigner({
        serviceName: "some-new-service",
        audience: "matching",
        keys,
        scopes: [],
        now: () => NOW,
      }),
    ).toThrow(/غيرُ مُعلَنٍ/);
  });

  it("دورٌ إنتاجيٌّ على حدٍّ لا منحَ لهُ عليهِ ⇒ يُرفَضُ — والجمهورُ يفصلُ الحدودَ", () => {
    expect(() =>
      createServiceRequestSigner({
        serviceName: "dispatch",
        audience: "marketplace",
        keys,
        scopes: ["marketplace:store:read"],
        now: () => NOW,
      }),
    ).toThrow(/ولا منحَ لهُ على الحدِّ/);
  });

  it("وبوّابةُ خروجٍ مُعلَنةٌ تُوقِّعُ بكاملِ مجموعةِ حدِّها ⇒ تمرُّ", () => {
    expect(() =>
      createServiceRequestSigner({
        serviceName: "order-exit-gate",
        audience: "orders",
        keys,
        scopes: ["orders:intake:write", "orders:transition:write"],
        now: () => NOW,
      }),
    ).not.toThrow();
  });

  it("والبدائيُّ يبقى حرّاً بقصدٍ: الاختبارُ السلبيُّ يحتاجُ رمزاً زائدَ الصلاحيّةِ ليُقاسَ رفضُ الحدِّ", () => {
    const token = mintServiceToken({
      serviceName: "dispatch",
      audience: "matching",
      method: "GET",
      path: "/matching/rulesets",
      scopes: ["matching:rulesets:read", "matching:decisions:read"],
      keys,
      now: NOW,
    });
    expect(typeof token).toBe("string");
  });
});
