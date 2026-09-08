/**
 * حارسُ الانحراف: مرآةُ Drizzle مقابلَ `contracts/schema.sql` — **في الاتجاهين**.
 *
 * لماذا حارسٌ ولم يكفِ اختبارُ التكامل؟ لأنّ اختبارَ التكامل يمرّ على مرآةٍ **ناقصةٍ** ما لم
 * يلمس الاستعلامُ العمودَ الناقص: عمودٌ في العقد بلا مرآةٍ لا يُكسر شيئاً اليوم ثم يُكتب صفٌّ
 * بلا قيمةٍ له غداً، وعمودٌ في المرآة بلا عقدٍ يُنتج استعلاماً يرفضه Postgres في الإنتاج.
 * وهذا الملفُّ يركض **بلا قاعدة**: نصُّ العقد مقابلَ الأنواع، فيفشل في البناء لا في النشر.
 *
 * ولا يعدّ الأسماءَ وحدها: الخطأُ المؤذي أن يبقى الاسمُ ويتغيّر النوعُ أو الإلزام، فتمرّ
 * كتابةٌ في الذاكرة وتُرفَض في القاعدة. ولذلك يُقارن (الاسمُ · النوعُ · NOT NULL) لكلّ عمود.
 *
 * ## [مصالحة ADR-024 · الموجة 3]
 *
 * كانَ الحارسُ يقارنُ القيودَ المُسمّاةَ **بحرفها** فقط، فأهملَ القيودَ المضمَّنةَ غيرَ المسماة
 * (تعدادُ `state` · صيغةُ المُعرّف · طولُ مفتاحِ منعِ التكرار) بحجّةِ أنّ «اسمٌ نخترعهُ هنا لا
 * وجودَ لهُ في القاعدة». لكنّ ولادةَ المولِّدِ (drizzle-kit) غيّرتِ الحسابَ: الترحيلُ
 * المولَّدُ من إسقاطٍ بلا القيودِ المضمَّنةِ كانَ سيُنشئَ قاعدةً **أرخى من العقدِ** — انحدارٌ
 * صامتٌ يعيشُ في الإنتاج. فأُلحِقَت القيودُ المضمَّنةُ كلُّها بأسمائِها الكنونيّةِ
 * `<table>_<column>_check` في المرآة، وهذا الحارسُ **يشتقُّ تلكَ الأسماءَ من نصِّ العقدِ** كذلك
 * (كلُّ عمودٍ يحملُ `CHECK` في تعريفِهِ يسمّيهِ PostgreSQLُ تلقائيّاً عندَ تطبيقِ العقدِ)،
 * والمفاتيحُ المركّبةُ غيرُ المسماةِ يُشتقُّ لها `<table>_pkey`. فلا يبقى قيدٌ في المرآةِ بلا
 * عقدٍ ولا عكسُ، والتكافؤُ الكاملُ يقيسُهُ اختبارُ الدورةِ في سبعةِ أبعادِ كتالوجٍ.
 *
 * وصار المفحوصُ في المراجعة 5/6 **عشرةَ جداولٍ من عشرة**: انعكست `referral_rewards` و
 * `subscription_idempotency` و`subscription_outbox` مع مخازنِها، فصارت `NOT_MIRRORED_TABLES`
 * فارغةً. والمقارنةُ بها تبقى قائمةً: جدولٌ يُضاف إلى العقد غداً بلا مرآةٍ يُفشل هذا الاختبار.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";

import { SCHEMA_CONTRACT_PATH } from "../db/migrate.js";
import {
  NOT_MIRRORED_TABLES,
  referralCodes,
  referralRewards,
  referrals,
  subscriptionIdempotency,
  subscriptionOutbox,
  subscriptionPeriods,
  subscriptionPlanEntitlements,
  subscriptionPlans,
  subscriptions,
  subscriptionTransitions,
} from "../db/schema.js";

const DDL = readFileSync(SCHEMA_CONTRACT_PATH, "utf8");

const MIRRORED = [
  subscriptionPlans,
  subscriptionPlanEntitlements,
  subscriptions,
  subscriptionPeriods,
  subscriptionTransitions,
  referralCodes,
  referrals,
  referralRewards,
  subscriptionIdempotency,
  subscriptionOutbox,
];

interface DdlColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
}

/** نصُّ جدولٍ واحدٍ من العقد بلا تعليقات. */
function tableBlock(table: string): string {
  const pattern = new RegExp(
    `CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`,
    "u",
  );
  const found = pattern.exec(DDL);
  if (!found) throw new Error(`الجدول ${table} غير موجود في العقد`);
  return found[1]!
    .split("\n")
    .map((line) => line.replace(/--.*$/u, ""))
    .join("\n");
}

