/**
 * حارسٌ سلبيّ على النقاء: لا ساعةَ مخفيّة، ولا شبكة، ولا قاعدةَ بيانات، ولا عقوبة.
 *
 * تُمسح كلُّ ملفات `src/` (خارج `__tests__/`) **بعد حذف التعليقات** ثم يُبحث في الكود
 * الفعليّ عن أنماطٍ محرّمة. وحذفُ التعليقات ليس تفصيلاً: الشرحُ في هذه الخدمة يقول
 * صراحةً «لا `Date.now()` هنا ولا `setTimeout`»، فحارسٌ يقرأ النثرَ يُفشل نفسَه على
 * الشرح الصحيح ويجعل أرخصَ إصلاحٍ هو حذفَ الشرح — وذاك أسوأُ من غياب الحارس
 * (HANDOFF §16-ج).
 *
 * ولِمَ حارسٌ نصّيٌّ ولم يكفِ الاختبارُ السلوكيّ؟ لأنّ `Date.now()` واحداً يُدسّ في
 * دالّةٍ مساعدةٍ يمرّ من كل اختبارٍ سلوكيّ (الساعةُ الحقيقية ساعةٌ صحيحةٌ اليوم) ثم يظهر
 * أوّلَ مرّةٍ كاختبارٍ مُتقلّبٍ عند منتصف الليل، أو كنتيجةٍ لا تُشرح بعد شهر.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");

function sourceFiles(directory: string = SRC): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__") continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (entry.endsWith(".ts")) found.push(path);
  }
  return found.sort();
}

/** الكودُ وحده: بلا تعليقات كتلةٍ ولا تعليقات سطر. */
function codeOnly(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

interface Offence {
  readonly file: string;
  readonly pattern: string;
}

function scan(patterns: ReadonlyArray<readonly [string, RegExp]>): readonly Offence[] {
  const offences: Offence[] = [];
  for (const path of sourceFiles()) {
    const code = codeOnly(path);
    for (const [label, pattern] of patterns) {
      if (pattern.test(code)) {
        offences.push({ file: relative(SRC, path), pattern: label });
      }
    }
  }
  return offences;
}

describe("مسحُ المصدر", () => {
  it("يجد ملفاتٍ فعلاً — فلا يمرّ الحارسُ على قائمةٍ فارغة", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(files.some((path) => path.endsWith("index.ts"))).toBe(true);
  });

  it("حذفُ التعليقات يعمل على النمطين", () => {
    const sample = codeOnly(join(SRC, "domain", "time.ts"));
    expect(sample).not.toContain("اللحظةُ تدخل من الحاقن");
    // وما بقي كودٌ يُقرأ.
    expect(sample).toContain("export function");
  });
});

