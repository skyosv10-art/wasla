/**
 * حارسٌ سلبيٌّ على النقاء: لا ساعةَ مخفيّة، ولا شبكة، ولا قاعدةَ بيانات، ولا حذفَ صفٍّ، ولا بحث.
 *
 * تُمسح كلُّ ملفات `src/` (خارج `__tests__/`) **بعد حذف التعليقات** ثم يُبحث في الكودِ
 * الفعليّ عن أنماطٍ محرَّمة. وحذفُ التعليقات ليس تفصيلاً: شرحُ `domain/time.ts` يقول صراحةً
 * «ولا `Date.now()` في المجالِ بحال»، فحارسٌ يقرأ النثرَ يُفشل نفسَه على الشرحِ الصحيحِ
 * ويجعل أرخصَ إصلاحٍ هو حذفَ الشرح — وذاك أسوأُ من غيابِ الحارس (سابقةُ
 * `services/subscriptions/src/__tests__/purity.test.ts` و`services/reputation/…`).
 *
 * ولِمَ حارسٌ نصّيٌّ ولم يكفِ الاختبارُ السلوكيّ؟ لأنّ `Date.now()` واحداً يُدسّ في دالّةٍ
 * مساعدةٍ يمرّ من كلّ اختبارٍ سلوكيّ (الساعةُ الحقيقيةُ ساعةٌ صحيحةٌ اليوم) ثمّ يظهر أوّلَ
 * مرّةٍ كاختبارٍ مُتقلّبٍ عند منتصفِ الليل، أو كحالةِ متجرٍ لا تُشرح بعد شهر.
 *
 * ## قوائمُ الاستثناءِ في هذه المراجعة: **فارغةٌ كلُّها**
 *
 * المراجعةُ 2/6 مجالٌ نقيٌّ بلا قاعدةٍ ولا خادمٍ ولا مُهاجرة، فكلُّ قائمةِ استثناءٍ أدناه
 * فارغةٌ **بالنصّ**، وكلُّ قائمةٍ محروسةٌ باختبارٍ موجَبٍ يُثبت أنّ مجموعةَ الملفاتِ المطابقةِ
 * للنمطِ تساوي القائمةَ بالضبط — لا أقلَّ ولا أكثر. ويومَ تُدخل المراجعةُ 3/6 مُهيئَ
 * Drizzle و`db/migrate-cli.ts` سيفشل الاختبارُ **الموجَبُ** لا السلبيُّ وحده، فتُحدَّث
 * القوائمُ **بأسمائها** ولا يُبطَل حارسٌ ولا يُوسَّع نمط. والقوائمُ مفصولةٌ عن بعضها بقصد:
 * قارئُ نصِّ العقدِ ليس قارئَ البيئةِ، وقائمةٌ واحدةٌ للاثنَين كانت ستُبيح البيئةَ لمن
 * يحتاج الملفَّ وحدَه.
 *
 * وأخصُّ ما يحرسه هذا الملفُّ من قراراتِ ADR-016: **لا جدولَ انتقالاتٍ ثانياً** (القرار 1)،
 * **لا ساعةَ تُقرَّر بها موافقة** (القرار 2)، **لا عمودَ ظهورٍ مُخزَّن** (القرار 3)، **لا
 * كسرَ في السعر** (القرار 4)، **لا حذفَ صلبٍ ولا بحثَ نصّيّ** (القرار 10).
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

/** يُحسب الواقعُ من المصدرِ لا من القائمة — هذا ما يجعل الاستثناءَ شدّاً لا تخفيفاً. */
function filesMatching(pattern: RegExp): readonly string[] {
  return sourceFiles()
    .filter((path) => pattern.test(codeOnly(path)))
    .map((path) => relative(SRC, path).split(sep).join("/"))
    .sort();
}

/** قوائمُ الاستثناءِ المُعلَنةُ لهذه المراجعة — فارغةٌ كلُّها، ومحروسةٌ موجَباً. */
const REAL_CLOCK_FILES: readonly string[] = [];
const ENV_READING_FILES: readonly string[] = [];
const FS_READING_FILES: readonly string[] = [];
const DB_AWARE_FILES: readonly string[] = [];
const HTTP_AWARE_FILES: readonly string[] = [];

