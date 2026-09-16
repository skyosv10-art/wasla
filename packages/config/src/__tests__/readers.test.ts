/**
 * القراءاتُ الصارمةُ: كلُّ حالةٍ **سلبيّةٌ** هنا عطبٌ مقيسٌ لا احتياطٌ. (M2-04)
 *
 * الحالاتُ الخمسُ الأولى هيَ بعينِها ما يقبلُهُ `Number(...)` صامتاً وما وُجِدَتِ
 * الحزمةُ لتصيحَ بهِ (`RISK-0046`). ولو رُدَّتِ القراءةُ يوماً إلى `Number` عارياً
 * سقطتْ هذهِ الحزمةُ من الاختباراتِ — فهيَ حارسُ الانحدارِ لا زينةُ تغطيةٍ.
 */

import { describe, expect, it } from "vitest";

import {
  ConfigError,
  readCsvEnv,
  readFlagEnv,
  readIntEnv,
  readLenientIntEnv,
  readPortEnv,
  readPostgresUrlEnv,
  readRawEnv,
  readStringEnv,
  readUrlEnv,
  requireEnv,
} from "../index.js";

describe("readIntEnv — ما يقبلُهُ Number صامتاً يُرَدُّ باسمِ المتغيّرِ", () => {
  it("يرفضُ نصّاً غيرَ رقميٍّ بدلَ أن يُخرِجَ NaN", () => {
    expect(() => readIntEnv({ WAVE: "ثلاثة" }, "WAVE", { fallback: 2 })).toThrow(ConfigError);
    expect(() => readIntEnv({ WAVE: "ثلاثة" }, "WAVE", { fallback: 2 })).toThrow(/WAVE/);
  });

  it("يرفضُ الستّةَ عشرَ المُقنَّعةَ بالسادسةَ عشرَ (0x10)", () => {
    expect(Number("0x10")).toBe(16); // العطبُ المقيسُ: عشرةٌ تُقرأُ ستّةَ عشرَ
    expect(() => readIntEnv({ N: "0x10" }, "N", { fallback: 1 })).toThrow(/N/);
  });

  it("يرفضُ الصيغةَ الأُسّيّةَ (1e3)", () => {
    expect(Number("1e3")).toBe(1000);
    expect(() => readIntEnv({ N: "1e3" }, "N", { fallback: 1 })).toThrow(ConfigError);
  });

  it("يرفضُ الكسرَ العشريَّ", () => {
    expect(() => readIntEnv({ N: "1.5" }, "N", { fallback: 1 })).toThrow(ConfigError);
  });

  it("يرفضُ السالبَ حينَ الحدُّ الأدنى صفرٌ", () => {
    expect(() => readIntEnv({ N: "-1" }, "N", { fallback: 1 })).toThrow(ConfigError);
  });

  it("يقبلُ الرقمَ المُحاطَ بفراغٍ ويُشذِّبُهُ", () => {
    expect(readIntEnv({ N: " 12 " }, "N", { fallback: 1 })).toBe(12);
  });

  it("يُطبِّقُ الحدَّينِ الأدنى والأعلى ويسمّي المُجاوِزَ", () => {
    expect(() => readIntEnv({ N: "0" }, "N", { min: 1, fallback: 1 })).toThrow(/الحدِّ الأدنى/);
    expect(() => readIntEnv({ N: "99" }, "N", { max: 10, fallback: 1 })).toThrow(/الحدِّ الأعلى/);
  });

  it("الفراغُ والغيابُ سواءٌ: كلاهما يسقطُ إلى الافتراضِ", () => {
    expect(readIntEnv({ N: "   " }, "N", { fallback: 7 })).toBe(7);
    expect(readIntEnv({}, "N", { fallback: 7 })).toBe(7);
  });

  it("بلا افتراضٍ يصيرُ إلزاميّاً", () => {
    expect(() => readIntEnv({}, "N")).toThrow(/إلزاميٌّ/);
  });

  it("يحملُ الخطأُ اسمَ المتغيّرِ والقيمةَ في حقلَينِ لا في نصٍّ وحدَهُ", () => {
    try {
      readIntEnv({ WAVE: "x" }, "WAVE", { fallback: 1 });
      expect.unreachable("كانَ يجبُ أن يُلقيَ");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).variable).toBe("WAVE");
      expect((error as ConfigError).rawValue).toBe("x");
    }
  });
});

describe("readLenientIntEnv — تسامحٌ مُسمّىً لا صمتٌ", () => {
  it("يُعيدُ undefined لقيمةٍ غيرِ مقروءةٍ بدلَ أن يُلقيَ", () => {
    expect(readLenientIntEnv({ T: "abc" }, "T")).toBeUndefined();
    expect(readLenientIntEnv({ T: "0" }, "T", { min: 1 })).toBeUndefined();
  });

  it("يُعيدُ العددَ الصالحَ", () => {
    expect(readLenientIntEnv({ T: "250" }, "T")).toBe(250);
  });
});

