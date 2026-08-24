import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATEGORY_MAX_DEPTH, INVENTORY_REASON_CODES, PRODUCT_ACTOR_TYPES, PRODUCT_ALLOWED_TRANSITIONS,
  PRODUCT_DECISIONS, PRODUCT_MODERATION_STATES, PRODUCT_REASON_CODES, PRODUCT_STATES,
  STORE_ACTOR_TYPES, STORE_ALLOWED_TRANSITIONS, STORE_DECISIONS, STORE_REASON_CODES,
  STORE_STAFF_ROLES, STORE_STATES,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(__dirname, "../../../../../services/marketplace/contracts");
const schemaSql = readFileSync(resolve(CONTRACTS_DIR, "schema.sql"), "utf8");
const openapi = readFileSync(resolve(CONTRACTS_DIR, "api.openapi.yml"), "utf8");
/** يقتص تعريف جدول واحد كي لا يمر تعداد لعمود من جدول آخر. */
function table(name: string): string {
  const start = schemaSql.indexOf(`CREATE TABLE IF NOT EXISTS ${name}`);
  expect(start, `${name} يجب أن يوجد`).toBeGreaterThan(-1);
  const end = schemaSql.indexOf("\nCREATE TABLE IF NOT EXISTS ", start + 1);
  return schemaSql.slice(start, end === -1 ? undefined : end);
}
/** يستخرج قائمة IN لعمود بعينه للمقارنة الحرفية بثابت الحزمة. */
function inList(sql: string, column: string): string[] {
  const match = new RegExp(`${column}[^\\n]*?IN \\(([^)]*)\\)`, "s").exec(sql);
  expect(match, `${column} يجب أن يقيّد قيمه`).not.toBeNull();
  return [...match![1]!.matchAll(/'([a-z_]+)'/g)].map((item) => item[1]!);
}
/** يقتص تعريف مخطط OpenAPI واحد كي لا يقرأ الحارس تعداداً لمخطط آخر. */
function apiSchema(name: string): string {
  const header = new RegExp(`^ {4}${name}:$`, "m").exec(openapi);
  expect(header, `${name} يجب أن يوجد في العقد`).not.toBeNull();
  const rest = openapi.slice(header!.index + header![0].length);
  const next = rest.search(/\n {4}[A-Za-z_][A-Za-z0-9_]*:/);
  return next === -1 ? rest : rest.slice(0, next);
}
/** يقرأ تعداد `enum: [...]` من سطرٍ واحدٍ في مخطط بعينه. */
function apiEnum(name: string): string[] {
  const block = apiSchema(name);
  const match = /enum: \[([^\]]*)\]/.exec(block);
  expect(match, `${name} يجب أن يعلن تعداده`).not.toBeNull();
  return match![1]!.split(",").map((value) => value.trim());
}

const TABLES = [
  "store_categories", "stores", "store_reviews", "store_staff", "products", "product_reviews",
  "inventory_adjustments", "product_inventory", "marketplace_idempotency", "marketplace_outbox",
];

