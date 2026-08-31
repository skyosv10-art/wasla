/** المُوقِّعُ الصادرُ (M1-03): رمزٌ لكلِّ نداءٍ، ومُوقِّعٌ رافضٌ عندَ نسيانِ الإعداد. */

import { describe, expect, it } from "vitest";

import {
  createServiceRequestSigner,
  refusingServiceRequestSigner,
} from "../outbound.js";
import { SERVICE_AUTH_HEADER } from "../http.js";
import { MIN_SECRET_BYTES, ServiceAuthKeyRegistry } from "../keys.js";
import { verifyServiceToken } from "../token.js";

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