describe("readPortEnv", () => {
  it("يرفضُ صفراً وما فوقَ 65535", () => {
    expect(() => readPortEnv({ PORT: "0" }, "PORT", 8080)).toThrow(ConfigError);
    expect(() => readPortEnv({ PORT: "65536" }, "PORT", 8080)).toThrow(ConfigError);
  });

  it("يقبلُ المنفذَ الصالحَ ويسقطُ إلى الافتراضِ عندَ الغيابِ", () => {
    expect(readPortEnv({ PORT: "8093" }, "PORT", 8080)).toBe(8093);
    expect(readPortEnv({}, "PORT", 8080)).toBe(8080);
  });

  it("منفذٌ غيرُ صالحٍ لا يُهمَلُ إلى الافتراضِ — الإقلاعُ يسقطُ", () => {
    expect(() => readPortEnv({ PORT: "٨٠٨٠" }, "PORT", 8080)).toThrow(/PORT/);
  });
});

describe("readUrlEnv", () => {
  it("يرفضُ نصّاً ليسَ عنواناً", () => {
    expect(() => readUrlEnv({ U: "localhost:8080" }, "U")).toThrow(ConfigError);
  });

  it("يفرضُ البروتوكولاتِ المُعلَنةَ", () => {
    expect(() => readUrlEnv({ U: "http://x.example" }, "U", { protocols: ["https:"] })).toThrow(
      /البروتوكولُ/,
    );
    expect(readUrlEnv({ U: "https://x.example" }, "U", { protocols: ["https:"] })).toBe(
      "https://x.example",
    );
  });

  it("يسقطُ إلى الافتراضِ عندَ الغيابِ ويُلقي بلا افتراضٍ", () => {
    expect(readUrlEnv({}, "U", { fallback: "http://localhost:8081" })).toBe(
      "http://localhost:8081",
    );
    expect(() => readUrlEnv({}, "U")).toThrow(/إلزاميٌّ/);
  });
});

describe("readPostgresUrlEnv — لا تُطبَعُ القيمةُ في رسالةٍ", () => {
  it("يقبلُ postgres وpostgresql ويرفضُ غيرَهما", () => {
    expect(readPostgresUrlEnv({ D: "postgresql://u:p@h:5432/d" }, "D")).toBe(
      "postgresql://u:p@h:5432/d",
    );
    expect(() => readPostgresUrlEnv({ D: "mysql://u:p@h/d" }, "D")).toThrow(/postgres/);
  });

  it("الغيابُ ليسَ إخفاقاً: القرارُ للجذرِ لا للقارئِ", () => {
    expect(readPostgresUrlEnv({}, "D")).toBeUndefined();
  });

  it("لا تحملُ الرسالةُ كلمةَ المرورِ", () => {
    try {
      readPostgresUrlEnv({ D: "not a url with s3cr3tpass" }, "D");
      expect.unreachable("كانَ يجبُ أن يُلقيَ");
    } catch (error) {
      expect((error as Error).message).not.toContain("s3cr3tpass");
      expect((error as Error).message).toContain("محجوبةٌ");
    }
  });
});

describe("readCsvEnv · readFlagEnv · requireEnv · readStringEnv · readRawEnv", () => {
  it("يُشذِّبُ ويُزيلُ المُكرَّرَ ويرفضُ الفاصلةَ الزائدةَ", () => {
    expect(readCsvEnv({ L: " a , b , a " }, "L")).toEqual(["a", "b"]);
    expect(() => readCsvEnv({ L: "a,,b" }, "L")).toThrow(ConfigError);
    expect(readCsvEnv({}, "L")).toEqual([]);
  });

  it("الرايةُ `1` حرفاً وحدَهُ تُفعِّلُ", () => {
    expect(readFlagEnv({ F: "1" }, "F")).toBe(true);
    expect(readFlagEnv({ F: "true" }, "F")).toBe(false);
    expect(readFlagEnv({}, "F")).toBe(false);
  });

  it("الإلزاميُّ يُلقي باسمِهِ، والاختياريُّ يسقطُ إلى افتراضِهِ", () => {
    expect(() => requireEnv({ X: "  " }, "X")).toThrow(/X/);
    expect(readStringEnv({}, "H", "0.0.0.0")).toBe("0.0.0.0");
    expect(readRawEnv({ X: "  y " }, "X")).toBe("y");
    expect(readRawEnv({ X: "   " }, "X")).toBeUndefined();
  });
});
