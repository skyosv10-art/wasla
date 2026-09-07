/**
 * اختبارُ الدورةِ الكاملةِ للترحيلاتِ المولَّدةِ (M0-23 · ADR-024 · الموجةُ 3).
 *
 * هذا الاختبارُ هو **الدليلُ** على ما تدَّعيهُ بوّابةُ M0-23، ولا يقبلُ الادّعاءَ
 * بلا قياسٍ:
 *
 *  1. **التكافؤُ مع العقدِ:** تُطبَّقُ الترحيلاتُ في قاعدةٍ والعقدُ
 *     (`contracts/schema.sql`) في قاعدةٍ أخرى، ثمّ يُقارَنُ الكتالوجُ في سبعةِ
 *     أبعادٍ: الجداولُ · الأعمدةُ · القيودُ · الفهارسُ · المُطلِقاتُ · الدوالّ ·
 *     المتتابعاتُ. انحرافُ أيٍّ منها = انحدارٌ صامتٌ بينَ التمثيلاتِ الثلاثةِ
 *     (عقدٍ · إسقاطٍ · ترحيلٍ) يُسقِطُ الدفعةَ قبلَ أن يكتشفَهُ الإنتاجُ.
 *  2. **العكسيّةُ المُثبَتةُ لا المفترضةُ:** يُطبَّقُ الترجعُ (down) فيُقاسُ أنّ
 *     القاعدةَ صارت **نظيفةً تماماً** — لا جدولَ ولا فهرسَ ولا مُطلِقَ ولا
 *     دالّةَ ولا متتابعةَ.
 *  3. **إعادةُ التطبيقِ بعدَ الترجعِ:** الدورةُ تعملُ مرّتَينِ متتاليتَين، فلا
 *     «ترجعٌ يعملُ مرّةً واحدةً» بقايا `IF EXISTS` مخفيّةٍ.
 *  4. **seed النسخة 1:** يُتحقَّقُ أنّ قاعدةَ العقدِ وقاعدةَ الترحيلِ تحتويانِ
 *     على سياسةِ التفاوضِ للإصدار 1 (`saudi-launch-v1`) مجمَّدةً
 *     (`is_frozen = TRUE`) وبكلِّ أعمدةِ الحكمِ كاملةً (SAR · 500..500000 ·
 *     5 أدوارٍ · 120s/900s · 1000/100) — فالترحيلُ بلا seed ليسَ عقداً: كلُّ
 *     خيطٍ يُفسَّرُ بالسياسةِ التي حكمَته، وغيابُ الصفِّ يعطّلُ فتحَ أيِّ
 *     خيطٍ أصلاً.
 *
 * يعملُ في وظيفةِ `negotiations · db-integration` القائمةِ (لا وظيفةَ جديدةَ —
 * ADR-024 §2.3)، ويُنشئُ قاعدةَ المقارنةِ بنفسِه (`*_mig_eq`) بحقِّ CREATEDB
 * من المستخدمِ نفسِه، ويُتخلَّصُ منها في النهايةِ.
 *
 * يُتخطَّى كُلُّهُ حين لا تكونُ DATABASE_URL مضبوطةً، كإخوتهِ في هذا المجلَّدِ.
 *
 * Local run:
 *   DATABASE_URL=postgres://wasla:wasla@127.0.0.1:5432/wasla_negotiations_test \
 *     pnpm --filter @wasla/negotiations-service test:integration
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const PG_ENABLED = Boolean(DATABASE_URL);

/** أبعادُ المقارنةِ — كلُّ بُعدٍ استعلامٌ يُقاسُ في القاعدتَينِ ويُقارَنُ حرفاً. */
const CATALOG_QUERIES: ReadonlyArray<readonly [string, string]> = [
  [
    "الجداول",
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`,
  ],
  [
    "الأعمدة",
    `SELECT table_name, column_name, data_type,
            COALESCE(character_maximum_length::text,
                     numeric_precision || ',' || COALESCE(numeric_scale::text, 'x')) AS shape,
            is_nullable, COALESCE(column_default, '')
     FROM information_schema.columns WHERE table_schema = 'public'
     ORDER BY table_name, column_name`,
  ],
  [
    "القيود",
    `SELECT c.conname, c.contype, ct.relname, pg_get_constraintdef(c.oid)
     FROM pg_constraint c
     JOIN pg_class ct ON ct.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = ct.relnamespace
     WHERE n.nspname = 'public' ORDER BY ct.relname, c.conname`,
  ],
  [
    "الفهارس",
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public' ORDER BY indexname`,
  ],
  [
    "المُطلِقات",
    `SELECT trigger_name, event_object_table, action_timing, event_manipulation, action_statement
     FROM information_schema.triggers WHERE trigger_schema = 'public'
     ORDER BY trigger_name`,
  ],
  [
    "الدوالّ",
    `SELECT routine_name FROM information_schema.routines
     WHERE routine_schema = 'public' AND routine_name NOT LIKE 'pg\\\\_%' ORDER BY 1`,
  ],
  [
    "المتتابعات",
    `SELECT sequence_name FROM information_schema.sequences
     WHERE sequence_schema = 'public' ORDER BY 1`,
  ],
];

