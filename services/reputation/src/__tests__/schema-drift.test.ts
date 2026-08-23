/**
 * حارسُ انحراف مرآة Drizzle عن عقد PostgreSQL الرسميّ.
 *
 * يقرأ هذا الاختبارُ `contracts/schema.sql` وقتَ التشغيل ويقارن **الاتجاهين**: عمودٌ أو
 * قيدٌ في العقد بلا مرآة، أو في المرآة بلا عقد، يُفشل البناء. ولا يكفي عدُّ كلمات `ck_`
 * في النصّ: الخطأُ المؤذي أن يبقى الاسمُ موجوداً بينما يتغيّر نوعُ العمود أو إلزاميّتُه
 * أو افتراضُه — فيُكتب صفٌّ تقبله المرآةُ وترفضه القاعدة، ويُكتشف أوّلَ مرّةٍ في الإنتاج.
 *
 * ولا يحتاج هذا الحارسُ قاعدةَ بيانات، فيعيش في التشغيل المعتاد لا في إعداد التكامل
 * وحده: انحرافُ مرآةٍ يجب أن يظهر لمن لا Postgres على جهازه أيضاً.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { ENFORCED_CONSTRAINTS } from "../infrastructure/constraints.js";
import {
  fraudSignals,
  reputationFacts,
  reputationFraudThresholds,
  reputationIdempotency,
  reputationOutbox,
  reputationRatings,
  reputationRuleWeights,
  reputationRulesets,
  reputationScores,
} from "../infrastructure/drizzle/schema.js";

const SERVICE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DDL = readFileSync(path.join(SERVICE_ROOT, "contracts", "schema.sql"), "utf8");

const TABLES = [
  { name: "reputation_rulesets", table: reputationRulesets },
  { name: "reputation_rule_weights", table: reputationRuleWeights },
  { name: "reputation_fraud_thresholds", table: reputationFraudThresholds },
  { name: "reputation_facts", table: reputationFacts },
  { name: "reputation_scores", table: reputationScores },
  { name: "reputation_ratings", table: reputationRatings },
  { name: "fraud_signals", table: fraudSignals },
  { name: "reputation_idempotency", table: reputationIdempotency },
  { name: "reputation_outbox", table: reputationOutbox },
] as const;

type AnyTable = (typeof TABLES)[number]["table"];

interface ColumnShape {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly defaultValue: string | null;
}

const DDL_TYPES: Record<string, string> = {
  UUID: "uuid",
  TEXT: "text",
  JSONB: "jsonb",
  INTEGER: "integer",
  SMALLINT: "smallint",
  BIGINT: "bigint",
  BOOLEAN: "boolean",
  TIMESTAMPTZ: "timestamp with time zone",
};

const TYPE_ALTERNATIVES = Object.keys(DDL_TYPES).join("|");

/** أسماءُ القيود والفهارس في هذه الخدمة: `reputation_*` و`fraud_signals_*`. */
const NAME_PATTERN = "(?:ck|ux|pk|ix)_(?:reputation|fraud_signals)_[a-z_]+";

