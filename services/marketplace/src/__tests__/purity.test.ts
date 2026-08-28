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
 * ## قوائمُ الاستثناءِ بعد 3/6: تُحدَّث **بأسماءِ ملفاتٍ** لا بتوسيعِ نمط
 *
 * كانت كلُّ قائمةٍ فارغةً في 2/6 (مجالٌ نقيٌّ بلا قاعدةٍ ولا مُهاجرة)، وقيل هناك صراحةً: يومَ
 * تدخل 3/6 سيسقط الاختبارُ **الموجَبُ** لا السلبيُّ وحدَه فتُملأ القوائمُ بالأسماء. وقد وقع ذلك
 * حرفاً: سقطت ستُّ حالاتٍ موجَبةٍ في أوّلِ تشغيلٍ بعد إضافةِ `db/`، وهذا ما تقوله القوائمُ الآن:
 *
 * - `ENV_READING_FILES = ["db/migrate-cli.ts"]` — **ملفٌ واحدٌ** يقرأ `DATABASE_URL`، وهو طرفٌ
 *   تنفيذيٌّ لا يستورده أحد. ولو قرأ `client.ts` البيئةَ لصار كلُّ من يستورده يفتح اتّصالاً
 *   لا يراه في وسائطِه — وهذا أوّلُ ما يجعل اختباراً يمسُّ قاعدةً لم يطلبها.
 * - `FS_READING_FILES = ["db/migrate.ts"]` — ملفٌ واحدٌ يقرأ `contracts/schema.sql` ليُطبّقَه حرفاً.
 * - `DB_AWARE_FILES` — عشرةُ ملفاتٍ تحت `db/` وحدَها، ولا ملفَّ مجالٍ واحدٌ في القائمة: وهذا
 *   هو موضوعُ الحراسةِ أصلاً — القاعدةُ دخلت الخدمةَ ولم تدخل المجال.
 * - `REAL_CLOCK_FILES = ["app/runtime.ts"]` — **ملفٌ واحدٌ** فيه `new Date()`، وهو تنفيذُ
 *   `Clock` الوحيد في الخدمة. وساعةٌ تُقرأ في خدمةِ تطبيقٍ مباشرةً كانت ستجعل كلَّ اختبارٍ
 *   يعتمد على ساعةِ المُشغّل، والحقنُ يجعل الزمنَ وسيطاً يُثبَّت في الاختبار.
 * - `HTTP_AWARE_FILES = ["http/app.ts", "http/errors.ts"]` — الأوّلُ يبني الخادمَ ويُسجّل
 *   المسارات، والثاني يستورد `FastifyReply` **نوعاً وحدَه**. و`http/server.ts` ليس فيها: هو
 *   يستورد `createMarketplaceApp` ولا يعرف الإطارَ نصّاً — فالقائمةُ محسوبةٌ من المصدرِ لا
 *   من التوقّع.
 * - `ENV_READING_FILES` صارت ملفَّين في 4/6: `db/migrate-cli.ts` و`http/server.ts`، وهذا
 *   الحدُّ الأقصى المُعلَن.
 * - وقد كانت القائمتان الأولى والثانية فارغتَين قبل 4/6: لا إطارَ HTTP قبلها، ولا
 *   قارئَ ساعةٍ في الطبقةِ أبداً؛ الأزمنةُ إمّا وسيطٌ من المُنادي أو `DEFAULT now()` في القاعدةِ
 *   نفسِها. وملاحظةٌ دقيقة: `new Date(arg)` مسموحٌ والممنوعُ `Date.now()` و`new Date()` بلا
 *   وسيطٍ — فالتحويلُ ليس قراءةً للساعة.
 *
 * ومنعُ SQL النصّيّ ومنعُ الحذفِ الصلبِ بقيا **بلا استثناءٍ واحد** بعد دخولِ القاعدة، وهذا مقيسٌ
 * لا مأمول: لا `SELECT` ولا `INSERT INTO` ولا `DELETE FROM` ولا `TRUNCATE` في ملفٍ واحدٍ من
 * `src/` خارج الاختبارات. وقوالبُ `sql` في المستودعاتِ تحمل توابعَ القاعدةِ وحدَها
 * (`gen_random_uuid()` · `lower()` · `now()` · `coalesce`) لا أسماءَ جداولَ ولا أعمدةً، فيبقى
 * مصدرُ الأسماءِ واحداً: المرآةُ التي يحرسها `schema-drift.test.ts`.
 *
 * والقوائمُ مفصولةٌ عن بعضها بقصد: قارئُ نصِّ العقدِ ليس قارئَ البيئةِ، وقائمةٌ واحدةٌ للاثنَين
 * كانت ستُبيح البيئةَ لمن يحتاج الملفَّ وحدَه.
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

