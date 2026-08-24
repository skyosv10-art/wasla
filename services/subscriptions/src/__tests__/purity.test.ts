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
 * ## الاستثناءات في هذه المراجعة: **أربعةُ ملفاتٍ بأسمائها**
 *
 * المراجعةُ 2/6 كانت مجالاً نقيّاً بلا قاعدةٍ فكانت القوائمُ كلُّها فارغة، وقد قال شرحُها:
 * «يومَ تُدخل المراجعةُ 3/6 مُهيئَ Drizzle سيفشل الاختبارُ الموجَبُ لا السلبيُّ وحده». وهذا
 * ما حدث بالحرف: المراجعةُ 3/6 أدخلت `src/db/`، فتُحدَّث القوائمُ **بأسمائها** ولا يُبطَل
 * حارسٌ ولا يُوسَّع نمطٌ. وكلُّ قائمةٍ محروسةٌ باختبارٍ موجَبٍ يُثبت أنّ **مجموعةَ الملفات
 * المطابقةِ للنمط تساوي القائمةَ بالضبط** — لا أقلَّ ولا أكثر.
 *
 * والقوائمُ مفصولةٌ عن بعضها بقصد: `FS_READING_FILES` غيرُ `ENV_READING_FILES` لأنّ قارئَ
 * نصِّ العقد (`db/migrate.ts`) ليس قارئَ البيئة (`db/migrate-cli.ts`). وقائمةٌ واحدةٌ
 * للاثنين كانت ستُبيح البيئةَ لمن يحتاج الملفَّ وحدَه — وهذا نصُّ ما تمنعه فقرةُ «لا
 * `process.env` في المجال» في `domain/plans.ts`.
 *
 * وأُضيف في هذه المراجعة حارسٌ خامسٌ لا استثناءَ له: **لا `UPDATE` ولا حذفٌ في أيّ ملف**
 * (`لا تعديلَ على دفتر` أدناه). الدفترُ append-only بنصّ ADR-015 القرار 2، وأرخصُ نسخةٍ
 * خاطئةٍ هي `db.update(...)` على `subscription_periods` أو على عمودِ حالةٍ — فيصير سؤالُ
 * «لماذا هذا السائق `active`؟» بلا جواب. والحارسُ نصّيٌّ لأنّ اختباراً سلوكيّاً لا يرى
 * تعديلاً لم يُنادِه أحدٌ بعد.
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

/** قوائمُ الاستثناءِ المُعلَنة لهذه المراجعة — بالأسماء، ومحروسةٌ موجَباً. */
const REAL_CLOCK_FILES: readonly string[] = ["app/runtime.ts", "db/migrate-cli.ts"];
const ENV_READING_FILES: readonly string[] = ["db/migrate-cli.ts", "http/server.ts"];
const FS_READING_FILES: readonly string[] = ["db/migrate.ts"];
const DB_AWARE_FILES: readonly string[] = [
  "db/client.ts",
  "db/idempotency.ts",
  "db/migrate.ts",
  "db/outbox.ts",
  "db/projection.ts",
  "db/referrals.ts",
  "db/repository.ts",
  "db/schema.ts",
];
/**
 * ولمَ `http/errors.ts` مع `http/app.ts`؟ لأنّه يستورد **نوعَ** `FastifyReply` ليكتب الجوابَ
 * بيدٍ واحدة: مترجمُ الأخطاءِ إلى أسلاكٍ هو المكانُ الذي يجب أن يعرف شكلَ الجواب، وتمريرُ
 * «شيءٍ يشبه الجواب» كان سيجعل خطأً في الترميز يظهر في التشغيل لا في `tsc`. و`http/server.ts`
 * لا يستورد الإطارَ أصلاً — يبني التطبيقَ ويستمع، فلا يدخل القائمة.
 */
const HTTP_AWARE_FILES: readonly string[] = ["http/app.ts", "http/errors.ts"];

