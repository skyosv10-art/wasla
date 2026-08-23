import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SUBSCRIPTION_SERVICE_PORT } from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = resolve(__dirname, "../../../../../services/subscriptions/contracts");
const schema = readFileSync(resolve(base, "schema.sql"), "utf8");
const api = readFileSync(resolve(base, "api.openapi.yml"), "utf8");
const eventsRaw = readFileSync(resolve(base, "events.json"), "utf8");
const events = JSON.parse(eventsRaw) as unknown;
/** نزيل الشرح: الحدّ يخص أسماء الأعمدة لا النثر الذي يشرح غيابها. */
const schemaCode = schema.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
const apiCode = api.split("\n").map((line) => line.replace(/#.*$/, "")).join("\n");
function sqlColumns(sql: string): string[] {
  return [...sql.matchAll(/^ {4}([a-z][a-z0-9_]*)\s+[A-Z]/gm)].map((match) => match[1]!);
}
function yamlPropertyKeys(yml: string): string[] {
  const lines = yml.split("\n"); const keys: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const parent = /^(\s*)properties:\s*$/.exec(lines[index]!);
    if (!parent) continue;
    const childIndent = parent[1]!.length + 2;
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next]!; if (!line.trim()) continue;
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= parent[1]!.length) break;
      const child = new RegExp(`^ {${childIndent}}([A-Za-z_][A-Za-z0-9_]*):`).exec(line);
      if (child) keys.push(child[1]!);
    }
  }
  return keys;
}
function jsonPropertyKeys(node: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(node)) for (const value of node) jsonPropertyKeys(value, keys);
  else if (node && typeof node === "object") {
    const object = node as { properties?: Record<string, unknown> };
    if (object.properties) for (const key of Object.keys(object.properties)) keys.add(key);
    for (const value of Object.values(node)) jsonPropertyKeys(value, keys);
  }
  return keys;
}
const fieldNames = new Set([...sqlColumns(schemaCode), ...yamlPropertyKeys(apiCode), ...jsonPropertyKeys(events)]);
const machineSurface = [...fieldNames].join("\n").toLowerCase();

describe("حد المال والبيانات الحرة في عقد الاشتراك", () => {
  /**
   * لماذا هذا الحارس: هذه الخدمة تسجل استحقاقاً ومرجع تحصيل معتماً، لا مصدر حقيقة للمال.
   * النسخة الخاطئة الأرخص: amount أو price «للعرض فقط» ثم يصبح رقماً ثانياً مختلفاً عن Billing.
   */
  it("يمنع نوع مال أو فاصلة عائمة في schema.sql بعد حذف التعليقات", () => {
    expect(schemaCode).not.toMatch(/\b(?:NUMERIC|DECIMAL|MONEY|FLOAT|REAL)\b/i);
  });
  it("يمنع أسماء حقول المال من الأعمدة ومفاتيح العقود مع إبقاء payment_reference مسموحاً", () => {
    for (const forbidden of ["amount", "currency", "price", "vat", "invoice", "refund", "card", "iban"]) {
      expect(fieldNames, forbidden).not.toContain(forbidden);
    }
    expect(fieldNames).toContain("payment_reference");
  });
  it("يمنع عمود نص حر من المخطط بعد حذف التعليقات", () => {
    for (const forbidden of ["comment", "note", "description"]) expect(sqlColumns(schemaCode), forbidden).not.toContain(forbidden);
  });
});

describe("حد الخدمة وخصوصية سطح العقد", () => {
  it("يمنع مفتاحاً أجنبياً إلى drivers أو orders أو reputation", () => {
    expect(schemaCode).not.toMatch(/\bREFERENCES\s+(?:drivers|orders|reputation_\w*)\b/i);
  });
  it("يمنع الهاتف والاسم والإحداثية والقناة من أسماء الحقول", () => {
    for (const forbidden of ["phone", "name", "latitude", "longitude", "lat", "lng", "chat_id", "telegram"]) {
      expect(fieldNames, forbidden).not.toContain(forbidden);
    }
  });
  /**
   * لماذا هذا الحارس: community أرضية امتياز لا أداة عقاب؛ قرار الحجب يملكه حد آخر.
   * النسخة الخاطئة الأرخص: حقل blocked أو حدث ban بجانب community فيمنح هذا العقد سلطة لا يملكها.
   */
  it("يمنع اقتران community بحجب أو إيقاف في السطح الآلي للعقود", () => {
    for (const forbidden of ["suspend", "block", "ban"]) expect(machineSurface, forbidden).not.toContain(forbidden);
  });
});

describe("تخصيص منفذ خدمة الاشتراك", () => {
  it("يمنع أي منفذ 809x غير 8093 في العقد", () => {
    expect(SUBSCRIPTION_SERVICE_PORT).toBe(8093);
    const ports = [...`${schemaCode}\n${apiCode}\n${eventsRaw}`.matchAll(/\b(809\d)\b/g)].map((match) => Number(match[1]!));
    expect(ports).toEqual([SUBSCRIPTION_SERVICE_PORT]);
  });
});
