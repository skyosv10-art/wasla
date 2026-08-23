import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRAUD_RULE_CODES, REPUTATION_EVENT_FORBIDDEN_FIELDS, REPUTATION_EVENT_TYPES,
  REPUTATION_FACT_KINDS, REPUTATION_FORBIDDEN_EVENT_TYPES, REPUTATION_RATING_REASON_CODES,
  REPUTATION_RECOMPUTE_TRIGGERS, REPUTATION_SUBJECT_TYPES, REPUTATION_TIERS,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(__dirname, "../../../../../services/reputation/contracts");
const raw = readFileSync(resolve(CONTRACTS_DIR, "events.json"), "utf8");
const events = JSON.parse(raw) as { $defs: Record<string, unknown> };

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
function byType(type: string): Def {
  const found = eventDefs.find(([, d]) => constEventType(d) === type);
  expect(found, `${type} must be declared`).toBeDefined();
  return found![1];
}
function keysOf(type: string): string[] {
  return Object.keys(dataSchema(byType(type)).properties ?? {});
}
/**
 * يحلّ `$ref` داخليّاً كي يقارن الحارس تعداداً بتعداد لا مرجعاً بنصّ، ويفتح غلاف
 * `oneOf` للحقل الذي يقبل `null`: الاختيارية شكلٌ لا تُغيّر مفردات التعداد.
 */
function resolve$ref(node: unknown): { enum?: string[] } {
  const n = node as { $ref?: string; enum?: string[]; oneOf?: unknown[]; anyOf?: unknown[] };
  if (typeof n?.$ref === "string") {
    const key = n.$ref.replace("#/$defs/", "");
    expect(Object.keys(defs), n.$ref).toContain(key);
    return defs[key] as never;
  }
  const branches = n?.oneOf ?? n?.anyOf;
  if (Array.isArray(branches)) {
    for (const branch of branches) {
      const b = branch as { $ref?: string; enum?: string[]; type?: string };
      if (b?.type === "null") continue;
      if (typeof b?.$ref === "string" || Array.isArray(b?.enum)) return resolve$ref(branch);
    }
  }
  return n ?? {};
}
function enumOf(type: string, key: string): string[] | undefined {
  return resolve$ref((dataSchema(byType(type)).properties as Record<string, unknown>)[key]).enum;
}
/** كل مفاتيح كل الحمولات، للحارس السالب على الحقول الممنوعة. */
function allDataKeys(): Array<[string, string]> {
  return eventDefs.flatMap(([, def]) =>
    Object.keys(dataSchema(def).properties ?? {}).map((key) => [constEventType(def), key] as [string, string]),
  );
}