describe("مسحُ المصدر", () => {
  it("يجد ملفاتٍ فعلاً — فلا يمرّ الحارسُ على قائمةٍ فارغة", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThanOrEqual(12);
    expect(files.some((path) => path.endsWith("index.ts"))).toBe(true);
    expect(files.some((path) => path.endsWith(join("domain", "state.ts")))).toBe(true);
    expect(files.some((path) => path.endsWith(join("domain", "visibility.ts")))).toBe(true);
  });

  it("حذفُ التعليقات يعمل على النمطَين", () => {
    const sample = codeOnly(join(SRC, "domain", "time.ts"));
    expect(sample).not.toContain("ولا `Date.now()` في المجالِ بحال");
    expect(sample).toContain("export function");
  });

  it("وكلُّ ملفٍّ يقيم في `domain/` إلّا بابَ الحزمة", () => {
    /**
     * الشكلُ نفسُه حارس: مراجعةٌ اسمُها «طبقةُ مجالٍ نقيّة» لا يجوز أن تُخرج ملفاً واحداً
     * إلى `app/` أو `http/` قبل موعدِه. ويومَ تُدخل 3/6 مجلَّدَ `db/` سيسقط هذا الاختبارُ
     * فيُحدَّث بقرارٍ مكتوبٍ لا بحذفٍ صامت.
     */
    const outside = sourceFiles()
      .map((path) => relative(SRC, path).split(sep).join("/"))
      .filter((file) => !file.startsWith("domain/"));
    expect(outside).toEqual(["index.ts"]);
  });
});

