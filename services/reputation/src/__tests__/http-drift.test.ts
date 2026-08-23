/**
 * حرّاسُ التباعد لطبقة HTTP (Phase 09 · المراجعة 4/6).
 *
 * مجموعة `http.test.ts` تُثبت أنّ ما كتبناه يعمل صحيحاً. وهي لا تستطيع أن تلاحظ مساراً
 * **يُعلنه العقدُ ولم يُنفّذه أحد**: اختبارُه لم يُكتب هو أيضاً، فالثغرةُ صامتةٌ في الملفّين
 * معاً. وهذا ما يُبطله هذا الملف: يقرأ وثيقةَ OpenAPI **من القرص** ويقابلها — في
 * الاتجاهين — بما سجّله Fastify فعلاً، وبقوائم مفاتيح الطلب في `http/requests.ts`.
 *
 * وكلُّ ما يُثبَت هنا رمزٌ بنيوي: مسارٌ أو فعلٌ أو اسمُ حقلٍ أو رمزُ حالة. ولا شيءَ يُطابق
 * نصّاً عربياً، لسبب `schema-drift.test.ts` نفسه: حارسٌ يسقط عند تحسين شرحٍ حارسٌ يتعلّم
 * الناسُ تجاهلَه.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  REPUTATION_API_PATHS,
  REPUTATION_ERROR_CODES,
  REPUTATION_HTTP_STATUS_CODES,
} from "@wasla/contracts-reputation";

import { REPUTATION_INTERNAL_ERROR_CODE } from "../http/errors.js";
import {
  FACT_LIST_QUERY_KEYS,
  FACT_RECORD_KEYS,
  FRAUD_SIGNAL_LIST_QUERY_KEYS,
  RATING_LIST_QUERY_KEYS,
  RATING_SUBMIT_KEYS,
} from "../http/requests.js";

import { httpHarness } from "./http-harness.js";

const here = dirname(fileURLToPath(import.meta.url));
const contract = readFileSync(resolve(here, "../../contracts/api.openapi.yml"), "utf8");

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

/** `{subjectType}` → `:subjectType`، وهو الفرقُ الوحيد بين لهجتي المسار. */
function toFastifyPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ":$1");
}

/** العمليّاتُ المُعلَنة تحت مسارات العقد، بصيغة `METHOD /path`. */
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
 * ما يخدمه Fastify حقاً، مقروءاً من مُوجّهه هو.
 *
 * قراءةُ المُوجّه بدل قائمةٍ مكتوبةٍ باليد هي المقصدُ كلُّه: القائمةُ موضعٌ ثالث يُنسى،
 * فيصير الحارسُ يُثبت أنّ قائمتين تتفقان بينما الخادمُ يفعل شيئاً آخر. و`HEAD` يُسقَط لأنّ
 * Fastify يستنبطه من `GET` تلقائياً ولا يُعلنه أيُّ عقد.
 */