const TYPES = ["TEXT", "INTEGER", "BIGINT", "BOOLEAN", "UUID", "TIMESTAMPTZ", "JSONB", "SMALLINT"];

function ddlColumns(table: string): ReadonlyArray<DdlColumn> {
  const columns: DdlColumn[] = [];
  for (const raw of tableBlock(table).split("\n")) {
    const line = raw.trim();
    const found = new RegExp(`^([a-z][a-z0-9_]*)\\s+(${TYPES.join("|")})\\b(.*)$`, "u").exec(line);
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
 * المسماة (`<table>_<column>_check` لكلِّ عمودٍ يحملُ `CHECK`، و`<table>_pkey` لكلِّ مفتاحٍ
 * مركّبٍ مُعلَنٍ على مستوى الجدول)، وأسماءُ `CREATE INDEX`.
 *
 * [مصالحة ADR-024] الاشتقاقُ الكنونيُّ ضرورةٌ لا ترفٌ: العقدُ يتركُ تسميةَ القيدِ المضمّنِ
 * لقاعدةِ البيانات، فيسمّيهِ PostgreSQLُ `<table>_<column>_check` عندَ التطبيقِ — وهو اسمٌ
 * حقيقيٌّ في الكتالوجِ يقيسُهُ اختبارُ الدورةِ في سبعةِ أبعاد. ولم يكن ممكناً أن يُتركَ هذا
 * الحارسُ يقارنُ المُسمّى وحده: المرآةُ بعدَ المصالحةِ تُسمّيهِ كذلك، فإغفالُ الاشتقاقِ كان
 * سيُسقطُ 41 قيداً يُثبتها اختبارُ الدورةِ أنّها مطابقة.
 */
function ddlConstraintNames(table: string): ReadonlyArray<string> {
  const names = new Set<string>();
  const body = tableBlock(table);

  for (const match of body.matchAll(/CONSTRAINT\s+([a-z_]+)/gu)) {
    names.add(match[1] as string);
  }

  for (const raw of body.split("\n")) {
    const line = raw.trim();
    const found = new RegExp(`^([a-z][a-z0-9_]*)\\s+(?:${TYPES.join("|")})\\b(.*)$`, "u").exec(line);
    if (found && /\bCHECK\b/u.test(found[2]!)) {
      names.add(`${table}_${found[1]!}_check`);
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

/** نوعُ Postgres المُقابل لعمود Drizzle. */
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
  it("العقدُ مقروءٌ وفيه الجداولُ العشرة", () => {
    expect(DDL).toContain("CREATE TABLE IF NOT EXISTS subscription_periods");
    expect([...DDL.matchAll(/CREATE TABLE IF NOT EXISTS/gu)]).toHaveLength(10);
  });

  it("والمرآةُ عشرةُ جداولٍ لا أقلّ", () => {
    expect(MIRRORED.map((table) => getTableConfig(table).name).sort()).toEqual([
      "referral_codes",
      "referral_rewards",
      "referrals",
      "subscription_idempotency",
      "subscription_outbox",
      "subscription_periods",
      "subscription_plan_entitlements",
      "subscription_plans",
      "subscription_transitions",
      "subscriptions",
    ]);
  });
});

describe.each(MIRRORED)("مطابقةُ المرآةِ للعقد", (table) => {
  const name = getTableConfig(table).name;

  it(`${name}: الأعمدةُ نفسُها بالنوع والإلزام`, () => {
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
