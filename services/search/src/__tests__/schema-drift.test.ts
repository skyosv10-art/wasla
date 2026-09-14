/**
 * حارسُ الانحراف: مرآةُ Drizzle مقابلَ `contracts/schema.sql` — **في الاتّجاهَينِ**، وبلا قاعدةٍ.
 *
 * ولمَ حارسٌ ثانٍ وقد قِيسَ تكافؤُ الكتالوجِ في سبعةِ أبعادٍ في
 * `migrations.integration.test.ts`؟ لأنّ ذاكَ يقيسُ **الترحيلَ** مقابلَ العقدِ، وهذا يقيسُ
 * **المرآةَ** مقابلَ العقدِ. والفرقُ ليسَ شكليّاً: الترحيلُ يُولَّدُ من المرآةِ مرّةً ثمّ يُجمَّدُ
 * ملفّاً، فمرآةٌ تنحرفُ بعدَ التوليدِ لا تكسرُ الترحيلَ المُجمَّدَ ولا اختبارَ تكافئِهِ — وإنّما
 * تكسرُ **الاستعلاماتَ** التي تُبنى منها في المخازنِ. ولا يظهرُ العطبُ حتى يلمسَ استعلامٌ
 * العمودَ المنحرفَ في الإنتاجِ.
 *
 * وهذا الملفُّ يركضُ بلا مُشغّلٍ ولا اتّصالٍ: نصُّ العقدِ مقابلَ الأنواعِ، فيفشلُ في البناءِ لا
 * في النشرِ. ولا يعدُّ الأسماءَ وحدَها: الخطأُ المؤذي أن يبقى الاسمُ ويتغيّرَ النوعُ أو
 * الإلزامُ، فتمرَّ كتابةٌ في الذاكرةِ وتُرفَضَ في القاعدةِ.
 *
 * ## والاشتقاقُ يُحاكي خوارزميّةَ PostgreSQL لا قاعدةَ `<table>_<column>_check`
 *
 * القاعدةُ الشائعةُ **ليست** قاعدةَ PostgreSQL؛ إنّما `ChooseConstraintName` فوقَ
 * `makeObjectName`: القصُّ إلى 63 حرفاً يأكلُ من **الأطولِ** حرفاً حرفاً، والتصادمُ يُرقّمُ
 * **الوسمَ** لا الاسمَ. وقد قِيسَ أنّ عقدَ البحثِ لا يُصيبُ الحالتَينِ اليومَ (فحوصُهُ كلُّها
 * أحاديّةُ العمودِ، وأطولُ اسمٍ 58 حرفاً) — وهذا **قياسٌ لا افتراضٌ**: الاشتقاقُ هوَ نفسُهُ
 * المُصدَّقُ في التوصيلِ، ومعهُ توكيدانِ صريحانِ أدناهُ يُخفقانِ يومَ يُضافُ عمودٌ يُخرِجُ
 * اسماً عن 63 حرفاً أو فحصٌ يمسُّ عمودَينِ — قبلَ أن يُنتِجَ ذلكَ ترحيلاً يخالفُ العقدَ.
 *
 * ## وما لا تستطيعُ المرآةُ التعبيرَ عنهُ مُعلَنٌ بالاسمِ ومقيسٌ بالطرحِ
 *
 * فهرسا `gin` (أحدُهما على `to_tsvector(…)` والآخرُ بصنفِ مُعاملاتٍ `gin_trgm_ops`) خارجَ
 * تعبيرِ `pgTable`، فهما مُعلَنانِ في `NOT_MIRRORED_INDEXES`. ويُقاسُ **الطرحُ بالتساوي**:
 * فهارسُ العقدِ − فهارسُ المرآةِ = القائمةُ المُعلَنةُ **بالضبطِ**. فلا يمرُّ فهرسٌ نُسيَ من
 * المرآةِ باعتبارِهِ «غيرَ قابلٍ للتعبيرِ»، ولا يبقى في القائمةِ اسمٌ صارَ لهُ مرآةٌ.
 */