describe("لا ساعةَ مخفيّة (القرار 2)", () => {
  it("لا Date.now ولا new Date() بلا وسيطٍ ولا مؤقّتَ ولا نومَ ولا عشوائيّة", () => {
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

  it("ولا مُجدولَ ولا نبضةَ اعتمادٍ — الاعتمادُ قرارُ إنسانٍ لا مرورُ وقت", () => {
    /**
     * أهمُّ حارسٍ زمنيٍّ في هذه الخدمة، ونصُّ القرار 2: خدمةُ الاشتراكاتِ تملك نبضةً لأنّ
     * انتهاءَ المدّةِ حقيقةٌ يصنعها الوقتُ وحدَه؛ أمّا اعتمادُ متجرٍ فحقيقةٌ يصنعها مُعتدِلٌ.
     * وأرخصُ نسخةٍ خاطئةٍ هي `tick(now)` تُعتمد المتاجرَ المُعلَّقةَ بعد ٧٢ ساعة — فيصير
     * «من اعتمد هذا المتجر؟» سؤالاً جوابُه «الساعة».
     */
    expect(
      scan([
        ["cron", /\bcron\b/],
        ["schedule(", /\bschedule\s*\(/],
        ["queue.add", /\bqueue\s*\.\s*add\s*\(/],
        ["tick(", /\btick\s*\(/],
        ["autoApprove", /\bauto_?[Aa]pprove\w*/],
        ["expiresAt", /\bexpires_?[Aa]t\b/],
      ]),
    ).toEqual([]);
  });

  it("والزمنُ يُقرأ نصّاً ويُحوَّل — `Date.parse` موجودٌ فعلاً فالغيابُ ليس غيابَ زمن", () => {
    const time = codeOnly(join(SRC, "domain", "time.ts"));
    expect(time).toContain("Date.parse(");
    expect(/new\s+Date\s*\(\s*\)/.test(time)).toBe(false);
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
          ["node:child_process", /from\s+["']node:child_process["']/],
          ["process.env", /\bprocess\s*\.\s*env\b/],
        ],
        new Set(ENV_READING_FILES),
      ),
    ).toEqual([]);
    expect(filesMatching(/\bprocess\s*\.\s*env\b/)).toEqual([...ENV_READING_FILES]);
  });

  it("ولا نظامَ ملفاتٍ في أيّ ملف — والقائمةُ فارغةٌ بالضبط", () => {
    expect(
      scan(
        [
          ["node:fs", /from\s+["']node:fs(?:\/promises)?["']/],
          ["readFileSync", /\breadFileSync\s*\(/],
        ],
        new Set(FS_READING_FILES),
      ),
    ).toEqual([]);
    expect(filesMatching(/from\s+["']node:fs(?:\/promises)?["']/)).toEqual([...FS_READING_FILES]);
  });

  it("لا مُشغّلَ قاعدةٍ ولا ORM ولا إطارَ HTTP ولا SQL نصّاً", () => {
    /**
     * منعُ SQL النصّيّ يبقى **بلا استثناء** حتى بعد دخولِ القاعدةِ في 3/6: المخزنُ سيستعمل
     * مُنشئَ استعلامات Drizzle فيبقى اسمُ كلّ عمودٍ مقروناً بالمرآةِ التي يحرسها اختبارُ
     * الانحراف. واستعلامٌ نصّيٌّ في `src/` كان سيصير مصدرَ أسماءٍ ثالثاً لا يقارنه حارس —
     * يمرّ في البناءِ ويُرفض في القاعدة.
     */
    expect(
      scan(
        [
          ["pg", /from\s+["']pg["']/],
          ["drizzle", /from\s+["'][^"']*drizzle[^"']*["']/],
        ],
        new Set(DB_AWARE_FILES),
      ),
    ).toEqual([]);
    expect(scan([["fastify", /from\s+["']fastify["']/]], new Set(HTTP_AWARE_FILES))).toEqual([]);
    expect(
      scan([["SQL نصّاً", /\b(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/]]),
    ).toEqual([]);
  });

  it("ومن يعرف المُشغّلَ أو الإطارَ: لا أحد — والقائمتان فارغتان بالضبط", () => {
    expect(filesMatching(/from\s+["']pg["']|from\s+["'][^"']*drizzle-orm[^"']*["']/)).toEqual([
      ...DB_AWARE_FILES,
    ]);
    expect(filesMatching(/from\s+["']fastify["']/)).toEqual([...HTTP_AWARE_FILES]);
  });

  it("التبعيّةُ المُعلَنةُ واحدةٌ: حزمةُ العقدِ وحدَها", () => {
    /**
     * القائمةُ مكتوبةٌ صريحةً حتى تسقط أوّلُ تبعيّةٍ تُضاف بلا قرارٍ موثَّق: مكتبةُ تحقّقٍ
     * أو عميلُ HTTP أو مُجدولٌ هنا يعني أنّ الخدمةَ صارت تفعل ما لم تُعلنه هذه المراجعة.
     * و`pg` و`drizzle-orm` تدخلان بقرارِ المراجعة 3/6 لا قبلَها.
     */
    const manifest: unknown = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8"));
    const dependencies = (manifest as { readonly dependencies?: Record<string, string> })
      .dependencies;
    expect(Object.keys(dependencies ?? {}).sort()).toEqual(["@wasla/contracts-marketplace"]);
  });

  it("لا استيرادَ يعبر حدَّ الحزمةِ إلى خدمةٍ أخرى", () => {
    expect(
      scan([
        ["استيراد يعبر الحد", /from\s+["']\.\.\/\.\.\/\.\.\//],
        ["services/", /from\s+["'][^"']*\/services\//],
      ]),
    ).toEqual([]);
  });
});

describe("لا جدولَ انتقالاتٍ ثانياً (القرار 1)", () => {
  it("جدولا المتجرِ والمنتجِ يُقرآن من العقدِ بالاسمِ ولا يُنسَخان أزواجاً", () => {
    /**
     * الحارسُ الذي يمنع أخطرَ نسخةٍ خاطئة: قائمةَ أزواجِ حالاتٍ مكتوبةً بيدٍ ثانيةٍ في
     * `transitions.ts`. الجدولُ الوحيدُ في حزمةِ العقد، وهذا الملفُّ **يقرؤه** بالاسم.
     */
    const transitions = codeOnly(join(SRC, "domain", "transitions.ts"));
    expect(transitions).toContain("STORE_ALLOWED_TRANSITIONS");
    expect(transitions).toContain("PRODUCT_ALLOWED_TRANSITIONS");
    for (const pair of [
      /\[\s*["']draft["']\s*,\s*["']pending_review["']\s*\]/,
      /\[\s*["']pending_review["']\s*,\s*["']approved["']\s*\]/,
      /\[\s*["']approved["']\s*,\s*["']suspended["']\s*\]/,
      /\[\s*["']draft["']\s*,\s*["']published["']\s*\]/,
      /\[\s*null\s*,\s*["']draft["']\s*\]/,
    ]) {
      expect(pair.test(transitions)).toBe(false);
    }
  });

  it("وجدولُ الاعتدالِ الوحيدُ المُعلَنُ محلّيّاً مُقيَّدٌ بثلاثةِ أزواجٍ لا يزيد", () => {
    /**
     * الاستثناءُ الوحيدُ، وله قرارٌ مكتوبٌ في `transitions.ts`: العقدُ يُعلن حالاتِ
     * الاعتدالِ الثلاثَ ولا يُعلن جدولَ أزواجِها، فالجدولُ يُعلَن هنا مرّةً واحدةً بدلاً من
     * أن يُستنبَط في كلِّ نداءٍ بشروطٍ متفرّقة. وهذا الاختبارُ يُقفل الاستثناءَ على مقاسه:
     * ثلاثةُ أزواجٍ بأسمائها ولا رابعَ — فلو أُضيف `approved → rejected` غداً لسقط.
     */
    const transitions = codeOnly(join(SRC, "domain", "transitions.ts"));
    expect(transitions).toContain("PRODUCT_MODERATION_ALLOWED_TRANSITIONS");

    // يُقتطَع جسمُ الإعلانِ وحدَه: قائمةُ أسبابٍ في الملفِّ ليست جدولَ أزواجٍ وإن تشابه شكلُها.
    const start = transitions.indexOf("PRODUCT_MODERATION_ALLOWED_TRANSITIONS");
    const end = transitions.indexOf("];", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = transitions.slice(start, end);

    const declared = block.match(/\[\s*(?:null|["'][a-z_]+["'])\s*,\s*["'][a-z_]+["']\s*\]/g);
    expect(declared).not.toBeNull();
    expect(new Set(declared)).toHaveLength(3);

    // ولا زوجَ حالاتِ اعتدالٍ يُعلَن خارجَ هذا الجسمِ في الملفّ.
    const outside = (transitions.slice(0, start) + transitions.slice(end)).match(
      /\[\s*(?:null|["'](?:pending|approved|rejected)["'])\s*,\s*["'](?:pending|approved|rejected)["']\s*\]/g,
    );
    expect(outside).toBeNull();
  });

  it("ولا حالةَ متجرٍ مُعادةٌ باسمِ قرارٍ: `reinstated` قرارٌ لا حالة", () => {
    const transitions = codeOnly(join(SRC, "domain", "transitions.ts"));
    expect(transitions).toContain("reinstated");
    expect(/STORE_STATES\s*=\s*\[/.test(transitions)).toBe(false);
  });
});

describe("لا ظهورَ مُخزَّنٌ ولا كسرَ في السعر (القرارَان 3 و4)", () => {
  it("لا حقلَ ظهورٍ مُخزَّنٍ في أيّ ملفِّ مجال", () => {
    /**
     * القرارُ 3 يقول: الظهورُ اقترانٌ يُحسَب لا عمودٌ يُكتَب. وأوّلُ حقلٍ باسم `isVisible`
     * في نموذجٍ يجعل مستهلكاً يقرؤه ويتصرّف به، فيصير عمودٌ راكدٌ يخالف الحقيقةَ عند أوّلِ
     * إيقافِ متجرٍ لم يُعِد الحسابَ. والدالّةُ `isVisible` مسموحةٌ — الحارسُ على الحقلِ
     * المُخزَّنِ لا على الحساب.
     */
    expect(
      scan([
        ["is_visible", /\bis_visible\b/],
        ["isVisible حقلاً", /\bisVisible\s*[?]?\s*:/],
        ["visibleAt", /\bvisible_?[Aa]t\b/],
        ["visibilityState", /\bvisibility_?[Ss]tate\b/],
      ]),
    ).toEqual([]);
    expect(codeOnly(join(SRC, "domain", "visibility.ts"))).toContain("export function isVisible");
  });

  it("لا كسرَ ولا تنسيقَ عملةٍ ولا حسابَ عائمٍ في السعر", () => {
    /**
     * القرارُ 4: السعرُ عددٌ صحيحٌ بالهللات، والعرضُ شأنُ الواجهة. وأوّلُ `toFixed(2)` أو
     * `Intl.NumberFormat` هنا يجعل المجالَ يُنتج نصّاً يظنّه المستهلكُ رقماً، ثمّ يُقارَن
     * قرشٌ بقرشٍ في مكانٍ لا يعرف أنّ الفاصلةَ عائمة.
     */
    expect(
      scan([
        ["toFixed", /\btoFixed\s*\(/],
        ["parseFloat", /\bparseFloat\s*\(/],
        ["Intl", /\bIntl\b/],
        ["Math.round", /\bMath\s*\.\s*round\s*\(/],
        ["قسمةٌ على مئة", /\/\s*100\b/],
        ["priceDecimal", /\bprice_?(?:[Dd]ecimal|[Ff]loat|[Mm]ajor)\b/],
      ]),
    ).toEqual([]);
    expect(codeOnly(join(SRC, "domain", "pricing.ts"))).toContain("Number.isSafeInteger");
  });
});

describe("لا حذفَ صلبٌ ولا بحثٌ (القرار 10)", () => {
  it("لا حذفَ صفٍّ ولا تفريغَ جدولٍ في أيّ ملف", () => {
    /**
     * القرارُ 10: لا حذفَ صلباً — المتجرُ يُؤرشَف والعضوُ يُختَم بـ`removed_at`. والحارسُ
     * نصّيٌّ لأنّ اختباراً سلوكيّاً لا يرى حذفاً لم يُنادِه أحدٌ بعد؛ ويومَ يحتاج ملفٌّ
     * تعديلاً سيُضاف الاستثناءُ باسمِه وقرارٍ مكتوبٍ يشرح لماذا — لا بتوسيعِ نمط.
     */
    expect(
      scan([
        ["db.delete(", /\b(?:db|tx)\s*\.\s*delete\s*\(/],
        ["hardDelete", /\bhard_?[Dd]elete\w*/],
        ["TRUNCATE", /\bTRUNCATE\b/],
        ["DROP TABLE", /\bDROP\s+TABLE\b/],
        ["deletedAt", /\bdeleted_?[Aa]t\b/],
      ]),
    ).toEqual([]);
  });

  it("والختمُ موجودٌ فعلاً — فالغيابُ ليس غيابَ إزالة", () => {
    const staff = codeOnly(join(SRC, "domain", "staff.ts"));
    expect(staff).toContain("removedAt");
    expect(staff).toContain("sealStaffRemoval");
  });

  it("ولا بحثَ نصّيٍّ ولا فهرسَ كلماتٍ في المجال", () => {
    /**
     * القرارُ 10 يُخرج البحثَ من هذه الخدمةِ صراحةً: الاستعراضُ بالتصنيفِ وبالمتجر، وأمّا
     * البحثُ فتملكه Phase 14. وأرخصُ نسخةٍ خاطئةٍ هي `includes(query)` على العنوانِ — تمرّ
     * على ألفِ منتجٍ ثمّ تصير عقبةَ أداءٍ وواجهةً غيرَ مُعلَنةٍ في عقدٍ لا يذكرها.
     */
    expect(
      scan([
        ["search", /\bsearch\w*\s*[(:]/i],
        ["tsvector", /\bts_?vector\b/i],
        ["ILIKE", /\bILIKE\b/i],
        ["fullText", /\bfull_?[Tt]ext\b/],
        ["relevance", /\brelevance\b/i],
      ]),
    ).toEqual([]);
  });
});
