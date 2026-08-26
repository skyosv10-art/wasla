/**
 * حرّاسُ التباعد لطبقة HTTP في السوق (الطور 11 · المراجعة 4/6).
 *
 * `http.integration.test.ts` يُثبت أنّ ما كُتب يعمل على قاعدةٍ حقيقيّة، وهو عاجزٌ بطبعِه عن
 * ملاحظةِ عمليّةٍ **يُعلنها العقدُ ولم يُنفّذها أحد**: اختبارُها لم يُكتب هو أيضاً، فالثغرةُ
 * صامتةٌ في الملفَّين معاً. وهذا ما يُبطله هذا الملفّ: يقرأ `contracts/api.openapi.yml` **من
 * القرص** ويقابله — في الاتجاهَين — بما سجّله Fastify فعلاً، وبقوائمِ مفاتيحِ الطلبِ في
 * `http/requests.ts`، وبثوابتِ حزمةِ العقد.
 *
 * وكلُّ ما يُثبَت هنا رمزٌ بنيويّ: مسارٌ أو فعلٌ أو اسمُ حقلٍ أو رمزُ حالة. ولا شيءَ يُطابق
 * نصّاً عربيّاً، لسببِ `schema-drift.test.ts` نفسِه: حارسٌ يسقط عند تحسينِ شرحٍ حارسٌ يتعلّم
 * الناسُ تجاهلَه فيصير ضجيجاً في المُراجعة.
 *
 * وهو سريعٌ بلا قاعدة: التطبيقُ يُبنى في وضعِ الذاكرةِ والمُوجّهُ يُسجّل مساراتَه كلَّها في
 * الوضعَين، فالتباعدُ يُكشَف على جهازٍ لا Postgres فيه لا في خطٍّ لاحق.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  MARKETPLACE_API_OPERATION_COUNT,
  MARKETPLACE_API_PATHS,
  MARKETPLACE_ERROR_CODES,
  MARKETPLACE_HTTP_STATUS_CODES,
  MARKETPLACE_SERVICE_PORT,
} from "@wasla/contracts-marketplace";

import { createMarketplaceApp } from "../http/app.js";
import { MARKETPLACE_INTERNAL_ERROR_CODE } from "../http/errors.js";
import {
  ADD_STAFF_KEYS,
  ADJUST_INVENTORY_KEYS,
  CATEGORY_QUERY_KEYS,
  CREATE_PRODUCT_KEYS,
  INVENTORY_QUERY_FILTER_KEYS,
  PRODUCT_ACTION_KEYS,
  PRODUCT_DECISION_KEYS,
  PRODUCT_QUERY_FILTER_KEYS,
  REGISTER_STORE_KEYS,
  REMOVE_STAFF_KEYS,
  REVIEW_REQUEST_KEYS,
  STORE_DECISION_KEYS,
  STORE_QUERY_FILTER_KEYS,
} from "../http/requests.js";

const here = dirname(fileURLToPath(import.meta.url));
const HTTP_DIR = resolve(here, "../http");
const contract = readFileSync(resolve(here, "../../contracts/api.openapi.yml"), "utf8");

/**
 * التعليقاتُ تُنزع قبل المسح — بمنطقِ `purity.test.ts` ولسببِه.
 *
 * ملفّاتُ هذه الطبقةِ تشرح في ترويساتها لماذا لا يُمرَّر `probe` ولماذا لا `try` في معالج،
 * وحارسٌ يقرأ النصَّ خاماً كان سيسقط على **شرحِ القاعدةِ نفسِها** فيتعلّم الكاتبُ أنّ العلاجَ
 * حذفُ الشرح — وهو أسوأُ ما يُعلّمه حارس.
 */
function codeOnly(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** مفاتيحُ `paths:` العلويّة — إزاحتُها 2 في الوثيقة. */
function contractPaths(): string[] {
  const paths: string[] = [];
  let inPaths = false;
  for (const line of contract.split("\n")) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths && /^\S/.test(line)) break;
    const match = /^ {2}(\/\S*):\s*$/.exec(line);
    if (inPaths && match?.[1]) paths.push(match[1]);
  }
  return paths;
}

/** `{storeSlug}` → `:storeSlug`، وهو الفرقُ الوحيدُ بين لهجتَي المسار. */
function toFastifyPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ":$1");
}