describe("لا ساعةَ مخفيّة", () => {
  it("لا Date.now ولا new Date() بلا وسيطٍ ولا مؤقّت ولا نوم", () => {
    expect(
      scan([
        ["Date.now", /\bDate\s*\.\s*now\s*\(/],
        ["new Date() بلا وسيط", /new\s+Date\s*\(\s*\)/],
        ["setTimeout", /\bsetTimeout\s*\(/],
        ["setInterval", /\bsetInterval\s*\(/],
        ["sleep", /\bsleep\s*\(/],
        ["Math.random", /\bMath\s*\.\s*random\s*\(/],
        ["performance.now", /\bperformance\s*\.\s*now\s*\(/],
      ]),
    ).toEqual([]);
  });

  it("`new Date(x)` بوسيطٍ مسموحٌ — تحويلُ صيغةٍ لا قراءةُ ساعة", () => {
    /**
     * الفرقُ كلُّه في الوسيط: `new Date(millis)` دالّةُ تحويلٍ نقيّةٌ تُعطي نفسَ المخرج
     * لنفس المدخل أبداً، و`new Date()` قراءةُ ساعةِ النظام من داخل المجال. ومنعُ
     * الأولى كان سيدفع إلى حسابِ تقويمٍ يدويٍّ أسوأَ من المكتبة القياسية.
     */
    const time = codeOnly(join(SRC, "domain", "time.ts"));
    expect(time).toContain("new Date(");
    expect(/new\s+Date\s*\(\s*\)/.test(time)).toBe(false);
  });
});

describe("لا شبكةَ ولا قاعدةَ بيانات ولا نظامَ ملفات", () => {
  it("لا استدعاءَ شبكةٍ ولا استيرادَ مُشغّلٍ ولا قراءةَ ملفٍّ في طبقة المجال", () => {
    expect(
      scan([
        ["fetch", /\bfetch\s*\(/],
        ["axios", /from\s+["']axios["']/],
        ["http", /from\s+["']node:https?["']/],
        ["drizzle", /from\s+["'][^"']*drizzle[^"']*["']/],
        ["pg", /from\s+["']pg["']/],
        ["node:fs", /from\s+["']node:fs["']/],
        ["node:child_process", /from\s+["']node:child_process["']/],
        ["process.env", /\bprocess\s*\.\s*env\b/],
      ]),
    ).toEqual([]);
  });

  it("لا استيرادَ يعبر حدَّ الحزمة إلى خدمةٍ أخرى", () => {
    /**
     * ADR-014: لا مفتاحَ أجنبيّ ولا استدعاءَ متزامنٍ يعبر حدَّ الخدمة. واستيرادٌ نسبيٌّ
     * إلى `../../orders` كان سيجعل الحدَّ ورقياً بلا أن يُلاحظ أحد.
     */
    expect(
      scan([
        ["استيراد يعبر الحد", /from\s+["']\.\.\/\.\.\/\.\.\//],
        ["services/", /from\s+["'][^"']*\/services\//],
      ]),
    ).toEqual([]);
  });

  it("التبعيّةُ الوحيدةُ المُعلَنة هي حزمةُ العقود", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(join(SRC, "..", "package.json"), "utf8"),
    );
    const dependencies = (manifest as { readonly dependencies?: Record<string, string> })
      .dependencies;
    expect(Object.keys(dependencies ?? {})).toEqual(["@wasla/contracts-reputation"]);
  });
});

describe("لا عقوبةَ ولا حُكم", () => {
  it("لا حقلَ إيقافٍ ولا حظرٍ ولا وسمَ محتال في الكود", () => {
    /**
     * القرار 7 في ADR-014 وعبارةُ الطور: «الخدمة لا تعاقب أحداً». والاسمُ هو الآليّة
     * هنا: أوّلُ حقلٍ باسم `isSuspended` يجعل كلَّ مستهلكٍ يقرؤه ويتصرّف به، فيصير
     * القرارُ الإداريُّ ملكاً لخدمةٍ لا تملكه.
     */
    expect(
      scan([
        ["isSuspended", /\bis_?[Ss]uspended\b/],
        ["isBanned", /\bis_?[Bb]anned\b/],
        ["isBlocked", /\bis_?[Bb]locked\b/],
        ["isFraudster", /\bis_?[Ff]raudster\b/],
        ["suspendedUntil", /\bsuspended_?[Uu]ntil\b/],
        ["allowedActions", /\ballowed_?[Aa]ctions\b/],
      ]),
    ).toEqual([]);
  });

  it("لا احتمالٌ إحصائيٌّ ولا درجةُ خطر — الإشارةُ قاعدةٌ مُسمّاةٌ بعتبة", () => {
    expect(
      scan([
        ["probability", /\bprobability\b/],
        ["riskScore", /\brisk_?[Ss]core\b/],
        ["confidence", /\bconfidence\b/],
        ["anomalyScore", /\banomaly_?[Ss]core\b/],
      ]),
    ).toEqual([]);
  });

  it("لا نصَّ حرًّا في التقييم — لا comment ولا note ولا body", () => {
    /**
     * القرار 5: النصُّ الحرّ يحتاج تنقيحاً وحجباً ومالكاً، وذاك Phase 16. وغيابُه
     * مقصودٌ ومحروس.
     */
    expect(
      scan([
        ["comment", /\bcomment\s*[?:]/],
        ["note", /\bnote\s*[?:]/],
        ["body", /\bbody\s*[?:]/],
        ["freeText", /\bfree_?[Tt]ext\b/],
      ]),
    ).toEqual([]);
  });
});
