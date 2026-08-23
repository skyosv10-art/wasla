/**
 * حارس انحراف مرآة Drizzle عن عقد PostgreSQL الرسمي.
 *
 * يقرأ هذا الاختبار `contracts/schema.sql` وقت التشغيل ويقارن كل اتجاه: عمود أو قيد يظهر
 * في العقد بلا مرآة، أو يظهر في المرآة بلا عقد، يفشل البناء. لا يكفي عدّ كلمات `ck_` في
 * النص؛ فالخطأ المؤذي هو أن يبقى الاسم موجوداً بينما يتغير نوع العمود أو إلزاميته أو افتراضه.
 *
 * لا يحتاج هذا الحارس قاعدة بيانات، ولذلك يعيش في التشغيل المعتاد لا في إعداد التكامل فقط.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  negotiationAgreements,
  negotiationIdempotency,
  negotiationMessages,
  negotiationOutbox,
  negotiationPolicies,
  negotiationPriceHandoffs,
  negotiationRounds,
  negotiationThreads,
} from '../infrastructure/drizzle/schema.js';

const SERVICE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const DDL = readFileSync(
  path.join(SERVICE_ROOT, 'contracts', 'schema.sql'),
  'utf8',
);
const REQUIRED_CONSTRAINTS = [
  'ck_negotiation_policies_amount_bounds',
  'ck_negotiation_policies_ttl_order',
  'ux_negotiation_threads_order_driver',
  'ux_negotiation_threads_dispatch_offer',
  'ck_negotiation_threads_open_is_clean',
  'ck_negotiation_threads_closed_has_reason',
  'ck_negotiation_threads_agreed_names_round',
  'ck_negotiation_threads_round_counters',
  'ck_negotiation_threads_agreed_round_exists',
  'ux_negotiation_rounds_thread_no',
  'ck_negotiation_rounds_state_timestamp',
  'ck_negotiation_rounds_no_self_resolution',
  'ux_negotiation_rounds_one_pending',
  'ux_negotiation_rounds_one_accepted',
  'ux_negotiation_messages_thread_seq',
  'ck_negotiation_messages_body_or_code',
  'ck_negotiation_messages_redaction',
  'ux_negotiation_agreements_order_driver',
  'ck_negotiation_agreements_handed_off_at',
  'ck_negotiation_agreements_terminal_no_retry',
  'ck_negotiation_agreements_failure_named',
  'ux_negotiation_price_handoffs_attempt',
  'ck_negotiation_price_handoffs_completion',
  'ck_negotiation_price_handoffs_failure_named',
] as const;

const TABLES = [
  { name: 'negotiation_policies', table: negotiationPolicies },
  { name: 'negotiation_threads', table: negotiationThreads },
  { name: 'negotiation_rounds', table: negotiationRounds },
  { name: 'negotiation_messages', table: negotiationMessages },
  { name: 'negotiation_agreements', table: negotiationAgreements },
  { name: 'negotiation_price_handoffs', table: negotiationPriceHandoffs },
  { name: 'negotiation_idempotency', table: negotiationIdempotency },
  { name: 'negotiation_outbox', table: negotiationOutbox },
] as const;

type AnyTable = (typeof TABLES)[number]['table'];

type ColumnShape = {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly defaultValue: string | null;
};

/** يستخرج جسم CREATE TABLE بلا الاعتماد على مجلد التشغيل. */
function ddlTableBody(tableName: string): string {
  const match = new RegExp(
    `CREATE TABLE IF NOT EXISTS ${tableName} \\(([\\s\\S]*?)\\n\\);`,
    'u',
  ).exec(DDL);

  if (match?.[1] === undefined) {
    throw new Error(`لم يُعثر على الجدول ${tableName} في عقد PostgreSQL`);
  }

  return match[1];
}

/**
 * يفصل تعريفات الأعمدة متعددة الأسطر عن القيود متعددة الأسطر.
 *
 * يبدأ كل عمود في العقد بمسافة ثم اسم ونوع PostgreSQL؛ أما التعليقات والقيود فلا تطابق هذه
 * البداية. تجميع الأسطر التالية مهم لحالات `state DEFAULT 'open'` التي يضعها العقد بسطرين.
 */