/** العمليّاتُ المُعلَنةُ تحت مساراتِ العقد، بصيغةِ `METHOD /path`. */
function contractOperations(): Set<string> {
  const operations = new Set<string>();
  let current: string | null = null;
  let inPaths = false;
  for (const line of contract.split("\n")) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (!inPaths) continue;
    if (/^\S/.test(line)) break;
    const path = /^ {2}(\/\S*):\s*$/.exec(line);
    if (path?.[1]) {
      current = path[1];
      continue;
    }
    const method = /^ {4}(get|post|patch|put|delete):\s*$/.exec(line);
    if (method?.[1] && current) {
      operations.add(`${method[1].toUpperCase()} ${toFastifyPath(current)}`);
    }
  }
  return operations;
}

/**
 * ما يخدمه Fastify حقّاً، مقروءاً من مُوجّهِه هو.
 *
 * وقراءةُ المُوجّهِ بدلَ قائمةٍ مكتوبةٍ باليدِ هي المقصدُ كلُّه: القائمةُ موضعٌ ثالثٌ يُنسى،
 * فيصير الحارسُ يُثبت أنّ قائمتَين تتّفقان بينما الخادمُ يفعل شيئاً آخر. و`HEAD` يُسقَط لأنّ
 * Fastify يستنبطه من `GET` تلقائيّاً ولا يُعلنه أيُّ عقد.
 */
async function registeredOperations(): Promise<Set<string>> {
  const app = createMarketplaceApp();
  await app.ready();
  const tree = app.printRoutes({ commonPrefix: false });
  await app.close();

  const operations = new Set<string>();
  const segments: string[] = [];
  for (const line of tree.split("\n")) {
    if (line.trim() === "") continue;
    const match = /^([^/]*)(\S+?)(?: \(([^)]*)\))?$/u.exec(line);
    if (!match) continue;
    const [, glyphs = "", segment = "", methods] = match;
    const depth = Math.floor(glyphs.length / 4);
    segments.length = depth;
    segments[depth] = segment;
    if (!methods) continue;
    const path = segments.join("");
    for (const method of methods.split(", ")) {
      if (method !== "HEAD") operations.add(`${method} ${path}`);
    }
  }
  return operations;
}

/** أسماءُ `properties:` لمخطَّطٍ في `components.schemas` — الاسمُ على 4 والحقولُ على 8. */
function propertyKeys(schemaName: string): string[] {
  const start = contract.indexOf(`\n    ${schemaName}:\n`);
  expect(start, schemaName).toBeGreaterThan(-1);
  const rest = contract.slice(start + 1);
  const end = rest.search(/\n {4}\w/);
  const block = end === -1 ? rest : rest.slice(0, end);
  const propertiesAt = block.indexOf("\n      properties:\n");
  if (propertiesAt === -1) return [];
  const keys: string[] = [];
  for (const line of block.slice(propertiesAt + 1).split("\n").slice(1)) {
    if (/^ {1,6}\S/.test(line)) break;
    const match = /^ {8}(\w+):/.exec(line);
    if (match?.[1]) keys.push(match[1]);
  }
  return keys;
}

/**
 * حقولُ جسمِ الطلبِ لعمليّةٍ بعينها — مُعلَنةً بـ`$ref` أو مكتوبةً في موضعها.
 *
 * وأربعةُ أجسامٍ في هذا العقدِ مضمَّنةٌ لا مُسمّاةٌ (طلبةُ المراجعةِ وإضافةُ عضوٍ وإزالتُه
 * وفعلُ المنتج)، وحارسٌ يقرأ المُسمّاةَ وحدَها كان سيترك أربعَ كتاباتٍ بلا مقابلةٍ — وهي
 * الكتاباتُ التي حقلُها الوحيدُ هويّةُ فاعلٍ، أي أخطرُ ما يُخطئ فيه اسمُ حقل.
 */
