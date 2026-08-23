/**
 * حارسٌ سلبيٌّ على النقاء: لا ساعةَ مخفيّة، ولا شبكة، ولا قاعدةَ بيانات، ولا **مال**، ولا عقوبة.
 *
 * تُمسح كلُّ ملفات `src/` (خارج `__tests__/`) **بعد حذف التعليقات** ثم يُبحث في الكود
 * الفعليّ عن أنماطٍ محرَّمة. وحذفُ التعليقات ليس تفصيلاً: الشرحُ في هذه الخدمة يقول صراحةً
 * «لا `Date.now()` هنا ولا `setTimeout`» و«لا مبلغَ ولا عملة»، فحارسٌ يقرأ النثرَ يُفشل
 * نفسَه على الشرح الصحيح ويجعل أرخصَ إصلاحٍ هو حذفَ الشرح — وذاك أسوأُ من غياب الحارس
 * (HANDOFF §16-ج، وسابقةُ `services/reputation/src/__tests__/purity.test.ts`).
 *
 * ولِمَ حارسٌ نصّيٌّ ولم يكفِ الاختبارُ السلوكيّ؟ لأنّ `Date.now()` واحداً يُدسّ في دالّةٍ
 * مساعدةٍ يمرّ من كلّ اختبارٍ سلوكيّ (الساعةُ الحقيقيةُ ساعةٌ صحيحةٌ اليوم) ثم يظهر أوّلَ
 * مرّةٍ كاختبارٍ مُتقلّبٍ عند منتصف الليل، أو كحالةِ سائقٍ لا تُشرح بعد شهر.
 *
 * ## الاستثناءات في هذه المراجعة: **لا شيء**
 *
 * المراجعةُ 2/6 مجالٌ نقيٌّ بلا قاعدةٍ وبلا HTTP وبلا مُشغّل، فكلُّ القوائم أدناه فارغةٌ
 * صراحةً ومحروسةٌ باختبارٍ موجَبٍ يُثبت أنّ **مجموعةَ الملفات المطابقةِ لكلّ نمطٍ تساوي
 * القائمةَ بالضبط** — لا أقلَّ ولا أكثر. فيومَ تُدخل المراجعةُ 3/6 مُهيئَ Drizzle سيفشل
 * الاختبارُ الموجَبُ لا السلبيُّ وحده، فلا يمرّ استيرادٌ لقاعدةٍ بلا قرارٍ موثَّقٍ يُسمّي ملفَّه.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
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

function scan(
  patterns: ReadonlyArray<readonly [string, RegExp]>,
  exempt: ReadonlySet<string> = new Set(),
): readonly Offence[] {
  const offences: Offence[] = [];
  for (const path of sourceFiles()) {
    const file = relative(SRC, path).split(sep).join("/");
    if (exempt.has(file)) continue;
    const code = codeOnly(path);
    for (const [label, pattern] of patterns) {
      if (pattern.test(code)) offences.push({ file, pattern: label });
    }
  }
  return offences;
}

/** يُحسب الواقعُ من المصدر لا من القائمة — هذا ما يجعل الاستثناءَ شدّاً لا تخفيفاً. */
function filesMatching(pattern: RegExp): readonly string[] {
  return sourceFiles()
    .filter((path) => pattern.test(codeOnly(path)))
    .map((path) => relative(SRC, path).split(sep).join("/"))
    .sort();
}

/** قوائمُ الاستثناءِ المُعلَنة لهذه المراجعة — فارغةٌ كلُّها، ومحروسةٌ موجَباً. */
const REAL_CLOCK_FILES: readonly string[] = [];
const ENV_READING_FILES: readonly string[] = [];
const DB_AWARE_FILES: readonly string[] = [];
const HTTP_AWARE_FILES: readonly string[] = [];

describe("مسحُ المصدر", () => {
  it("يجد ملفاتٍ فعلاً — فلا يمرّ الحارسُ على قائمةٍ فارغة", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files.some((path) => path.endsWith("index.ts"))).toBe(true);
    expect(files.some((path) => path.endsWith(join("domain", "state.ts")))).toBe(true);
  });

  it("حذفُ التعليقات يعمل على النمطين", () => {
    const sample = codeOnly(join(SRC, "domain", "time.ts"));
    expect(sample).not.toContain("اللحظةُ تدخل من الحاقن");
    expect(sample).toContain("export function");
  });
});