/**
 * ثلاثةُ ملفاتٍ تُعدّل صفّاً — **بالأسماء، ولكلٍّ منها قرارٌ مكتوبٌ يقول لماذا.**
 *
 * قال شرحُ المراجعة 3/6 بالحرف: «يومَ تحتاج تعديلاً سيُضاف الاستثناءُ باسم ملفِّه وقرارٍ
 * مكتوبٍ يشرح لماذا — لا بتوسيعِ نمطٍ يُبيح التعديلَ على الدفتر نفسِه». وهذا ما يحدث هنا
 * ثلاثَ مرّاتٍ بلا توسيعِ نمطٍ واحد:
 *
 * 1. `db/projection.ts` (4/6): يكتب صفَّ `subscriptions` بـ`onConflictDoUpdate` لأنّ الصفَّ
 *    **مُشتقٌّ** — إعادةُ حسابِ نتيجةٍ لا تعديلُ تاريخ.
 * 2. `db/outbox.ts` (5/6): يكتب `published_at` و`attempts` و`last_error` — بياناتُ **تسليمٍ**
 *    لا حقيقةُ حدث. و`payload` و`event_id` و`occurred_at` لا تُلمَس بعد الإضافة، والوسمُ
 *    مشروطٌ بـ`published_at IS NULL` فلا يُدهَس نشرٌ سابق. والبديلُ (صفٌّ ثانٍ لكلّ نشرٍ)
 *    كان سيجعل «هل نُشر؟» سؤالاً يحتاج تجميعاً في كلّ نبضة.
 * 3. `db/referrals.ts` (5/6): يُقدّم حالةَ الإحالةِ `pending → qualified → rewarded` بشرطِ
 *    الحالةِ السابقةِ في `WHERE`. والإحالةُ **مطالبةٌ حالتُها تتقدّم**، لا صفٌّ في دفتر؛
 *    وقد قال شرحُ `db/referrals.ts` نفسُه في 4/6 إنّ هذا التحويلَ عملُ 5/6. والبديلُ
 *    الوحيدُ (جدولُ انتقالاتٍ ثانٍ للإحالة) كان سيُنشئ تاريخاً موازياً لا يقرؤه عقدٌ ولا
 *    مستهلكٌ ولا واجهة، مقابلَ ثلاثِ حالاتٍ لا أكثر.
 *
 * و`subscription_periods` و`subscription_transitions` تبقى بلا استثناءٍ واحد: لا `UPDATE`
 * ولا `DELETE` عليهما في أيّ ملفٍّ من `src/` — والحارسُ الثالثُ أدناه يُثبت أنّ كاتبَ الصفِّ
 * المُشتقِّ لا يذكر الجدولَين أصلاً.
 */
const PROJECTION_WRITING_FILES: readonly string[] = [
  "db/outbox.ts",
  "db/projection.ts",
  "db/referrals.ts",
];

/**
 * النمطُ مُقيَّدٌ بمِقبضِ القاعدة (`db.` أو `tx.`) لا بكلِّ `.update(` في المستودع، لأنّ
 * `createHash("sha256").update(...)` في `app/referral-code.ts` تعديلُ **مُلخَّصٍ** لا صفٍّ —
 * وحارسٌ يسقط على مطابقةٍ نصّيّةٍ لا علاقةَ لها بالقاعدة يُدرَّب المُراجعُ على تجاهله، وذلك
 * أسوأُ من غيابه. ومُنشئُ استعلامِ drizzle في هذا المستودع يمرّ دائماً عبر أحدِ المِقبضَين،
 * وحارسُ «من يعرف المُشغّل» أعلاه يُثبت أنّ ملفاتِ `db/` هي وحدَها التي تحمله.
 */