function bodyKeys(operationId: string): string[] {
  const start = contract.indexOf(`operationId: ${operationId}`);
  expect(start, operationId).toBeGreaterThan(-1);
  const responsesAt = contract.indexOf("\n      responses:", start);
  const block = contract.slice(start, responsesAt);
  const named = /schema: \{ \$ref: '#\/components\/schemas\/(\w+)' \}/.exec(block);
  if (named?.[1]) return propertyKeys(named[1]);
  const propertiesAt = block.indexOf("\n              properties:\n");
  if (propertiesAt === -1) return [];
  const keys: string[] = [];
  for (const line of block.slice(propertiesAt + 1).split("\n").slice(1)) {
    if (/^ {1,14}\S/.test(line)) break;
    const match = /^ {16}(\w+):/.exec(line);
    if (match?.[1]) keys.push(match[1]);
  }
  return keys;
}

/**
 * مُعامِلاتُ استعلامٍ لعمليّةٍ بعينها، مُستخرجةً من موضعِها لا منسوخةً هنا.
 *
 * والنسخةُ مصدرُ حقيقةٍ ثانٍ يجعل الحارسَ ينجح بينما العقدُ يقول غيرَه. و`Cursor` و`Limit`
 * و`x-request-id` لا تظهر لأنّها تُشار إليها بـ`$ref` لا بـ`- name:` — وهي مُعامِلاتٌ مشتركةٌ
 * لا مُرشِّحاتُ عمليّة، ولذلك تُقابَل على حدةٍ بـ`PAGE_QUERY_KEYS`.
 */
function queryParameters(operationId: string): string[] {
  const start = contract.indexOf(`operationId: ${operationId}`);
  expect(start, operationId).toBeGreaterThan(-1);
  const block = contract.slice(start, contract.indexOf("\n      responses:", start));
  const names: string[] = [];
  for (const line of block.split("\n")) {
    const match = /^ {8}- name: (\w+)$/.exec(line);
    if (match?.[1]) names.push(match[1]);
  }
  return names;
}

describe("حارسُ التباعد: المساراتُ المسجَّلةُ والعقد", () => {
  it("كلُّ عمليّةٍ في العقدِ لها مسارٌ مسجَّلٌ فعلاً", async () => {
    const registered = await registeredOperations();
    const missing = [...contractOperations()].filter((operation) => !registered.has(operation));
    expect(missing).toEqual([]);
  });

  it("كلُّ مسارٍ مسجَّلٍ مُعلَنٌ في العقد — لا نقطةَ نهايةٍ غيرَ موثَّقة", async () => {
    const declared = contractOperations();
    const extra = [...(await registeredOperations())].filter(
      (operation) => !declared.has(operation),
    );
    expect(extra).toEqual([]);
  });

  it("العمليّاتُ تسعَ عشرةَ بالضبط والمساراتُ خمسةَ عشر — كما تُعلن حزمةُ العقد", () => {
    /**
     * الرقمُ من حزمةِ العقدِ لا مكتوباً هنا: عمليّةٌ تُضاف بلا تحديثِ الثابتِ والوثيقةِ معاً
     * تسقط هنا قبل أن تصل إلى أوّلِ مُتَّصل. والفرقُ بين 19 و15 مقصودٌ: أربعةُ مساراتٍ تحمل
     * فعلَين (`/stores` و`/stores/{storeSlug}/staff` و`/stores/{storeSlug}/products`
     * و`/products/{productId}/inventory`) — قراءةٌ وكتابةٌ على المَورِد نفسِه.
     */
    expect(contractOperations().size).toBe(MARKETPLACE_API_OPERATION_COUNT);
    expect(contractPaths()).toHaveLength(MARKETPLACE_API_PATHS.length);
  });

  it("مساراتُ العقدِ هي MARKETPLACE_API_PATHS نفسُها — لا قائمتان تفترقان", () => {
    expect(contractPaths().slice().sort()).toEqual([...MARKETPLACE_API_PATHS].slice().sort());
  });
});

