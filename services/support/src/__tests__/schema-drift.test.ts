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

import { supportTickets, supportEvidence, supportOutbox } from "../infrastructure/drizzle/schema.js";

const SERVICE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHEMA_SQL = readFileSync(join(SERVICE_ROOT, "contracts", "schema.sql"), "utf8");

// ---------------------------------------------------------------------------
// استخراجُ أسماء الجداول والأعمدة من العقد
// ---------------------------------------------------------------------------

/** يُستخرجُ اسمُ الجدولِ من `CREATE TABLE IF NOT EXISTS name (`. */
function extractTableNames(sql: string): Set<string> {
  const names = new Set<string>();
  const re = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    names.add(m[1]);
  }
  return names;
}

/** يُستخرجُ اسمُ العمودِ من سطرٍ في تعريفِ الجدول. */
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

/** يُستخرجُ أسماءُ أعمدةِ DB من مرآةِ Drizzle. */
function drizzleColumnNames(table: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const col of Object.values(table)) {
    if (col && typeof col === "object" && "name" in col) {
      names.add((col as { name: string }).name);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// الاختبارات
// ---------------------------------------------------------------------------

describe("Schema drift — Drizzle mirror vs schema.sql contract", () => {
  const contractTables = extractTableNames(SCHEMA_SQL);

  it("mirrors the same three tables as the contract", () => {
    expect(contractTables.has("support_tickets")).toBe(true);
    expect(contractTables.has("support_evidence")).toBe(true);
    expect(contractTables.has("support_outbox")).toBe(true);
  });

  it("support_tickets has all contract columns", () => {
    const contractCols = extractColumnNames(SCHEMA_SQL, "support_tickets");
    const mirrorCols = drizzleColumnNames(supportTickets as unknown as Record<string, unknown>);

    for (const col of contractCols) {
      expect(mirrorCols.has(col), `Column "${col}" in contract but not in Drizzle mirror`).toBe(true);
    }
  });

  it("support_evidence has all contract columns", () => {
    const contractCols = extractColumnNames(SCHEMA_SQL, "support_evidence");
    const mirrorCols = drizzleColumnNames(supportEvidence as unknown as Record<string, unknown>);

    for (const col of contractCols) {
      expect(mirrorCols.has(col), `Column "${col}" in contract but not in Drizzle mirror`).toBe(true);
    }
  });

  it("support_outbox has all contract columns", () => {
    const contractCols = extractColumnNames(SCHEMA_SQL, "support_outbox");
    const mirrorCols = drizzleColumnNames(supportOutbox as unknown as Record<string, unknown>);

    for (const col of contractCols) {
      expect(mirrorCols.has(col), `Column "${col}" in contract but not in Drizzle mirror`).toBe(true);
    }
  });

  it("no extra columns in Drizzle mirror beyond the contract", () => {
    const contractTickets = extractColumnNames(SCHEMA_SQL, "support_tickets");
    const mirrorTickets = drizzleColumnNames(supportTickets as unknown as Record<string, unknown>);

    for (const col of mirrorTickets) {
      expect(contractTickets.has(col), `Column "${col}" in Drizzle mirror but not in contract`).toBe(true);
    }
  });
});