describe("reputation event catalog ↔ events.json", () => {
  it("declares every exported event type and no undeclared type", () => {
    expect(eventDefs.map(([, d]) => constEventType(d)).sort()).toEqual([...REPUTATION_EVENT_TYPES].sort());
  });
  it("keeps event types unique", () => {
    expect(new Set(REPUTATION_EVENT_TYPES).size).toBe(REPUTATION_EVENT_TYPES.length);
  });
  it("namespaces every event under reputation.", () => {
    for (const type of REPUTATION_EVENT_TYPES) expect(type).toMatch(/^reputation\.[a-z_]+$/);
  });
  it("names reputation-service as the only producer", () => {
    expect(raw).toContain('"reputation-service"');
    for (const other of ["orders-service", "dispatch-service", "drivers-service", "matching-service"]) {
      expect(raw, other).not.toContain(`"${other}"`);
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

describe("ADR-014 decision 7: no event punishes", () => {
  /**
   * الحارس يقرأ **قيَم `const` وحدها** لا نصّ الملفّ: الكتالوج يشرح صراحةً **لماذا لا
   * يوجد** `reputation.subject_suspended`، وحارسٌ يقرأ الشرح يجعل أقرب إصلاحٍ حذفَ
   * التوضيح لا حذفَ التسريب. الحدّ يُفرض على العقد، والتفسير حرّ.
   */
  it("declares no suspension, ban or verdict event", () => {
    const declaredConsts = [...raw.matchAll(/"const"\s*:\s*"([^"]+)"/g)].map((m) => m[1]!);
    for (const forbidden of REPUTATION_FORBIDDEN_EVENT_TYPES) {
      expect([...REPUTATION_EVENT_TYPES], forbidden).not.toContain(forbidden as never);
      expect(declaredConsts, forbidden).not.toContain(forbidden as never);
    }
  });
  /** الإشارة ملاحظةٌ تشرح نفسها: لا قرار ولا توصيةَ عقوبة في حمولتها. */
  it("raises a fraud signal as an observation, never as a decision", () => {
    const keys = keysOf("reputation.fraud_signal_raised");
    for (const key of ["observed_count", "threshold_count", "rule_code", "window_started_at", "window_ended_at"]) {
      expect(keys, key).toContain(key);
    }
    for (const forbidden of ["state", "resolution", "decision", "action", "penalty", "is_fraudster", "confirmed"]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });
});

describe("ADR-014 decision 9: an event says what changed, never who the person is", () => {
  it("lets no forbidden field enter any payload", () => {
    for (const [type, key] of allDataKeys()) {
      expect([...REPUTATION_EVENT_FORBIDDEN_FIELDS], `${type}.${key}`).not.toContain(key as never);
    }
  });
  /** درجةٌ ورمزُ سبب يعبران لأنّهما هما ما تغيّر؛ ولا تعليق نصّي في العقد أصلاً (القرار 5). */
  it("measures a rating instead of quoting it", () => {
    const keys = keysOf("reputation.rating_submitted");
    expect(keys).toContain("stars");
    expect(keys).toContain("reason_code");
    for (const forbidden of ["comment", "review_text", "body", "text"]) expect(keys, forbidden).not.toContain(forbidden);
  });
});

describe("ADR-014 decisions 2 · 3 · 4: a payload must be reproducible", () => {
  /** واقعةٌ بلا مصدرٍ وترتيبٍ لا يمكن التحقّق منها ولا كشفُ تكرارها. */
  it("carries the source event and its per-order sequence on every fact", () => {
    const keys = keysOf("reputation.fact_recorded");
    for (const key of ["source_event_type", "source_event_id", "source_sequence", "order_public_id", "fact_kind"]) {
      expect(keys, key).toContain(key);
    }
  });
  /** نتيجةٌ بلا نسخةِ قواعد لا تُفسَّر بعد شهرين ولا تُقارَن بنتيجةٍ أخرى. */
  it("stamps the ruleset version on every derived payload", () => {
    for (const type of [
      "reputation.score_recomputed", "reputation.tier_changed",
      "reputation.rating_submitted", "reputation.fraud_signal_raised",
    ]) expect(keysOf(type), type).toContain("ruleset_version");
  });
  /** «تغيّر إلى 62» بلا «من 71» يُجبر كل مستهلك أن يحفظ نسخته، ونسخةٌ تتباعد بصمت. */
  it("carries the previous value wherever something changed", () => {
    expect(keysOf("reputation.score_recomputed")).toContain("previous_score_points");
    expect(keysOf("reputation.tier_changed")).toContain("from_tier");
  });
  it("says why a score was recomputed", () => {
    expect(keysOf("reputation.score_recomputed")).toContain("trigger");
  });
});

describe("reputation event enums ↔ exported constants", () => {
  it("keeps the fact kinds identical to the exported constant", () => {
    expect(enumOf("reputation.fact_recorded", "fact_kind")?.slice().sort())
      .toEqual([...REPUTATION_FACT_KINDS].sort());
  });
  it("keeps the tiers identical wherever a tier appears", () => {
    expect(enumOf("reputation.score_recomputed", "tier")?.slice().sort()).toEqual([...REPUTATION_TIERS].sort());
    expect(enumOf("reputation.tier_changed", "to_tier")?.slice().sort()).toEqual([...REPUTATION_TIERS].sort());
  });
  it("keeps the recompute triggers identical to the exported constant", () => {
    expect(enumOf("reputation.score_recomputed", "trigger")?.slice().sort())
      .toEqual([...REPUTATION_RECOMPUTE_TRIGGERS].sort());
  });
  it("keeps the rating reason codes identical to the exported constant", () => {
    expect(enumOf("reputation.rating_submitted", "reason_code")?.slice().sort())
      .toEqual([...REPUTATION_RATING_REASON_CODES].sort());
  });
  it("keeps the fraud rule codes identical to the exported constant", () => {
    expect(enumOf("reputation.fraud_signal_raised", "rule_code")?.slice().sort())
      .toEqual([...FRAUD_RULE_CODES].sort());
  });
  it("names only the two measured sides wherever a subject appears", () => {
    for (const type of REPUTATION_EVENT_TYPES) {
      const keys = keysOf(type);
      if (!keys.includes("subject_type")) continue;
      expect(enumOf(type, "subject_type")?.slice().sort(), type).toEqual([...REPUTATION_SUBJECT_TYPES].sort());
    }
  });
});
