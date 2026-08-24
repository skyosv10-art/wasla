import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MARKETPLACE_SERVICE_PORT } from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = resolve(__dirname, "../../../../../services/marketplace/contracts");
const schema = readFileSync(resolve(base, "schema.sql"), "utf8");
const api = readFileSync(resolve(base, "api.openapi.yml"), "utf8");
const eventsRaw = readFileSync(resolve(base, "events.json"), "utf8");
const events = JSON.parse(eventsRaw) as unknown;
/**
 * نزيل الشرح: الحدّ يخص **أسماء الحقول والأعمدة** لا النثر الذي يشرح غيابها.
 * وهذا لازمٌ هنا بالذات لأنّ متنَ العقد يذكر `NUMERIC` و`commission` و`quantity_reserved`
 * صراحةً في سياقِ النفي، فحارسٌ يقرأ النصَّ الخام كان سيفشل على العقدِ الصحيح.
 */
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
const sqlColumnNames = new Set(sqlColumns(schemaCode));
const apiPropertyNames = new Set(yamlPropertyKeys(apiCode));
const eventPropertyNames = jsonPropertyKeys(events);
const fieldNames = new Set([...sqlColumnNames, ...apiPropertyNames, ...eventPropertyNames]);

describe("حد المال في عقد السوق (ADR-016 القرار 4)", () => {
  /**
   * لماذا هذا الحارس: السعرُ عددٌ صحيحٌ بالهللات؛ وفاصلةٌ عائمةٌ تجعل 29.90 رقماً لا يُطابق
   * نفسَه عند الجمع، فيختلف مجموعُ سلّةٍ عن مجموعِ الفاتورةِ بهللةٍ لا يجدها أحد.
   * النسخة الخاطئة الأرخص: NUMERIC(10,2) لأنّها «تقرأ أوضح» في لوحة تحكّم.
   */
  it("يمنع نوع مال أو فاصلة عائمة في schema.sql بعد حذف التعليقات", () => {
    expect(schemaCode).not.toMatch(/\b(?:NUMERIC|DECIMAL|MONEY|FLOAT|REAL|DOUBLE)\b/i);
  });
  /**
   * لماذا هذا الحارس: هذا الحدُّ كتالوجٌ لا بوّابةُ سداد؛ وحقلٌ واحدٌ عن المال يجعل مستهلكاً
   * يُرسل إليه ما لا يجوز أن يراه ويجعل رقماً ثانياً بجانب Phase 17.
   * النسخة الخاطئة الأرخص: `commission_rate` «لحساب العرض فقط» ثم يصير مصدرَ حقيقةٍ للتسوية.
   */
  it("يمنع أسماء حقول المال مع إبقاء سعر الكتالوج وعملته مسموحَين", () => {
    for (const forbidden of [
      "amount", "total", "subtotal", "fee", "commission", "vat", "tax", "discount",
      "invoice", "invoice_id", "payout", "refund", "card", "iban", "payment_reference",
    ]) expect(fieldNames, forbidden).not.toContain(forbidden);
    expect(fieldNames).toContain("price_minor_units");
    expect(fieldNames).toContain("currency_code");
  });
  /**
   * لماذا هذا الحارس: السعرُ في المورد ومحرَّمٌ في الحدث؛ ومستهلكٌ يحفظه من حدثٍ يحسب على
   * رقمٍ قديمٍ ويعرض على المشتري سعراً لا وجودَ له.
   * النسخة الخاطئة الأرخص: إضافته إلى `product_created` «كي لا يُقرأ المورد مرّتَين».
   */
  it("يمنع السعر والعملة والنص الحر من مفاتيح الأحداث ويثبت وجودها في المورد", () => {
    for (const forbidden of ["price_minor_units", "currency_code", "title_ar", "description_ar"]) {
      expect(eventPropertyNames, forbidden).not.toContain(forbidden);
    }
    for (const present of ["price_minor_units", "title_ar"]) {
      expect(apiPropertyNames, present).toContain(present);
    }
  });
});

