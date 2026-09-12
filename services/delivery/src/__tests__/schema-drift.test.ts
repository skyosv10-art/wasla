/**
 * حارسُ الانحراف: مرآةُ Drizzle مقابلَ `contracts/schema.sql` — **في الاتّجاهَينِ**، وبلا قاعدةٍ.
 *
 * لماذا حارسٌ ولم يكفِ اختبارُ التكاملِ؟ لأنّ اختبارَ التكاملِ يمرُّ على مرآةٍ **ناقصةٍ** ما لم
 * يلمسِ الاستعلامُ العمودَ الناقصَ: عمودٌ في العقدِ بلا مرآةٍ لا يُكسرُ شيئاً اليومَ ثمّ يُكتبُ
 * صفٌّ بلا قيمةٍ لهُ غداً، وعمودٌ في المرآةِ بلا عقدٍ يُنتجُ استعلاماً يرفضُهُ Postgres في
 * الإنتاجِ. وهذا الملفُّ يركضُ بلا مُشغّلٍ ولا اتّصالٍ: نصُّ العقدِ مقابلَ الأنواعِ، فيفشلُ في
 * البناءِ لا في النشرِ.
 *
 * ولا يعدُّ الأسماءَ وحدَها: الخطأُ المؤذي أن يبقى الاسمُ ويتغيّرَ النوعُ أو الإلزامُ، فتمرَّ
 * كتابةٌ في الذاكرةِ وتُرفَضَ في القاعدةِ. ولذلك يُقارَنُ (الاسمُ · النوعُ · NOT NULL) لكلِّ
 * عمودٍ، والقيودُ والفهارسُ بأسمائِها في الاتّجاهَينِ.
 *
 * ## ولمَ اشتقاقٌ يُحاكي PostgreSQL بدلَ قاعدةِ `<table>_<column>_check`؟
 *
 * انتظمتِ الخدمةُ في الترحيلاتِ المولَّدةِ (ADR-024)، والمولَّدُ يكتبُ أسماءَ القيودِ
 * **صراحةً** كما تُعلنُها المرآةُ. فاسمٌ في المرآةِ يخالفُ ما كانَ PostgreSQLُ سيُسمّيهِ عندَ
 * تطبيقِ العقدِ يُنتجُ قاعدتَينِ متكافئتَينِ في المعنى مختلفتَينِ في الكتالوجِ — وذاكَ ما
 * يُسقِطُهُ اختبارُ الدورةِ في `migrations.integration.test.ts`.
 *
 * والقاعدةُ الشائعةُ `<table>_<column>_check` **ليست** قاعدةَ PostgreSQL؛ إنّما هي
 * `ChooseConstraintName` فوقَ `makeObjectName`، وثلاثُ خصائصَ منها تظهرُ في هذا العقدِ فعلاً:
 *
 *   1. **فحصٌ يمسُّ أكثرَ من عمودٍ لا يحملُ اسمَ عمودٍ**: `<table>_check`.
 *   2. **والثاني منها في الجدولِ نفسِهِ** يأخذُ لاحقةً في الوسمِ لا في الاسمِ:
 *      `<table>_check1` (خمسةُ مواضعَ في هذا العقدِ — انظرِ الاختبارَ أدناه).
 *   3. **والقصُّ إلى 63 حرفاً يُقصُّ الأطولَ حرفاً حرفاً** لا يقطعُ الذيلَ: فحصُ
 *      `marketplace_reservation_ref` صارَ `delivery_inventory_reservatio_…_check`.
 *
 * فالاشتقاقُ هنا يُحاكي الخوارزميّةَ نفسَها (`makeObjectName` أدناه) ويُطبّقُها على القيودِ
 * غيرِ المسماةِ كلِّها — فحوصاً ومفاتيحَ فريدةً ومفاتيحَ أجنبيّةً ومفتاحاً مركّباً. وقد
 * **قِيسَتِ** الأسماءُ الناتجةُ من كتالوجٍ حقيقيٍّ طُبِّقَ عليهِ العقدُ قبلَ كتابةِ المرآةِ، ثمّ
 * أُثبِتَ تكافؤُ الكتالوجِ في سبعةِ أبعادٍ — فالاشتقاقُ مُصدَّقٌ لا مُدَّعىً.
 *
 * ## والاشتقاقُ **ذو حالةٍ** لأنّ العقدَ يكتبُ الفحصَ في سطرٍ لاحقٍ أحياناً
 *
 * `substitution_price_delta_minor_units INTEGER` يليهِ سطرٌ يبدأُ بـ`CHECK (…)`. فلا يكفي
 * فحصُ السطرِ نفسِهِ؛ ولذلك يُقرأُ نصُّ الجدولِ **متّصلاً** ويُستخرَجُ كلُّ `CHECK (…)` بموازنةِ
 * الأقواسِ، ويُستثنى ما تقدّمَهُ `CONSTRAINT <name>` (وهوَ هنا `ck_delivery_proof` وحدَه).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";

import { SCHEMA_CONTRACT_PATH } from "../db/migrate.js";
import {
  NOT_MIRRORED_TABLES,
  deliveryIdempotencyKeys,
  deliveryInventoryConflicts,
  deliveryInventoryObservations,
  deliveryInventoryRelayCheckpoint,
  deliveryInventoryRelayConsumedEvents,
  deliveryInventoryReservations,
  deliveryOutbox,
  deliveryRelayCheckpoint,
  deliveryRelayConsumedEvents,
  deliveryTaskTransitions,
  deliveryTasks,
  storeOrderItems,
  storeOrderTransitions,
  storeOrders,
} from "../db/schema.js";

const DDL = readFileSync(SCHEMA_CONTRACT_PATH, "utf8");

const MIRRORED = [
  storeOrders,
  storeOrderItems,
  storeOrderTransitions,
  deliveryTasks,
  deliveryTaskTransitions,
  deliveryOutbox,
  deliveryRelayConsumedEvents,
  deliveryRelayCheckpoint,
  deliveryInventoryObservations,
  deliveryInventoryRelayConsumedEvents,
  deliveryInventoryRelayCheckpoint,
  deliveryIdempotencyKeys,
  deliveryInventoryReservations,
  deliveryInventoryConflicts,
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

const TYPES = [
  "TEXT",
  "INTEGER",
  "BIGSERIAL",
  "BIGINT",
  "BOOLEAN",
  "UUID",
  "TIMESTAMPTZ",
  "JSONB",
  "SMALLINT",
];
// اللاحقةُ `[]` جزءٌ من النوعِ لا من بقيّةِ السطرِ: `TEXT` و`TEXT[]` نوعانِ مختلفانِ في
// الكتالوجِ، وإغفالُ اللاحقةِ كانَ سيُمرِّرُ مرآةَ مصفوفةٍ على عمودٍ مفردٍ وبالعكسِ
// (`affected_order_public_ids` في `delivery_inventory_conflicts` أوّلُ مصفوفةٍ في العقدِ).
const COLUMN_LINE = new RegExp(
  `^([a-z][a-z0-9_]*)\\s+(${TYPES.join("|")})\\b(\\[\\])?(.*)$`,
  "u",
);

/** أسطرُ الأعمدةِ بترتيبِ العقدِ — أساسُ كلِّ اشتقاقٍ بعدَها. */
function columnLines(table: string): ReadonlyArray<{ name: string; type: string; rest: string }> {
  const rows: Array<{ name: string; type: string; rest: string }> = [];
  for (const raw of tableBlock(table).split("\n")) {
    const found = COLUMN_LINE.exec(raw.trim());
    if (found) rows.push({ name: found[1]!, type: `${found[2]!}${found[3] ?? ""}`, rest: found[4]! });
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
 * الأعمدةُ التي يمسُّها تعبيرٌ: تُنزَعُ الحروفُ النصّيّةُ أوّلاً (`'active'` ليست عموداً ولو
 * وافقَ اسمُها اسمَ عمودٍ)، ثمّ يُبحَثُ عن كلِّ اسمِ عمودٍ بحدودِ كلمةٍ.
 */
function columnsTouched(expression: string, columns: ReadonlyArray<string>): ReadonlyArray<string> {
  const withoutLiterals = expression.replace(/'(?:[^']|'')*'/gu, "''");
  return columns.filter((column) => new RegExp(`\\b${column}\\b`, "u").test(withoutLiterals));
}

/**
 * أسماءُ القيودِ والفهارسِ في العقدِ لهذا الجدولِ، **بالاتجاهَينِ**: المُسمّاةُ صراحةً
 * (`CONSTRAINT …`)، والمُشتقّةُ بخوارزميّةِ PostgreSQL للقيودِ غيرِ المسماةِ (فحوصاً ·
 * مفاتيحَ فريدةً · مفاتيحَ أجنبيّةً · مفتاحاً مركّباً)، وأسماءُ `CREATE INDEX`.
 */
function ddlConstraintNames(table: string): ReadonlyArray<string> {
  const names = new Set<string>();
  const body = tableBlock(table);
  const columns = columnLines(table);
  const columnNames = columns.map((column) => column.name);

  for (const match of body.matchAll(/CONSTRAINT\s+([a-z_][a-z0-9_]*)/gu)) {
    names.add(match[1] as string);
  }

  // مفاتيحُ فريدةٌ مضمَّنةٌ في سطرِ العمودِ، ثمّ المُعلنةُ على مستوى الجدولِ.
  for (const column of columns) {
    if (/\bUNIQUE\b/u.test(column.rest)) {
      names.add(chooseName(table, column.name, "key", names));
    }
    if (/\bREFERENCES\b/u.test(column.rest)) {
      names.add(chooseName(table, column.name, "fkey", names));
    }
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

  if (/^\s*PRIMARY KEY\s*\(/mu.test(body)) {
    names.add(chooseName(table, null, "pkey", names));
  }

  const indexPattern = /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ([a-z_]+)[\s\S]*?;/gu;
  for (const match of DDL.matchAll(indexPattern)) {
    if (new RegExp(`ON ${table}\\s`, "u").test(match[0])) names.add(match[1] as string);
  }

  return [...names].sort();
}

/** نوعُ Postgres المُقابلُ لعمودِ Drizzle. */
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
 * ما تُسمّيهِ المرآةُ فعلاً: القيودُ (`check` و`unique` و`foreignKeys`) **والمفاتيحُ الأساسيّةُ
 * المُسمّاةُ** (المركّبةُ فقط، إذ لا اسمَ للمفتاحِ المضمّنِ في Drizzle فيُفلترُ) **والفهارسُ**.
 *
 * **والفريدُ المضمَّنُ في العمودِ لا يظهرُ في `uniqueConstraints`**: Drizzle يُعلّقُ اسمَهُ على
 * العمودِ نفسِهِ (`column.uniqueName`) ويُصدرُهُ في DDL قيداً مُسمّى. فإغفالُهُ هنا كانَ سيجعلُ
 * الحارسَ **يشتكي من مطابقةٍ صحيحةٍ**، ثمّ يُخفي — لو أُصلحَ بحذفِ الاسمِ من جانبِ العقدِ —
 * انحرافَ اسمٍ حقيقيّاً يقيسُهُ اختبارُ الدورةِ. فالجمعُ من الموضعَينِ لا من أحدِهما.
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
  it("العقدُ مقروءٌ وفيهِ أربعةَ عشرَ جدولاً ومتتالٌ واحدٌ", () => {
    expect(DDL).toContain("CREATE TABLE IF NOT EXISTS store_orders");
    expect([...DDL.matchAll(/CREATE TABLE IF NOT EXISTS/gu)]).toHaveLength(14);
    expect(DDL).toContain("CREATE SEQUENCE IF NOT EXISTS store_order_public_id_seq");
  });

  it("والمرآةُ أربعةَ عشرَ جدولاً بأسمائِها", () => {
    expect(MIRRORED.map((table) => getTableConfig(table).name).sort()).toEqual([
      "delivery_idempotency_keys",
      "delivery_inventory_conflicts",
      "delivery_inventory_observations",
      "delivery_inventory_relay_checkpoint",
      "delivery_inventory_relay_consumed_events",
      "delivery_inventory_reservations",
      "delivery_outbox",
      "delivery_relay_checkpoint",
      "delivery_relay_consumed_events",
      "delivery_task_transitions",
      "delivery_tasks",
      "store_order_items",
      "store_order_transitions",
      "store_orders",
    ]);
  });

  it("والاشتقاقُ يُحاكي قصَّ PostgreSQL إلى ثلاثةٍ وستّينَ حرفاً بقصِّ الأطولِ", () => {
    // القصُّ يأكلُ من اسمِ الجدولِ (الأطولِ) لا من اسمِ العمودِ — وهذا هوَ الاسمُ المقيسُ
    // في الكتالوجِ حرفاً، ولولا محاكاةُ الخوارزميّةِ لخرجَ اسمٌ من 64 حرفاً لا وجودَ لهُ.
    const derived = ddlConstraintNames("delivery_inventory_reservations");
    expect(derived).toContain("delivery_inventory_reservatio_marketplace_reservation_ref_check");
    expect(
      derived.every((name) => name.length <= 63),
      `اسمٌ يتجاوزُ 63 حرفاً: ${derived.filter((name) => name.length > 63).join(", ")}`,
    ).toBe(true);
  });

  it("وفحصٌ يمسُّ أكثرَ من عمودٍ يُسمّى بلا اسمِ عمودٍ — والثاني يأخذُ لاحقةً", () => {
    // خمسةُ مواضعَ في هذا العقدِ، والعدُّ بالضبطِ هوَ الحارسُ: لو نُسبَ فحصٌ مركّبٌ إلى
    // آخرِ عمودٍ رآهُ الماسحُ لظهرَ اسمٌ لا وجودَ لهُ في الكتالوجِ وغابَ اسمٌ موجودٌ.
    expect(ddlConstraintNames("store_orders")).toContain("store_orders_check");
    expect(ddlConstraintNames("store_order_transitions")).toContain("store_order_transitions_check");
    expect(ddlConstraintNames("delivery_task_transitions")).toContain(
      "delivery_task_transitions_check",
    );

    const items = ddlConstraintNames("store_order_items");
    expect(items).toContain("store_order_items_check");
    expect(items).toContain("store_order_items_check1");

    // ولا يُنسبُ فحصُ القيدِ المُسمّى (`ck_delivery_proof`) إلى عمودٍ: فحوصُ المهمّةِ
    // المُشتقّةُ سبعةٌ لا ثمانيةٌ، والثامنُ اسمُهُ المُعلَنُ في العقدِ.
    const taskChecks = ddlConstraintNames("delivery_tasks").filter((name) =>
      name.endsWith("_check"),
    );
    expect(taskChecks).toEqual([
      "delivery_tasks_courier_ref_check",
      "delivery_tasks_dispatch_job_ref_check",
      "delivery_tasks_ineligibility_reason_check",
      "delivery_tasks_proof_ref_check",
      "delivery_tasks_proof_type_check",
      "delivery_tasks_state_check",
      "delivery_tasks_version_check",
    ]);
    expect(ddlConstraintNames("delivery_tasks")).toContain("ck_delivery_proof");
  });

  it("والفحصُ في سطرٍ لاحقٍ يُلتقَطُ بموازنةِ الأقواسِ لا بقراءةِ السطرِ", () => {
    // `substitution_price_delta_minor_units INTEGER` ثمّ سطرٌ يبدأُ بـ`CHECK (…)`.
    const expressions = unnamedCheckExpressions("store_order_items");
    expect(expressions).toHaveLength(7);
    expect(
      expressions.some((expression) =>
        expression.includes("substitution_price_delta_minor_units IS NOT NULL"),
      ),
    ).toBe(true);
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
});