function ddlColumns(tableName: string): ColumnShape[] {
  const definitions: string[] = [];
  let current: string[] | null = null;

  for (const sourceLine of ddlTableBody(tableName).split('\n')) {
    const line = sourceLine.trim();
    if (
      /^[a-z_]+\s+(UUID|TEXT|JSONB|INTEGER|BIGINT|BOOLEAN|TIMESTAMPTZ)\b/u.test(
        line,
      )
    ) {
      if (current !== null) definitions.push(current.join(' '));
      current = [line];
      continue;
    }
    if (line.startsWith('CONSTRAINT')) {
      if (current !== null) definitions.push(current.join(' '));
      current = null;
      continue;
    }
    if (current !== null && !line.startsWith('--')) {
      current.push(line);
    }
  }
  if (current !== null) definitions.push(current.join(' '));

  return definitions.map((definition) => {
    const match =
      /^(?<name>[a-z_]+)\s+(?<type>UUID|TEXT|JSONB|INTEGER|BIGINT|BOOLEAN|TIMESTAMPTZ)\b/u.exec(
        definition,
      );
    if (match?.groups?.name === undefined || match.groups.type === undefined) {
      throw new Error(`تعريف عمود غير قابل للقراءة: ${definition}`);
    }

    const defaultMatch = /\bDEFAULT\s+(now\(\)|false|0|1|'[^']+')/u.exec(
      definition,
    );
    return {
      name: match.groups.name,
      type: normalizeDdlType(match.groups.type),
      notNull: /\bNOT NULL\b|\bPRIMARY KEY\b/u.test(definition),
      defaultValue:
        defaultMatch?.[1] === undefined
          ? null
          : normalizeDdlDefault(defaultMatch[1]),
    };
  });
}

function normalizeDdlType(type: string): string {
  const types: Record<string, string> = {
    UUID: 'uuid',
    TEXT: 'text',
    JSONB: 'jsonb',
    INTEGER: 'integer',
    BIGINT: 'bigint',
    BOOLEAN: 'boolean',
    TIMESTAMPTZ: 'timestamp with time zone',
  };
  return types[type]!;
}

function normalizeDdlDefault(value: string): string {
  if (value === 'now()') return 'sql';
  return value.replace(/^'|'$/gu, '');
}

/** يعرض بيانات العمود التي يعلنها Drizzle فعلياً، لا نص المصدر TypeScript. */
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
          : typeof defaultValue === 'object'
            ? 'sql'
            : String(defaultValue),
    };
  });
}

/** يجمع الأسماء التي عرّفتها مرآة Drizzle من checks وunique indexes وindexes العادية. */
function drizzleNames(table: AnyTable): string[] {
  const config = getTableConfig(table);
  return [
    ...config.checks.map((check) => check.name),
    ...config.uniqueConstraints.map((constraint) => constraint.name),
    ...config.indexes.map((index) => index.config.name),
  ]
    .filter((name): name is string => name !== undefined)
    .sort();
}

/** يجمع القيود والفهارس المسماة في العقد، سواء كانت داخل الجدول أو CREATE INDEX خارجه. */
function ddlNames(tableName: string): string[] {
  const names = new Set<string>();
  const body = ddlTableBody(tableName);

  for (const match of body.matchAll(
    /CONSTRAINT\s+((?:ck|ux)_negotiation_[a-z_]+)/gu,
  )) {
    names.add(match[1] as string);
  }

  const indexPattern =
    /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ((?:ix|ux)_negotiation_[a-z_]+)[\s\S]*?;/gu;
  for (const match of DDL.matchAll(indexPattern)) {
    if (match[0].includes(`ON ${tableName} `)) {
      names.add(match[1] as string);
    }
  }

  return [...names].sort();
}

describe('مرآة Drizzle ↔ عقد PostgreSQL للتفاوض', () => {
  it.each(TABLES)(
    '$name يحتفظ باسم الجدول المتعاقد عليه',
    ({ name, table }) => {
      expect(getTableName(table)).toBe(name);
    },
  );

  it.each(TABLES)(
    '$name يطابق الأعمدة والنوع وNOT NULL والقيمة الافتراضية',
    ({ name, table }) => {
      expect(drizzleColumns(table).sort(byName)).toEqual(
        ddlColumns(name).sort(byName),
      );
    },
  );

  it.each(TABLES)(
    '$name يطابق مجموعة القيود والفهارس المسماة في الاتجاهين',
    ({ name, table }) => {
      expect(drizzleNames(table)).toEqual(ddlNames(name));
    },
  );

  it('يغطي كل جدول أعلنه العقد ولا يعلن جدولاً زائداً', () => {
    const declared = [
      ...DDL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gu),
    ].map((match) => match[1]);
    expect(declared.sort()).toEqual(TABLES.map((entry) => entry.name).sort());
  });

  it('يضع القيود الأربعة والعشرين المسماة كلها في مرآة Drizzle', () => {
    const mirrorNames = new Set(
      TABLES.flatMap(({ table }) => drizzleNames(table)),
    );
    expect([...REQUIRED_CONSTRAINTS].sort()).toEqual(
      [...mirrorNames]
        .filter((name) => REQUIRED_CONSTRAINTS.includes(name as never))
        .sort(),
    );
  });

  it('يعلن العقد نفسه القيود الأربعة والعشرين بلا تكرار أو غياب', () => {
    const contractNames = new Set(
      [...DDL.matchAll(/\b(?:ck|ux)_negotiation_[a-z_]+\b/gu)].map(
        (match) => match[0],
      ),
    );
    expect(contractNames.size).toBe(24);
    expect([...contractNames].sort()).toEqual([...REQUIRED_CONSTRAINTS].sort());
  });
});

function byName(left: ColumnShape, right: ColumnShape): number {
  return left.name.localeCompare(right.name);
}