interface MigrationFile {
  /** المسارُ الكاملُ للملفِّ الأماميِّ. */
  up: string;
  /** المسارُ الكاملُ لرفيقِ الترجعِ (يُفحَصُ وجودُهُ قبلَ أيِّ تطبيقٍ). */
  down: string;
  /** الوسمُ (`tag`) من الـjournal — للرسائلِ فقط. */
  tag: string;
}

/** قراءةُ الـjournal بترتيبِهِ — لا بافتراضِ أسماءِ الملفاتِ أبجديّاً. */
async function readMigrations(): Promise<MigrationFile[]> {
  const journalPath = resolve(process.cwd(), "drizzle/meta/_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  const files: MigrationFile[] = [];
  for (const entry of journal.entries) {
    const up = resolve(process.cwd(), "drizzle", `${entry.tag}.sql`);
    const down = resolve(process.cwd(), "drizzle", `${entry.tag}.down.sql`);
    // رفيقُ الترجعِ شرطُ وجودٍ لا رفاهيّةٌ: لا ترحيلَ بلا down (ADR-024 §2.3).
    let downExists = true;
    try {
      await readFile(down, "utf8");
    } catch {
      downExists = false;
    }
    if (!downExists) {
      throw new Error(`الترحيلُ ${entry.tag} بلا رفيقِ ترجعٍ (${entry.tag}.down.sql) — ADR-024 §2.2 يرفضُه.`);
    }
    files.push({ up, down, tag: entry.tag });
  }
  return files;
}

/** تطبيقُ ملفِّ SQL واحدٍ: تُفصَمُ العباراتُ عندَ فاصلِ drizzle لا عندَ حدسٍ. */
async function applySqlFile(client: pg.Client, path: string): Promise<void> {
  const raw = await readFile(path, "utf8");
  const chunks = raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => {
      // فقرةٌ تعليقاتٍ خالصةٍ لا عباراتَ فيها تُهمَل؛ وأمّا عباراتٌ تسبقُها
      // تعليقاتٌ (رأسُ الملفِّ المولَّدِ · قسمُ الإلحاقِ المُراجَعِ) فتُطبَّقُ كما هي —
      // pg يقبلُ التعليقاتِ في رأسِ الاستعلامِ.
      const withoutComments = s
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim();
      return withoutComments.length > 0;
    });
  for (const chunk of chunks) {
    await client.query(chunk);
  }
}