describe("لا ساعةَ مخفيّة", () => {
  it("لا Date.now ولا new Date() بلا وسيطٍ ولا مؤقّت ولا نوم ولا عشوائيّة", () => {
    expect(
      scan(
        [
          ["Date.now", /\bDate\s*\.\s*now\s*\(/],
          ["new Date() بلا وسيط", /new\s+Date\s*\(\s*\)/],
          ["setTimeout", /\bsetTimeout\s*\(/],
          ["setInterval", /\bsetInterval\s*\(/],
          ["setImmediate", /\bsetImmediate\s*\(/],
          ["sleep", /\bsleep\s*\(/],
          ["Math.random", /\bMath\s*\.\s*random\s*\(/],
          ["performance.now", /\bperformance\s*\.\s*now\s*\(/],
          ["crypto.randomUUID", /randomUUID\s*\(/],
        ],
        new Set(REAL_CLOCK_FILES),
      ),
    ).toEqual([]);
  });

  it("ومن يقرأ ساعةَ النظام: لا أحد — والقائمةُ المُعلَنةُ فارغةٌ بالضبط", () => {
    expect(filesMatching(/\bDate\s*\.\s*now\s*\(|new\s+Date\s*\(\s*\)/)).toEqual([
      ...REAL_CLOCK_FILES,
    ]);
  });

  it("`new Date(x)` بوسيطٍ مسموحٌ — تحويلُ صيغةٍ لا قراءةُ ساعة", () => {
    /**
     * الفرقُ كلُّه في الوسيط: `new Date(millis)` دالّةُ تحويلٍ نقيّةٌ تُعطي نفسَ المخرج
     * لنفس المدخل أبداً، و`new Date()` قراءةُ ساعةِ النظام من داخل المجال. ومنعُ الأولى
     * كان سيدفع إلى حسابِ تقويمٍ يدويٍّ أسوأَ من المكتبة القياسية.
     */
    const time = codeOnly(join(SRC, "domain", "time.ts"));
    expect(time).toContain("new Date(");
    expect(/new\s+Date\s*\(\s*\)/.test(time)).toBe(false);
  });

  it("ولا مُجدولَ داخليّاً — النبضةُ هي الزمنُ المُعلَن (القرار 5)", () => {
    expect(
      scan([
        ["cron", /\bcron\b/],
        ["schedule(", /\bschedule\s*\(/],
        ["queue.add", /\bqueue\s*\.\s*add\s*\(/],
      ]),
    ).toEqual([]);
  });
});

describe("لا شبكةَ ولا قاعدةَ بيانات ولا نظامَ ملفات", () => {
  it("لا استدعاءَ شبكةٍ ولا قراءةَ ملفٍّ ولا بيئةَ نظام", () => {
    expect(
      scan(
        [
          ["fetch", /\bfetch\s*\(/],
          ["axios", /from\s+["']axios["']/],
          ["node:http(s)", /from\s+["']node:https?["']/],
          ["node:fs", /from\s+["']node:fs["']/],
          ["node:child_process", /from\s+["']node:child_process["']/],
          ["process.env", /\bprocess\s*\.\s*env\b/],
        ],
        new Set(ENV_READING_FILES),
      ),
    ).toEqual([]);
  });

  it("ومن يقرأ بيئةَ النظام: لا أحد — بالضبط", () => {
    expect(filesMatching(/\bprocess\s*\.\s*env\b/)).toEqual([...ENV_READING_FILES]);
  });

  it("لا مُشغّلَ قاعدةٍ ولا ORM ولا HTTP في أيّ ملف", () => {
    expect(
      scan([
        ["pg", /from\s+["']pg["']/],
        ["drizzle", /from\s+["'][^"']*drizzle[^"']*["']/],
        ["fastify", /from\s+["']fastify["']/],
        ["SQL نصّاً", /\b(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/],
      ]),
    ).toEqual([]);
  });

  it("ومن يعرف القاعدةَ أو HTTP: لا أحد — بالضبط", () => {
    expect(filesMatching(/from\s+["']pg["']|from\s+["'][^"']*drizzle-orm[^"']*["']/)).toEqual([
      ...DB_AWARE_FILES,
    ]);
    expect(filesMatching(/from\s+["']fastify["']/)).toEqual([...HTTP_AWARE_FILES]);
  });

  it("التبعيّةُ المُعلَنةُ حزمةُ العقد وحدَها", () => {
    /**
     * القائمةُ مكتوبةٌ صريحةً حتى تسقط أوّلُ تبعيّةٍ تُضاف بلا قرارٍ موثَّق: مكتبةُ تحقّقٍ
     * أو ORM أو عميلُ HTTP في طبقةِ مجالٍ يعني أنّ المجالَ صار يعرف مخزنَه أو شبكتَه.
     */
    const manifest: unknown = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8"));
    const dependencies = (manifest as { readonly dependencies?: Record<string, string> })
      .dependencies;
    expect(Object.keys(dependencies ?? {}).sort()).toEqual(["@wasla/contracts-subscription"]);
  });

  it("لا استيرادَ يعبر حدَّ الحزمة إلى خدمةٍ أخرى", () => {
    expect(
      scan([
        ["استيراد يعبر الحد", /from\s+["']\.\.\/\.\.\/\.\.\//],
        ["services/", /from\s+["'][^"']*\/services\//],
      ]),
    ).toEqual([]);
  });
});

describe("لا مالَ في هذه الخدمة (القرار 6)", () => {
  it("لا مبلغَ ولا عملةَ ولا سعرَ ولا ضريبةَ ولا فاتورةَ ولا وسيلةَ دفع", () => {
    /**
     * أقوى حارسٍ في هذا الملف. الخدمةُ تعرف **مرجعاً opaque** واحداً اسمُه
     * `paymentReference` ولا شيءَ غيره؛ وأوّلُ حقلٍ باسم `amount` أو `currency` يجعل
     * مستهلكاً يُرسل مبلغاً، ثم تصير هذه الخدمةُ مخزناً لبياناتِ سدادٍ لا حرّاسَ لها ولا
     * مالكَ. الفوترةُ يملكها Phase 17.
     *
     * والنمطُ يستثني `paymentReference` و`payment_reference` صراحةً: المنعُ على المعنى
     * الماليّ لا على كلمة `payment` نفسِها.
     */
    expect(
      scan([
        ["amount", /\bamount\b/i],
        ["currency", /\bcurrency\b/i],
        ["price", /\bprice\b/i],
        ["SAR", /\bSAR\b/],
        ["tax/vat", /\b(?:tax|vat)\b/i],
        ["invoice", /\binvoice\b/i],
        ["refund", /\brefund\b/i],
        ["balance/credit", /\b(?:balance|credits?|wallet)\b/i],
        ["card", /\bcard\b/i],
        ["iban", /\biban\b/i],
        ["gateway", /\bgateway\b/i],
      ]),
    ).toEqual([]);
  });

  it("ومرجعُ الدفع موجودٌ فعلاً — فالحارسُ يمنع المعنى لا الكلمة", () => {
    const model = codeOnly(join(SRC, "domain", "model.ts"));
    expect(model).toContain("paymentReference");
  });
});

describe("لا عقوبةَ ولا حُكم (القرار 4)", () => {
  it("لا إيقافَ ولا حظرَ ولا وسمَ محتال", () => {
    /**
     * `community` **أرضيّةُ استحقاقٍ لا عقوبة**. والاسمُ هو الآليّة: أوّلُ حقلٍ باسم
     * `isSuspended` يجعل كلَّ مستهلكٍ يقرؤه ويتصرّف به، فيصير القرارُ الإداريُّ ملكاً
     * لخدمةٍ لا تملكه (`services/drivers` وPhase 15).
     */
    expect(
      scan([
        ["isSuspended", /\bis_?[Ss]uspended\b/],
        ["isBanned", /\bis_?[Bb]anned\b/],
        ["isBlocked", /\bis_?[Bb]locked\b/],
        ["suspendedUntil", /\bsuspended_?[Uu]ntil\b/],
        ["penalty", /\bpenalt(?:y|ies)\b/i],
        ["punish", /\bpunish\w*/i],
        ["isFraudster", /\bis_?[Ff]raudster\b/],
      ]),
    ).toEqual([]);
  });

  it("لا نصَّ حرًّا يعبر المجال", () => {
    expect(
      scan([
        ["comment", /\bcomment\s*[?:]/],
        ["note", /\bnote\s*[?:]/],
        ["body", /\bbody\s*[?:]/],
        ["freeText", /\bfree_?[Tt]ext\b/],
      ]),
    ).toEqual([]);
  });

  it("ولا جدولَ انتقالاتٍ ثانياً في الخدمة", () => {
    /**
     * الحارسُ الذي يمنع أخطرَ نسخةٍ خاطئة: قائمةَ أزواجِ حالاتٍ مكتوبةً بيدٍ ثانيةٍ في
     * `transitions.ts`. الجدولُ الوحيدُ في حزمة العقد، وهذا الملفُّ **يقرؤه** بالاسم.
     */
    const transitions = codeOnly(join(SRC, "domain", "transitions.ts"));
    expect(transitions).toContain("SUBSCRIPTION_ALLOWED_TRANSITIONS");
    expect(/\[\s*["']trial["']\s*,\s*["']active["']\s*\]/.test(transitions)).toBe(false);
    expect(/\[\s*null\s*,\s*["']trial["']\s*\]/.test(transitions)).toBe(false);
  });
});
