/**
 * مِشْكاةُ بوّابةِ خروجِ الطورِ 11 — حدُّ السوقِ على **مُستمعٍ حقيقيٍّ** و**قاعدةٍ حقيقيّة**.
 *
 * # ما تُثبته هذه الحزمةُ ولا يُثبته غيرُها
 *
 * اختباراتُ خدمةِ السوقِ (316 سريعاً و118 على القاعدة) تُثبت أنّ كلَّ قطعةٍ صحيحةٌ وحدَها:
 * الانتقالاتُ، والظهورُ المُشتَقُّ، وحرسُ الإعادةِ، وذرّيّةُ المعاملة، وصندوقُ الصادر. ولا
 * تُثبت أربعةَ أشياءَ لا تظهر إلّا مُجتمِعةً وعبرَ سلكٍ:
 *
 *  1. **أنّ ما يكتبه الحدُّ في الصندوقِ يُطابق العقدَ المنشورَ كاملاً.** فـ`events.test.ts`
 *     يُصدِّق **حمولةَ** مُسوَّداتٍ يبنيها الاختبارُ بيدِه على `data` وحدَه؛ وهنا تُقرأ صفوفُ
 *     الصندوقِ التي كتبتها **طلباتٌ حقيقيّةٌ**، ويُعاد بناءُ الغلافِ بـ`envelopeOf` — وهي
 *     الدالّةُ التي سيُناديها الناقلُ يومَ يُكتب — ثمّ يُصدَّق **الغلافُ والحمولةُ معاً** على
 *     `contracts/events.json`: المفاتيحُ المطلوبةُ، و`producer` الثابتُ، وصيغةُ `uuid`، و
 *     `date-time`، و`additionalProperties: false`. فحقلٌ ينساه المخزنُ يسقط هنا لا في مُستهلِك.
 *  2. **أنّ الرحلةَ تمرّ عبرَ الشبكةِ لا عبرَ مِقبضٍ داخليّ.** `http.integration.test.ts`
 *     يستعمل `app.inject`، وهو يتجاوز طبقةَ `node:http` كلَّها: ترميزَ الجسمِ، وتحليلَ
 *     الترويسات، وحدَّ الطول. وهنا كلُّ نداءٍ `fetch` على منفذٍ يمنحه النظام.
 *  3. **أنّ الجوابَ المحفوظَ يصمد على السلك.** الإعادةُ مفحوصةٌ على مِقبضٍ داخليٍّ في
 *     `idempotency-replay.integration.test.ts`؛ وهنا تُقاس على الشبكةِ ويُقارَن التسلسلُ
 *     القانونيُّ للجسمَين. وهذا التوكيدُ نفسُه هو ما كشفَ أنّ ثلاثةَ مواضعَ في الشجرةِ كانت
 *     تُعلن «نفسَ البايتات» بينما `response_body JSONB` يُعيد ترتيبَ المفاتيح — فصُحِّحت
 *     الدعوى وسُجِّل الفرقُ في `RISK-0013`.
 *  4. **أنّ الناقلَ غائبٌ فعلاً.** دَينُ الطورِ 09 مُعلَنٌ، والمُعلَنُ يُثبَّت لا يُترك ظنّاً:
 *     بعدَ رحلةٍ كاملةٍ تكتب أحدَ عشرَ حدثاً يبقى `published_at` فارغاً في كلِّ صفٍّ، ولا
 *     دالّةَ ختمٍ على سطحِ المخزن.
 *
 * # النسخةُ الخاطئةُ الأرخص
 *
 * كان الأرخصُ أن تُنادى الخدماتُ مباشرةً بلا مُستمعٍ، وأن يُقارَن كلُّ حدثٍ بثابتٍ مكتوبٍ في
 * الملفّ. والنتيجةُ بوّابةٌ تُثبت أنّ الخدمةَ متّسقةٌ مع فهمِنا نحن للعقدِ — وهو مُثبَتٌ أصلاً
 * في 434 اختباراً — ولا تُثبت أنّ ما سيُنشَر يُطابق **الورقةَ المنشورةَ** التي يقرؤها
 * المُتكامِل. ولذلك لا ثابتَ حدثٍ واحدٍ هنا: المُصدِّقُ يقرأ `events.json` من القرص.
 *
 * # ساعةٌ ثابتةٌ، ولحظةٌ من القاعدةِ لا من الساعة
 *
 * ساعةُ الخدمةِ محقونةٌ وثابتةٌ (`NOW`) كي يبقى الفشلُ مقروءاً بعد سنةٍ من كتابةِ الملفّ، وكي
 * لا يُخالف حارسُ النقاءِ الذي يمنع `new Date()` في `src/`. و`created_at` في صفوفِ الصندوقِ
 * ليست منها: تُكتب بـ`clock_timestamp()` من القاعدةِ — وذلك مقصودٌ ومحروسٌ في `RISK-0012`.
 *
 * Scope: Phase 11 · MR 6/6 — بوّابةُ الخروجِ فقط.
 * Related Code: services/marketplace
 * Related Docs: docs/12-testing/PHASE11_EXIT_GATE_E2E.md
 */
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import {
  MarketplaceCatalogService,
  MarketplaceProductService,
  MarketplaceStoreService,
} from "@wasla/marketplace-service/app";
import {
  MarketplaceUnitOfWork,
  applyMarketplaceSchema,
  bindStores,
  createMarketplaceDb,
  envelopeOf,
  type Db,
  type MarketplaceStores,
  type OutboxRecord,
} from "@wasla/marketplace-service/db";
import { createMarketplaceApp } from "@wasla/marketplace-service/http";
import type { Pool } from "pg";