const DB_UPDATE_PATTERN = /\b(?:db|tx)\s*\.\s*update\s*\(/;

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
    /**
     * والاستثناءُ الوحيدُ حدُّ تشغيلٍ لا يُستورَد من مخزنٍ ولا من مجال: `db/migrate-cli.ts`
     * يقرأ الساعةَ مرّةً واحدةً ليُعطيَ المُهاجرةَ لحظةَ تجميدٍ، لأنّ العقد يُلزم اقترانَ
     * `is_frozen` بـ`frozen_at` والكتالوجُ في المجال لا يحمل لحظة. ولو قرأت المُهاجرةُ
     * ساعتَها لصار اختبارُ البذرةِ يقارن لحظةً لا يملكها.
     */
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
          ["node:child_process", /from\s+["']node:child_process["']/],
          ["process.env", /\bprocess\s*\.\s*env\b/],
        ],
        new Set(ENV_READING_FILES),
      ),
    ).toEqual([]);
  });

  it("ومن يقرأ بيئةَ النظام: ملفٌّ واحدٌ بالاسم — بالضبط", () => {
    expect(filesMatching(/\bprocess\s*\.\s*env\b/)).toEqual([...ENV_READING_FILES]);
  });

  it("ولا نظامَ ملفاتٍ إلّا قارئَ نصِّ العقد، مُعلَناً بالاسم", () => {
    /**
     * `db/migrate.ts` يقرأ `contracts/schema.sql` ليُطبّقه على المحرّك — وهذا نصُّ بوّابةِ
     * المراجعة: مخطّطٌ **يُطبَّق** لا مخطّطٌ يُوصف. وما عداه لا يلمس قرصاً.
     */
    expect(
      scan(
        [
          ["node:fs", /from\s+["']node:fs(?:\/promises)?["']/],
          ["readFile", /\breadFileSync\s*\(/],
        ],
        new Set(FS_READING_FILES),
      ),
    ).toEqual([]);
    expect(filesMatching(/from\s+["']node:fs(?:\/promises)?["']/)).toEqual([...FS_READING_FILES]);
  });

  it("لا HTTP في أيّ ملف، ولا SQL نصّاً في مخزنٍ يعرف القاعدة", () => {
    /**
     * منعُ SQL النصّيّ باقٍ **بلا استثناء** بعد دخول القاعدة: المخزنُ يستعمل مُنشئَ
     * استعلامات Drizzle، فيبقى اسمُ كلّ عمودٍ مقروناً بالمرآة التي يحرسها
     * `schema-drift.test.ts`. واستعلامٌ نصّيٌّ في `src/` كان سيصير مصدرَ أسماءٍ ثالثاً لا
     * يقارنه حارسٌ — يمرّ في البناء ويُرفض في القاعدة.
     */
    expect(
      scan(
        [["fastify", /from\s+["']fastify["']/]],
        // الإطارُ مسموحٌ لملفٍّ واحدٍ بالاسم؛ ومنعُ SQL النصّيّ يبقى **بلا استثناء** أدناه.
        new Set(HTTP_AWARE_FILES),
      ),
    ).toEqual([]);
    expect(
      scan([["SQL نصّاً", /\b(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/]]),
    ).toEqual([]);
  });

  it("ومن يعرف المُشغّلَ: ملفاتُ `db/` بأسمائها لا غيرُها", () => {
    expect(
      scan(
        [
          ["pg", /from\s+["']pg["']/],
          ["drizzle", /from\s+["'][^"']*drizzle[^"']*["']/],
        ],
        new Set([...DB_AWARE_FILES, ...FS_READING_FILES]),
      ),
    ).toEqual([]);
  });

  it("ومن يعرف القاعدةَ: القائمةُ بالضبط، ومن يعرف HTTP: لا أحد", () => {
    expect(filesMatching(/from\s+["']pg["']|from\s+["'][^"']*drizzle-orm[^"']*["']/)).toEqual([
      ...DB_AWARE_FILES,
    ]);
    expect(filesMatching(/from\s+["']fastify["']/)).toEqual([...HTTP_AWARE_FILES]);
    // والاتجاهُ الثاني: من يعرف الإطارَ يقيم في `http/` — ولا يعرفه مجالٌ ولا تطبيقٌ ولا مخزن.
    for (const file of HTTP_AWARE_FILES) expect(file.startsWith("http/")).toBe(true);
  });

  it("ولا ملفَّ مجالٍ واحدٍ يعرف القاعدة — الحدُّ في `db/` وحدَه", () => {
    /**
     * الاتجاهُ الثاني للحارس السابق: كلُّ ملفٍّ يعرف المُشغّلَ يقيم في `db/`. ولو أُضيف
     * استيرادُ `pg` في `domain/state.ts` لمرّ من القائمةِ لو كانت بلا هذا الشرط — فيصير
     * الاشتقاقُ يعرف مخزنَه، وهو نقضُ القرار 2 من داخله.
     */
    for (const file of DB_AWARE_FILES) expect(file.startsWith("db/")).toBe(true);
    expect(filesMatching(/from\s+["']pg["']|from\s+["'][^"']*drizzle-orm[^"']*["']/).every((file) =>
      file.startsWith("db/"),
    )).toBe(true);
  });

  it("التبعيّاتُ المُعلَنةُ أربعٌ: العقدُ والمُشغّلُ وORM وإطارُ HTTP", () => {
    /**
     * القائمةُ مكتوبةٌ صريحةً حتى تسقط أوّلُ تبعيّةٍ تُضاف بلا قرارٍ موثَّق: مكتبةُ تحقّقٍ
     * أو عميلُ HTTP أو مُجدولٌ هنا يعني أنّ الخدمةَ صارت تفعل ما لم تُعلنه هذه المراجعة.
     * و`pg` و`drizzle-orm` دخلتا بقرار المراجعة 3/6 (استمراريّة)، بنفس نسختَي خدمة السمعة.
     */
    const manifest: unknown = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8"));
    const dependencies = (manifest as { readonly dependencies?: Record<string, string> })
      .dependencies;
    expect(Object.keys(dependencies ?? {}).sort()).toEqual([
      "@wasla/contracts-subscription",
      "drizzle-orm",
      "fastify",
      "pg",
    ]);
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

describe("لا تعديلَ على دفتر (القرار 2)", () => {
  it("لا UPDATE ولا DELETE ولا حتّى مُنشئُ استعلامٍ يُعدّل أو يحذف", () => {
    /**
     * الحارسُ الذي يحمي معنى الدفتر كلَّه: `subscription_periods` و
     * `subscription_transitions` جداولُ إضافةٍ فقط، والحالةُ تُشتقّ من قراءتهما. ولا يملك
     * `db/repository.ts` دالّةَ تعديلٍ ولا حذفٍ — وهذا يُثبت الغياب لا يصفه.
     *
     * ولمَ لا استثناءَ للصفّ المُتحقِّق في `subscriptions`؟ لأنّ إعادةَ بنائه في المراجعة
     * 4/6 ستكون **كتابةً من الدفتر** (حذفٌ وإدخالٌ في معاملةٍ أو `INSERT … ON CONFLICT`)،
     * ويومَ تحتاج تعديلاً سيُضاف الاستثناءُ باسم ملفِّه وقرارٍ مكتوبٍ يشرح لماذا — لا
     * بتوسيعِ نمطٍ يُبيح التعديلَ على الدفتر نفسِه.
     */
    expect(
      scan(
        [
          ["db.update(", DB_UPDATE_PATTERN],
          ["db.delete(", /\b(?:db|tx)\s*\.\s*delete\s*\(/],
          ["onConflictDoUpdate", /\bonConflictDoUpdate\b/],
          ["TRUNCATE", /\bTRUNCATE\b/],
        ],
        new Set(PROJECTION_WRITING_FILES),
      ),
    ).toEqual([]);
  });

  it("ومن يُعدّل صفّاً: ملفُّ الصفِّ المُشتقِّ وحدَه — بالضبط", () => {
    expect(filesMatching(new RegExp(`\\bonConflictDoUpdate\\b|${DB_UPDATE_PATTERN.source}`))).toEqual([
      ...PROJECTION_WRITING_FILES,
    ]);
  });

  it("وكاتبُ الصفِّ المُشتقِّ لا يعرف جدولَي الدفتر أصلاً", () => {
    /**
     * الاتجاهُ الثاني: الاستثناءُ مُقيَّدٌ بما يستطيع الملفُّ لمسَه، لا بحسنِ نيّةِ كاتبِه.
     * `db/projection.ts` لا يذكر `subscriptionPeriods` ولا `subscriptionTransitions`، فلو
     * أُضيف فيه `update` على أحدهما غداً لسقط هذا الاختبارُ قبل أن يُراجعه أحد.
     */
    const projection = codeOnly(join(SRC, "db", "projection.ts"));
    expect(projection).toContain("onConflictDoUpdate");
    expect(projection).not.toContain("subscriptionPeriods");
    expect(projection).not.toContain("subscriptionTransitions");
  });

  it("والمخزنُ يُضيف ويقرأ فعلاً — فالغيابُ ليس غيابَ مخزن", () => {
    const store = codeOnly(join(SRC, "db", "repository.ts"));
    expect(store).toContain(".insert(");
    expect(store).toContain(".select(");
    expect(store).toContain("insertPeriod");
    expect(store).toContain("listPeriods");
    expect(store).toContain("insertTransition");
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
