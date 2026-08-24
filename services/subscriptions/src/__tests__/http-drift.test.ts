/**
 * حرّاسُ التباعد لطبقة HTTP (Phase 10 · المراجعة 4/6).
 *
 * `http.integration.test.ts` يُثبت أنّ ما كُتب يعمل صحيحاً على قاعدةٍ حقيقيّة. وهو لا
 * يستطيع أن يلاحظ عمليّةً **يُعلنها العقدُ ولم يُنفّذها أحد**: اختبارُها لم يُكتب هو أيضاً،
 * فالثغرةُ صامتةٌ في الملفّين معاً. وهذا ما يُبطله هذا الملفّ: يقرأ `contracts/api.openapi.yml`
 * **من القرص** ويقابله — في الاتجاهين — بما سجّله Fastify فعلاً، وبقوائمِ مفاتيحِ الطلب في
 * `http/requests.ts`، وبثوابتِ حزمةِ العقد.
 *
 * وكلُّ ما يُثبَت هنا رمزٌ بنيويّ: مسارٌ أو فعلٌ أو اسمُ حقلٍ أو رمزُ حالة. ولا شيءَ يُطابق
 * نصّاً عربياً، لسببِ `schema-drift.test.ts` نفسِه: حارسٌ يسقط عند تحسين شرحٍ حارسٌ يتعلّم
 * الناسُ تجاهلَه فيصير ضجيجاً في المُراجعة.
 *
 * وهذا الملفُّ سريعٌ بلا قاعدة: التطبيقُ يُبنى في وضعِ الذاكرة، والمُوجّهُ يُسجّل مساراتَه
 * كلَّها في الوضعين — فالتباعدُ يُكشَف على جهازٍ لا Postgres فيه، لا في خطٍّ لاحق.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  SUBSCRIPTION_API_OPERATION_COUNT,
  SUBSCRIPTION_API_PATHS,
  SUBSCRIPTION_ERROR_CODES,
  SUBSCRIPTION_HTTP_STATUS_CODES,
} from "@wasla/contracts-subscription";

import { createSubscriptionApp } from "../http/app.js";
import { SUBSCRIPTION_INTERNAL_ERROR_CODE } from "../http/errors.js";
import {
  REFERRAL_CLAIM_KEYS,
  REFERRAL_LIST_QUERY_KEYS,
  SUBSCRIPTION_ACTIVATE_KEYS,
  SUBSCRIPTION_START_KEYS,
} from "../http/requests.js";

const here = dirname(fileURLToPath(import.meta.url));
const HTTP_DIR = resolve(here, "../http");
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

/** `{driverPublicId}` → `:driverPublicId`، وهو الفرقُ الوحيد بين لهجتَي المسار. */
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
 * قراءةُ المُوجّه بدل قائمةٍ مكتوبةٍ باليد هي المقصدُ كلُّه: القائمةُ موضعٌ ثالثٌ يُنسى،
 * فيصير الحارسُ يُثبت أنّ قائمتين تتفقان بينما الخادمُ يفعل شيئاً آخر. و`HEAD` يُسقَط لأنّ
 * Fastify يستنبطه من `GET` تلقائياً ولا يُعلنه أيُّ عقد.
 */