/**
 * نوعُ المِقبضِ **مُشتَقٌّ** من الدالّةِ لا مُستورَدٌ من `fastify`.
 *
 * وذاك مقصودٌ لا اختصار: استيرادُ `FastifyInstance` كان سيُلزم هذه الحزمةَ بتبعيّةِ إطارٍ
 * رابعةٍ في شجرةٍ يحرس تبعيّاتِها `validate-dependency-audit.sh`، ولا حاجةَ إليها — الاشتقاقُ
 * يبقى صادقاً لو تغيّرَ الإطارُ غداً في الخدمةِ وحدَها.
 */
type MarketplaceApp = ReturnType<typeof createMarketplaceApp>;

/** البوّابةُ تحتاج قاعدةً: نمطُ الذاكرةِ في هذه الخدمةِ يردّ `503` عن قصد. */
export const PG_ENABLED = (process.env.DATABASE_URL ?? "").trim() !== "";

/** ساعةُ الخدمةِ — لحظةٌ ثابتةٌ يقرؤها كلُّ ختمِ قرارٍ في هذه البوّابة. */
export const NOW = "2026-06-01T00:00:00.000Z";

export const OWNER = "WS-1000000001";
export const MODERATOR = "WS-9000000001";
export const MEMBER = "WS-1000000003";

export const CATEGORY = "electronics-phones";
export const STORE_SLUG = "madinah-electronics";

/**
 * الجداولُ العشرةُ بترتيبِ اعتمادٍ عكسيّ — نفسُ قائمةِ مُهيِّئِ التكاملِ في الخدمة.
 *
 * ونسخةٌ ثانيةٌ من القائمةِ هنا لا استيرادٌ لأنّ `pg-harness.ts` أداةُ اختبارٍ داخليّةٌ لا
 * تُصدِّرها الحزمةُ (`exports` فيها أربعةُ مداخلَ محروسةٍ بـ`purity.test.ts`)، وتصديرُها
 * لأجلِ بوّابةٍ كان سيفتح سطحاً عامّاً لأداةِ اختبار.
 */
const TABLES = [
  "marketplace_outbox",
  "marketplace_idempotency",
  "product_inventory",
  "inventory_adjustments",
  "product_reviews",
  "products",
  "store_staff",
  "store_reviews",
  "stores",
  "store_categories",
] as const;

export interface GateContext {
  /** أصلُ الخدمةِ — مُستمعٌ حقيقيٌّ على منفذٍ يمنحه النظام. */
  readonly baseUrl: string;
  /** حوضُ القاعدةِ للتوكيداتِ التي تقرأ صفوفاً لا أجساماً. */
  readonly pool: Pool;
  readonly db: Db;
  readonly stores: MarketplaceStores;
  readonly close: () => Promise<void>;
}

/**
 * يرفع الخدمةَ بتركيبِها الإنتاجيِّ: `createMarketplaceApp` في نمطِ `postgres` على مِقبضِ
 * `node:http` حقيقيّ. ولا `probe` ولا مُضاعِفَ مخزنٍ — البوّابةُ تسأل ما سيجري في الإنتاج.
 */