describe("حد الحجز والبحث والظهور (القرارات 3 و5 و9)", () => {
  /**
   * لماذا هذا الحارس: الحجزُ ملكُ Phase 13 والبحثُ ملكُ Phase 12؛ وعمودٌ هنا لأحدهما يجعل
   * طورَين يكتبان في الرقم نفسه بلا مالكٍ للقرار.
   * النسخة الخاطئة الأرخص: `tsvector` «جاهزيةً للبحث» فيصير للفهرسِ مصدران يتباعدان.
   */
  it("يمنع أعمدة الحجز والفهرسة من المخطط", () => {
    for (const forbidden of ["quantity_reserved", "quantity_available", "reserved_until", "search_vector"]) {
      expect(sqlColumnNames, forbidden).not.toContain(forbidden);
    }
    expect(schemaCode).not.toMatch(/\btsvector\b/i);
    expect(schemaCode).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
  /**
   * لماذا هذا الحارس: الظهورُ مُشتَقٌّ عند القراءةِ ولا يُخزَّن (القرار 3)؛ عمودٌ له يجعل كلَّ
   * إيقافِ متجرٍ كتابةً على كلِّ منتجاتِه، وأوّلُ فشلٍ في المنتصف يترك سوقاً نصفَ ظاهر.
   * النسخة الخاطئة الأرخص: عمودٌ `is_visible` يُحدَّث بمُشغِّل، فيبدو أسرعَ ويكذب بصمت.
   */
  it("يمنع عمود ظهور في المخطط ويُبقيه محسوباً في القراءة", () => {
    for (const forbidden of ["is_visible", "visible", "is_searchable"]) {
      expect(sqlColumnNames, forbidden).not.toContain(forbidden);
    }
    expect(apiPropertyNames).toContain("is_visible");
    expect(eventPropertyNames).not.toContain("is_visible");
  });
  it("يمنع مسار بحثٍ أو معامل استعلام نصّيّ في هذا الطور", () => {
    expect(apiCode).not.toMatch(/^\s+name: q$/m);
    expect(api).not.toMatch(/^ {2}\/search/m);
  });
});

describe("حد الهوية وخصوصية سطح العقد (القرار 6)", () => {
  /**
   * لماذا هذا الحارس: المالكُ والعضوُ مُعرّفان علنيّان معتمان؛ ومفتاحٌ أجنبيٌّ إلى قاعدةِ
   * هويّةٍ أو سائقين يجعل هذا الحدَّ يعرف عن الإنسان ما لا يحتاجه ليعرض كتالوجاً.
   * النسخة الخاطئة الأرخص: REFERENCES users (id) «لسلامة البيانات» فتلتحم الحدود ولا تُفصل.
   */
  it("يمنع مفتاحاً أجنبياً إلى هوية أو سائقين أو طلبات", () => {
    expect(schemaCode).not.toMatch(/\bREFERENCES\s+(?:users|identities|drivers|customers|orders)\b/i);
  });
  it("يمنع الهاتف والاسم والإحداثية والقناة من أسماء الحقول", () => {
    for (const forbidden of ["phone", "email", "name", "full_name", "latitude", "longitude", "lat", "lng", "chat_id", "telegram"]) {
      expect(fieldNames, forbidden).not.toContain(forbidden);
    }
  });
  /**
   * لماذا هذا الحارس: الإيقافُ حدٌّ على **متجرٍ** لا على إنسان (القرار 6)؛ وحقلٌ يقول
   * `owner_suspended` يمنح هذا العقدَ سلطةً على الأشخاصِ لا يملكها.
   * النسخة الخاطئة الأرخص: `banned_at` على المالك «لمنع تكرار المخالفة» فيصير عقاباً بلا مالك.
   */
  it("يمنع حقلاً عقابياً على شخصٍ في سطح العقود الآليّ", () => {
    for (const forbidden of ["owner_suspended", "owner_banned", "banned_at", "blocked_at", "is_banned"]) {
      expect(fieldNames, forbidden).not.toContain(forbidden);
    }
  });
});

describe("تخصيص منفذ خدمة السوق", () => {
  it("يمنع أي منفذ 809x غير 8094 في العقد", () => {
    expect(MARKETPLACE_SERVICE_PORT).toBe(8094);
    const ports = [...`${schemaCode}\n${apiCode}\n${eventsRaw}`.matchAll(/\b(809\d)\b/g)].map((match) => Number(match[1]!));
    expect(ports).toEqual([MARKETPLACE_SERVICE_PORT]);
  });
});
