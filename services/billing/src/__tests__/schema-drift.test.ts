/**
 * حارسُ انحرافِ المخطط — يقارن مرآةَ Drizzle بعقدِ `schema.sql`.
 *
 * العمودُ أو القيدُ في العقدِ بلا مرآة، أو في المرآة بلا عقد، يُفشل البناء.
 * هذا اختبارٌ صامتٌ لا يحتاجُ قاعدةَ بيانات: يقرأُ الـDDL نصّاً ويُحلّلُه.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { billingInvoices, billingSettlements, billingOutbox } from "../infrastructure/drizzle/schema.js";

const SERVICE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHEMA_SQL = readFileSync(join(SERVICE_ROOT, "contracts", "schema.sql"), "utf8");

function extractTableNames(sql: string): Set<string> {
  const names = new Set<string>();
  const re = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    names.add(m[1]);
  }
  return names;
}

function extractColumnNames(sql: string, table: string): Set<string> {
  const cols = new Set<string>();
  const re = new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\s*\\(([^;]+)\\)`, "i");
  const m = re.exec(sql);
  if (!m) return cols;

  const body = m[1];
  for (const line of body.split("\n")) {
    const trimmed = line.trim().replace(/,$/, "").trim();
    if (!trimmed) continue;
    if (/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|INDEX|CREATE|KEY)\b/i.test(trimmed)) continue;
    const colMatch = trimmed.match(/^(\w+)\s+/);
    if (colMatch) cols.add(colMatch[1]);
  }
  return cols;
}

function drizzleColumnNames(table: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const col of Object.values(table)) {
    if (col && typeof col === "object" && "name" in col) {
      names.add((col as { name: string }).name);
    }
  }
  return names;
}

describe("Schema drift — Drizzle mirror vs schema.sql contract", () => {
  const contractTables = extractTableNames(SCHEMA_SQL);

  it("mirrors the same three tables as the contract", () => {
    expect(contractTables.has("billing_invoices")).toBe(true);
    expect(contractTables.has("billing_settlements")).toBe(true);
    expect(contractTables.has("billing_outbox")).toBe(true);
  });

  it("billing_invoices has all contract columns", () => {
    const contractCols = extractColumnNames(SCHEMA_SQL, "billing_invoices");
    const mirrorCols = drizzleColumnNames(billingInvoices as unknown as Record<string, unknown>);

    for (const col of contractCols) {
      expect(mirrorCols.has(col), `Column "${col}" in contract but not in Drizzle mirror`).toBe(true);
    }
  });

  it("billing_settlements has all contract columns", () => {
    const contractCols = extractColumnNames(SCHEMA_SQL, "billing_settlements");
    const mirrorCols = drizzleColumnNames(billingSettlements as unknown as Record<string, unknown>);

    for (const col of contractCols) {
      expect(mirrorCols.has(col), `Column "${col}" in contract but not in Drizzle mirror`).toBe(true);
    }
  });

  it("billing_outbox has all contract columns", () => {
    const contractCols = extractColumnNames(SCHEMA_SQL, "billing_outbox");
    const mirrorCols = drizzleColumnNames(billingOutbox as unknown as Record<string, unknown>);

    for (const col of contractCols) {
      expect(mirrorCols.has(col), `Column "${col}" in contract but not in Drizzle mirror`).toBe(true);
    }
  });

  it("no extra columns in Drizzle mirror beyond the contract", () => {
    const contractInvoices = extractColumnNames(SCHEMA_SQL, "billing_invoices");
    const mirrorInvoices = drizzleColumnNames(billingInvoices as unknown as Record<string, unknown>);

    for (const col of mirrorInvoices) {
      expect(contractInvoices.has(col), `Column "${col}" in Drizzle mirror but not in contract`).toBe(true);
    }
  });
});