/** قوائمُ الاستثناءِ المُعلَنةُ بعد 3/6 — بأسماءِ ملفاتِها، ومحروسةٌ موجَباً. */
const REAL_CLOCK_FILES: readonly string[] = ["app/runtime.ts"];
const ENV_READING_FILES: readonly string[] = ["db/migrate-cli.ts", "http/server.ts"];
const FS_READING_FILES: readonly string[] = ["db/migrate.ts"];
const DB_AWARE_FILES: readonly string[] = [
  "db/categories.ts",
  "db/client.ts",
  "db/idempotency.ts",
  "db/ledger.ts",
  "db/migrate.ts",
  "db/outbox.ts",
  "db/projection.ts",
  "db/resources.ts",
  "db/schema.ts",
  "db/staff.ts",
];
const HTTP_AWARE_FILES: readonly string[] = ["http/app.ts", "http/errors.ts"];

/**
 * ملفاتُ الاستمراريّةِ المُعلَنةُ خارجَ `domain/` — مراجعةُ 3/6 وحدَها، ولا ملفَّ `app/`
 * ولا `http/` قبل موعدِهما في 4/6. والقائمةُ مكتوبةٌ حرفاً لا بنمطِ `db/**`: ملفٌ جديدٌ
 * في الطبقةِ يجب أن يُرى في مُراجعةٍ، لا أن يمرّ لأنّ مجلَّدَه مأذونٌ له.
 */
const PERSISTENCE_FILES: readonly string[] = [
  "db/categories.ts",
  "db/client.ts",
  "db/constraints.ts",
  "db/idempotency.ts",
  "db/index.ts",
  "db/ledger.ts",
  "db/migrate-cli.ts",
  "db/migrate.ts",
  "db/outbox.ts",
  "db/paging.ts",
  "db/projection.ts",
  "db/resources.ts",
  "db/rows.ts",
  "db/schema.ts",
  "db/staff.ts",
  "db/unit-of-work.ts",
];

/**
 * ملفاتُ طبقةِ التطبيقِ وطبقةِ HTTP — دخلتا في **مراجعةِ 4/6** بأسمائها.
 *
 * وثلاثةُ حدودٍ تُحرَس بالشكلِ هنا: `domain/` لا تعرف شيئاً من فوقِها، و`app/` تُنسّق ولا
 * تعرف الإطارَ، و`http/` تُصيغ ولا تفتح معاملةً. وقائمةٌ بنمطِ `app/**` كانت ستُبيح ملفاً
 * جديداً يخرق أحدَ هذه الحدودِ بلا أن يراه مُراجع.
 */
const APPLICATION_FILES: readonly string[] = [
  "app/catalog.ts",
  "app/context.ts",
  "app/cursor.ts",
  "app/idempotency.ts",
  "app/index.ts",
  "app/products.ts",
  "app/runtime.ts",
  "app/stores.ts",
];
const HTTP_FILES: readonly string[] = [
  "http/app.ts",
  "http/errors.ts",
  "http/mappers.ts",
  "http/requests.ts",
  "http/server.ts",
];

/**
 * حيث يُحسب الظهورُ ويُصاغ — ولا حيث يُخزَّن.
 *
 * القرارُ 3 يمنع **عمودَ ظهورٍ مُخزَّناً**، ولا يمنع العقدَ من إعلانِ `is_visible` في جوابِ
 * منتج: المستهلكُ يحتاج الحقيقةَ محسوبةً. فالحارسُ يبقى **بلا استثناءٍ واحدٍ** في `domain/`
 * و`db/` — لا حقلَ في مرآةِ الجدولِ ولا في سجلٍّ يُقرأ — ويُستثنى ملفّان: `app/products.ts`
 * تُشتقُّ فيه القيمةُ من دالّةِ المجالِ عند كلِّ قراءة، و`http/mappers.ts` يُسمّيها باسمِ العقد.
 */
