/**
 * حرّاسُ الأحداثِ: **العقدُ `contracts/events.json` هو المرجعُ، لا نسخةٌ منه مكتوبةٌ هنا**.
 *
 * ## لمَ يُقرأ العقدُ ملفّاً بدل أن تُكتب المفاتيحُ المتوقّعةُ في الاختبار
 *
 * لأنّ اختباراً يكتب قائمةَ مفاتيحَ بيدِه يقيس اتّفاقَ الكودِ مع **نسخةٍ ثانيةٍ من نيّةِ
 * كاتبِه**، لا مع العقد: يُنسى حرفٌ في العقدِ فيمرّ الاختبارُ، أو يُعدَّل العقدُ فلا يشعر أحد.
 * وهنا يُقرأ الملفُّ ذاتُه الذي سيقرؤه المُستهلك، فأيُّ فرقٍ — مفتاحٌ زائدٌ أو ناقصٌ أو نوعٌ
 * مختلفٌ أو نمطٌ لا يُطابق — يسقط بفرقٍ مقروءٍ باسمِ الحقلِ ونوعِ الحدث.
 *
 * ## ولمَ مُدقّقٌ صغيرٌ هنا بدل مكتبةِ JSON Schema
 *
 * لأنّ `dependencies` في `package.json` محروسةٌ بأربعِ حزمٍ بالاسم (`purity.test.ts`)، وإضافةُ
 * مُدقّقٍ لأجلِ اختبارٍ كانت ستوسّع سطحَ الإنتاجِ لأجلِ التطوير. والمُقرَأُ من العقدِ هنا
 * مجموعةٌ فرعيّةٌ مُعلَنةٌ: `type` · `const` · `enum` · `pattern` · `minimum` · `not.const` ·
 * `oneOf` · `$ref` · `required` · `additionalProperties:false`. وكلُّ كلمةٍ مفتاحيّةٍ في العقدِ
 * خارجَ هذه المجموعةِ **تُفشل المُدقّقَ صراحةً** (`unsupported keyword`) بدل أن تُتجاهَل
 * صامتةً: حارسٌ يتجاهل ما لا يفهم يُصبح موافقةً على كلِّ شيء.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  MARKETPLACE_EVENT_PRODUCER,
  MARKETPLACE_EVENT_TYPES,
  MARKETPLACE_EVENT_VERSION,
  inventoryAdjustedEvent,
  marketplaceEventEnvelope,
  productArchivedEvent,
  productCreatedEvent,
  productModeratedEvent,
  productPublishedEvent,
  storeApprovedEvent,
  storeDecisionEvent,
  storeRegisteredEvent,
  storeStaffAddedEvent,
  storeStaffRemovedEvent,
  type MarketplaceEventDraft,
  type MarketplaceEventType,
} from "../domain/events.js";

const EVENTS_CONTRACT_PATH = fileURLToPath(
  new URL("../../contracts/events.json", import.meta.url),
);

interface Schema {
  readonly [keyword: string]: unknown;
}

const CONTRACT = JSON.parse(readFileSync(EVENTS_CONTRACT_PATH, "utf8")) as {
  readonly $defs: Readonly<Record<string, Schema>>;
};

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
function defNameOf(eventType: MarketplaceEventType): string {
  return `${eventType
    .split(/[.:_]/u)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("")}V1`;
}

function resolve(schema: Schema): Schema {
  const ref = schema.$ref;
  if (typeof ref !== "string") return schema;
  const name = ref.replace("#/$defs/", "");
  const target = CONTRACT.$defs[name];
  if (target === undefined) throw new Error(`unresolved $ref: ${ref}`);
  return resolve(target);
}

function dataSchemaOf(eventType: MarketplaceEventType): Schema {
  const def = CONTRACT.$defs[defNameOf(eventType)];
  if (def === undefined) throw new Error(`no contract def for ${eventType}`);
  const properties = def.properties as Readonly<Record<string, Schema>> | undefined;
  if (properties?.data === undefined) throw new Error(`no data schema for ${eventType}`);
  return resolve(properties.data);
}

/** يُعيد قائمةَ مخالفاتٍ نصّيّةً — فارغةٌ تعني مطابقةً، ومملوءةٌ تُطبَع كما هي في الفرق. */
function violations(value: unknown, schema: Schema, path: string): readonly string[] {
  const found: string[] = [];
  const resolved = resolve(schema);

  for (const keyword of Object.keys(resolved)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      found.push(`${path}: unsupported keyword in contract: ${keyword}`);
    }
  }

  if ("const" in resolved && value !== resolved.const) {
    found.push(`${path}: expected const ${JSON.stringify(resolved.const)}, got ${JSON.stringify(value)}`);
  }

  if (Array.isArray(resolved.enum) && !resolved.enum.includes(value)) {
    found.push(`${path}: ${JSON.stringify(value)} is not in the contract enum`);
  }

  if (resolved.type !== undefined && !matchesType(value, resolved.type)) {
    found.push(`${path}: expected type ${JSON.stringify(resolved.type)}, got ${typeOf(value)}`);
  }

  // `pattern` و`minLength` لا تقعان إلّا على نصٍّ، و`minimum` لا تقع إلّا على رقم — هذه دلالةُ
  // JSON Schema حرفاً. ومُدقّقٌ يُطبّق النمطَ على `null` كان سيرفض حقلاً اختياريّاً صحيحاً
  // (`actor_public_id` لقرارِ نظامٍ) ثمّ يُقرأ رفضُه عطباً في الكودِ لا في الحارس.
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
  if (properties !== undefined) {
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

  if (Array.isArray(resolved.required)) {
    const record = value as Readonly<Record<string, unknown>>;
    for (const key of resolved.required as readonly string[]) {
      if (!(key in record)) found.push(`${path}: missing required key ${key}`);
    }
  }

  return found;
}

