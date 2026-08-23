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
 *
 * ومنذ المراجعة 3/6 صار للمسح استثناءٌ واحدٌ مُسمّى: ملفّاتُ مُهيئ Drizzle وحدها
 * تعرف أنّ PostgreSQL موجود، ويحرسها اختبارٌ موجَبٌ يُثبت أنّ المجموعةَ هي هي بالضبط.
 * الشرحُ الكامل عند `DB_AWARE_FILES` أدناه.
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
      if (pattern.test(code)) {
        offences.push({ file, pattern: label });
      }
    }
  }
  return offences;
}

/**
 * الملفّاتُ المسموحُ لها وحدها أن تستورد `pg` و`drizzle-orm` — أي أن تعرف أنّ PostgreSQL موجود.
 *
 * ## لماذا قائمةُ استثناءٍ ولم يبقَ المنعُ شاملاً كما في المراجعة 2/6
 *
 * حتى المراجعة 2/6 كانت الخدمةُ بلا استمرارية، فمنعُ `pg` و`drizzle` في كلِّ `src/` كان
 * منعاً بلا استثناءٍ لأنّه لم يُحتَجْ إلى واحد. والمراجعةُ 3/6 تُدخل المُهيئ، فإمّا أن
 * يُصرَّح بمكانه أو يُحذف الحارسُ — والثاني هو التخفيف الحقيقيّ.
 *
 * وهذا ليس تضييقاً للحارس بل شدٌّ له، ودليلُه ثلاثةُ أمور:
 *
 *   1. كلُّ ملفٍّ خارج هذه القائمة يبقى ممسوحاً بـ**كلِّ** الأنماط كما كان — لا مجلّدَ
 *      أُخرج من المسح، بما فيه `infrastructure/in-memory.ts`.
 *   2. الأنماطُ الأخرى (`fetch`، `node:fs`، `process.env`، `Date.now`، العقوبة، النصّ
 *      الحرّ) تُطبَّق على الأربعةِ أيضاً بلا استثناء: مُهيئُ القاعدة يقرأ ساعةَ الحاقن
 *      ويستقبل نصَّ الاتصال وسيطاً، ولا يقرأ بيئةً ولا ملفاً.
 *   3. اختبارٌ **موجَبٌ** يُثبت أنّ مجموعةَ الملفات التي تستورد `pg`/`drizzle-orm` تساوي
 *      هذه القائمةَ تماماً — فالقائمةُ لا تتّسع بالإهمال ولا تبقى بعد حذف مُهيئها.
 *
 * الأمرُ الثالث هو الفرقُ الجوهريّ: المنعُ الشامل كان يقول «لا أحد»، وهذا يقول «هؤلاء
 * وحدهم ولا غيرُهم» — وهو قولٌ أقوى، لأنّه يُفشِل نفسَه على استيرادٍ زائدٍ **وعلى**
 * استيرادٍ ناقص. والمُوثَّقُ في `docs/02-architecture/REPUTATION_PERSISTENCE.md`
 * §الانحرافات.
 */
const DB_DRIVER_FILES: readonly string[] = [
  // المراجعة 4/6: `http/server.ts` يستورد نوعَ `Pool` وحدَه ليُغلقه عند الإطفاء — لا استعلامَ
  // فيه ولا جدول. وأُدرج هنا لا في القائمة الأوسع لأنّ الاختبارَ الموجَبَ أدناه يُحسب من
  // المصدر: مَن يذكر `pg` يظهر فيه سواءٌ استورد نوعاً أو قيمةً، وإخفاؤه كان سيلزم تعمية الحارس.
  "http/server.ts",
  "infrastructure/drizzle/db.ts",
  "infrastructure/drizzle/repository.ts",
  "infrastructure/drizzle/schema.ts",
];

