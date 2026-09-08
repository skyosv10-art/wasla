/**
 * حارسُ الانحراف: مرآةُ Drizzle مقابلَ `contracts/schema.sql` — **في الاتّجاهين**، وبلا قاعدة.
 *
 * لماذا حارسٌ ولم يكفِ اختبارُ التكامل؟ لأنّ اختبارَ التكامل يمرّ على مرآةٍ **ناقصةٍ** ما لم
 * يلمس الاستعلامُ العمودَ الناقص: عمودٌ في العقدِ بلا مرآةٍ لا يُكسر شيئاً اليومَ ثمّ يُكتب صفٌّ
 * بلا قيمةٍ له غداً، وعمودٌ في المرآةِ بلا عقدٍ يُنتج استعلاماً يرفضه Postgres في الإنتاج.
 * وهذا الملفُّ يركض بلا مُشغّلٍ ولا اتصالٍ: نصُّ العقدِ مقابلَ الأنواعِ، فيفشل في البناءِ لا في
 * النشر.
 *
 * ولا يعدّ الأسماءَ وحدَها: الخطأُ المؤذي أن يبقى الاسمُ ويتغيّر النوعُ أو الإلزامُ، فتمرّ
 * كتابةٌ في الذاكرةِ وتُرفَض في القاعدة. ولذلك يُقارن (الاسمُ · النوعُ · NOT NULL) لكلِّ عمود.
 *
 * والقيودُ المُسمّاةُ تُقارن كذلك: أسماؤها هي ما يقرؤه `constraints.ts` ليُترجم الرفضَ إلى رمزِ
 * مجالٍ، فاسمٌ يتغيّر في العقدِ بلا مرآةٍ يُنتج خطأً خاماً بدل رمزٍ مُعلَن. ولذلك يفحص هذا
 * الملفُّ أيضاً أنّ **كلَّ** اسمٍ في `TRANSLATED_CONSTRAINTS` و`SEQUENCE_RACE_CONSTRAINTS`
 * موجودٌ في نصِّ العقدِ حرفاً: ترجمةٌ تنتظر قيداً لا وجودَ له هي فرعٌ ميتٌ يبدو حمايةً.
 *
 * والمفحوصُ في هذه المراجعةِ **الجداولُ العشرةُ كلُّها**: انعكست `marketplace_idempotency` في
 * 4/6 مع الطبقةِ التي تقرأ `Idempotency-Key`، وانعكست `marketplace_outbox` في 5/6 مع المخزنِ
 * الذي يكتب فيها فعلاً — ومرآةٌ تسبق كاتبَها كانت ستكون جدولاً محروساً لا يكتب فيه أحد.
 * فصارت `NOT_MIRRORED_TABLES` **فارغةً**، والمقارنةُ بها تبقى قائمةً لا تُحذَف: جدولٌ يُضاف
 * إلى العقدِ غداً بلا مرآةٍ يُفشل هذا الاختبارَ بفرقٍ مقروءٍ باسمِ الجدول.
 *
 * ## [مصالحة ADR-024 · الموجة 3] — الاشتقاقُ الكنونيُّ للقيودِ المضمَّنة
 *
 * كانَ الحارسُ يقارنُ القيودَ المُسمّاةَ **بحرفها** فقط، فأهملَ القيودَ المضمَّنةَ غيرَ المسماة
 * (تعدادُ `state` · صيغةُ المُعرّف · طولُ مفتاحِ منعِ التكرار) بحجّةِ أنّ «اسمٌ نخترعهُ هنا لا
 * وجودَ لهُ في القاعدة». لكنّ ولادةَ المولِّدِ (drizzle-kit) غيّرتِ الحسابَ: الترحيلُ
 * المولَّدُ من إسقاطٍ بلا القيودِ المضمَّنةِ كانَ سيُنشئَ قاعدةً **أرخى من العقدِ** — انحدارٌ
 * صامتٌ يعيشُ في الإنتاج. فأُلحِقَت القيودُ المضمَّنةُ كلُّها بأسمائِها الكنونيّةِ
 * `<table>_<column>_check` في المرآة، وهذا الحارسُ **يشتقُّ تلكَ الأسماءَ من نصِّ العقدِ** كذلك
 * (كلُّ عمودٍ يحملُ `CHECK` في تعريفِهِ يسمّيهِ PostgreSQLُ تلقائيّاً عندَ تطبيقِ العقدِ)،
 * والمفاتيحُ المركّبةُ غيرُ المسماةِ يُشتقُّ لها `<table>_pkey`. فلا يبقى قيدٌ في المرآةِ بلا
 * عقدٍ ولا عكسُ، والتكافؤُ الكاملُ يقيسُهُ اختبارُ الدورةِ في سبعةِ أبعادِ كتالوج.
 *
 * ## وعقدُ marketplace يكتبُ الفحصَ في سطرٍ لاحقٍ — فالاشتقاقُ **ذو حالةٍ**
 *
 * خلافاً لعقودِ الاشتراكاتِ والسمعة، فحوصُ هذا العقدِ قد تأتي `CHECK` في **سطرٍ مستقلٍّ بعدَ
 * سطرِ العمود** (مثلُ `reason_code TEXT` ثمّ سطرٌ يبدأُ بـ`CHECK (reason_code IS NULL OR …)`).
 * فلا يكفي فحصُ السطرِ نفسِه: الحارسُ يتذكّرُ **آخرَ عمودٍ** رآه، وينسبُ سطرَ `CHECK` الذي
 * يبدأُ السطرَ إليه. وسطرُ `CHECK` الذي يتبعُ `CONSTRAINT …` مُسمّىً لا يُنسبُ للعمودِ — بل
 * للقيدِ المُسمّى الذي فوقَه (والاسمُ مأخوذٌ مسبقاً من مُطابقةِ `CONSTRAINT` نفسِها)؛ فالحالةُ
 * «داخلَ قيدٍ مُسمّى» تُلغى عندَ أوّلِ سطرِ `CHECK` يلتقيه أو عندَ انتهاءِ السطرِ بفاصلةٍ —
 * وهو ما يفصلُ بينَ تكملةِ قيدٍ مُسمّى وفحصِ عمودٍ بلا اسم.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";

import { SCHEMA_CONTRACT_PATH } from "../db/migrate.js";
import { SEQUENCE_RACE_CONSTRAINTS, TRANSLATED_CONSTRAINTS } from "../db/constraints.js";
import {
  NOT_MIRRORED_TABLES,
  inventoryAdjustments,
  marketplaceIdempotency,
  marketplaceOutbox,
  productInventory,
  productReviews,
  products,
  storeCategories,
  storeReviews,
  storeStaff,
  stores,
} from "../db/schema.js";

const DDL = readFileSync(SCHEMA_CONTRACT_PATH, "utf8");

const MIRRORED = [
  storeCategories,
  marketplaceIdempotency,
  marketplaceOutbox,
  stores,
  storeReviews,
  storeStaff,
  products,
  productReviews,
  inventoryAdjustments,
  productInventory,
];

interface DdlColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
}

/** نصُّ جدولٍ واحدٍ من العقدِ بلا تعليقات. */
function tableBlock(table: string): string {
  const pattern = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`, "u");
  const found = pattern.exec(DDL);
  if (!found) throw new Error(`الجدول ${table} غير موجود في العقد`);
  return found[1]!
    .split("\n")
    .map((line) => line.replace(/--.*$/u, ""))
    .join("\n");
}

const TYPES = ["TEXT", "INTEGER", "BIGINT", "BOOLEAN", "UUID", "TIMESTAMPTZ", "JSONB", "SMALLINT"];
const COLUMN_LINE = new RegExp(`^([a-z][a-z0-9_]*)\\s+(${TYPES.join("|")})\\b(.*)$`, "u");

function ddlColumns(table: string): ReadonlyArray<DdlColumn> {
  const columns: DdlColumn[] = [];
  for (const raw of tableBlock(table).split("\n")) {
    const line = raw.trim();
    const found = COLUMN_LINE.exec(line);
    if (!found) continue;
    columns.push({
      name: found[1]!,
      type: found[2]!,
      notNull: /\bNOT NULL\b/u.test(found[3]!) || /\bPRIMARY KEY\b/u.test(found[3]!),
    });
  }
  return [...columns].sort((first, second) => first.name.localeCompare(second.name));
}

/**
 * أسماءُ القيود والفهارس في العقد لهذا الجدول، **بالاتجاهين**: المُسمّاةُ صراحةً
 * (`CONSTRAINT ck_…` و`fk_…` و`ux_…`)، **والمُشتقّةُ كنونيّاً** للقيودِ المضمَّنةِ غيرِ
 * المسماة (`<table>_<column>_check` لكلِّ عمودٍ يحملُ `CHECK` — ولو في سطرٍ لاحقٍ —
 * و`<table>_pkey` لكلِّ مفتاحٍ مركّبٍ مُعلَنٍ على مستوى الجدول)، وأسماءُ `CREATE INDEX`.
 *
 * والاشتقاقُ **ذو حالةٍ** لأنّ هذا العقدَ يكتبُ فحصَ العمودِ أحياناً في سطرٍ مستقلٍّ بعدَ
 * تعريفِ العمودِ (انظر رأسِ الملف) — فالسطرُ يُقرأ في سياقِ ما قبلَه.
 */
function ddlConstraintNames(table: string): ReadonlyArray<string> {
  const names = new Set<string>();
  const body = tableBlock(table);

  for (const match of body.matchAll(/CONSTRAINT\s+([a-z_]+)/gu)) {
    names.add(match[1] as string);
  }

  let lastColumn: string | null = null;
  let insideNamedConstraint = false;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;

    if (/\bCONSTRAINT\b/u.test(line)) {
      // قيدٌ مُسمّى: قد يمتدُّ لأسطرٍ، وأوّلُ سطرِ `CHECK` بعده هو تعبيرُهُ هو — لا فحصُ عمودٍ.
      insideNamedConstraint = true;
      continue;
    }
    if (insideNamedConstraint) {
      if (/^CHECK\b/u.test(line)) insideNamedConstraint = false;
      else if (/,$/u.test(line) || /\);$/.test(line)) insideNamedConstraint = false;
      continue;
    }

    const found = COLUMN_LINE.exec(line);
    if (found) {
      lastColumn = found[1]!;
      if (/\bCHECK\b/u.test(found[3]!)) names.add(`${table}_${found[1]!}_check`);
      continue;
    }
    if (/^CHECK\b/u.test(line) && lastColumn) {
      names.add(`${table}_${lastColumn}_check`);
    }
  }

  if (/^\s*PRIMARY KEY\s*\(/mu.test(body)) {
    names.add(`${table}_pkey`);
  }

  const indexPattern = new RegExp(
    `CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ([a-z_]+)[\\s\\S]*?;`,
    "gu",
  );
  for (const match of DDL.matchAll(indexPattern)) {
    if (new RegExp(`ON ${table}\\s`, "u").test(match[0])) names.add(match[1] as string);
  }

  return [...names].sort();
}

/** نوعُ Postgres المُقابل لعمودِ Drizzle. */
function sqlTypeOf(columnType: string, sqlName: string): string {
  if (sqlName === "timestamp with time zone") return "TIMESTAMPTZ";
  if (columnType === "PgBigInt53") return "BIGINT";
  return sqlName.toUpperCase();
}

function mirrorColumns(table: (typeof MIRRORED)[number]): ReadonlyArray<DdlColumn> {
  return getTableConfig(table)
    .columns.map((column) => ({
      name: column.name,
      type: sqlTypeOf(column.columnType, column.getSQLType()),
      notNull: column.notNull,
    }))
    .sort((first, second) => first.name.localeCompare(second.name));
}

/**
 * ما تُسمّيه المرآةُ فعلاً: القيودُ (`check` و`unique` و`foreignKeys`) **والمفاتيحُ الأساسيّةُ
 * المُسمّاةُ** (المركّبةُ فقط، إذ لا اسمَ للمفتاحِ المضمّنِ في Drizzle فيُفلتر) **والفهارسُ**.
 */
function mirrorConstraintNames(table: (typeof MIRRORED)[number]): ReadonlyArray<string> {
  const config = getTableConfig(table);
  return [
    ...config.checks.map((check) => check.name),
    ...config.uniqueConstraints.map((unique) => unique.name),
    ...config.foreignKeys.map((key) => key.getName()),
    ...config.primaryKeys.map((key) => key.getName()),
    ...config.indexes.map((index) => index.config.name),
  ]
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .sort();
}

describe("حارسُ الانحراف يقرأ العقدَ فعلاً", () => {
  it("العقدُ مقروءٌ وفيه عشرةُ جداول", () => {
    expect(DDL).toContain("CREATE TABLE IF NOT EXISTS inventory_adjustments");
    expect([...DDL.matchAll(/CREATE TABLE IF NOT EXISTS/gu)]).toHaveLength(10);
  });

  it("والمرآةُ عشرةُ جداولٍ بأسمائها", () => {
    expect(MIRRORED.map((table) => getTableConfig(table).name).sort()).toEqual([
      "inventory_adjustments",
      "marketplace_idempotency",
      "marketplace_outbox",
      "product_inventory",
      "product_reviews",
      "products",
      "store_categories",
      "store_reviews",
      "store_staff",
      "stores",
    ]);
  });

  it("والاشتقاقُ الكنونيُّ ذو الحالةِ يمسكُ فحوصَ الأسطرِ اللاحقةِ باسمِ عمودِها", () => {
    // `reason_code` في جداولٍ ثلاثةٍ يُكتبُ فحصُهُ في سطرٍ مستقلٍّ بعدَ العمود، وفحصُ
    // `state` في stores كذلك — فهذه الأسماءُ لا تُلتقطُ إلّا بالحالةِ لا بالسطرِ وحده.
    expect(ddlConstraintNames("store_reviews")).toContain("store_reviews_reason_code_check");
    expect(ddlConstraintNames("product_reviews")).toContain("product_reviews_reason_code_check");
    expect(ddlConstraintNames("inventory_adjustments")).toContain(
      "inventory_adjustments_reason_code_check",
    );
    expect(ddlConstraintNames("stores")).toContain("stores_state_check");

    // والعدُّ بالضبطِ هو الحارسُ الأقوى: فحوصُ `store_reviews` المُشتقّةُ سبعةٌ لا غيرُ —
    // فلو نُسبَ فحصُ قيدٍ مُسمّى (سطرُ `CHECK` الذي يتبعُ `CONSTRAINT …`) إلى آخرِ عمودٍ
    // لظهرَ اسمٌ ثامنٌ أو ازدوجَ واحدٌ، ولما نفعَ `toContain` وحده.
    const derived = (table: string): ReadonlyArray<string> =>
      ddlConstraintNames(table).filter((name) => name.endsWith("_check") && !name.startsWith("ck_"));
    expect(derived("store_reviews")).toEqual([
      "store_reviews_actor_public_id_check",
      "store_reviews_actor_type_check",
      "store_reviews_decision_check",
      "store_reviews_from_state_check",
      "store_reviews_reason_code_check",
      "store_reviews_state_sequence_check",
      "store_reviews_to_state_check",
    ]);
    expect(derived("stores")).toHaveLength(8);
  });
});

describe.each(MIRRORED)("مطابقةُ المرآةِ للعقد", (table) => {
  const name = getTableConfig(table).name;

  it(`${name}: الأعمدةُ نفسُها بالنوعِ والإلزام`, () => {
    expect(mirrorColumns(table)).toEqual(ddlColumns(name));
  });

  it(`${name}: القيودُ والفهارسُ نفسُها في الاتجاهين`, () => {
    expect(mirrorConstraintNames(table)).toEqual(ddlConstraintNames(name));
  });
});

describe("ما لا مرآةَ له مُعلَنٌ بالاسم", () => {
  it("جداولُ العقد − جداولُ المرآة = القائمةُ المُعلَنةُ بالضبط", () => {
    const contractTables = [...DDL.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/gu)]
      .map((hit) => hit[1]!)
      .sort();
    const mirrored = new Set(MIRRORED.map((table) => getTableConfig(table).name));
    expect(contractTables.filter((table) => !mirrored.has(table))).toEqual([
      ...NOT_MIRRORED_TABLES,
    ]);
  });
});

describe("كلُّ قيدٍ تُترجِمه الطبقةُ موجودٌ في العقد", () => {
  it.each([...TRANSLATED_CONSTRAINTS])("%s مذكورٌ في نصِّ العقد", (name) => {
    expect(DDL).toContain(name);
  });

  it.each([...SEQUENCE_RACE_CONSTRAINTS])("%s مذكورٌ في نصِّ العقد", (name) => {
    expect(DDL).toContain(name);
  });
});