export async function startGate(): Promise<GateContext> {
  const connectionString = process.env.DATABASE_URL!;
  const { pool, db } = createMarketplaceDb({ connectionString, max: 4 });

  // المخطّطُ بالمُهاجرةِ نفسِها لا بنسخةٍ ثانيةٍ من DDL: ما يُفحَص هو ما سيركض في الإنتاج.
  await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
  await applyMarketplaceSchema(pool);

  const stores = bindStores(db);
  const deps = { uow: new MarketplaceUnitOfWork(db), clock: { now: () => NOW } };
  const app: MarketplaceApp = createMarketplaceApp({
    mode: "postgres",
    services: {
      stores: new MarketplaceStoreService(deps),
      products: new MarketplaceProductService(deps),
      catalog: new MarketplaceCatalogService(deps),
    },
    logger: false,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    pool,
    db,
    stores,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

/** يُفرِّغ أثرَ الاختبارِ السابقِ — الجداولُ كلُّها، فلا بذرةَ عقدٍ في هذا الطور. */
export async function resetData(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

/**
 * يبذر تصنيفَ ورقةٍ بأبيه — كلُّ اختبارٍ يبذر تصنيفَه لأنّ `TRUNCATE` يشمل الكتالوجَ،
 * والبذرةُ المُعلَنةُ في المجالِ فارغةٌ بقرار.
 */
export async function seedLeafCategory(stores: MarketplaceStores): Promise<string> {
  const parent = await stores.categories.insertCategory({
    slug: `${CATEGORY}-parent`,
    depth: 1,
    labelAr: "إلكترونيّات",
    isActive: true,
  });
  const leaf = await stores.categories.insertCategory({
    slug: CATEGORY,
    depth: 2,
    parentCategoryId: parent.categoryId,
    labelAr: "هواتف",
    isActive: true,
  });
  return leaf.categoryId;
}

export interface HttpResult {
  readonly status: number;
  /** الجسمُ **نصّاً كما وصل** — الإعادةُ تُقارن بايتاتٍ لا كائناتٍ مُحلَّلة. */
  readonly text: string;
  readonly body: Record<string, unknown>;
}

/** نداءٌ عبرَ الشبكةِ على المُستمعِ — لا `app.inject` في هذه الحزمةِ بحال. */
export async function call(
  gate: GateContext,
  init: {
    readonly method: string;
    readonly path: string;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
    readonly traceId?: string;
  },
): Promise<HttpResult> {
  const response = await fetch(`${gate.baseUrl}${init.path}`, {
    method: init.method,
    headers: {
      "content-type": "application/json",
      ...(init.idempotencyKey === undefined ? {} : { "idempotency-key": init.idempotencyKey }),
      ...(init.traceId === undefined ? {} : { "x-request-id": init.traceId }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

/**
 * تسلسلٌ قانونيٌّ: مفاتيحٌ مُرتَّبةٌ في كلّ عمقٍ — به يُقارَن جوابٌ مُعادٌ بجوابٍ أوّل.
 *
 * ولمَ لا `toEqual` وحدَها؟ لأنّها تُساوي كائنَين وتصمت عن أنّ أحدَهما صار مصفوفةً بترتيبٍ
 * آخر؛ والنصُّ القانونيُّ يُثبّت المحتوى كلَّه في مقارنةٍ واحدةٍ تُقرأ في رسالةِ الفشل.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    const body = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",");
    return `{${body}}`;
  }
  return JSON.stringify(value) ?? "null";
}

let counter = 0;

/** مفتاحُ تكرارٍ جديدٌ في كلِّ كتابة؛ والمُعادُ يُطلب صراحةً بتمريرِ مفتاحٍ سابق. */
export function nextKey(prefix: string): string {
  counter += 1;
  return `idem-gate-${prefix}-${String(counter).padStart(6, "0")}`;
}

/** صفوفُ الصندوقِ بترتيبِ الكتابةِ — نفسُ ترتيبِ `listUnpublished` وبنفسِ فاصلَيه. */
export async function outboxRecords(gate: GateContext): Promise<readonly OutboxRecord[]> {
  return await gate.stores.outbox.listUnpublished(500);
}

/** الغلافُ الكاملُ كما سيُنشره الناقلُ يومَ يُكتب — لا يُبنى هنا بيد. */
export function envelopesOf(records: readonly OutboxRecord[]): readonly Record<string, unknown>[] {
  return records.map((record) => envelopeOf(record) as unknown as Record<string, unknown>);
}

/** عددُ صفوفِ جدولٍ — لإثباتِ أنّ ما لم يُكتب لم يُكتب. */
export async function countRows(pool: Pool, table: (typeof TABLES)[number]): Promise<number> {
  const result = await pool.query<{ readonly count: string }>(
    `SELECT count(*)::text AS count FROM ${table}`,
  );
  return Number(result.rows[0]?.count ?? "0");
}

// ─────────────────────────────────────────────────────────────────────────────
// مُصدِّقُ العقدِ المنشور
// ─────────────────────────────────────────────────────────────────────────────

interface Schema {
  readonly [keyword: string]: unknown;
}

const CONTRACT_PATH = resolve(process.cwd(), "../../services/marketplace/contracts/events.json");

const CONTRACT = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as {
  readonly $defs: Readonly<Record<string, Schema>>;
};

/**
 * الكلماتُ المفتاحيّةُ التي يفهمها هذا المُصدِّقُ — وما خرج عنها **يُفشِله صراحةً**.
 *
 * ولا `ajv` في المستودعِ كلِّه، وإضافتُها لأجلِ بوّابةٍ كانت تبعيّةَ إنتاجٍ ثالثةً في شجرةٍ
 * محروسةٍ بـ`validate-dependency-audit.sh`. والبديلُ الأمينُ ليس مُصدِّقاً متسامحاً — بل
 * مُصدِّقٌ **يسقط عندَ ما لا يفهم**: كلمةٌ جديدةٌ في العقدِ تُسقط البوّابةَ باسمِها بدلَ أن
 * تُتجاهَل صامتةً فتصير الورقةُ أوسعَ من الحارس.
 */
const SUPPORTED_KEYWORDS = new Set([
  "$ref",
  "additionalProperties",
  "allOf",
  "const",
  "description",
  "enum",
  "format",
  "minLength",
  "minimum",
  "not",
  "oneOf",
  "pattern",
  "properties",
  "required",
  "title",
  "type",
]);

/** `marketplace.store_staff_added` → `MarketplaceStoreStaffAddedV1` — اشتقاقٌ لا خريطةٌ مكتوبة. */
export function defNameOf(eventType: string): string {
  return `${eventType
    .split(/[.:_]/u)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("")}V1`;
}

function resolveRef(schema: Schema): Schema {
  const ref = schema.$ref;
  if (typeof ref !== "string") return schema;
  const name = ref.replace("#/$defs/", "");
  const target = CONTRACT.$defs[name];
  if (target === undefined) throw new Error(`unresolved $ref: ${ref}`);
  return resolveRef(target);
}

/**
 * يُعيد قائمةَ مخالفاتٍ نصّيّةً — فارغةٌ تعني مطابقةً، ومملوءةٌ تُطبَع كما هي في رسالةِ الفشل.
 *
 * و`allOf` مأخوذةٌ هنا خلافاً لمُصدِّقِ الخدمةِ الذي يقرأ `data` وحدَه: كلُّ تعريفِ حدثٍ في
 * الورقةِ يُركّب الغلافَ بها (`allOf: [{ $ref: EventEnvelope }]`)، فتجاهلُها كان سيجعل
 * البوّابةَ تُصدِّق الحمولةَ وتُهمل المفاتيحَ الستّةَ التي يقرؤها كلُّ مُستهلِك.
 */
export function violations(value: unknown, schema: Schema, path: string): readonly string[] {
  const found: string[] = [];
  const resolved = resolveRef(schema);

  for (const keyword of Object.keys(resolved)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      found.push(`${path}: unsupported keyword in contract: ${keyword}`);
    }
  }

  if (Array.isArray(resolved.allOf)) {
    for (const branch of resolved.allOf as readonly Schema[]) {
      found.push(...violations(value, branch, path));
    }
  }

  if ("const" in resolved && value !== resolved.const) {
    found.push(
      `${path}: expected const ${JSON.stringify(resolved.const)}, got ${JSON.stringify(value)}`,
    );
  }

  if (Array.isArray(resolved.enum) && !resolved.enum.includes(value)) {
    found.push(`${path}: ${JSON.stringify(value)} is not in the contract enum`);
  }

  if (resolved.type !== undefined && !matchesType(value, resolved.type)) {
    found.push(`${path}: expected type ${JSON.stringify(resolved.type)}, got ${typeOf(value)}`);
  }

  if (typeof resolved.pattern === "string" && typeof value === "string") {
    if (!new RegExp(resolved.pattern, "u").test(value)) {
      found.push(`${path}: ${JSON.stringify(value)} does not match ${resolved.pattern}`);
    }
  }

  if (typeof resolved.minLength === "number" && typeof value === "string") {
    if (value.length < resolved.minLength) {
      found.push(`${path}: ${JSON.stringify(value)} is shorter than ${resolved.minLength}`);
    }
  }

  if (typeof resolved.minimum === "number" && typeof value === "number") {
    if (value < resolved.minimum) {
      found.push(`${path}: ${JSON.stringify(value)} is below minimum ${resolved.minimum}`);
    }
  }

  const not = resolved.not as Schema | undefined;
  if (not !== undefined && "const" in not && value === not.const) {
    found.push(`${path}: ${JSON.stringify(value)} is forbidden by not.const`);
  }

  if (resolved.format === "uuid" && typeof value === "string") {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)) {
      found.push(`${path}: ${JSON.stringify(value)} is not a uuid`);
    }
  }

  if (resolved.format === "date-time" && typeof value === "string") {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)) {
      found.push(`${path}: ${JSON.stringify(value)} is not an ISO instant in UTC`);
    }
  }

  if (Array.isArray(resolved.oneOf)) {
    const branches = resolved.oneOf as readonly Schema[];
    const passing = branches.filter((branch) => violations(value, branch, path).length === 0);
    if (passing.length !== 1) {
      found.push(`${path}: ${JSON.stringify(value)} matched ${passing.length} oneOf branches`);
    }
  }

  const properties = resolved.properties as Readonly<Record<string, Schema>> | undefined;
  if (properties !== undefined && typeof value === "object" && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    for (const [key, child] of Object.entries(properties)) {
      if (key in record) found.push(...violations(record[key], child, `${path}.${key}`));
    }
    if (resolved.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in properties)) found.push(`${path}: unexpected key ${key}`);
      }
    }
  }

  if (Array.isArray(resolved.required) && typeof value === "object" && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    for (const key of resolved.required as readonly string[]) {
      if (!(key in record)) found.push(`${path}: missing required key ${key}`);
    }
  }

  return found;
}

function matchesType(value: unknown, type: unknown): boolean {
  if (Array.isArray(type)) return type.some((one) => matchesType(value, one));
  if (type === "object") {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  if (type === "null") return value === null;
  if (type === "integer") return Number.isSafeInteger(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number";
  return false;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}

/** يُصدِّق غلافاً كاملاً على تعريفِ نوعِه في الورقةِ المنشورة. */
export function envelopeViolations(envelope: Record<string, unknown>): readonly string[] {
  const eventType = envelope.event_type;
  if (typeof eventType !== "string") return ["event_type is not a string"];
  const def = CONTRACT.$defs[defNameOf(eventType)];
  if (def === undefined) return [`no contract def for ${eventType}`];
  return violations(envelope, def, eventType);
}

/** أسماءُ تعريفاتِ الأحداثِ في الورقةِ — لإثباتِ أنّ الأنواعَ المكتوبةَ هي المنشورة. */
export function contractEventTypes(): readonly string[] {
  return Object.keys(CONTRACT.$defs).filter((name) => name.endsWith("V1"));
}

/**
 * ## النطاق
 *
 * رفعُ خدمةِ السوقِ على Postgres على مِقبضٍ حقيقيّ، ومُساعداتُ نداءٍ وعدِّ صفوفٍ وقراءةِ
 * صندوقٍ، ومُصدِّقُ عقدٍ يقرأ `contracts/events.json` من القرصِ ويسقط عندَ ما لا يفهم.
 *
 * ## آخر تحديث
 *
 * المراجعة 6/6 — الملفُّ جديد.
 *
 * ## الحالة
 *
 * يحتاج `DATABASE_URL`؛ ويتخطّى نفسَه بلا قاعدةٍ عبر `PG_ENABLED`.
 *
 * ## كودٌ ذو صلة
 *
 * `services/marketplace/src/http/app.ts` (نفسُ التركيب) ·
 * `services/marketplace/src/__tests__/pg-harness.ts` · `packages/subscription-e2e/src/harness.ts`.
 *
 * ## الفريق
 *
 * Marketplace / Data.
 */
