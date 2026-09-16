/**
 * السجلُّ المرجعيُّ ومُشتَقُّهُ نوعاً واحداً — لا نسختَينِ تتقاربانِ. (M2-04)
 *
 * والفحصُ 18 في CI يُعيدُ توليدَ المُشتَقِّ ويقارنُ بايتاً بايتاً، فلِمَ اختبارٌ
 * أيضاً؟ لأنَّ الفحصَ يُثبِتُ **أنَّ الملفَّ مُشتَقٌّ**، وهذا يُثبِتُ **أنَّ ما
 * يستهلكُهُ TypeScript صادقٌ**: لو كُتِبَ المُشتَقُّ بيدٍ في فرعٍ لا يمرُّ بالفحصِ،
 * أو حُرِّرَ السجلُّ وأُهمِلَ التوليدُ، سقطَ هذا الاختبارُ في التوِّ المحلّيِّ.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ENV_REGISTRY, ENV_VAR_NAMES, findEnvVarSpec } from "../index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

interface RawVariable {
  readonly name: string;
  readonly type: string;
  readonly required: string;
  readonly secret: boolean;
  readonly default: string | null;
  readonly scopes: readonly string[];
  readonly readers: readonly { readonly file: string; readonly mode: string }[];
}

const raw = JSON.parse(
  readFileSync(path.join(packageRoot, "env-registry.json"), "utf8"),
) as { schema: string; variables: readonly RawVariable[] };

describe("env-registry.json", () => {
  it("يُعلِنُ صيغتَهُ", () => {
    expect(raw.schema).toBe("wasla.env-registry/v1");
  });

  it("أسماءٌ فريدةٌ مرتّبةٌ بلا مُكرَّرٍ", () => {
    const names = raw.variables.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(names);
  });

  it("لكلِّ متغيّرٍ قارئٌ واحدٌ على الأقلِّ — لا إعلانَ ميّتاً", () => {
    for (const entry of raw.variables) {
      expect(entry.readers.length, entry.name).toBeGreaterThan(0);
    }
  });

  it("لا سرَّ لهُ قيمةٌ افتراضيّةٌ", () => {
    for (const entry of raw.variables) {
      if (entry.secret) expect(entry.default, entry.name).toBeNull();
    }
  });

  it("كلُّ مادّةٍ سرِّيّةٍ مُعلَنةٌ سرّاً", () => {
    for (const entry of raw.variables) {
      if (entry.type === "secret_material") expect(entry.secret, entry.name).toBe(true);
    }
  });
});

describe("registry.generated.ts يطابقُ سجلَّهُ", () => {
  it("العددُ والأسماءُ سواءٌ", () => {
    expect(ENV_REGISTRY).toHaveLength(raw.variables.length);
    expect([...ENV_VAR_NAMES]).toEqual(raw.variables.map((entry) => entry.name));
  });

  it("كلُّ حقلٍ مُشتَقٍّ يطابقُ أصلَهُ", () => {
    for (const entry of raw.variables) {
      const spec = findEnvVarSpec(entry.name);
      expect(spec, entry.name).toBeDefined();
      expect(spec?.type).toBe(entry.type);
      expect(spec?.required).toBe(entry.required);
      expect(spec?.secret).toBe(entry.secret);
      expect(spec?.default).toBe(entry.default);
      expect(spec?.scopes).toEqual(entry.scopes);
      expect(spec?.readerCount).toBe(entry.readers.length);
    }
  });

  it("البحثُ عن غيرِ المُسجَّلِ يُعيدُ undefined لا يُلقي", () => {
    expect(findEnvVarSpec("WASLA_NOT_A_REAL_VARIABLE")).toBeUndefined();
  });
});

describe("قواعدُ الإرسالِ الأربعُ مُسجَّلةٌ صراحةً", () => {
  // هذهِ الأربعُ هيَ موضعُ `RISK-0046`: كانت تُقرأُ بـ`Number(...)` عارياً.
  const dispatchRules = [
    "DISPATCH_WAVE_SIZE",
    "DISPATCH_OFFER_TIMEOUT_SECONDS",
    "DISPATCH_MAX_WAVES",
    "DISPATCH_ESCALATION_TIMEOUT_SECONDS",
  ] as const;

  it("كلُّ قاعدةٍ عددٌ موجبٌ لهُ افتراضيٌّ مُعلَنٌ", () => {
    for (const name of dispatchRules) {
      const spec = findEnvVarSpec(name);
      expect(spec, name).toBeDefined();
      expect(spec?.type, name).toBe("positive_int");
      expect(spec?.default, name).not.toBeNull();
    }
  });
});