const VISIBILITY_COMPUTED_FILES: readonly string[] = ["app/products.ts", "http/mappers.ts"];

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

  it("وكلُّ ملفٍّ يقيم في `domain/` أو `db/` أو `app/` أو `http/` إلّا بابَ الحزمة", () => {
    /**
     * الشكلُ نفسُه حارسٌ: لا يجوز أن يخرج ملفٌ إلى `app/` أو `http/` قبل موعدِه في 4/6.
     * وقد سقط هذا الاختبارُ عند دخولِ `db/` كما قيل في 2/6 أنّه سيسقط، فحُدِّث بقائمةٍ
     * مكتوبةٍ بأسماءِ ملفاتِها لا بإباحةِ مجلَّدٍ كامل.
     */
    const outside = sourceFiles()
      .map((path) => relative(SRC, path).split(sep).join("/"))
      .filter((file) => !file.startsWith("domain/"));
    expect(outside).toEqual([
      ...APPLICATION_FILES,
      ...PERSISTENCE_FILES,
      ...HTTP_FILES,
      "index.ts",
    ]);
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

  it("ومن يقرأ ساعةَ النظام: تنفيذُ `Clock` وحدَه — والقائمةُ المُعلَنةُ بالضبط", () => {
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

  it("ومن يعرف المُشغّلَ: `db/` وحدَها — ومن يعرف الإطارَ: ملفّا `http/` بأسمائهما", () => {
    expect(filesMatching(/from\s+["']pg["']|from\s+["'][^"']*drizzle-orm[^"']*["']/)).toEqual([
      ...DB_AWARE_FILES,
    ]);
    expect(filesMatching(/from\s+["']fastify["']/)).toEqual([...HTTP_AWARE_FILES]);
  });

  it("والتبعيّاتُ أربعٌ بأسمائها: العقدُ والمُشغّلُ ومُنشئُ الاستعلاماتِ والإطار", () => {
    /**
     * القائمةُ مكتوبةٌ صريحةً حتى تسقط أوّلُ تبعيّةٍ تُضاف بلا قرارٍ موثَّق: مكتبةُ تحقّقٍ
     * أو عميلُ HTTP أو مُجدولٌ هنا يعني أنّ الخدمةَ صارت تفعل ما لم تُعلنه هذه المراجعة.
     * وقُيل في 2/6: «`pg` و`drizzle-orm` تدخلان بقرارِ المراجعة 3/6 لا قبلَها» — وقد دخلتا،
     * وثالثةٌ لم تدخل: لا `drizzle-kit` ولا مُهاجرةٌ تُولَّد، فالمُهاجرةُ تُطبّق نصَّ العقدِ حرفاً.
     */
    const manifest: unknown = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8"));
    const dependencies = (manifest as { readonly dependencies?: Record<string, string> })
      .dependencies;
    expect(Object.keys(dependencies ?? {}).sort()).toEqual([
      "@wasla/contracts-marketplace",
      "drizzle-orm",
      "fastify",
      "pg",
    ]);
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
      scan(
        [
          ["is_visible", /\bis_visible\b/],
          ["isVisible حقلاً", /\bisVisible\s*[?]?\s*:/],
        ],
        new Set(VISIBILITY_COMPUTED_FILES),
      ),
    ).toEqual([]);
    expect(filesMatching(/\bis_visible\b|\bisVisible\s*[?]?\s*:/)).toEqual([
      ...VISIBILITY_COMPUTED_FILES,
    ]);
    expect(
      scan([
        ["visibleAt", /\bvisible_?[Aa]t\b/],
        ["visibilityState", /\bvisibility_?[Ss]tate\b/],
      ]),
    ).toEqual([]);
    expect(codeOnly(join(SRC, "domain", "visibility.ts"))).toContain("export function isVisible");
    expect(codeOnly(join(SRC, "app", "products.ts"))).toContain("isVisible(");
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