describe("مخطط السوق ↔ ثوابت الحزمة", () => {
  it("يمنع غياب واحد من الجداول العشرة أو إضافة جدول خارج الطور", () => {
    expect([...schemaSql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]!).sort())
      .toEqual([...TABLES].sort());
  });
  it("يمنع تعداداً في DDL يختلف حرفياً عن ثوابت المجال", () => {
    expect(inList(table("stores"), "state")).toEqual([...STORE_STATES]);
    expect(inList(table("store_reviews"), "decision")).toEqual([...STORE_DECISIONS]);
    expect(inList(table("store_reviews"), "reason_code")).toEqual([...STORE_REASON_CODES]);
    expect(inList(table("store_reviews"), "actor_type")).toEqual([...STORE_ACTOR_TYPES]);
    expect(inList(table("store_staff"), "role")).toEqual([...STORE_STAFF_ROLES]);
    expect(inList(table("products"), "state")).toEqual([...PRODUCT_STATES]);
    expect(inList(table("products"), "moderation_state")).toEqual([...PRODUCT_MODERATION_STATES]);
    expect(inList(table("product_reviews"), "decision")).toEqual([...PRODUCT_DECISIONS]);
    expect(inList(table("product_reviews"), "reason_code")).toEqual([...PRODUCT_REASON_CODES]);
    expect(inList(table("product_reviews"), "actor_type")).toEqual([...PRODUCT_ACTOR_TYPES]);
    expect(inList(table("inventory_adjustments"), "reason_code")).toEqual([...INVENTORY_REASON_CODES]);
  });
  it("يمنع تعداداً في OpenAPI يختلف عن تعداد DDL نفسه", () => {
    expect(apiEnum("StoreState")).toEqual([...STORE_STATES]);
    expect(apiEnum("StoreDecision")).toEqual([...STORE_DECISIONS]);
    expect(apiEnum("ProductState")).toEqual([...PRODUCT_STATES]);
    expect(apiEnum("ProductModerationState")).toEqual([...PRODUCT_MODERATION_STATES]);
    expect(apiEnum("ProductDecision")).toEqual([...PRODUCT_DECISIONS]);
  });
  /**
   * لماذا هذا الحارس: قيود التفرد هي ما يجعل «مالكٌ واحدٌ لكل متجر» و«قرارٌ واحدٌ لكل
   * تسلسل» حقيقةً في القاعدة لا نيّةً في الكود.
   * النسخة الخاطئة الأرخص: نقل الفحص إلى طبقة التطبيق، فيسمح تسابقُ طلبَين بقرارَين بالتسلسل نفسه.
   */
  it("يمنع إسقاط قيود التفرد وقيود القرار المُسمَّى", () => {
    for (const constraint of [
      "ux_store_categories_slug", "fk_store_categories_parent", "ck_store_categories_depth_parent",
      "ck_stores_first_approved_state", "ux_store_reviews_sequence", "ck_store_reviews_reason_required",
      "ck_store_reviews_actor", "ck_store_staff_removed_pair", "ck_store_staff_removed_after_added",
      "ux_products_store_sku", "ck_products_published_moderated", "ux_product_reviews_sequence",
      "ck_product_reviews_reason_required", "ck_product_reviews_actor", "ux_inventory_adjustments_sequence",
    ]) expect(schemaSql, constraint).toContain(`CONSTRAINT ${constraint}`);
    for (const index of [
      "ux_stores_slug_lower", "ux_stores_owner_active", "ux_store_staff_active_member",
      "ux_store_staff_single_owner",
    ]) expect(schemaSql, index).toContain(`CREATE UNIQUE INDEX IF NOT EXISTS ${index}`);
  });
  /**
   * لماذا هذا الحارس: التفرد بلا LOWER يجعل `Wasla` و`wasla` متجرَين ورابطَين يقرؤهما
   * الإنسانُ واحداً؛ والقرار 7 يقول إنّ التفرد غيرُ حسّاسٍ لحالة الأحرف.
   * النسخة الخاطئة الأرخص: UNIQUE (slug) وحده، ثم تسوية الحالة في الكود فقط.
   */
  it("يمنع تفرد slug بلا تسوية حالة الأحرف", () => {
    expect(schemaSql).toMatch(/ux_stores_slug_lower ON stores \(LOWER\(slug\)\)/);
  });
  it("يمنع عمق تصنيف يتجاوز الحدّ المعلن", () => {
    expect(table("store_categories")).toContain(`CHECK (depth IN (1, ${CATEGORY_MAX_DEPTH}))`);
  });
});