async function registeredOperations(): Promise<Set<string>> {
  const app = createSubscriptionApp();
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
 * والنسخةُ مصدرُ حقيقةٍ ثانٍ يجعل الحارسَ ينجح بينما العقدُ يقول غيرَ ذلك. وترويسةُ
 * `x-request-id` لا تظهر لأنّها تُشار إليها بـ`$ref` لا بـ`- name:` — وهي ترويسةٌ مشتركةٌ
 * لا مُرشِّح.
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

describe("حارسُ التباعد: المساراتُ المسجَّلةُ والعقد", () => {
  it("كلُّ عمليّةٍ في العقد لها مسارٌ مسجَّلٌ فعلاً", async () => {
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

  it("العمليّاتُ اثنتا عشرةَ بالضبط — كما يُعلن SUBSCRIPTION_API_OPERATION_COUNT", () => {
    /**
     * الرقمُ من حزمةِ العقد لا مكتوباً هنا: عمليّةٌ تُضاف بلا تحديثِ الثابتِ والوثيقةِ معاً
     * تسقط هنا قبل أن تصل إلى أوّل مُتَّصل. والمساراتُ أحدَ عشرَ لأنّ `/referrals` تحمل
     * فعلَين (`POST` مطالبةٌ و`GET` قراءةٌ) — والفرقُ مقصودٌ ومحروسٌ في السطر التالي.
     */
    expect(contractOperations().size).toBe(SUBSCRIPTION_API_OPERATION_COUNT);
    expect(contractPaths()).toHaveLength(SUBSCRIPTION_API_PATHS.length);
  });

  it("مساراتُ العقد هي SUBSCRIPTION_API_PATHS نفسُها — لا قائمتان تفترقان", () => {
    expect(contractPaths().slice().sort()).toEqual([...SUBSCRIPTION_API_PATHS].slice().sort());
  });
});

describe("حارسُ التباعد: قوائمُ مفاتيح الطلب", () => {
  // في الاتجاهين لكلّ مخطّط: مفتاحٌ يُعلنه العقدُ ويرفضه المُحلِّلُ يجعل طلباً موثَّقاً
  // مستحيلاً، ومفتاحٌ يقبله المُحلِّلُ ولا يُعلنه العقدُ حقلٌ غيرُ موثَّقٍ سيعتمد عليه مُتَّصل.
  const bodies: readonly (readonly [string, readonly string[]])[] = [
    ["SubscriptionStartRequest", SUBSCRIPTION_START_KEYS],
    ["SubscriptionActivateRequest", SUBSCRIPTION_ACTIVATE_KEYS],
    ["ReferralClaimRequest", REFERRAL_CLAIM_KEYS],
  ];

  for (const [schema, accepted] of bodies) {
    it(`${schema}: المفاتيحُ المقبولةُ هي حقولُ العقد نفسُها`, () => {
      expect([...accepted].slice().sort()).toEqual(propertyKeys(schema).sort());
    });
  }

  it("listReferrals: المُرشِّحاتُ المقبولةُ هي مُعامِلاتُ العقد نفسُها", () => {
    expect([...REFERRAL_LIST_QUERY_KEYS].slice().sort()).toEqual(
      queryParameters("listReferrals").sort(),
    );
  });

  it("listSubscriptionPlans: مُرشِّحُ التجميدِ مُعلَنٌ في العقد باسمِه", () => {
    expect(queryParameters("listSubscriptionPlans")).toEqual(["frozen_only"]);
  });
});

describe("حارسُ التباعد: مفاتيحُ تفاصيلِ الخطأ", () => {
  /**
   * `ErrorResponse.details` مُغلَقٌ (`additionalProperties: false`)، فمفتاحٌ تكتبه الخدمةُ
   * ولا تُعلنه الورقةُ يصير جواباً **مرفوضاً** عند مستهلكٍ يُدقّق المخطّط — وسجلّاتُنا
   * تقول `4xx` سليماً. وهذا الحارسُ وجد خللاً فعليّاً في هذه المراجعة: كانت الطبقةُ تكتب
   * `from_state`/`to_state`/`period_source`/`referral_state`/`rejection_reason` ولا واحدٌ
   * منها في العقد، فأُعيدت الترجمةُ إلى `state` و`expected` المُعلَنَين.
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

  it("مفاتيحُ `SubscriptionErrorWireDetails` هي حقولُ العقدِ نفسُها", () => {
    const declared = detailKeys();
    expect(declared.length).toBeGreaterThan(0);
    // الواجهةُ تُقرأ من مصدرِها لا من نسخةٍ هنا: نسخةٌ ثالثةٌ تجعل الحارسَ يُثبت
    // اتفاقَ قائمتَين بينما الخدمةُ ترسل شيئاً أخر.
    const source = codeOnly(resolve(HTTP_DIR, "errors.ts"));
    const block = source.slice(
      source.indexOf("interface SubscriptionErrorWireDetails"),
      source.indexOf("interface SubscriptionErrorEnvelope"),
    );
    const written = [...block.matchAll(/readonly (\w+)\?:/g)].map((match) => match[1]!);
    expect(written.slice().sort()).toEqual(declared.slice().sort());
  });

  it("ولا مفتاحَ حالةٍ مركّباً يُسند على السلك — `state` وحدَها", () => {
    // الممنوعُ إسنادُ مفتاحٍ لم يُعلن (`wire.from_state = …`)، لا ذِكرُ الاسمِ نفسِه:
    // `expected` يحمل عمداً قيمةً بنيويّةً فيها `period_source:…`، وحارسٌ يمنع النصَّ
    // منعاً أعمى يفشل على النسخةِ الصحيحة ويُدرّب القارئَ على تجاوزِه.
    const source = codeOnly(resolve(HTTP_DIR, "errors.ts"));
    for (const forbidden of [
      "from_state",
      "to_state",
      "period_source",
      "referral_state",
      "rejection_reason",
    ]) {
      expect(source).not.toMatch(new RegExp(`wire\\s*\\.\\s*${forbidden}\\s*=`));
      expect(source).not.toMatch(new RegExp(`readonly ${forbidden}\\?:`));
    }
  });
});

describe("حارسُ التباعد: رموزُ الخطأ والحالات", () => {
  it("لا 500 في قائمةِ الحالاتِ المنشورة، ولا 502 معها", () => {
    expect(SUBSCRIPTION_HTTP_STATUS_CODES as readonly number[]).not.toContain(500);
    expect(SUBSCRIPTION_HTTP_STATUS_CODES as readonly number[]).not.toContain(502);
  });

  it("رمزُ الخللِ الداخليِّ غائبٌ عن الكتالوج قصداً — إشارةُ خللٍ لا حالةٌ يُتعاقد عليها", () => {
    /**
     * `SUBSCRIPTION_INTERNAL_ERROR` يخرج بـ`500` من `http/errors.ts` حين يظهر قيدٌ في
     * القاعدةِ لا ترجمةَ له. وإدخالُه في الكتالوج كان سيجعله **حالةً متوقّعةً** يبني عليها
     * مُتَّصلٌ منطقَ إعادةِ محاولةٍ، وهو ليس كذلك: هو اعترافٌ بأنّ الخدمةَ لم تعرف ما جرى.
     */
    expect(SUBSCRIPTION_ERROR_CODES as readonly string[]).not.toContain(
      SUBSCRIPTION_INTERNAL_ERROR_CODE,
    );
  });

  it("كلُّ حالةٍ يُعلنها العقدُ مذكورةٌ في SUBSCRIPTION_HTTP_STATUS_CODES", () => {
    const declared = new Set<number>();
    for (const line of contract.split("\n")) {
      // الوثيقةُ تكتب الحالاتَ بعلامةٍ مفردةٍ وقد تُتبعها `{ $ref: ... }` على السطرِ نفسِه.
      const match = /^ {8}'(\d{3})':/.exec(line);
      if (match?.[1]) declared.add(Number(match[1]));
    }
    expect(declared.size).toBeGreaterThan(0);
    const extra = [...declared].filter(
      (status) => !(SUBSCRIPTION_HTTP_STATUS_CODES as readonly number[]).includes(status),
    );
    expect(extra).toEqual([]);
  });

  it("ثغرةٌ معروفةٌ ومُعلَنة: تعدادُ ErrorResponse.code لا يذكر أربعةَ رموزٍ من السبعةَ عشر", () => {
    /**
     * هذا اختبارٌ **يُثبّت ثغرةً** لا يُصلحها، وذلك قرارٌ: حزمةُ العقدِ مُجمَّدةٌ في هذه
     * المراجعة (`is_frozen` وحرّاسُ 2/6)، وتعديلُ الوثيقةِ هنا كان يعني تحريكَ عقدٍ نشرته
     * مراجعةٌ سابقةٌ في منتصفِ تنفيذٍ يعتمد عليه. فالأربعةُ تُخرَج من الخدمةِ فعلاً برموزها
     * وحالاتِها الصحيحة، والوثيقةُ تُصحَّح في مراجعةٍ تملك العقدَ — وحتى ذلك اليوم هذا
     * السطرُ هو ما يمنع الثغرةَ من أن تُنسى، ويسقط يومَ تُصحَّح فيُقرأ القرارُ مرّةً أخرى.
     */
    const start = contract.indexOf("\n    ErrorResponse:\n");
    expect(start).toBeGreaterThan(-1);
    const block = contract.slice(start, contract.indexOf("\n    ValidationError:", start));
    const listed = SUBSCRIPTION_ERROR_CODES.filter((code) => block.includes(code));
    const missing = SUBSCRIPTION_ERROR_CODES.filter((code) => !block.includes(code));
    expect(listed).toHaveLength(13);
    expect(missing.slice().sort()).toEqual([
      "REFERRAL_REFEREE_ALREADY_REFERRED",
      "REFERRAL_REWARD_ALREADY_GRANTED",
      "SUBSCRIPTION_ALREADY_EXISTS",
      "SUBSCRIPTION_TRANSITION_NOT_ALLOWED",
    ]);
  });
});

/**
 * التعليقاتُ تُنزع قبل المسح — بنفسِ منطق `purity.test.ts` ولنفسِ السبب.
 *
 * هذا الملفُّ يشرح في ترويستِه لماذا لا يُمرَّر `probe` ولماذا لا `try` في معالج — وحارسٌ
 * يقرأ النصَّ خاماً كان سيسقط على **شرحِ القاعدةِ نفسِها**، فيتعلّم الكاتبُ أنّ العلاجَ حذفُ
 * الشرح — وهو أسوأُ ما يمكن أن يُعلّمه حارس.
 */
function codeOnly(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("حارسُ التباعد: ما لا يجوز أن يسكن في طبقة HTTP", () => {
  const app = codeOnly(resolve(HTTP_DIR, "app.ts"));

  it("لا `try` ولا `catch` في أيّ معالجٍ — معالجُ الخطأِ الواحدُ هو الموضع", () => {
    /**
     * الاستثناءُ الوحيدُ المسموحُ نصّاً هو `try` في مُحلِّلِ نوعِ المحتوى: `JSON.parse`
     * لا يُبلّغ بغير رمي، ومعالجُ الخطأِ لا يراه لأنّ المُحلِّلَ يعمل قبل التوجيه. وما بعده
     * صفرٌ: معالجٌ يلتقط خطأَه يستطيع أن يُخفيَه أو يُعيد تصنيفَه، فيصير رمزُ الحالةِ رأياً.
     */
    expect((app.match(/\btry\s*\{/g) ?? []).length).toBe(1);
    expect((app.match(/\bcatch\b/g) ?? []).length).toBe(1);
    expect(app.slice(app.indexOf("app.setErrorHandler")).includes("try {")).toBe(false);
  });

  it("لا طريقَ من السلك إلى مِسبارِ إجهاضِ المعاملة", () => {
    // `TransactionProbe` أداةُ اختبارٍ تُجهض معاملةً في نقطةٍ مُعلَنةٍ لتُثبت الذرّية.
    // وذكرُها في هذا الملفّ يعني أنّ مُتَّصلاً قد يستطيع يوماً أن يُجهض معاملاتِنا بطلب.
    expect(app).not.toContain("probe");
    expect(app).not.toContain("Probe");
  });

  it("ولا قراءةَ بيئةٍ في التطبيق — الوضعُ يُمرَّر معطىً لا يُكتشَف", () => {
    expect(app).not.toContain("process.env");
    expect(codeOnly(resolve(HTTP_DIR, "requests.ts"))).not.toContain("process.env");
    expect(codeOnly(resolve(HTTP_DIR, "mappers.ts"))).not.toContain("process.env");
    expect(codeOnly(resolve(HTTP_DIR, "errors.ts"))).not.toContain("process.env");
  });

  it("والمساراتُ مُرقَّمةٌ في الملفّ باثنتَي عشرةَ عمليّة — ترقيمٌ يقابله المُوجّه", () => {
    const handlers = app.match(/^ {2}app\.(get|post)\(/gm) ?? [];
    expect(handlers).toHaveLength(SUBSCRIPTION_API_OPERATION_COUNT);
  });
});

/**
 * حرسُ **أغلفةِ الأجوبة** — الفراغُ الذي كشفته المراجعة 5/6.
 *
 * حرّاسُ 4/6 قرأوا الطلبات: `SUBSCRIPTION_START_KEYS` وما بعدها. ولم يقرأ أحدٌ ما **يُرسَل**،
 * فبقيت أربعُ عمليّاتِ كتابةٍ تُعلن في العقدِ غلافاً (`subscription`/`period`/`duplicate`) وتُرسل
 * الحالةَ عاريةً — أربعةَ أشهرِ عقدٍ لا يصفُ ما يخرج. وكلُّها `additionalProperties: false`،
 * فمُتَّصلٌ يُحقّق جوابَه كان سيرفضه، ومَن لا يُحقّق كان سيقرأ `duplicate` من رمزِ الحالة —
 * وهو تخمينٌ مستحيلٌ في `activate` لأنّ عقدَه لا يُعلن `201` أصلاً.
 *
 * ولذلك يُقرأ هنا `required:` من الوثيقةِ **من القرص** ويقابله ما تُنتجه دالّةُ التحويل: لا
 * قائمةٌ مكتوبةٌ بيدٍ في الاختبار — قائمةٌ كهذه تُنسَخ خطأً مرّةً واحدةً فتصير الحرسُ صدىً
 * للخلل لا كاشفاً له.
 */
describe("حارسُ التباعد: أغلفةُ أجوبةِ الكتابة", () => {
  const mappers = codeOnly(resolve(HTTP_DIR, "mappers.ts"));
  const app = codeOnly(resolve(HTTP_DIR, "app.ts"));

  /** حقولُ `required` لمخطَّطٍ في `components.schemas` — الإزاحةُ 4 للاسمِ و6 للمفاتيح. */
  function requiredKeys(schema: string): string[] {
    const start = contract.indexOf(`\n    ${schema}:\n`);
    if (start < 0) return [];
    const block = contract.slice(start + 1);
    const end = block.search(/\n {4}\S/);
    const body = end < 0 ? block : block.slice(0, end);
    const match = /required:\s*\[([^\]]*)\]/.exec(body);
    return match?.[1] ? match[1].split(",").map((key) => key.trim()).filter(Boolean) : [];
  }

  const WRAPPERS = [
    ["SubscriptionStartResult", "toGrantResultWire"],
    ["SubscriptionActivateResult", "toGrantResultWire"],
    ["SubscriptionRecomputeResult", "toRecomputeResultWire"],
    ["ReferralClaimResult", "toReferralClaimResultWire"],
  ] as const;

  it("الأغلفةُ الأربعةُ مُعلَنةٌ في الوثيقةِ بحقولٍ مطلوبةٍ غيرِ فارغة", () => {
    for (const [schema] of WRAPPERS) {
      expect(requiredKeys(schema).length, schema).toBeGreaterThan(0);
    }
    expect(requiredKeys("SubscriptionStartResult")).toEqual(["subscription", "period", "duplicate"]);
    expect(requiredKeys("SubscriptionRecomputeResult")).toEqual(["subscription", "rebuilt"]);
    expect(requiredKeys("ReferralClaimResult")).toEqual(["referral", "duplicate"]);
  });

  it("كلُّ حقلٍ مطلوبٍ يُكتَب فعلاً في دالّةِ التحويلِ التي تُقابله", () => {
    for (const [schema, mapper] of WRAPPERS) {
      const start = mappers.indexOf(`export function ${mapper}(`);
      expect(start, mapper).toBeGreaterThan(-1);
      // النهايةُ هي بدايةُ الدالّةِ التالية لا أوّلُ `}` في العمودِ صفر: نوعُ الوسيطِ
      // مكتوبٌ سطوراً وينتهي بقوسٍ في العمودِ نفسِه، فقياسٌ ساذجٌ كان يقرأ الترويسةَ وحدَها
      // ويمرّ وهو لم ينظر في جسمِ التحويلِ أصلاً.
      const rest = mappers.slice(start + 1);
      const next = rest.indexOf("\nexport function ");
      const body = next < 0 ? rest : rest.slice(0, next);
      for (const key of requiredKeys(schema)) {
        expect(body, `${mapper} ← ${key}`).toContain(`${key}:`);
      }
    }
  });

  it("مساراتُ الكتابةِ الأربعةُ تُرسل الغلافَ لا الحالةَ عاريةً", () => {
    // `toStateWire` تبقى مسموحةً في القراءةِ وحدَها (عمليّةُ `GET /subscriptions/{id}`)،
    // فالمقياسُ عددُ نداءاتِها لا وجودُها: ثلاثةٌ كانت وواحدٌ يبقى.
    expect((app.match(/send\(toStateWire\(/g) ?? []).length).toBe(1);
    expect((app.match(/send\(toGrantResultWire\(/g) ?? []).length).toBe(2);
    expect((app.match(/send\(toRecomputeResultWire\(/g) ?? []).length).toBe(1);
    expect((app.match(/send\(toReferralClaimResultWire\(/g) ?? []).length).toBe(1);
    expect(app).not.toContain("send(toReferralWire(");
  });

  it("و`duplicate` تُقرأ من الحصيلةِ لا من رمزِ الحالة — العلامةُ في الجسمِ هي العقد", () => {
    const startRoute = app.slice(app.indexOf('app.post("/subscriptions"'));
    const handler = startRoute.slice(0, startRoute.indexOf('app.get("/subscriptions/:driverPublicId"'));
    expect(handler).toContain("outcome.duplicate ? 200 : 201");
    expect(handler).toContain("toGrantResultWire(outcome)");
  });
});
