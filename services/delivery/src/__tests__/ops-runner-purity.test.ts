/**
 * حارسٌ سلبيٌّ على مُنادياتِ التشغيلِ (`src/ops/`) — المراجعةُ 14/N · ADR-026 §4.16.
 *
 * ثلاثةُ منوعٍ يُقاسُ نصُّها لا سلوكُها، ولكلٍّ سببُهُ:
 *
 *  1. **لا مؤقِّتَ ولا جَدوَلَ داخلَ العمليّةِ.** قرارُ المنظومةِ (ADR-011/013/014/015)
 *     أنَّ الدقَّاتَ تُنادى من خارجِ الخدمةِ. و`setInterval` واحدٌ يُدسُّ في
 *     مُنادٍ يمرُّ من كلِّ اختبارٍ سلوكيٍّ (الجَولةُ الأولى صحيحةٌ)، ثمّ يظهرُ
 *     أوّلَ مرّةٍ كعمليّةٍ لا تموتُ في حاويةِ جَدوَلٍ، أو كجَولتَينِ
 *     متزامنتَينِ تتزاحمانِ على نفسِ الصفوفِ.
 *  2. **البيئةُ والخروجُ في ملفِّ الحدِّ وحدَهُ.** ملفُّ منطقٍ يقرأُ
 *     `process.env` يجعلُ كلَّ اختبارٍ يستوردُهُ يُصيبُ قاعدةً لم يُصرِّح بها،
 *     و`process.exit` في ملفِّ منطقٍ يقتلُ مُشغِّلَ الاختباراتِ نفسَهُ.
 *  3. **قائمةُ الحدودِ مُعلَنةٌ بالمساواةِ لا بالاحتواءِ.** فحارسٌ يقولُ «هذهِ
 *     مسموحةٌ» يمرُّ صامتاً على حدٍّ ثانٍ يُضافُ غداً؛ والمساواةُ تُفشِلُ
 *     الإضافةَ حتّى تُعلَنَ.
 *
 * ويُمسحُ الكودُ **بعدَ حذفِ التعليقاتِ** (نفسُ نهجِ حرّاسِ النقاءِ في السمعةِ
 * والسوقِ): الشرحُ في هذا المجلَّدِ يقولُ صراحةً «لا `setInterval` هنا»، فحارسٌ
 * يقرأُ النثرَ يجعلُ أرخصَ إصلاحٍ حذفَ الشرحِ — وذاكَ أسوأُ من غيابِ الحارسِ.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const OPS = join(dirname(fileURLToPath(import.meta.url)), "..", "ops");

/** أسماءُ ملفّاتِ `src/ops/` مرتَّبةً. */
function opsFiles(): readonly string[] {
  return readdirSync(OPS)
    .filter((entry) => entry.endsWith(".ts"))
    .sort();
}

/** الكودُ وحدَهُ: بلا تعليقاتِ كتلةٍ ولا تعليقاتِ سطرٍ. */
function codeOnly(name: string): string {
  return readFileSync(join(OPS, name), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

/**
 * حدودُ العمليّةِ المُعلَنةُ — وهيَ وحدَها التي يُسمحُ لها بقراءةِ البيئةِ
 * وإنهاءِ العمليّةِ والكتابةِ إلى المجرَيَينِ.
 */
const PROCESS_BOUNDARY_FILES: readonly string[] = ["idempotency-sweep-cli.ts"];

describe("نقاءُ مُنادياتِ التشغيلِ", () => {
  it("المجلَّدُ يحوي ما هوَ مُعلَنٌ فقط — حدٌّ واحدٌ ومنطقٌ واحدٌ", () => {
    expect(opsFiles()).toEqual(["idempotency-sweep-cli.ts", "idempotency-sweep-runner.ts"]);
  });

  it.each([
    ["setInterval", /\bsetInterval\b/],
    ["setTimeout", /\bsetTimeout\b/],
    ["setImmediate", /\bsetImmediate\b/],
    ["node-cron / cron", /\bcron\b/i],
    ["node:timers", /node:timers/],
  ])("لا %s في أيِّ مُنادٍ — الجَدوَلُ خارجُ العمليّةِ", (_label, pattern) => {
    const offenders = opsFiles().filter((name) => pattern.test(codeOnly(name)));
    expect(offenders).toEqual([]);
  });

  it("قراءةُ البيئةِ محصورةٌ في حدِّ العمليّةِ المُعلَنِ", () => {
    const readers = opsFiles().filter((name) => /process\.env/.test(codeOnly(name)));
    expect(readers).toEqual(PROCESS_BOUNDARY_FILES);
  });

  it("إنهاءُ العمليّةِ محصورٌ في حدِّ العمليّةِ المُعلَنِ", () => {
    const killers = opsFiles().filter((name) => /process\.exit/.test(codeOnly(name)));
    expect(killers).toEqual(PROCESS_BOUNDARY_FILES);
  });

  it("الكتابةُ إلى stdout/stderr محصورةٌ في حدِّ العمليّةِ، ولا `console` أصلاً", () => {
    const writers = opsFiles().filter((name) => /process\.(stdout|stderr)/.test(codeOnly(name)));
    expect(writers).toEqual(PROCESS_BOUNDARY_FILES);

    const talkers = opsFiles().filter((name) => /\bconsole\./.test(codeOnly(name)));
    expect(talkers).toEqual([]);
  });

  it("ملفُّ المنطقِ لا يعرفُ `process` بحرفٍ واحدٍ — لذلكَ يُختبَرُ بلا عمليّةٍ", () => {
    expect(/\bprocess\b/.test(codeOnly("idempotency-sweep-runner.ts"))).toBe(false);
  });

  it("ملفُّ المنطقِ لا يفتحُ اتّصالاً بنفسِهِ — البِركةُ تُركَّبُ من الحدِّ", () => {
    const logic = codeOnly("idempotency-sweep-runner.ts");
    expect(/new Pool\b/.test(logic)).toBe(false);
    expect(/from "pg"/.test(logic)).toBe(false);
  });
});