/**
 * ومن يجوز له أن **يذكر** مُهيئَ Drizzle بمساره: الثلاثةُ أعلاه، ووحدةُ العمل
 * التي تربطها، والمُشغّلُ الذي يركّبها.
 *
 * والفرقُ بين القائمتين مقصودٌ: `transaction.ts` و`runner.ts` لا يعرفان `pg` ولا
 * `drizzle-orm` — لا استعلامَ فيهما ولا جدولَ، بل تركيبٌ لمنافذٍ حول مقبضٍ. والحارسُ
 * يُميّز المرتبتين بدل أن يخلطهما تحت «ملفاتُ قاعدة».
 */
const DB_PATH_AWARE_FILES: readonly string[] = [
  ...DB_DRIVER_FILES,
  "infrastructure/drizzle/transaction.ts",
  "runner.ts",
];

/**
 * ومنذ المراجعة 4/6 استثناءان مُسمّيان آخران، وكلٌّ منهما محروسٌ باختبارٍ موجَبٍ مثلَ الأوّل.
 *
 * ### الساعةُ والمُعرّفاتُ الحقيقيّة
 *
 * الخدمةُ كلُّها تأخذ اللحظةَ من الحاقن، لكنّ **أحداً** في مكانٍ ما يجب أن يقرأ ساعةَ
 * النظام فعلاً وإلّا وقف الخادمُ عند لحظةٍ ثابتة. والمنعُ الشامل كان معناه أن يُهيَّأ
 * ذلك في ملفٍّ لا يُمسَح أصلاً (`server.ts` مثلاً مع بقيّة تركيبه) فيضيع بين أسطرِ
 * الإقلاع؛ وهذا يُخرجه إلى ملفٍّ واحدٍ اسمُه يقول ما فيه، ويُثبت أنّه وحده.
 */
const REAL_CLOCK_FILES: readonly string[] = ["infrastructure/runtime.ts"];

/**
 * ### قراءةُ بيئة النظام
 *
 * `http/server.ts` هو الموضعُ الوحيد الذي يقرأ `process.env`، وهذا حدُّ التهيئة: ما
 * دخل منه يصير وسائطَ صريحةً لدوالٍّ نقيّة. وقراءةُ البيئة في `app.ts` أو في المحوّلات
 * كانت ستجعل اختباراً واحداً يتصرّف تصرّفين حسب صدفةِ متغيّرٍ في الطرفيّة.
 */
const ENV_READING_FILES: readonly string[] = ["http/server.ts"];