function matchesType(value: unknown, type: unknown): boolean {
  if (Array.isArray(type)) return type.some((one) => matchesType(value, one));
  if (type === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
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

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const STAFF_ID = "33333333-3333-4333-8333-333333333333";
const ADJUSTMENT_ID = "44444444-4444-4444-8444-444444444444";
const EVENT_ID = "55555555-5555-4555-8555-555555555555";
const OWNER = "WS-0000000001";
const MODERATOR = "WS-0000000002";
const MEMBER = "WS-0000000003";
const FOR = "2026-03-01T10:00:00.000Z";
const AT = "2026-03-01T10:00:01.000Z";

const storeShared = {
  storeId: STORE_ID,
  storeSlug: "atlas-market",
  ownerPublicId: OWNER,
  categorySlug: "general",
  occurredFor: FOR,
  occurredAt: AT,
} as const;

const staffShared = {
  storeId: STORE_ID,
  storeSlug: "atlas-market",
  staffId: STAFF_ID,
  memberPublicId: MEMBER,
  actorPublicId: OWNER,
  occurredFor: FOR,
  occurredAt: AT,
} as const;

const productShared = {
  productId: PRODUCT_ID,
  storeId: STORE_ID,
  storeSlug: "atlas-market",
  occurredFor: FOR,
  occurredAt: AT,
} as const;

/**
 * حدثٌ واحدٌ لكلِّ نوعٍ من الأنواعِ الثلاثةَ عشرَ، **بكلِّ الحقولِ الاختياريّةِ مملوءةً**.
 *
 * وملؤها مقصودٌ: العقدُ يقول `additionalProperties:false`، فحمولةٌ تُغفِل حقلاً اختياريّاً
 * تمرّ الفحصَ ولا تُثبت أنّ البانيَ يعرفه. والحالةُ التي تُغفِله مفحوصةٌ وحدَها أدناه.
 */
const SAMPLES: Readonly<Record<MarketplaceEventType, MarketplaceEventDraft>> = {
  "marketplace.store_registered": storeRegisteredEvent({ ...storeShared, stateSequence: 1 }),
  "marketplace.store_review_requested": storeDecisionEvent({
    ...storeShared,
    fromState: "draft",
    toState: "pending_review",
    stateSequence: 2,
    actorType: "owner",
    actorPublicId: OWNER,
    reasonCode: "owner_request",
  }),
  "marketplace.store_approved": storeApprovedEvent({
    ...storeShared,
    fromState: "pending_review",
    toState: "approved",
    stateSequence: 3,
    actorType: "moderator",
    actorPublicId: MODERATOR,
    reasonCode: "owner_request",
    isFirstApproval: true,
  }),
  "marketplace.store_rejected": storeDecisionEvent({
    ...storeShared,
    fromState: "pending_review",
    toState: "rejected",
    stateSequence: 3,
    actorType: "moderator",
    actorPublicId: MODERATOR,
    reasonCode: "incomplete_profile",
  }),
  "marketplace.store_suspended": storeDecisionEvent({
    ...storeShared,
    fromState: "approved",
    toState: "suspended",
    stateSequence: 4,
    actorType: "moderator",
    actorPublicId: MODERATOR,
    reasonCode: "policy_violation",
  }),
  "marketplace.store_archived": storeDecisionEvent({
    ...storeShared,
    fromState: "suspended",
    toState: "archived",
    stateSequence: 5,
    actorType: "owner",
    actorPublicId: OWNER,
    reasonCode: "owner_request",
  }),
  "marketplace.store_staff_added": storeStaffAddedEvent({ ...staffShared, role: "manager" }),
  "marketplace.store_staff_removed": storeStaffRemovedEvent({ ...staffShared, role: "staff" }),
  "marketplace.product_created": productCreatedEvent({
    ...productShared,
    sku: "SKU-0001",
    categorySlug: "general",
    createdByPublicId: OWNER,
  }),
  "marketplace.product_moderated": productModeratedEvent({
    ...productShared,
    fromState: "pending",
    toState: "rejected",
    moderationSequence: 2,
    actorType: "moderator",
    actorPublicId: MODERATOR,
    reasonCode: "wrong_category",
  }),
  "marketplace.product_published": productPublishedEvent({
    ...productShared,
    categorySlug: "general",
    fromState: "draft",
    storeState: "approved",
    quantityOnHand: 7,
    actorPublicId: OWNER,
  }),
  "marketplace.product_archived": productArchivedEvent({
    ...productShared,
    fromState: "published",
    actorPublicId: OWNER,
  }),
  "marketplace.inventory_adjusted": inventoryAdjustedEvent({
    adjustmentId: ADJUSTMENT_ID,
    productId: PRODUCT_ID,
    storeId: STORE_ID,
    quantityDelta: -3,
    quantityAfter: 4,
    reasonCode: "shrinkage",
    adjustmentSequence: 5,
    actorPublicId: OWNER,
    occurredFor: FOR,
    occurredAt: AT,
  }),
};

describe("العقدُ مقروءٌ وأنواعُه ثلاثةَ عشرَ", () => {
  it("كلُّ نوعٍ مُعلَنٍ في الكودِ له تعريفٌ في العقدِ باسمٍ مُشتَقّ", () => {
    expect(MARKETPLACE_EVENT_TYPES).toHaveLength(13);
    expect(
      MARKETPLACE_EVENT_TYPES.filter((type) => CONTRACT.$defs[defNameOf(type)] === undefined),
    ).toEqual([]);
  });

  it("ولا تعريفَ حدثٍ في العقدِ بلا نوعٍ مُعلَنٍ في الكود", () => {
    const declared = new Set<string>(MARKETPLACE_EVENT_TYPES.map(defNameOf));
    const contractEvents = Object.keys(CONTRACT.$defs).filter((name) => name.endsWith("V1"));
    expect(contractEvents.filter((name) => !declared.has(name))).toEqual([]);
  });

  it("والنوعُ المُعلَنُ في العقدِ هو نوعُ المسوّدةِ نفسُه", () => {
    for (const type of MARKETPLACE_EVENT_TYPES) {
      const properties = CONTRACT.$defs[defNameOf(type)]!.properties as Readonly<
        Record<string, Schema>
      >;
      expect(properties.event_type!.const).toBe(type);
      expect(properties.event_version!.const).toBe(MARKETPLACE_EVENT_VERSION);
      expect(SAMPLES[type].eventType).toBe(type);
    }
  });
});

describe.each(MARKETPLACE_EVENT_TYPES)("حمولةُ %s تُطابق العقد", (type) => {
  it("لا مفتاحَ زائدٌ ولا ناقصٌ ولا قيمةٌ تُخالف نمطاً", () => {
    expect(violations(SAMPLES[type].payload, dataSchemaOf(type), "data")).toEqual([]);
  });

  it("والغلافُ المُعادُ بناؤه يُطابق تعريفَ الحدثِ كاملاً", () => {
    const def = CONTRACT.$defs[defNameOf(type)]!;
    const envelope = marketplaceEventEnvelope(EVENT_ID, SAMPLES[type]);
    expect(envelope.producer).toBe(MARKETPLACE_EVENT_PRODUCER);
    expect(violations(envelope, def, "event")).toEqual([]);
    for (const branch of def.allOf as readonly Schema[]) {
      expect(violations(envelope, branch, "envelope")).toEqual([]);
    }
  });

  it("والحمولةُ مُجمَّدةٌ فلا يُعدّلها مُستهلكٌ في الذاكرة", () => {
    expect(Object.isFrozen(SAMPLES[type].payload)).toBe(true);
  });
});

describe("الحقولُ الاختياريّةُ تُكتب `null` لا تُحذَف", () => {
  it("قرارُ نظامٍ بلا فاعلٍ ولا سببٍ: المفتاحان موجودان بقيمةِ `null`", () => {
    const draft = storeDecisionEvent({
      ...storeShared,
      fromState: "approved",
      toState: "suspended",
      stateSequence: 4,
      actorType: "system",
    });
    expect(draft.payload.actor_public_id).toBeNull();
    expect(draft.payload.reason_code).toBeNull();
    expect(violations(draft.payload, dataSchemaOf("marketplace.store_suspended"), "data")).toEqual(
      [],
    );
  });

  it("والتسجيلُ يُثبّت `∅ → draft` بفاعلِ مالكٍ ولا يقبل خلافَه وسيطاً", () => {
    const draft = storeRegisteredEvent({ ...storeShared, stateSequence: 1 });
    expect(draft.payload.from_state).toBeNull();
    expect(draft.payload.to_state).toBe("draft");
    expect(draft.payload.actor_type).toBe("owner");
    expect(draft.aggregateType).toBe("store");
  });
});

describe("جذرُ الحدثِ ومُعرِّفُه", () => {
  it("أحداثُ المتجرِ جذرُها المتجرُ، والمنتجِ المنتجُ، والمخزونِ المنتجُ لا الفرق", () => {
    const roots = MARKETPLACE_EVENT_TYPES.map((type) => ({
      type,
      aggregate: `${SAMPLES[type].aggregateType}:${SAMPLES[type].aggregateId}`,
    }));
    expect(roots.filter((row) => row.type.startsWith("marketplace.store"))).toHaveLength(8);
    for (const row of roots) {
      const expected = row.type.startsWith("marketplace.store")
        ? `store:${STORE_ID}`
        : row.type === "marketplace.inventory_adjusted"
          ? `inventory:${PRODUCT_ID}`
          : `product:${PRODUCT_ID}`;
      expect(`${row.type} → ${row.aggregate}`).toBe(`${row.type} → ${expected}`);
    }
  });
});

describe("البانونَ يرفضون ما يُخالف العقدَ", () => {
  const decision = {
    ...storeShared,
    fromState: "pending_review",
    toState: "approved",
    stateSequence: 3,
    actorType: "moderator",
    actorPublicId: MODERATOR,
  } as const;

  it("الاعتمادُ لا يُبنى ببانِ القراراتِ العامِّ ولا بالعكس", () => {
    expect(() => storeDecisionEvent(decision)).toThrow(/to_state/u);
    expect(() => storeApprovedEvent({ ...decision, toState: "rejected", isFirstApproval: true })).toThrow(
      /to_state/u,
    );
  });

  it("والإنشاءُ لا يُبنى ببانِ القراراتِ: `draft` بابُه واحد", () => {
    expect(() => storeDecisionEvent({ ...decision, toState: "draft" })).toThrow(/to_state/u);
  });

  it("وإزالةُ مالكٍ لا حدثَ لها: العقدُ يقصر الدورَ على `manager|staff`", () => {
    expect(() => storeStaffRemovedEvent({ ...staffShared, role: "owner" })).toThrow(/role/u);
    expect(storeStaffAddedEvent({ ...staffShared, role: "owner" }).payload.role).toBe("owner");
  });

  it("وفرقُ مخزونٍ صفرٌ مرفوضٌ، والرصيدُ السالبُ مرفوضٌ", () => {
    const base = {
      adjustmentId: ADJUSTMENT_ID,
      productId: PRODUCT_ID,
      storeId: STORE_ID,
      quantityAfter: 4,
      reasonCode: "correction",
      adjustmentSequence: 1,
      actorPublicId: OWNER,
      occurredFor: FOR,
      occurredAt: AT,
    } as const;
    expect(() => inventoryAdjustedEvent({ ...base, quantityDelta: 0 })).toThrow(/quantity_delta/u);
    expect(() =>
      inventoryAdjustedEvent({ ...base, quantityDelta: -9, quantityAfter: -1 }),
    ).toThrow(/quantity_after/u);
  });

  it("وتسلسلٌ صفرٌ أو كسريٌّ مرفوضٌ: العقدُ يقول عدداً صحيحاً من واحد", () => {
    expect(() => storeRegisteredEvent({ ...storeShared, stateSequence: 0 })).toThrow(
      /state_sequence/u,
    );
    expect(() => storeRegisteredEvent({ ...storeShared, stateSequence: 1.5 })).toThrow(
      /state_sequence/u,
    );
  });

  it("ومُعرِّفٌ عامٌّ بصيغةٍ خاطئةٍ مرفوضٌ حيثما وقع", () => {
    expect(() => storeRegisteredEvent({ ...storeShared, ownerPublicId: "WS-1", stateSequence: 1 })).toThrow(
      /owner_public_id/u,
    );
    expect(() => storeStaffAddedEvent({ ...staffShared, memberPublicId: "x", role: "staff" })).toThrow(
      /member_public_id/u,
    );
  });

  /**
   * وما لا يفحصه البانونَ **مُعلَنٌ هنا لا مسكوتٌ عنه**: `assertTimestamp` في `domain/time.ts`
   * يقبل نصّاً بلا `Z` ولا فارقٍ زمنيّ (`Date.parse` يقرؤه وقتاً محليّاً)، والعقدُ يقول
   * `format: date-time`. وتضييقُ ذلك يمسّ ملفَّ زمنٍ تقرؤه مراجعاتٌ سابقةٌ وخدماتٌ أخرى،
   * فهو **قرارٌ لا تصحيحٌ عابرٌ في مراجعةِ أحداث** — ومكتوبٌ في «ما لم يُتحقَّق منه».
   */
  it("ونصٌّ ليس لحظةً أصلاً مرفوضٌ — والفارقُ الزمنيُّ الغائبُ دَينٌ مُعلَنٌ لا حارسٌ هنا", () => {
    expect(() =>
      storeRegisteredEvent({ ...storeShared, occurredFor: "ليست لحظة", stateSequence: 1 }),
    ).toThrow(/occurred_for/u);
    expect(
      storeRegisteredEvent({ ...storeShared, occurredFor: "2026-03-01T10:00:00", stateSequence: 1 })
        .payload.occurred_for,
    ).toBe("2026-03-01T10:00:00");
  });

  it("والغلافُ لا يُبنى بمُعرِّفِ حدثٍ ليس UUID", () => {
    expect(() => marketplaceEventEnvelope("not-a-uuid", SAMPLES["marketplace.product_created"])).toThrow(
      /event_id/u,
    );
  });
});

describe("لا مالَ ولا نصَّ حرٍّ ولا ظهورَ في أيِّ حمولة", () => {
  const BANNED = [
    "price_minor_units",
    "currency_code",
    "amount",
    "total",
    "fee",
    "commission",
    "title_ar",
    "title_en",
    "title_ur",
    "description_ar",
    "is_visible",
    "owner_name",
    "phone",
    "email",
    "latitude",
    "longitude",
    "channel_id",
  ] as const;

  it("الحمولاتُ الثلاثةَ عشرَ خاليةٌ من مفاتيحِ المالِ والنصِّ والظهورِ والخصوصيّة", () => {
    const hits = MARKETPLACE_EVENT_TYPES.flatMap((type) =>
      Object.keys(SAMPLES[type].payload)
        .filter((key) => (BANNED as readonly string[]).includes(key))
        .map((key) => `${type}.${key}`),
    );
    expect(hits).toEqual([]);
  });

  it("ولا مفتاحَ في العقدِ نفسِه يحمل أحدَها — الحارسُ يقرأ العقدَ لا الحمولةَ وحدَها", () => {
    const hits = MARKETPLACE_EVENT_TYPES.flatMap((type) => {
      const properties = dataSchemaOf(type).properties as Readonly<Record<string, Schema>>;
      return Object.keys(properties)
        .filter((key) => (BANNED as readonly string[]).includes(key))
        .map((key) => `${type}.${key}`);
    });
    expect(hits).toEqual([]);
  });
});

describe("المُدقّقُ نفسُه يسقط حين يجب", () => {
  it("مفتاحٌ زائدٌ يُرى، ومفتاحٌ ناقصٌ يُرى، ونمطٌ مُخالفٌ يُرى", () => {
    const schema = dataSchemaOf("marketplace.product_archived");
    const good = SAMPLES["marketplace.product_archived"].payload;
    expect(violations({ ...good, surprise: 1 }, schema, "data")).toEqual([
      "data: unexpected key surprise",
    ]);
    const { store_slug: _dropped, ...missing } = good;
    expect(violations(missing, schema, "data")).toEqual(["data: missing required key store_slug"]);
    expect(violations({ ...good, store_slug: "A" }, schema, "data")).toHaveLength(1);
  });

  it("وكلمةٌ مفتاحيّةٌ لا يفهمها المُدقّقُ تُفشله بدل أن تُتجاهَل", () => {
    expect(violations(1, { multipleOf: 2 }, "x")).toEqual([
      "x: unsupported keyword in contract: multipleOf",
    ]);
  });
});