describe("جداول الانتقال المُعلَنة", () => {
  /**
   * لماذا هذا الحارس: الرفض طلبُ إصلاحٍ لا حكمٌ مؤبّد، ولو غاب `rejected → pending_review`
   * لصار أوّلُ نقصٍ في ملفٍ نهايةً لتاجرٍ صغير.
   * النسخة الخاطئة الأرخص: قبول أيّ زوج حالاتٍ في الكود فيتحول فرعٌ عرضيٌّ إلى سابقة دائمة.
   */
  it("يمنع انتقال متجرٍ غير مُعلن ويثبت زوج الإيقاف المتقابل", () => {
    const declared: ReadonlyArray<readonly [(typeof STORE_STATES)[number] | null, (typeof STORE_STATES)[number]]> = [
      [null, "draft"], ["draft", "pending_review"], ["pending_review", "approved"],
      ["pending_review", "rejected"], ["rejected", "pending_review"], ["approved", "suspended"],
      ["suspended", "approved"], ["approved", "archived"], ["rejected", "archived"],
    ];
    expect(STORE_ALLOWED_TRANSITIONS).toEqual(declared);
    expect(STORE_ALLOWED_TRANSITIONS).toContainEqual(["rejected", "pending_review"]);
    expect(STORE_ALLOWED_TRANSITIONS).toContainEqual(["suspended", "approved"]);
    expect(STORE_ALLOWED_TRANSITIONS).not.toContainEqual(["suspended", "archived"]);
  });
  /**
   * لماذا هذا الحارس: `archived` نهايةٌ (القرار 9)، وإعادةُ إحياءِ منتجٍ مُؤرشَفٍ تجعل رابطاً
   * أُعلن انتهاؤه يعود بمحتوىً وسعرٍ مختلفَين.
   * النسخة الخاطئة الأرخص: `archived → draft` «لتسهيل التعديل» فيسقط معنى النهاية.
   */
  it("يمنع خروجاً من الأرشفة في انتقالات المنتج", () => {
    expect(PRODUCT_ALLOWED_TRANSITIONS).toEqual([
      [null, "draft"], ["draft", "published"], ["published", "archived"], ["draft", "archived"],
    ]);
    for (const [from] of PRODUCT_ALLOWED_TRANSITIONS) expect(from).not.toBe("archived");
  });
  it("يمنع انتقالاً يذكر حالةً ليست من حالات العقد", () => {
    for (const [from, to] of STORE_ALLOWED_TRANSITIONS) {
      if (from !== null) expect([...STORE_STATES], String(from)).toContain(from);
      expect([...STORE_STATES], String(to)).toContain(to);
    }
    for (const [from, to] of PRODUCT_ALLOWED_TRANSITIONS) {
      if (from !== null) expect([...PRODUCT_STATES], String(from)).toContain(from);
      expect([...PRODUCT_STATES], String(to)).toContain(to);
    }
  });
});

describe("الإسقاطاتُ المتحقّقة ودفترُ المخزون (القرارات 1 و5)", () => {
  /**
   * لماذا هذا الحارس: النشرُ بلا اعتدالٍ موافقٍ يجعل منتجاً محظوراً ظاهراً بقرارِ متجرٍ وحده،
   * والقيدُ في القاعدة هو ما يمنع ذلك عند كلِّ مسارٍ لا عند مسارِ النشرِ فقط.
   * النسخة الخاطئة الأرخص: الفحص في معالج `POST /publish` وحده، فيتسلل تحديثٌ إداريٌّ من حوله.
   */
  it("يمنع نشراً بلا اعتدال موافق على مستوى القاعدة", () => {
    expect(table("products")).toContain("CHECK (state <> 'published' OR moderation_state = 'approved')");
  });
  it("يمنع فرقاً صفرياً في الدفتر ويثبت حفظ الرصيد الناتج", () => {
    const ledger = table("inventory_adjustments");
    expect(ledger).toContain("quantity_delta <> 0");
    expect(ledger).toContain("quantity_after");
    expect(table("product_inventory")).toContain("CHECK (quantity_on_hand >= 0)");
  });
  /**
   * لماذا هذا الحارس: الحجزُ ملكُ Phase 13 (القرار 5)، وعمودٌ محجوزٌ هنا يجعل خدمتَين
   * تكتبان في الرقم نفسه بلا مالكٍ للقرار.
   * النسخة الخاطئة الأرخص: quantity_reserved «جاهزيةً للمستقبل» فتُقرأ قبل أن يملأها أحد.
   */
  it("يمنع عمود حجزٍ أو كميةٍ متاحةٍ في مخطط هذا الطور", () => {
    // الحارس يقرأ **أسماء الأعمدة** لا النصَ الخام: متنُ المخطط يذكر `quantity_reserved`
    // صراحةً في سياقِ النفي، فحارسٌ يقرأ النصَ كان سيفشل على العقدِ الصحيح ويُدفع إلى حذفِ الشرح.
    const columns = [...schemaSql.matchAll(/^ {4}([a-z][a-z0-9_]*)\s+[A-Z]/gm)].map((match) => match[1]!);
    for (const forbidden of ["quantity_reserved", "quantity_available", "reserved_until"]) {
      expect(columns, forbidden).not.toContain(forbidden);
    }
  });
});