async function registeredOperations(): Promise<Set<string>> {
  const { app } = httpHarness();
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

/** أسماءُ `properties:` لمخطّطٍ واحد — المخطّطاتُ على إزاحة 4، والحقولُ على 8. */
function propertyKeys(schemaName: string): string[] {
  const start = contract.indexOf(`\n    ${schemaName}:\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = contract.slice(start + 1);
  const end = rest.search(/\n {4}\w/);
  const block = end === -1 ? rest : rest.slice(0, end);
  const propertiesAt = block.indexOf("\n      properties:\n");
  if (propertiesAt === -1) return [];
  const properties = block.slice(propertiesAt + 1);
  const keys: string[] = [];
  for (const line of properties.split("\n").slice(1)) {
    if (/^ {1,6}\S/.test(line)) break;
    const match = /^ {8}(\w+):/.exec(line);
    if (match?.[1]) keys.push(match[1]);
  }
  return keys;
}

/**
 * مُعامِلاتُ استعلامٍ لعمليّةٍ بعينها، مُستخرجةً من موضعها لا منسوخةً هنا.
 *
 * النسخةُ مصدرُ حقيقةٍ ثانٍ، فيصير الحارسُ ينجح بينما العقدُ يقول غيرَ ذلك. و`x-request-id`
 * لا يظهر لأنّه يُشار إليه بـ`$ref` لا بـ`- name:` — وهو ترويسةٌ مشتركة لا مُرشِّح.
 */
function queryParameters(operationId: string): string[] {
  const start = contract.indexOf(`operationId: ${operationId}`);
  expect(start).toBeGreaterThan(-1);
  const block = contract.slice(start, contract.indexOf("\n      responses:", start));
  const names: string[] = [];
  for (const line of block.split("\n")) {
    const match = /^ {8}- name: (\w+)$/.exec(line);
    if (match?.[1]) names.push(match[1]);
  }
  return names;
}

describe("حارس التباعد: المسارات المسجَّلة والعقد", () => {
  it("كلّ عملية في العقد لها مسار مسجَّل فعلاً", async () => {
    const registered = await registeredOperations();
    const missing = [...contractOperations()].filter((operation) => !registered.has(operation));
    expect(missing).toEqual([]);
  });

  it("كلّ مسار مسجَّل مُعلَن في العقد — لا نقطة نهاية غير موثَّقة", async () => {
    const declared = contractOperations();
    const extra = [...(await registeredOperations())].filter(
      (operation) => !declared.has(operation),
    );
    expect(extra).toEqual([]);
  });

  it("العقد يُعلن تسعة مسارات: ثمانيةٌ للسمعة و/health", () => {
    // الرقمُ مكتوبٌ صريحاً حتى تسقط الإضافةُ الصامتة: مسارٌ يُضاف بلا تحديث العقد أو
    // `REPUTATION_API_PATHS` سيكسر هذا الحارسَ قبل أن يصل إلى أوّل مُتَّصل.
    expect(contractPaths()).toHaveLength(9);
  });

  it("مسارات العقد هي REPUTATION_API_PATHS نفسها — لا قائمتان تفترقان", () => {
    expect(contractPaths().sort()).toEqual([...REPUTATION_API_PATHS].sort());
  });
});

describe("حارس التباعد: قوائم مفاتيح الطلب", () => {
  // في الاتجاهين لكلّ مخطّط: مفتاحٌ يُعلنه العقد ويرفضه المُحلِّل يجعل طلباً موثَّقاً
  // مستحيلاً، ومفتاحٌ يقبله المُحلِّل ولا يُعلنه العقد حقلٌ غير موثَّق سيعتمد عليه مُتَّصل.
  const bodies: readonly (readonly [string, readonly string[]])[] = [
    ["FactRecordRequest", FACT_RECORD_KEYS],
    ["RatingSubmitRequest", RATING_SUBMIT_KEYS],
  ];

  for (const [schema, accepted] of bodies) {
    it(`${schema}: المفاتيح المقبولة هي حقول العقد نفسها`, () => {
      expect([...accepted].sort()).toEqual(propertyKeys(schema).sort());
    });
  }

  const queries: readonly (readonly [string, readonly string[]])[] = [
    ["listReputationFacts", FACT_LIST_QUERY_KEYS],
    ["listReputationRatings", RATING_LIST_QUERY_KEYS],
    ["listFraudSignals", FRAUD_SIGNAL_LIST_QUERY_KEYS],
  ];

  for (const [operationId, accepted] of queries) {
    it(`${operationId}: المُرشِّحات المقبولة هي مُعامِلات العقد نفسها`, () => {
      expect([...accepted].sort()).toEqual(queryParameters(operationId).sort());
    });
  }
});

describe("حارس التباعد: رموز الخطأ والحالات", () => {
  it("لا 500 في قائمة الحالات المنشورة، ولا 502 معها", () => {
    expect(REPUTATION_HTTP_STATUS_CODES as readonly number[]).not.toContain(500);
    expect(REPUTATION_HTTP_STATUS_CODES as readonly number[]).not.toContain(502);
  });

  it("رمز الخلل الداخلي غائبٌ عن الكتالوج قصداً — إشارةُ خللٍ لا حالةٌ يُتعاقد عليها", () => {
    expect(REPUTATION_ERROR_CODES as readonly string[]).not.toContain(
      REPUTATION_INTERNAL_ERROR_CODE,
    );
  });

  it("كل حالةٍ يُعلنها العقد مذكورة في REPUTATION_HTTP_STATUS_CODES", () => {
    const declared = new Set<number>();
    for (const line of contract.split("\n")) {
      const match = /^ {8}'(\d{3})':/.exec(line);
      if (match?.[1]) declared.add(Number(match[1]));
    }
    const extra = [...declared].filter(
      (status) => !(REPUTATION_HTTP_STATUS_CODES as readonly number[]).includes(status),
    );
    expect(extra).toEqual([]);
  });

  it("لا 502 في أيّ فرعٍ من مُترجِم الخطأ — مقروءاً من المصدر بعد إسقاط الشرح", () => {
    const source = readFileSync(resolve(here, "../http/errors.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/status\(\s*502\s*\)/);
    expect(source).toMatch(/status\(\s*503\s*\)/);
  });
});