/** قاعدةُ المقارنةِ تُنشأُ وتُدمَّرُ بالاختبارِ نفسِه (حقُّ CREATEDB يكفي). */
function eqDatabaseName(url: string): string {
  const name = new URL(url).pathname.replace(/^\//, "");
  return `${name}_mig_eq`;
}

function maintenanceUrl(url: string): string {
  const u = new URL(url);
  u.pathname = "/postgres";
  return u.toString();
}

/** رابطُ قاعدةِ المقارنةِ: نفسُ المستخدمِ والمضيفِ، والاسمُ المُشتقُّ وحدَهُ يتغيَّرُ. */
function databaseUrlFor(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

interface PolicyV1Row {
  policy_version: number;
  label: string;
  currency: string;
  min_amount_minor: string;
  max_amount_minor: string;
  max_rounds: number;
  round_ttl_seconds: number;
  thread_ttl_seconds: number;
  max_message_length: number;
  max_messages_per_thread: number;
  is_frozen: boolean;
}

/**
 * قراءةُ النسخةِ 1 من سياسةِ التفاوضِ. لا حقولٌ زمنيّةٌ هنا (`created_at` من
 * `now()` فلا يُقارَن)، فتُقارَنُ كلُّ الأعمدةِ الجوهريّةِ حرفاً — وseed العقدِ
 * يُعلِنُها كلَّها صريحاً (لا قيماً افتراضيّةً تُتركُ للأعمدةِ كما في drivers).
 */
async function readPolicyV1(client: pg.Client): Promise<PolicyV1Row | undefined> {
  const result = await client.query<PolicyV1Row>(`
    SELECT policy_version, label, currency,
           min_amount_minor, max_amount_minor, max_rounds,
           round_ttl_seconds, thread_ttl_seconds,
           max_message_length, max_messages_per_thread, is_frozen
      FROM negotiation_policies
     WHERE policy_version = 1`);
  return result.rows[0];
}

describe.skipIf(!PG_ENABLED)("الدورةُ الكاملةُ للترحيلاتِ المولَّدةِ (M0-23)", () => {
  let contractDb: pg.Client;
  let migrationDb: pg.Client;
  let migrations: MigrationFile[];
  const eqName = DATABASE_URL ? eqDatabaseName(DATABASE_URL) : "";

  beforeAll(async () => {
    migrations = await readMigrations();
    expect(migrations.length).toBeGreaterThan(0);

    // قاعدةُ المقارنةِ: تُدمَّرُ إن بقيت من تشغيلٍ سابقٍ ثمّ تُنشأُ نظيفةً.
    const admin = new pg.Client({ connectionString: maintenanceUrl(DATABASE_URL!) });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${eqName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${eqName}`);
    await admin.end();

    // القاعدةُ الأولى: العقدُ (المصدرُ القانونيُّ المكتوبُ).
    contractDb = new pg.Client({ connectionString: DATABASE_URL! });
    await contractDb.connect();
    await contractDb.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const contract = await readFile(resolve(process.cwd(), "contracts/schema.sql"), "utf8");
    await contractDb.query(contract);

    // القاعدةُ الثانيةُ: الترحيلاتُ المولَّدةُ — ما سيُطبَّقُ في الإنتاجِ فعلاً.
    migrationDb = new pg.Client({
      connectionString: databaseUrlFor(DATABASE_URL!, eqName),
    });
    await migrationDb.connect();
    for (const m of migrations) {
      await applySqlFile(migrationDb, m.up);
    }
  });

  afterAll(async () => {
    await contractDb?.end().catch(() => undefined);
    await migrationDb?.end().catch(() => undefined);
    const admin = new pg.Client({ connectionString: maintenanceUrl(DATABASE_URL!) });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${eqName} WITH (FORCE)`);
    await admin.end();
  });

  it("التكافؤُ مع العقدِ: الكتالوجُ متطابقٌ في الأبعادِ السبعةِ كلِّها", async () => {
    const failures: string[] = [];
    for (const [label, query] of CATALOG_QUERIES) {
      const fromContract = await contractDb.query(query);
      const fromMigrations = await migrationDb.query(query);
      const a = JSON.stringify(fromContract.rows);
      const b = JSON.stringify(fromMigrations.rows);
      if (a !== b) {
        failures.push(
          `${label}:\n    عقدٌ فقط:   ${a}\n    ترحيلٌ فقط: ${b}`,
        );
      }
    }
    expect(failures, `انحرافُ الكتالوجِ بينَ العقدِ والترحيلاتِ:\n${failures.join("\n")}`).toEqual([]);
  });

  it("seed النسخةِ 1: سياسةُ التفاوضِ v1 موجودةٌ ومجمَّدةٌ في القاعدتَين", async () => {
    const fromContract = await readPolicyV1(contractDb);
    const fromMigrations = await readPolicyV1(migrationDb);

    expect(
      fromContract,
      "النسخةُ 1 غيرُ موجودةٍ في قاعدةِ العقدِ — العقدُ نفسُهُ ناقصٌ seed",
    ).toBeDefined();
    expect(
      fromMigrations,
      "النسخةُ 1 غيرُ موجودةٍ في قاعدةِ الترحيلِ — seed الإلحاقِ لم يُطبَّق",
    ).toBeDefined();

    // القيمُ المستقرّةُ فقط؛ seed العقدِ يُعلِنُها كلَّها صريحاً (العمودُ
    // الوحيدُ المُفوَّضُ إلى القيمةِ الافتراضيّةِ هو created_at الزمنيُّ).
    expect(fromContract).toMatchObject({
      policy_version: 1,
      label: "saudi-launch-v1",
      currency: "SAR",
      min_amount_minor: "500",
      max_amount_minor: "500000",
      max_rounds: 5,
      round_ttl_seconds: 120,
      thread_ttl_seconds: 900,
      max_message_length: 1000,
      max_messages_per_thread: 100,
      is_frozen: true,
    });
    expect(fromMigrations).toEqual(fromContract);
  });

  it("العكسيّةُ المُثبَتةُ: الترجعُ يُعيدُ القاعدةَ نظيفةً تماماً", async () => {
    // بترتيبٍ عكسيٍّ: الأحدثُ يُتراجَعُ أوّلاً.
    for (const m of [...migrations].reverse()) {
      await applySqlFile(migrationDb, m.down);
    }
    for (const [label, query] of CATALOG_QUERIES) {
      const result = await migrationDb.query(query);
      expect(
        result.rows,
        `بُعدُ «${label}» لم يَعُدْ نظيفاً بعدَ الترجعِ — الترجعُ ناقصٌ`,
      ).toEqual([]);
    }
  });

  it("إعادةُ التطبيقِ بعدَ الترجعِ: الدورةُ تعملُ مرّةً ثانيةً", async () => {
    for (const m of migrations) {
      await applySqlFile(migrationDb, m.up);
    }
    // ويُعادُ قياسُ التكافؤِ كاملاً — فالدورةُ الثانيةُ ليست مفترضةً بدليلٍ من الأولى.
    for (const [label, query] of CATALOG_QUERIES) {
      const fromContract = await contractDb.query(query);
      const fromMigrations = await migrationDb.query(query);
      expect(
        JSON.stringify(fromMigrations.rows),
        `بُعدُ «${label}» انحرفَ في الدورةِ الثانيةِ`,
      ).toEqual(JSON.stringify(fromContract.rows));
    }
    // ويعودُ seed النسخةِ 1 كذلك — فإعادةُ التطبيقِ لا تُسقطُ الإلحاقَ.
    const restoredSeed = await readPolicyV1(migrationDb);
    expect(restoredSeed, "seed النسخةِ 1 اختفى بعدَ إعادةِ التطبيقِ").toBeDefined();
  });
});