/** يستخرج جسمَ `CREATE TABLE` بلا اعتمادٍ على مجلّد التشغيل. */
function ddlTableBody(tableName: string): string {
  const match = new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName} \\(([\\s\\S]*?)\\n\\);`, "u").exec(
    DDL,
  );
  if (match?.[1] === undefined) {
    throw new Error(`لم يُعثر على الجدول ${tableName} في عقد PostgreSQL`);
  }
  return match[1];
}

/**
 * يفصل تعريفاتِ الأعمدة متعدّدةَ الأسطر عن القيود متعدّدةِ الأسطر.
 *
 * كلُّ عمودٍ في العقد يبدأ بمسافةٍ ثمّ اسمٍ ونوعِ PostgreSQL؛ أمّا التعليقاتُ والقيودُ
 * فلا تُطابق هذه البداية. وجمعُ الأسطر التالية ضروريٌّ لأنّ `CHECK (... IN (...))` في
 * هذا العقد يُكتب على أسطرٍ ثلاثة.
 */
function ddlColumns(tableName: string): ColumnShape[] {
  const definitions: string[] = [];
  let current: string[] | null = null;

  for (const sourceLine of ddlTableBody(tableName).split("\n")) {
    const line = sourceLine.trim();
    if (new RegExp(`^[a-z_]+\\s+(?:${TYPE_ALTERNATIVES})\\b`, "u").test(line)) {
      if (current !== null) definitions.push(current.join(" "));
      current = [line];
      continue;
    }
    if (line.startsWith("CONSTRAINT")) {
      if (current !== null) definitions.push(current.join(" "));
      current = null;
      continue;
    }
    if (current !== null && !line.startsWith("--")) current.push(line);
  }
  if (current !== null) definitions.push(current.join(" "));

  return definitions.map((definition) => {
    const match = new RegExp(
      `^(?<name>[a-z_]+)\\s+(?<type>${TYPE_ALTERNATIVES})\\b`,
      "u",
    ).exec(definition);
    if (match?.groups?.name === undefined || match.groups.type === undefined) {
      throw new Error(`تعريفُ عمودٍ غيرُ قابلٍ للقراءة: ${definition}`);
    }
    const defaultMatch = /\bDEFAULT\s+(now\(\)|false|true|0|1|'[^']+')/u.exec(definition);
    return {
      name: match.groups.name,
      type: DDL_TYPES[match.groups.type]!,
      notNull: /\bNOT NULL\b|\bPRIMARY KEY\b/u.test(definition),
      defaultValue:
        defaultMatch?.[1] === undefined ? null : normalizeDdlDefault(defaultMatch[1]),
    };
  });
}

function normalizeDdlDefault(value: string): string {
  if (value === "now()") return "sql";
  return value.replace(/^'|'$/gu, "");
}

/** ما يُعلنه Drizzle فعلاً، لا نصُّ مصدر TypeScript. */
function drizzleColumns(table: AnyTable): ColumnShape[] {
  return Object.values(getTableColumns(table)).map((column) => {
    const defaultValue = column.default;
    return {
      name: column.name,
      type: column.getSQLType(),
      notNull: column.notNull,
      defaultValue:
        defaultValue === undefined
          ? null
          : typeof defaultValue === "object"
            ? "sql"
            : String(defaultValue),
    };
  });
}

/**
 * الأسماءُ التي عرّفتها المرآة: `check` و`unique` والفهارس **والمفاتيحُ الأساسيّة
 * المُركّبة**.
 *
 * ثلاثةُ مفاتيحَ أساسيّةٍ في هذا العقد مُسمّاةٌ صراحةً (`pk_reputation_scores` وأخواه)،
 * وهي مفروضةٌ في مُهيئ الذاكرة بأسمائها. فلو أهمل هذا الحارسُ `primaryKeys` لأمكن أن
 * تُسمّى المرآةُ مفتاحَها `reputation_scores_pkey` بينما يرمي المُهيئُ اسماً آخر —
 * فتنجح المطابقةُ على اسمٍ لا وجودَ له في القاعدة.
 */
function drizzleNames(table: AnyTable): string[] {
  const config = getTableConfig(table);
  return [
    ...config.checks.map((check) => check.name),
    ...config.uniqueConstraints.map((constraint) => constraint.name),
    ...config.primaryKeys.map((key) => key.getName()),
    ...config.indexes.map((index) => index.config.name),
  ]
    .filter((name): name is string => name !== undefined && name.length > 0)
    .sort();
}

/** القيودُ والفهارسُ المُسمّاةُ في العقد لهذا الجدول، داخلَه أو في `CREATE INDEX` بعده. */
function ddlNames(tableName: string): string[] {
  const names = new Set<string>();

  for (const match of ddlTableBody(tableName).matchAll(
    new RegExp(`CONSTRAINT\\s+(${NAME_PATTERN})`, "gu"),
  )) {
    names.add(match[1] as string);
  }

  const indexPattern = new RegExp(
    `CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (${NAME_PATTERN})[\\s\\S]*?;`,
    "gu",
  );
  for (const match of DDL.matchAll(indexPattern)) {
    if (new RegExp(`ON ${tableName}\\s`, "u").test(match[0])) names.add(match[1] as string);
  }

  return [...names].sort();
}

describe("مرآة Drizzle ↔ عقد PostgreSQL للسمعة", () => {
  it.each(TABLES)("$name يحتفظ باسم الجدول المتعاقد عليه", ({ name, table }) => {
    expect(getTableName(table)).toBe(name);
  });

  it.each(TABLES)(
    "$name يطابق الأعمدةَ والنوعَ وNOT NULL والقيمةَ الافتراضية",
    ({ name, table }) => {
      expect(drizzleColumns(table).sort(byName)).toEqual(ddlColumns(name).sort(byName));
    },
  );

  it.each(TABLES)("$name يطابق مجموعةَ القيود والفهارس المُسمّاة في الاتجاهين", ({ name, table }) => {
    expect(drizzleNames(table)).toEqual(ddlNames(name));
  });

  it("يُغطّي كلَّ جدولٍ أعلنه العقد ولا يُعلن جدولاً زائداً", () => {
    const declared = [...DDL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gu)].map(
      (match) => match[1],
    );
    expect(declared.sort()).toEqual(TABLES.map((entry) => entry.name).sort());
  });

  it("والقيودُ الخمسةَ عشرَ المفروضةُ في الذاكرة كلُّها في المرآة أيضاً", () => {
    /**
     * ثلاثةُ مصادرَ لاسمٍ واحد: الـDDL، ومُهيئُ الذاكرة (`ENFORCED_CONSTRAINTS`)،
     * ومرآةُ Drizzle. واختبارُ `constraints.test.ts` يربط الأوّلين، وهذا يربط الثالث —
     * فلا يبقى اسمٌ مفروضٌ في الذاكرة ومفقودٌ من المرآة، وهو الفرقُ الذي كان سيجعل
     * `translate` في المستودع يرمي خطأً عامّاً بدل خطأِ القيد المُسمّى.
     */
    const mirrored = new Set(TABLES.flatMap(({ table }) => drizzleNames(table)));
    const missing = ENFORCED_CONSTRAINTS.filter((name) => !mirrored.has(name));
    expect(missing).toEqual([]);
    expect(ENFORCED_CONSTRAINTS).toHaveLength(15);
  });

  it("والفهارسُ الأحدَ عشرَ المُعلَنةُ في العقد كلُّها في المرآة", () => {
    const declared = [...DDL.matchAll(new RegExp(`INDEX IF NOT EXISTS (${NAME_PATTERN})`, "gu"))]
      .map((match) => match[1] as string)
      .sort();
    const mirrored = new Set(TABLES.flatMap(({ table }) => drizzleNames(table)));
    expect(declared).toHaveLength(11);
    expect(declared.filter((name) => !mirrored.has(name))).toEqual([]);
  });
});

function byName(left: ColumnShape, right: ColumnShape): number {
  return left.name.localeCompare(right.name);
}
