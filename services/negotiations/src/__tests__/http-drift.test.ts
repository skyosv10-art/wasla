/**
 * حرّاس التباعد لطبقة HTTP (Phase 08 · MR 4/6).
 *
 * مجموعة `http.test.ts` تُثبت أنّ ما كتبناه يعمل صحيحاً. وهي لا تستطيع أن تلاحظ مساراً
 * **يُعلنه العقد ولم يُنفّذه أحد**: اختبارُه لم يُكتب هو أيضاً، فالثغرة صامتةٌ في الملفّين
 * معاً. هذا ما يُبطله هذا الملف: يقرأ وثيقة OpenAPI من القرص ويقابلها — في الاتجاهين —
 * بما سجّله Fastify فعلاً، وبقوائم مفاتيح الطلب في `http/requests.ts`.
 *
 * وكلُّ ما يُثبَت هنا رمزٌ بنيوي: مسارٌ أو فعلٌ أو اسمُ حقل. ولا شيء يُطابق نصاً عربياً،
 * لسبب `contract-drift.test.ts` نفسه: حارسٌ يسقط عند تحسين شرحٍ حارسٌ يتعلّم الناس تجاهله.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  NEGOTIATION_API_PATHS,
  NEGOTIATION_ERROR_CODES,
  NEGOTIATION_HTTP_STATUS_CODES,
} from "@wasla/contracts-negotiation";

import { NEGOTIATION_INTERNAL_ERROR_CODE } from "../http/errors.js";
import {
  MESSAGE_SUBMISSION_KEYS,
  ROUND_DECISION_KEYS,
  ROUND_PROPOSAL_KEYS,
  ROUND_REJECTION_KEYS,
  THREAD_CANCEL_KEYS,
  THREAD_LIST_QUERY_KEYS,
  THREAD_OPEN_KEYS,
} from "../http/requests.js";

import { httpHarness } from "./http-harness.js";

const here = dirname(fileURLToPath(import.meta.url));
const contract = readFileSync(resolve(here, "../../contracts/api.openapi.yml"), "utf8");

/** مفاتيح `paths:` العلويّة — إزاحتها 2 في الوثيقة. */
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

/** `{threadId}` → `:threadId`، وهو الفرق الوحيد بين لهجتي المسار. */
function toFastifyPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ":$1");
}

/** العمليّات المُعلَنة تحت مسارات العقد، بصيغة `METHOD /path`. */
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
 * قراءةُ المُوجّه بدل قائمةٍ مكتوبة باليد هي المقصد كلّه: القائمة موضعٌ ثالث يُنسى، ويصير
 * الحارس يُثبت أنّ قائمتين تتفقان بينما الخادم يفعل شيئاً آخر. و`HEAD` يُسقَط لأنّ Fastify
 * يستنبطه من `GET` تلقائياً ولا يُعلنه أيّ عقد.
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

/** أسماء `properties:` لمخطّطٍ واحد — المخطّطات على إزاحة 4، والحقول على 8. */
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
 * مُرشِّحات `GET /negotiations` المُعلَنة كمُعامِلات استعلام، لا كمخطّط.
 *
 * تُستخرج من موضعها بدل نسخها هنا: النسخةُ مصدرُ حقيقةٍ ثانٍ، ويصير الحارس ينجح بينما
 * العقد يقول غير ذلك. و`x-request-id` مُستثنى لأنّه ترويسةٌ مشتركة لا مُرشِّح.
 */
function listQueryParameters(): string[] {
  const start = contract.indexOf("operationId: listNegotiationThreads");
  expect(start).toBeGreaterThan(-1);
  const block = contract.slice(start, contract.indexOf("\n  /negotiations/{threadId}:", start));
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

  it("العقد يُعلن عشرة مسارات، وهو العدد الذي تعهّدت به MR 4/6", () => {
    expect(contractPaths()).toHaveLength(10);
  });

  it("مسارات العقد هي NEGOTIATION_API_PATHS نفسها — لا قائمتان تفترقان", () => {
    expect(contractPaths().sort()).toEqual([...NEGOTIATION_API_PATHS].sort());
  });
});

describe("حارس التباعد: قوائم مفاتيح الطلب", () => {
  // في الاتجاهين لكلّ مخطّط: مفتاحٌ يُعلنه العقد ويرفضه المُحلِّل يجعل طلباً موثَّقاً
  // مستحيلاً، ومفتاحٌ يقبله المُحلِّل ولا يُعلنه العقد حقلٌ غير موثَّق سيعتمد عليه مُتَّصل.
  const cases: readonly (readonly [string, readonly string[]])[] = [
    ["ThreadOpenRequest", THREAD_OPEN_KEYS],
    ["ThreadCancelRequest", THREAD_CANCEL_KEYS],
    ["RoundProposal", ROUND_PROPOSAL_KEYS],
    ["RoundDecision", ROUND_DECISION_KEYS],
    ["RoundRejection", ROUND_REJECTION_KEYS],
    ["MessageSubmission", MESSAGE_SUBMISSION_KEYS],
  ];

  for (const [schema, accepted] of cases) {
    it(`${schema}: المفاتيح المقبولة هي حقول العقد نفسها`, () => {
      expect([...accepted].sort()).toEqual(propertyKeys(schema).sort());
    });
  }

  it("مُرشِّحات القائمة: المقبول هو مُعامِلات الاستعلام المُعلَنة نفسها", () => {
    expect([...THREAD_LIST_QUERY_KEYS].sort()).toEqual(listQueryParameters().sort());
  });
});

describe("حارس التباعد: رموز الخطأ والحالات", () => {
  it("لا 500 في قائمة الحالات المنشورة، ولا 502 معها", () => {
    expect(NEGOTIATION_HTTP_STATUS_CODES as readonly number[]).not.toContain(500);
    expect(NEGOTIATION_HTTP_STATUS_CODES as readonly number[]).not.toContain(502);
  });

  it("رمز الخلل الداخلي غائبٌ عن الكتالوج قصداً — إشارةُ خللٍ لا حالةٌ يُتعاقد عليها", () => {
    expect(NEGOTIATION_ERROR_CODES as readonly string[]).not.toContain(
      NEGOTIATION_INTERNAL_ERROR_CODE,
    );
  });

  it("كل حالةٍ يُعلنها العقد مذكورة في NEGOTIATION_HTTP_STATUS_CODES", () => {
    const declared = new Set<number>();
    for (const line of contract.split("\n")) {
      const match = /^ {8}'(\d{3})':/.exec(line);
      if (match?.[1]) declared.add(Number(match[1]));
    }
    const extra = [...declared].filter(
      (status) => !(NEGOTIATION_HTTP_STATUS_CODES as readonly number[]).includes(status),
    );
    expect(extra).toEqual([]);
  });
});
