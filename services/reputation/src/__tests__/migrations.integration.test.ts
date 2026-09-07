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
 *  4. **بذورُ النسخةِ 1 كاملةً:** يُتحقَّقُ أنّ قاعدةَ العقدِ وقاعدةَ الترحيلِ
 *     تحتويانِ على الجداولِ الحاكمةِ الثلاثةِ كما هي في العقدِ: نسخةِ القواعدِ 1
 *     (`saudi-launch-v1` مجمَّدةً بكلِّ حدودِها المُعلَنةِ)، وتسعةَ أوزانِ الوقائعِ،
 *     وخمسَ عتباتِ قواعدِ الاحتيالِ — فالترحيلُ بلا بذورٍ ليسَ عقداً: كلُّ واقعةٍ
 *     ونقطةٍ وإشارةٍ تُفسَّرُ بالأوزانِ والعتباتِ التي حكمتها، وغيابُ الصفوفِ
 *     يعطّلُ تسجيلَ الوقائعِ أصلاً (واقعةٌ بلا وزنٍ **تُرفض** ولا تُهمَل).
 *
 * يعملُ في وظيفةِ `reputation · db-integration` القائمةِ (لا وظيفةَ جديدةَ —
 * ADR-024 §2.3)، ويُنشئُ قاعدةَ المقارنةِ بنفسِه (`*_mig_eq`) بحقِّ CREATEDB
 * من المستخدمِ نفسِه، ويُتخلَّصُ منها في النهايةِ.
 *
 * يُتخطَّى كُلُّهُ حين لا تكونُ DATABASE_URL مضبوطةً، كإخوتهِ في هذا المجلَّدِ.
 *
 * Local run:
 *   DATABASE_URL=postgres://wasla:wasla@127.0.0.1:5432/wasla_reputation_test \
 *     pnpm --filter @wasla/reputation-service test:integration
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
    // رفيقُ الترجعِ شرطُ وجودٍ لا رفاهيّةٌ: لا ترحيلَ بلا down (ADR-024 §2.2).
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

/**
 * البذورُ الكاملةُ للنسخةِ 1 من ثلاثةِ جداولِ: نسخةِ القواعدِ (صفٌّ واحدٌ بكلِّ
 * أعمدةِ الحكمِ — كلُّها مُعلَنةٌ صريحةً في seed العقدِ، والعمودُ الوحيدُ المُفوَّضُ
 * إلى القيمةِ الافتراضيّةِ هو created_at الزمنيُّ)، وأوزانِ الوقائعِ (تسعةُ صفوفٍ)،
 * وعتباتِ قواعدِ الاحتيالِ (خمسةُ صفوفٍ). تُقرأُ مرتَّبةً لتكونَ المقارنةُ صفّاً بصفٍّ.
 */
async function readSeedV1(client: pg.Client): Promise<{
  ruleset: Record<string, unknown> | undefined;
  weights: Array<Record<string, unknown>>;
  thresholds: Array<Record<string, unknown>>;
}> {
  const ruleset = await client.query<Record<string, unknown>>(`
    SELECT ruleset_version, label, score_floor, score_ceiling, starting_score,
           min_facts_for_score, decay_half_life_days,
           tier_standard_at, tier_trusted_at, tier_under_watch_below,
           rating_window_hours, fraud_window_days, recompute_interval_hours, is_frozen
      FROM reputation_rulesets WHERE ruleset_version = 1`);
  const weights = await client.query<Record<string, unknown>>(`
    SELECT ruleset_version, subject_type, fact_kind, weight_points
      FROM reputation_rule_weights WHERE ruleset_version = 1
     ORDER BY subject_type, fact_kind`);
  const thresholds = await client.query<Record<string, unknown>>(`
    SELECT ruleset_version, rule_code, subject_type, threshold_count, severity
      FROM reputation_fraud_thresholds WHERE ruleset_version = 1
     ORDER BY rule_code`);
  return {
    ruleset: ruleset.rows[0],
    weights: weights.rows,
    thresholds: thresholds.rows,
  };
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

    // القاعدةُ الأولى: العقدُ (المصدرُ القانونيُّ المكتوبُ — ويحملُ بذورَهُ).
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

  it("بذورُ النسخةِ 1 كاملةً: القواعدُ والأوزانُ والعتباتُ في القاعدتَين", async () => {
    const fromContract = await readSeedV1(contractDb);
    const fromMigrations = await readSeedV1(migrationDb);

    expect(
      fromContract.ruleset,
      "النسخةُ 1 غيرُ موجودةٍ في قاعدةِ العقدِ — العقدُ نفسُهُ ناقصٌ seed",
    ).toBeDefined();
    expect(
      fromMigrations.ruleset,
      "النسخةُ 1 غيرُ موجودةٍ في قاعدةِ الترحيلِ — seed الإلحاقِ لم يُطبَّق",
    ).toBeDefined();

    // القيمُ المُعلَنةُ في العقدِ — كلُّ عمودِ حكمٍ صريحٌ في الـINSERT فلا يُفوَّضُ
    // شيءٌ لافتراضيّاتِ الأعمدةِ (العمودُ الوحيدُ المُفوَّضُ created_at الزمنيُّ).
    expect(fromContract.ruleset).toMatchObject({
      ruleset_version: 1,
      label: "saudi-launch-v1",
      score_floor: 0,
      score_ceiling: 100,
      starting_score: 60,
      min_facts_for_score: 5,
      decay_half_life_days: 180,
      tier_standard_at: 50,
      tier_trusted_at: 80,
      tier_under_watch_below: 35,
      rating_window_hours: 72,
      fraud_window_days: 30,
      recompute_interval_hours: 24,
      is_frozen: true,
    });

    // تسعةُ أوزانٍ وخمسُ عتباتٍ، ومطابقةٌ حرفيّةً بينَ القاعدتَينِ.
    expect(fromContract.weights).toHaveLength(9);
    expect(fromContract.thresholds).toHaveLength(5);
    expect(fromMigrations.ruleset).toEqual(fromContract.ruleset);
    expect(fromMigrations.weights).toEqual(fromContract.weights);
    expect(fromMigrations.thresholds).toEqual(fromContract.thresholds);
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
    // وتعودُ البذورُ كاملةً — فإعادةُ التطبيقِ لا تُسقِطُ الإلحاقَ.
    const restoredSeed = await readSeedV1(migrationDb);
    expect(restoredSeed.ruleset, "بذورُ النسخةِ 1 اختفت بعدَ إعادةِ التطبيقِ").toBeDefined();
    expect(restoredSeed.weights).toHaveLength(9);
    expect(restoredSeed.thresholds).toHaveLength(5);
  });
});
