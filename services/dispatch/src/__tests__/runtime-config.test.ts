/**
 * إعدادُ الإرسالِ يُقاسُ بلا إقلاعِ خدمةٍ — وهذا هوَ الفرقُ. (M2-04 · RISK-0046)
 *
 * قبلَ هذا الملفِّ لم يكنْ لقواعدِ الإرسالِ اختبارٌ **ممكنٌ**: كانت تُقرأُ في
 * `http/server.ts` وهوَ يُنفِّذُ `await main()` عندَ استيرادِهِ. فبقيَ
 * `Number(process.env.DISPATCH_WAVE_SIZE ?? 2)` بلا حارسٍ، و`NaN` يمرُّ منهُ
 * صامتاً إلى موجةٍ بلا سائقٍ.
 */

import { describe, expect, it } from "vitest";

import { ConfigError } from "@wasla/config";
import { DISPATCH_SERVICE_PORT } from "@wasla/contracts-dispatch";

import {
  DISPATCH_RULE_DEFAULTS,
  resolveDispatchPort,
  resolveDispatchRules,
} from "../config/runtime-config.js";

describe("resolveDispatchRules", () => {
  it("بيئةٌ فارغةٌ ⇒ الافتراضيّاتُ المُعلَنةُ بعينِها", () => {
    expect(resolveDispatchRules({})).toEqual({
      rulesetVersion: 1,
      ...DISPATCH_RULE_DEFAULTS,
    });
  });

  it("يقرأُ القيمَ المضبوطةَ", () => {
    expect(
      resolveDispatchRules({
        DISPATCH_WAVE_SIZE: "5",
        DISPATCH_OFFER_TIMEOUT_SECONDS: "45",
        DISPATCH_MAX_WAVES: "7",
        DISPATCH_ESCALATION_TIMEOUT_SECONDS: "300",
      }),
    ).toEqual({
      rulesetVersion: 1,
      waveSize: 5,
      offerTimeoutSeconds: 45,
      maxWaves: 7,
      escalationTimeoutSeconds: 300,
    });
  });

  it("العطبُ المقيسُ: أرقامٌ عربيّةٌ-هنديّةٌ تُلقي باسمِ المتغيّرِ لا تُنتِجُ NaN", () => {
    expect(Number("٣")).toBeNaN(); // ما كانَ يمرُّ صامتاً قبلَ M2-04
    expect(() => resolveDispatchRules({ DISPATCH_WAVE_SIZE: "٣" })).toThrow(ConfigError);
    expect(() => resolveDispatchRules({ DISPATCH_WAVE_SIZE: "٣" })).toThrow(/DISPATCH_WAVE_SIZE/);
  });

  it("موجةٌ بصفرِ سائقينَ ليست موجةً — الحدُّ الأدنى واحدٌ", () => {
    expect(() => resolveDispatchRules({ DISPATCH_WAVE_SIZE: "0" })).toThrow(/DISPATCH_WAVE_SIZE/);
    expect(() => resolveDispatchRules({ DISPATCH_MAX_WAVES: "0" })).toThrow(/DISPATCH_MAX_WAVES/);
    expect(() => resolveDispatchRules({ DISPATCH_OFFER_TIMEOUT_SECONDS: "0" })).toThrow(
      /DISPATCH_OFFER_TIMEOUT_SECONDS/,
    );
    expect(() => resolveDispatchRules({ DISPATCH_ESCALATION_TIMEOUT_SECONDS: "0" })).toThrow(
      /DISPATCH_ESCALATION_TIMEOUT_SECONDS/,
    );
  });

  it("كلُّ قاعدةٍ تُلقي باسمِها هيَ لا باسمِ أختِها", () => {
    for (const name of [
      "DISPATCH_WAVE_SIZE",
      "DISPATCH_OFFER_TIMEOUT_SECONDS",
      "DISPATCH_MAX_WAVES",
      "DISPATCH_ESCALATION_TIMEOUT_SECONDS",
    ] as const) {
      try {
        resolveDispatchRules({ [name]: "لا رقمَ" });
        expect.unreachable(`${name}: كانَ يجبُ أن يُلقيَ`);
      } catch (error) {
        expect((error as ConfigError).variable).toBe(name);
      }
    }
  });
});

describe("resolveDispatchPort", () => {
  it("يسقطُ إلى منفذِ العقدِ لا إلى رقمٍ مكتوبٍ في الجذرِ", () => {
    expect(resolveDispatchPort({})).toBe(DISPATCH_SERVICE_PORT);
  });

  it("يقرأُ PORT الصالحَ ويرفضُ غيرَ الصالحِ بدلَ الاستماعِ على منفذٍ مجهولٍ", () => {
    expect(resolveDispatchPort({ PORT: "9100" })).toBe(9100);
    expect(() => resolveDispatchPort({ PORT: "0" })).toThrow(/PORT/);
    expect(() => resolveDispatchPort({ PORT: "70000" })).toThrow(/PORT/);
  });
});