describe("حارسُ التباعد: قوائمُ مفاتيحِ الطلب", () => {
  // في الاتّجاهَين لكلّ جسم: مفتاحٌ يُعلنه العقدُ ويرفضه المُحلِّلُ يجعل طلباً موثَّقاً
  // مستحيلاً، ومفتاحٌ يقبله المُحلِّلُ ولا يُعلنه العقدُ حقلٌ غيرُ موثَّقٍ سيعتمد عليه مُتَّصل.
  const bodies: readonly (readonly [string, readonly string[]])[] = [
    ["registerStore", REGISTER_STORE_KEYS],
    ["decideStore", STORE_DECISION_KEYS],
    ["requestStoreReview", REVIEW_REQUEST_KEYS],
    ["addStoreStaff", ADD_STAFF_KEYS],
    ["removeStoreStaff", REMOVE_STAFF_KEYS],
    ["createProduct", CREATE_PRODUCT_KEYS],
    ["publishProduct", PRODUCT_ACTION_KEYS],
    ["archiveProduct", PRODUCT_ACTION_KEYS],
    ["decideProduct", PRODUCT_DECISION_KEYS],
    ["adjustProductInventory", ADJUST_INVENTORY_KEYS],
  ];

  for (const [operationId, accepted] of bodies) {
    it(`${operationId}: المفاتيحُ المقبولةُ هي حقولُ العقدِ نفسُها`, () => {
      const declared = bodyKeys(operationId);
      expect(declared.length, operationId).toBeGreaterThan(0);
      expect([...accepted].slice().sort()).toEqual(declared.slice().sort());
    });
  }

  it("ولا مفتاحَ حالةٍ في أيّ جسمِ كتابة — الحالةُ إسقاطٌ لا مُدخَل", () => {
    /**
     * القاعدةُ الأولى في هذا الطور: الحالةُ تُشتَقُّ من الدفترِ ولا تُقبَل من عميل. وحقلٌ
     * اسمُه `state` في جسمِ كتابةٍ كان سيسمح لمُتَّصلٍ أن يُعلن متجرَه `approved` بلا مراجعة،
     * فالمنعُ يُفحَص على **قائمةِ المفاتيحِ المقبولةِ** لا على نيّةِ الكاتب.
     */
    const writeKeys = bodies.flatMap(([, keys]) => [...keys]);
    for (const forbidden of ["state", "store_state", "product_state", "moderation_state"]) {
      expect(writeKeys, forbidden).not.toContain(forbidden);
    }
  });
});

describe("حارسُ التباعد: مُرشِّحاتُ القراءة", () => {
  const reads: readonly (readonly [string, readonly string[]])[] = [
    ["listStores", STORE_QUERY_FILTER_KEYS],
    ["listStoreProducts", PRODUCT_QUERY_FILTER_KEYS],
    ["getProductInventory", INVENTORY_QUERY_FILTER_KEYS],
    ["listStoreCategories", CATEGORY_QUERY_KEYS],
  ];

  for (const [operationId, accepted] of reads) {
    it(`${operationId}: المُرشِّحاتُ المقبولةُ هي مُعامِلاتُ العقدِ نفسُها`, () => {
      expect([...accepted].slice().sort()).toEqual(queryParameters(operationId).sort());
    });
  }

  it("listStoreReviews: دفترٌ بلا مُرشِّحٍ — الترقيمُ وحدَه", () => {
    /**
     * هذا السطرُ هو الذي كشف خللاً فعليّاً في هذه المراجعة: كان دفترُ القراراتِ يُحلَّل
     * بـ`parseStoreQuery`، فيردّ `MARKETPLACE_FILTER_REQUIRED` على طلبٍ مطابقٍ للعقدِ تماماً
     * ويقبل `?state=` الذي لا يُعلنه العقدُ لهذه العمليّة.
     */
    expect(queryParameters("listStoreReviews")).toEqual([]);
  });

  it("ولا `q=` ولا مُرشِّحُ بحثٍ في أيّ قراءة — البحثُ ملكُ الطور 12", () => {
    // القرار 9: مطابقةُ نصٍّ حرٍّ لا تدخل هذا الطور، وحارسُ `purity.test.ts` يمنعها في
    // الكود. وهنا تُمنع في **العقد** أيضاً: مُعامِلٌ يُعلَن اليومَ يُنفَّذ غداً بلا مراجعةِ قرار.
    const declared = reads.flatMap(([operationId]) => queryParameters(operationId));
    for (const forbidden of ["q", "query", "search", "term"]) {
      expect(declared, forbidden).not.toContain(forbidden);
    }
  });
});