import { readFileSync } from "node:fs";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { SCHEMA_CONTRACT_PATH } from "../db/migrate.js";
import {
  NOT_MIRRORED_INDEXES,
  NOT_MIRRORED_TABLES,
  searchMarketplaceProductState,
  searchMarketplaceStoreState,
  searchOutbox,
  searchProductIndex,
  searchRelayCheckpoint,
  searchRelayConsumedEvents,
} from "../db/schema.js";

const DDL = readFileSync(SCHEMA_CONTRACT_PATH, "utf8");

const MIRRORED = [
  searchProductIndex,
  searchMarketplaceStoreState,
  searchMarketplaceProductState,
  searchOutbox,
  searchRelayConsumedEvents,
  searchRelayCheckpoint,
];

const NAMEDATALEN = 64;

/**
 * `makeObjectName` من PostgreSQL (`src/backend/commands/indexcmds.c`) حرفاً: العبءُ هو
 * الوسمُ وفواصلُهُ، والباقي يُقتسَمُ بينَ الاسمَينِ بقصِّ **الأطولِ** حرفاً حرفاً.
 */
function makeObjectName(name1: string, name2: string | null, label: string): string {
  let name1chars = name1.length;
  let name2chars = name2 === null ? 0 : name2.length;
  let overhead = label.length + 1;
  if (name2 !== null) overhead += 1;
  const availchars = NAMEDATALEN - 1 - overhead;
  while (name1chars + name2chars > availchars) {
    if (name1chars > name2chars) name1chars -= 1;
    else name2chars -= 1;
  }
  const head = name1.slice(0, name1chars);
  const middle = name2 === null ? "" : `_${name2.slice(0, name2chars)}`;
  return `${head}${middle}_${label}`;
}

/**
 * `ChooseConstraintName`: يُجرَّبُ الوسمُ مجرَّداً، وعندَ التصادمِ يُعادُ البناءُ بوسمٍ مُرقَّمٍ
 * (`check` ⇒ `check1`) — فالرقمُ يدخلُ الوسمَ لا الاسمَ، ولذلك يُعادُ حسابُ القصِّ معَه.
 */
function chooseName(
  name1: string,
  name2: string | null,
  label: string,
  taken: ReadonlySet<string>,
): string {
  let candidate = makeObjectName(name1, name2, label);
  for (let pass = 1; taken.has(candidate); pass += 1) {
    candidate = makeObjectName(name1, name2, `${label}${pass}`);
  }
  return candidate;
}

interface DdlColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
}