/** يُحسب الواقعُ من المصدر لا من القائمة — هذا ما يجعل الاستثناءَ شدّاً لا تخفيفاً. */
function filesMatching(pattern: RegExp): readonly string[] {
  return sourceFiles()
    .filter((path) => pattern.test(codeOnly(path)))
    .map((path) => relative(SRC, path).split(sep).join("/"))
    .sort();
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
      ], new Set(REAL_CLOCK_FILES)),
    ).toEqual([]);

    // العشوائيّةُ لا استثناءَ لها في أيِّ ملفٍّ: مُولّدُ المُعرّفات يستعمل `crypto.randomUUID`،
    // و`Math.random` في مُعرّفٍ يعني تكراراً محتملاً في مفتاحٍ يُفترض تفرّدُه.
    expect(
      scan([
        ["Math.random", /\bMath\s*\.\s*random\s*\(/],
        ["performance.now", /\bperformance\s*\.\s*now\s*\(/],
      ]),
    ).toEqual([]);
  });

  it("ومن يقرأ ساعةَ النظام هذا الملفُّ بالضبط — لا أقلَّ ولا أكثر", () => {
    expect(filesMatching(/\bDate\s*\.\s*now\s*\(|new\s+Date\s*\(\s*\)/)).toEqual([
      ...REAL_CLOCK_FILES,
    ]);
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
  it("لا استدعاءَ شبكةٍ ولا قراءةَ ملفٍّ ولا بيئةَ نظامٍ — في أيِّ ملفٍّ بلا استثناء", () => {
    expect(
      scan([
        ["fetch", /\bfetch\s*\(/],
        ["axios", /from\s+["']axios["']/],
        ["http", /from\s+["']node:https?["']/],
        ["node:fs", /from\s+["']node:fs["']/],
        ["node:child_process", /from\s+["']node:child_process["']/],
        ["process.env", /\bprocess\s*\.\s*env\b/],
      ], new Set(ENV_READING_FILES)),
    ).toEqual([]);
  });

  it("ومن يقرأ بيئةَ النظام هذا الملفُّ بالضبط — لا أقلَّ ولا أكثر", () => {
    expect(filesMatching(/\bprocess\s*\.\s*env\b/)).toEqual([...ENV_READING_FILES]);
  });

  it("لا استيرادَ مُشغّلِ قاعدةٍ ولا دلالةَ على مُهيئه خارج القائمة", () => {
    expect(
      scan(
        [
          ["drizzle", /from\s+["'][^"']*drizzle[^"']*["']/],
          ["pg", /from\s+["']pg["']/],
        ],
        new Set(DB_PATH_AWARE_FILES),
      ),
    ).toEqual([]);
  });

  it("ومن يعرف `pg`/`drizzle-orm` هذه الملفاتُ بالضبط — لا أقلَّ ولا أكثر", () => {
    /**
     * الاختبارُ الموجَبُ الذي يمنع قائمةَ الاستثناء من أن تتحوّل إلى بابٍ مفتوح: يُحسب
     * الواقعُ من المصدر (من يستورد فعلاً `pg` أو `drizzle-orm`) ويُقارَن بالقائمة. فإن
     * ظهر مستوردٌ زائدٌ فشل الاختبار، وإن حُذف أحدُ المذكورين من المُهيئ فشل أيضاً — وهو
     * ما لا يستطيع منعٌ شاملٌ أن يفعله.
     */
    const importers = sourceFiles()
      .filter((path) => {
        const code = codeOnly(path);
        return (
          /from\s+["']pg["']/.test(code) || /from\s+["'][^"']*drizzle-orm[^"']*["']/.test(code)
        );
      })
      .map((path) => relative(SRC, path).split(sep).join("/"))
      .sort();
    expect(importers).toEqual([...DB_DRIVER_FILES]);
  });

  it("ولا ملفَّ من المُهيئ مُصدَّرٌ من نقطة الدخول", () => {
    /**
     * `index.ts` سطحُ الحزمة العامّ: تصديرُ `runner.ts` أو أيِّ ملفٍّ من `drizzle/` منه
     * كان سيجرّ `pg` إلى كلِّ من يستورد الخدمةَ — ومنهم حزمُ اختبارٍ لا قاعدةَ لها.
     * المراجعةُ 4/6 تستورد المُهيئَ بمسارِه الصريح.
     */
    const entry = codeOnly(join(SRC, "index.ts"));
    expect(entry).not.toContain("drizzle");
    expect(entry).not.toContain("runner");
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

  it("التبعيّاتُ المُعلَنةُ هي العقودُ ومُشغّلُ القاعدةِ وحدها — لا HTTP ولا سواه", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(join(SRC, "..", "package.json"), "utf8"),
    );
    const dependencies = (manifest as { readonly dependencies?: Record<string, string> })
      .dependencies;
    // المراجعة 4/6 تُدخل `fastify` وحدَها: لا مُصادقةً ولا ORM ثانياً ولا مكتبةَ تحقّقٍ —
    // التحقّقُ في `http/requests.ts` بكتالوجاتِ العقد، والقائمةُ مكتوبةٌ صريحةً حتى تسقط
    // أوّلُ تبعيّةٍ تُضاف بلا قرارٍ موثَّق.
    expect(Object.keys(dependencies ?? {}).sort()).toEqual([
      "@wasla/contracts-reputation",
      "drizzle-orm",
      "fastify",
      "pg",
    ]);
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