describe("حارسُ التباعد: مفاتيحُ تفاصيلِ الخطأ", () => {
  /**
   * `ErrorResponse.details` مُغلَقٌ (`additionalProperties: false`)، فمفتاحٌ تكتبه الخدمةُ
   * ولا تُعلنه الوثيقةُ يصير جواباً **مرفوضاً** عند مستهلكٍ يُدقّق المخطَّط — وسجلّاتُنا تقول
   * `4xx` سليماً. ولا نسخةَ للقائمةِ هنا: النوعُ يُشتَقُّ في `domain/errors.ts` من العقدِ نفسِه
   * (`MarketplaceErrorDetails`)، فالمقابلةُ تُثبت أنّ الاشتقاقَ ما زال قائماً لا مقطوعاً.
   */
  function detailKeys(): string[] {
    const start = contract.indexOf("\n            details:\n");
    expect(start).toBeGreaterThan(-1);
    const block = contract.slice(start + 1, contract.indexOf("\n        trace_id:", start));
    const at = block.indexOf("\n              properties:\n");
    expect(at).toBeGreaterThan(-1);
    const keys: string[] = [];
    for (const line of block.slice(at + 1).split("\n").slice(1)) {
      if (/^ {1,14}\S/.test(line)) break;
      const match = /^ {16}(\w+):/.exec(line);
      if (match?.[1]) keys.push(match[1]);
    }
    return keys;
  }

  it("الوثيقةُ تُعلن مفاتيحَ تفاصيلَ معدودةً غيرَ فارغة", () => {
    expect(detailKeys().length).toBeGreaterThan(0);
    expect(detailKeys()).toContain("field");
    expect(detailKeys()).toContain("constraint");
  });

  it("ونوعُ التفاصيلِ مُشتَقٌّ من العقدِ لا مكتوبٌ بيدٍ ثانية", () => {
    const source = codeOnly(resolve(here, "../domain/errors.ts"));
    expect(source).toContain("export type MarketplaceErrorDetails");
    expect(source).toMatch(/MarketplaceErrorDetails = NonNullable<[\s\S]*?ErrorResponse\[/);
    // وطبقةُ السلكِ لا تُترجم المفاتيح: خريطةُ تحويلٍ هنا نسخةٌ ثانيةٌ من قائمةٍ مغلقةٍ تُنسى.
    expect(codeOnly(resolve(HTTP_DIR, "errors.ts"))).toContain(
      "type WireDetails = MarketplaceErrorDetails",
    );
  });
});

describe("حارسُ التباعد: رموزُ الخطأِ والحالات", () => {
  it("كلُّ رمزٍ في MARKETPLACE_ERROR_CODES مُعلَنٌ في تعدادِ ErrorResponse", () => {
    const start = contract.indexOf("\n    ErrorResponse:\n");
    expect(start).toBeGreaterThan(-1);
    const block = contract.slice(start, contract.indexOf("\n  responses:", start));
    const missing = MARKETPLACE_ERROR_CODES.filter((code) => !block.includes(code));
    expect(missing).toEqual([]);
  });

  it("رمزُ الخللِ الداخليِّ غائبٌ عن الكتالوجِ قصداً — إشارةُ خللٍ لا حالةٌ يُتعاقد عليها", () => {
    /**
     * `MARKETPLACE_INTERNAL_DEFECT` يخرج بـ`500` حين يظهر قيدٌ في القاعدةِ لا ترجمةَ له.
     * وإدخالُه في الكتالوجِ كان سيجعله **حالةً متوقّعةً** يبني عليها مُتَّصلٌ منطقَ إعادةِ
     * محاولة، وهو ليس كذلك: هو اعترافٌ بأنّ الخدمةَ لم تعرف ما جرى.
     */
    expect(MARKETPLACE_ERROR_CODES as readonly string[]).not.toContain(
      MARKETPLACE_INTERNAL_ERROR_CODE,
    );
  });

  it("كلُّ حالةٍ يُعلنها العقدُ مذكورةٌ في MARKETPLACE_HTTP_STATUS_CODES", () => {
    const declared = new Set<number>();
    for (const line of contract.split("\n")) {
      const match = /^ {8}'(\d{3})':/.exec(line);
      if (match?.[1]) declared.add(Number(match[1]));
    }
    expect(declared.size).toBeGreaterThan(0);
    const extra = [...declared].filter(
      (status) => !(MARKETPLACE_HTTP_STATUS_CODES as readonly number[]).includes(status),
    );
    expect(extra).toEqual([]);
  });

  it("ثغرةٌ معروفةٌ ومُعلَنة: `500` تُخرَج ولا تُعلنها الوثيقةُ ولا الكتالوج", () => {
    /**
     * هذا اختبارٌ **يُثبّت ثغرةً** لا يُصلحها، وذلك قرار: حزمةُ العقدِ ووثيقتُه مُجمَّدتان في
     * هذه المراجعةِ (حرّاسُ 2/6)، وتحريكُهما هنا يعني تغييرَ عقدٍ نشرته مراجعةٌ سابقةٌ في
     * منتصفِ تنفيذٍ يعتمد عليه. والقيدُ غيرُ المُترجَمِ عيبُ برمجةٍ يجب أن يُقال `500` لا
     * `503`: `503` تقول «أعِد المحاولةَ» فيُعيدها العميلُ أبداً على كتابةٍ ترفضها القاعدةُ
     * دائماً. فتبقى الثغرةُ مُعلَنةً هنا، ويسقط هذا السطرُ يومَ يُصحَّح العقدُ فيُقرأ القرار.
     */
    expect(MARKETPLACE_HTTP_STATUS_CODES as readonly number[]).not.toContain(500);
    expect(codeOnly(resolve(HTTP_DIR, "errors.ts"))).toContain(".status(500)");
  });
});

describe("حارسُ التباعد: ما لا يجوز أن يسكن في طبقة HTTP", () => {
  const app = codeOnly(resolve(HTTP_DIR, "app.ts"));

  it("لا `try` ولا `catch` في أيّ معالجٍ — معالجُ الخطأِ الواحدُ هو الموضع", () => {
    /**
     * الاستثناءُ الوحيدُ المسموحُ نصّاً هو `try` في مُحلِّلِ نوعِ المحتوى: `JSON.parse`
     * لا يُبلّغ بغيرِ رمي، ومعالجُ الخطأِ لا يراه لأنّ المُحلِّلَ يعمل قبل التوجيه. وما بعده
     * صفرٌ: معالجٌ يلتقط خطأَه يستطيع أن يُخفيَه أو يُعيد تصنيفَه، فيصير رمزُ الحالةِ رأياً.
     */
    expect((app.match(/\btry\s*\{/g) ?? []).length).toBe(1);
    expect((app.match(/\bcatch\b/g) ?? []).length).toBe(1);
    expect(app.slice(app.indexOf("app.setErrorHandler")).includes("try {")).toBe(false);
  });

  it("لا طريقَ من السلكِ إلى مِسبارِ إجهاضِ المعاملة", () => {
    // `TransactionProbe` أداةُ اختبارٍ تُجهض معاملةً في نقطةٍ مُعلَنةٍ لتُثبت الذرّية. وذكرُها
    // في هذا الملفّ يعني أنّ مُتَّصلاً قد يستطيع يوماً أن يُجهض معاملاتِنا بطلب.
    expect(app).not.toContain("probe");
    expect(app).not.toContain("Probe");
  });

  it("ولا قراءةَ بيئةٍ في التطبيق — الوضعُ يُمرَّر معطىً لا يُكتشَف", () => {
    expect(app).not.toContain("process.env");
    for (const file of ["requests.ts", "mappers.ts", "errors.ts"]) {
      expect(codeOnly(resolve(HTTP_DIR, file)), file).not.toContain("process.env");
    }
  });

  it("والمعالجاتُ في الملفِّ تسعةَ عشرَ — ترقيمٌ يقابله المُوجّه", () => {
    const handlers = app.match(/^ {2}app\.(get|post|delete)\(/gm) ?? [];
    expect(handlers).toHaveLength(MARKETPLACE_API_OPERATION_COUNT);
  });

  it("ومَنفَذُ الخادمِ افتراضاً هو منفَذُ العقدِ لا رقمٌ مكتوبٌ بيدٍ ثانية", () => {
    // 8094 مكتوبٌ في `server.ts` كان سيفترق عن الحزمةِ يومَ يتغيّر أحدُهما، والخدمةُ
    // تُنصَت على منفَذٍ لا يقصده أحد.
    const server = codeOnly(resolve(HTTP_DIR, "server.ts"));
    expect(server).toContain("MARKETPLACE_SERVICE_PORT");
    expect(server).not.toContain(String(MARKETPLACE_SERVICE_PORT));
  });
});
