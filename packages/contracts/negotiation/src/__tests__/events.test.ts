import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NEGOTIATION_CLOSE_REASON_CODES, NEGOTIATION_EVENT_FORBIDDEN_FIELDS, NEGOTIATION_EVENT_TYPES,
  NEGOTIATION_HANDOFF_OUTCOMES, NEGOTIATION_PARTIES,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(__dirname, "../../../../../services/negotiations/contracts");
const events = JSON.parse(
  readFileSync(resolve(CONTRACTS_DIR, "events.json"), "utf8"),
) as {
  $defs: Record<string, unknown>;
  oneOf?: unknown[];
  properties?: Record<string, unknown>;
};

/** كل تعريف حدث في `$defs` يحمل `properties.event_type.const`. هذا هو مصدر الحقيقة. */
type Def = {
  properties?: Record<string, { const?: string; enum?: string[]; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }>;
  required?: string[];
  allOf?: Def[];
};
const defs = events.$defs as Record<string, Def>;
const eventDefs = Object.entries(defs).filter(([, d]) => {
  const merged = [d, ...(d.allOf ?? [])];
  return merged.some((m) => typeof m.properties?.["event_type"]?.const === "string");
});
function constEventType(def: Def): string {
  for (const m of [def, ...(def.allOf ?? [])]) {
    const c = m.properties?.["event_type"]?.const;
    if (typeof c === "string") return c;
  }
  throw new Error("event definition without a const event_type");
}
function dataSchema(def: Def): { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean } {
  for (const m of [def, ...(def.allOf ?? [])]) {
    const data = m.properties?.["data"];
    if (data && typeof data === "object") return data as never;
  }
  throw new Error(`${constEventType(def)} has no data schema`);
}
/** يحلّ `$ref` داخليّاً كي يقارن الحارس تعداداً بتعداد لا مرجعاً بنصّ. */
function resolve$ref(node: unknown): { enum?: string[] } {
  const n = node as { $ref?: string; enum?: string[] };
  if (typeof n?.$ref === "string") {
    const key = n.$ref.replace("#/$defs/", "");
    expect(Object.keys(defs), n.$ref).toContain(key);
    return defs[key] as never;
  }
  return n ?? {};
}
/** كل مفاتيح كل الحمولات، للحارس السالب على الحقول الممنوعة. */
function allDataKeys(): Array<[string, string]> {
  return eventDefs.flatMap(([, def]) =>
    Object.keys(dataSchema(def).properties ?? {}).map((key) => [constEventType(def), key] as [string, string]),
  );
}

describe("negotiation event catalog ↔ events.json", () => {
  it("declares every exported event type and no undeclared type", () => {
    expect(eventDefs.map(([, d]) => constEventType(d)).sort()).toEqual([...NEGOTIATION_EVENT_TYPES].sort());
  });
  it("keeps event types unique", () => {
    expect(new Set(NEGOTIATION_EVENT_TYPES).size).toBe(NEGOTIATION_EVENT_TYPES.length);
  });
  it("namespaces every event under negotiations.", () => {
    for (const type of NEGOTIATION_EVENT_TYPES) expect(type).toMatch(/^negotiations\.[a-z_]+$/);
  });
  it("names negotiations-service as the only producer", () => {
    const raw = readFileSync(resolve(CONTRACTS_DIR, "events.json"), "utf8");
    expect(raw).toContain('"negotiations-service"');
    for (const other of ["orders-service", "dispatch-service", "drivers-service", "matching-service"]) {
      expect(raw, other).not.toContain(other);
    }
  });
  it("carries a business time on every payload, so a late tick misdates nothing", () => {
    for (const [, def] of eventDefs) {
      const data = dataSchema(def);
      expect(Object.keys(data.properties ?? {}), constEventType(def)).toContain("occurred_for");
      expect(data.required ?? [], constEventType(def)).toContain("occurred_for");
    }
  });
  it("closes every payload to unknown keys", () => {
    for (const [, def] of eventDefs) {
      expect(dataSchema(def).additionalProperties, constEventType(def)).toBe(false);
    }
  });
});

describe("ADR-013 decision 6: an event says what changed, never what was said", () => {
  it("lets no forbidden field enter any payload", () => {
    for (const [type, key] of allDataKeys()) {
      expect([...NEGOTIATION_EVENT_FORBIDDEN_FIELDS], `${type}.${key}`).not.toContain(key as never);
    }
  });
  /** `body_length` عدّادُ إساءةٍ لا نصّ: الفرق بينه وبين `body` هو كلامُ الناس. */
  it("measures a message instead of quoting it", () => {
    const posted = eventDefs.find(([, d]) => constEventType(d) === "negotiations.message_posted");
    expect(posted).toBeDefined();
    const keys = Object.keys(dataSchema(posted![1]).properties ?? {});
    expect(keys).toContain("body_length");
    expect(keys).not.toContain("body");
    expect(keys).toContain("source_locale");
    expect(keys).not.toContain("translated_body");
  });
  /** المبلغ يعبر لأنّه هو التغيير نفسه: حدثُ تفاوضٍ بلا مبلغ لا يقول شيئاً. */
  it("does carry the amount, because the amount is the change", () => {
    for (const type of ["negotiations.round_proposed", "negotiations.agreed"]) {
      const def = eventDefs.find(([, d]) => constEventType(d) === type)![1];
      const keys = Object.keys(dataSchema(def).properties ?? {});
      expect(keys, type).toContain("amount_minor");
      expect(keys, type).toContain("currency");
    }
  });
});

describe("negotiation event enums ↔ exported constants", () => {
  it("keeps the closing event's reason codes identical to the schema's", () => {
    const closed = eventDefs.find(([, d]) => constEventType(d) === "negotiations.thread_closed")![1];
    const reason = resolve$ref((dataSchema(closed).properties as Record<string, unknown>)["close_reason_code"]);
    expect(reason.enum?.slice().sort()).toEqual([...NEGOTIATION_CLOSE_REASON_CODES].sort());
  });
  /** `agreed` له حدثه الخاصّ، فلا يظهر حالةً في حدث الإغلاق. */
  it("keeps agreed out of the closing event's state enum", () => {
    const closed = eventDefs.find(([, d]) => constEventType(d) === "negotiations.thread_closed")![1];
    const state = resolve$ref((dataSchema(closed).properties as Record<string, unknown>)["state"]);
    expect(state.enum).not.toContain("agreed");
    expect(state.enum?.slice().sort()).toEqual(["cancelled", "declined", "expired"]);
  });
  it("keeps the hand-off failure outcomes identical to the exported constant", () => {
    const failed = eventDefs.find(([, d]) => constEventType(d) === "negotiations.price_handoff_failed")![1];
    const outcome = resolve$ref((dataSchema(failed).properties as Record<string, unknown>)["outcome"]);
    expect(outcome.enum?.slice().sort()).toEqual([...NEGOTIATION_HANDOFF_OUTCOMES].sort());
  });
  it("names only the two parties wherever a party acts", () => {
    for (const [key, type] of [
      ["opened_by", "negotiations.thread_opened"], ["proposed_by", "negotiations.round_proposed"],
      ["rejected_by", "negotiations.round_rejected"], ["accepted_by", "negotiations.agreed"],
    ] as const) {
      const def = eventDefs.find(([, d]) => constEventType(d) === type)![1];
      const prop = resolve$ref((dataSchema(def).properties as Record<string, unknown>)[key]);
      expect(prop.enum?.slice().sort(), `${type}.${key}`).toEqual([...NEGOTIATION_PARTIES].sort());
    }
  });
});