/** نصُّ جدولٍ واحدٍ من العقدِ بلا تعليقاتٍ. */
function tableBlock(table: string): string {
  const pattern = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`, "u");
  const found = pattern.exec(DDL);
  if (!found) throw new Error(`الجدول ${table} غير موجود في العقد`);
  return found[1]!
    .split("\n")
    .map((line) => line.replace(/--.*$/u, ""))
    .join("\n");
}

const TYPES = ["TEXT", "INTEGER", "BIGSERIAL", "BIGINT", "BOOLEAN", "UUID", "TIMESTAMPTZ", "JSONB"];
const COLUMN_LINE = new RegExp(
  `^([a-z][a-z0-9_]*)\\s+(${TYPES.join("|")})\\b(\\[\\])?(.*)$`,
  "u",
);

/** أسطرُ الأعمدةِ بترتيبِ العقدِ — أساسُ كلِّ اشتقاقٍ بعدَها. */
function columnLines(table: string): ReadonlyArray<{ name: string; type: string; rest: string }> {
  const rows: Array<{ name: string; type: string; rest: string }> = [];
  for (const raw of tableBlock(table).split("\n")) {
    const found = COLUMN_LINE.exec(raw.trim());
    if (found) {
      rows.push({ name: found[1]!, type: `${found[2]!}${found[3] ?? ""}`, rest: found[4]! });
    }
  }
  return rows;
}

function ddlColumns(table: string): ReadonlyArray<DdlColumn> {
  return columnLines(table)
    .map((row) => ({
      name: row.name,
      type: row.type,
      notNull: /\bNOT NULL\b/u.test(row.rest) || /\bPRIMARY KEY\b/u.test(row.rest),
    }))
    .sort((first, second) => first.name.localeCompare(second.name));
}

/**
 * تعبيراتُ الفحوصِ **غيرِ المسماةِ** في الجدولِ بترتيبِ ظهورِها: يُبحَثُ عن `CHECK (`
 * وتُوازَنُ أقواسُهُ، ويُستثنى ما تقدّمَهُ `CONSTRAINT <name>` مباشرةً.
 *
 * وموازنةُ الأقواسِ لا قراءةُ السطرِ: فحصُ `status` في `search_relay_consumed_events` مكتوبٌ
 * في **السطرِ التاليِ** لسطرِ عمودِهِ، فماسحٌ سطريٌّ كانَ سيُغفلَهُ ويُنقصَ قيداً من الطرفِ
 * الواحدِ فيشتكي من مطابقةٍ صحيحةٍ.
 */
function unnamedCheckExpressions(table: string): ReadonlyArray<string> {
  const body = tableBlock(table);
  const expressions: string[] = [];
  const finder = /\bCHECK\s*\(/gu;
  let hit: RegExpExecArray | null;
  while ((hit = finder.exec(body)) !== null) {
    const before = body.slice(0, hit.index).trimEnd();
    if (/\bCONSTRAINT\s+[a-z_][a-z0-9_]*$/u.test(before)) continue;
    let depth = 1;
    let cursor = finder.lastIndex;
    while (cursor < body.length && depth > 0) {
      const char = body[cursor];
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      cursor += 1;
    }
    expressions.push(body.slice(finder.lastIndex, cursor - 1));
  }
  return expressions;
}

/**
 * الأعمدةُ التي يمسُّها تعبيرٌ: تُنزَعُ الحروفُ النصّيّةُ أوّلاً (`'archived'` ليست عموداً ولو
 * وافقَ اسمُها اسمَ عمودٍ)، ثمّ يُبحَثُ عن كلِّ اسمِ عمودٍ بحدودِ كلمةٍ.
 */
function columnsTouched(expression: string, columns: ReadonlyArray<string>): ReadonlyArray<string> {
  const withoutLiterals = expression.replace(/'(?:[^']|'')*'/gu, "''");
  return columns.filter((column) => new RegExp(`\\b${column}\\b`, "u").test(withoutLiterals));
}

/**
 * أسماءُ القيودِ والفهارسِ في العقدِ لهذا الجدولِ، **بالاتجاهَينِ**: المُسمّاةُ صراحةً،
 * والمُشتقّةُ بخوارزميّةِ PostgreSQL (فحوصاً · فريداً مضمَّناً · مفتاحاً أساسيّاً)، وأسماءُ
 * `CREATE INDEX` على الجدولِ نفسِهِ — ما خلا المُعلَنَ في `NOT_MIRRORED_INDEXES`.
 */
function ddlConstraintNames(table: string): ReadonlyArray<string> {
  const names = new Set<string>();
  const body = tableBlock(table);
  const columns = columnLines(table);
  const columnNames = columns.map((column) => column.name);

  for (const match of body.matchAll(/CONSTRAINT\s+([a-z_][a-z0-9_]*)/gu)) {
    names.add(match[1] as string);
  }

  for (const column of columns) {
    if (/\bUNIQUE\b/u.test(column.rest)) names.add(chooseName(table, column.name, "key", names));
    if (/\bREFERENCES\b/u.test(column.rest)) names.add(chooseName(table, column.name, "fkey", names));
  }
  for (const match of body.matchAll(/^\s*UNIQUE\s*\(([^)]*)\)/gmu)) {
    const cols = match[1]!.split(",").map((part) => part.trim());
    names.add(chooseName(table, cols.join("_"), "key", names));
  }

  // الفحوصُ غيرُ المسماةِ: عمودٌ واحدٌ ⇒ اسمُهُ في الوسطِ، وأكثرُ ⇒ لا اسمَ عمودٍ.
  for (const expression of unnamedCheckExpressions(table)) {
    const touched = columnsTouched(expression, columnNames);
    const name2 = touched.length === 1 ? touched[0]! : null;
    names.add(chooseName(table, name2, "check", names));
  }

  // مفتاحُ العقدِ كلُّهُ مضمَّنٌ في سطرِ العمودِ (`PRIMARY KEY`)، وDrizzle لا يُسمّي
  // المضمَّنَ — فالطرفانِ يتّفقانِ على إغفالِهِ، ويقيسُهُ اختبارُ الدورةِ في الكتالوجِ.
  if (/^\s*PRIMARY KEY\s*\(/mu.test(body)) names.add(chooseName(table, null, "pkey", names));

  const indexPattern = /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ([a-z_]+)[\s\S]*?;/gu;
  for (const match of DDL.matchAll(indexPattern)) {
    const name = match[1] as string;
    if (NOT_MIRRORED_INDEXES.includes(name)) continue;
    if (new RegExp(`ON ${table}\\s`, "u").test(match[0])) names.add(name);
  }

  return [...names].sort();
}

/** نوعُ Postgres المُقابلُ لعمودِ Drizzle. */
function sqlTypeOf(columnType: string, sqlName: string): string {
  if (sqlName === "timestamp with time zone") return "TIMESTAMPTZ";
  if (columnType === "PgBigInt53" || columnType === "PgBigSerial53") return "BIGSERIAL";
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
 * ما تُسمّيهِ المرآةُ فعلاً: الفحوصُ والفريدُ (على مستوى الجدولِ **وعلى العمودِ** — Drizzle
 * يُعلّقُ اسمَ الفريدِ المضمَّنِ على العمودِ لا في `uniqueConstraints`) والمفاتيحُ الأجنبيّةُ
 * والمفاتيحُ الأساسيّةُ المُسمّاةُ والفهارسُ.
 */
function mirrorConstraintNames(table: (typeof MIRRORED)[number]): ReadonlyArray<string> {
  const config = getTableConfig(table);
  return [
    ...config.checks.map((check) => check.name),
    ...config.uniqueConstraints.map((unique) => unique.name),
    ...config.columns.filter((column) => column.isUnique).map((column) => column.uniqueName),
    ...config.foreignKeys.map((key) => key.getName()),
    ...config.primaryKeys.map((key) => key.getName()),
    ...config.indexes.map((index) => index.config.name),
  ]
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .sort();
}

describe("حارسُ الانحرافِ يقرأُ العقدَ فعلاً", () => {
  it("العقدُ مقروءٌ وفيهِ ستّةُ جداولَ وامتدادٌ ودالّتانِ وأربعةُ مُطلِقاتٍ", () => {
    expect(DDL).toContain("CREATE TABLE IF NOT EXISTS search_product_index");
    expect([...DDL.matchAll(/CREATE TABLE IF NOT EXISTS/gu)]).toHaveLength(6);
    expect(DDL).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    expect([...DDL.matchAll(/CREATE OR REPLACE FUNCTION/gu)]).toHaveLength(2);
    expect([...DDL.matchAll(/CREATE TRIGGER/gu)]).toHaveLength(4);
  });

  it("والمرآةُ ستّةُ جداولَ بأسمائِها", () => {
    expect(MIRRORED.map((table) => getTableConfig(table).name).sort()).toEqual([
      "search_marketplace_product_state",
      "search_marketplace_store_state",
      "search_outbox",
      "search_product_index",
      "search_relay_checkpoint",
      "search_relay_consumed_events",
    ]);
  });

  it("ولا اسمَ قيدٍ في هذا العقدِ يُقَصُّ — والتوكيدُ حرسٌ لا وصفٌ", () => {
    // 58 حرفاً أطولُ اسمٍ مُشتقٍّ اليومَ. ويومَ يُضافُ عمودٌ طويلُ الاسمِ يُخفِقُ هذا
    // التوكيدُ قبلَ أن يُولَّدَ ترحيلٌ يكتبُ اسماً من 64 حرفاً لا وجودَ لهُ في الكتالوجِ.
    const all = MIRRORED.flatMap((table) => ddlConstraintNames(getTableConfig(table).name));
    const tooLong = all.filter((name) => name.length > 63);
    expect(tooLong, `اسمٌ يتجاوزُ 63 حرفاً: ${tooLong.join(", ")}`).toEqual([]);
    expect(Math.max(...all.map((name) => name.length))).toBeLessThanOrEqual(63);
  });

  it("وكلُّ فحصٍ في هذا العقدِ أحاديُّ العمودِ — فلا `_check` مجرَّدٌ ولا `_check1`", () => {
    // خاصّيّتانِ من `ChooseConstraintName` لا تظهرانِ في عقدِ البحثِ: الفحصُ المركّبُ
    // (يُسمّى `<table>_check`) والتصادمُ (`_check1`). والتوكيدُ يُخفِقُ يومَ تظهرانِ،
    // فيُراجَعُ الاشتقاقُ حينَها بدلاً من أن يمرَّ اسمٌ خاطئٌ صامتاً.
    for (const table of MIRRORED) {
      const name = getTableConfig(table).name;
      const columnNames = columnLines(name).map((column) => column.name);
      for (const expression of unnamedCheckExpressions(name)) {
        expect(
          columnsTouched(expression, columnNames),
          `فحصٌ يمسُّ غيرَ عمودٍ واحدٍ في ${name}: ${expression}`,
        ).toHaveLength(1);
      }
      expect(ddlConstraintNames(name)).not.toContain(`${name}_check`);
      expect(ddlConstraintNames(name)).not.toContain(`${name}_check1`);
    }
  });

  it("والفحصُ في سطرٍ لاحقٍ يُلتقَطُ بموازنةِ الأقواسِ لا بقراءةِ السطرِ", () => {
    // `status TEXT NOT NULL DEFAULT 'pending'` ثمّ سطرٌ يبدأُ بـ`CHECK (…)`.
    const expressions = unnamedCheckExpressions("search_relay_consumed_events");
    expect(expressions).toHaveLength(2);
    expect(expressions.some((expression) => expression.includes("status IN ("))).toBe(true);
  });
});

describe.each(MIRRORED)("مطابقةُ المرآةِ للعقد", (table) => {
  const name = getTableConfig(table).name;

  it(`${name}: الأعمدةُ نفسُها بالنوعِ والإلزامِ`, () => {
    expect(mirrorColumns(table)).toEqual(ddlColumns(name));
  });

  it(`${name}: القيودُ والفهارسُ نفسُها في الاتجاهَينِ`, () => {
    expect(mirrorConstraintNames(table)).toEqual(ddlConstraintNames(name));
  });
});

describe("ما لا مرآةَ لهُ مُعلَنٌ بالاسمِ", () => {
  it("جداولُ العقدِ − جداولُ المرآةِ = القائمةُ المُعلَنةُ بالضبطِ", () => {
    const contractTables = [...DDL.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/gu)]
      .map((hit) => hit[1]!)
      .sort();
    const mirrored = new Set(MIRRORED.map((table) => getTableConfig(table).name));
    expect(contractTables.filter((table) => !mirrored.has(table))).toEqual([
      ...NOT_MIRRORED_TABLES,
    ]);
  });

  it("وفهارسُ العقدِ − فهارسُ المرآةِ = فهرسا gin المُعلَنانِ بالضبطِ", () => {
    const contractIndexes = [...DDL.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ([a-z_]+)/gu)]
      .map((hit) => hit[1]!)
      .sort();
    const mirrorIndexes = new Set(
      MIRRORED.flatMap((table) =>
        getTableConfig(table).indexes.map((index) => index.config.name),
      ).filter((name): name is string => typeof name === "string"),
    );
    expect(contractIndexes.filter((index) => !mirrorIndexes.has(index))).toEqual(
      [...NOT_MIRRORED_INDEXES].sort(),
    );
    // والطرحُ في الاتّجاهِ الآخرِ: فهرسٌ في المرآةِ لا وجودَ لهُ في العقدِ يُولِّدُ ترحيلاً
    // يُنشئُ ما لا يُقابلُهُ شيءٌ في المصدرِ القانونيِّ.
    expect([...mirrorIndexes].filter((index) => !contractIndexes.includes(index))).toEqual([]);
  });
});
