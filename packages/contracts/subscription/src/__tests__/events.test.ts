import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUBSCRIPTION_EVENT_FORBIDDEN_FIELDS, SUBSCRIPTION_EVENT_PRODUCER, SUBSCRIPTION_EVENT_TYPES,
  SUBSCRIPTION_FORBIDDEN_EVENT_TYPES,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(__dirname, "../../../../../services/subscriptions/contracts");
const raw = readFileSync(resolve(CONTRACTS_DIR, "events.json"), "utf8");
type Node = { $ref?: string; const?: string; properties?: Record<string, Node>; required?: string[]; additionalProperties?: boolean; allOf?: Node[] };
const events = JSON.parse(raw) as { $defs: Record<string, Node> };
const defs = events.$defs;
function deref(node: Node): Node {
  if (!node.$ref) return node;
  const key = node.$ref.replace("#/$defs/", "");
  expect(Object.keys(defs), node.$ref).toContain(key);
  return defs[key]!;
}
function merged(def: Node): Node[] {
  return [def, ...(def.allOf ?? []).flatMap((part) => merged(deref(part)))];
}
function property(def: Node, key: string): Node | undefined {
  for (const part of merged(def)) {
    const value = part.properties?.[key];
    if (value) return deref(value);
  }
  return undefined;
}
const eventDefs = Object.entries(defs).filter(([, def]) => typeof def.properties?.event_type?.const === "string");
function eventType(def: Node): string { return def.properties!.event_type!.const!; }
function dataSchema(def: Node): Node {
  const data = property(def, "data");
  expect(data, `${eventType(def)} يجب أن يملك data`).toBeDefined();
  return data!;
}
function allPropertyKeys(node: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(node)) for (const value of node) allPropertyKeys(value, keys);
  else if (node && typeof node === "object") {
    const value = node as { properties?: Record<string, unknown> };
    if (value.properties) for (const key of Object.keys(value.properties)) keys.add(key);
    for (const child of Object.values(node)) allPropertyKeys(child, keys);
  }
  return keys;
}

describe("كتالوج أحداث الاشتراك ↔ events.json", () => {
  it("يمنع نوع حدث مُصدَّراً غائباً أو تعريف حدث غير مُصدَّر", () => {
    expect(eventDefs.map(([, def]) => eventType(def)).sort()).toEqual([...SUBSCRIPTION_EVENT_TYPES].sort());
  });
  it("يمنع منتجاً غير خدمة الاشتراكات في كل غلاف حدث", () => {
    for (const [, def] of eventDefs) expect(property(def, "producer")?.const, eventType(def)).toBe(SUBSCRIPTION_EVENT_PRODUCER);
  });
  it("يمنع حمولة مفتوحة أو حمولة بلا زمن العمل occurred_for", () => {
    for (const [, def] of eventDefs) {
      const data = dataSchema(def);
      expect(data.additionalProperties, eventType(def)).toBe(false);
      expect(Object.keys(data.properties ?? {}), eventType(def)).toContain("occurred_for");
      expect(data.required ?? [], eventType(def)).toContain("occurred_for");
    }
  });
  /**
   * لماذا هذا الحارس: المال والهوية والنص الحر تملكها حدود أخرى؛ الحدث قابل للاستهلاك بلا ملف شخصي.
   * النسخة الخاطئة الأرخص: منعها في واجهة واحدة وتركها تتسرّب في تعريف data آخر.
   */
  it("يمنع أي حقل محرّم من كل properties في ملف الأحداث تكرارياً", () => {
    const keys = allPropertyKeys(events);
    for (const forbidden of SUBSCRIPTION_EVENT_FORBIDDEN_FIELDS) expect(keys, forbidden).not.toContain(forbidden);
  });
  it("يمنع تعريف نوع حدث عقاب أو رفض أو مال في العقد", () => {
    const declaredConsts = [...raw.matchAll(/"const"\s*:\s*"([^"]+)"/g)].map((match) => match[1]!);
    for (const forbidden of SUBSCRIPTION_FORBIDDEN_EVENT_TYPES) {
      expect([...SUBSCRIPTION_EVENT_TYPES], forbidden).not.toContain(forbidden as never);
      expect(declaredConsts, forbidden).not.toContain(forbidden);
    }
  });
  /**
   * لماذا هذا الحارس: الانتقال بلا الحالة السابقة أو التسلسل لا يمكن ترتيبه أو تفسيره بعد إعادة التسليم.
   * النسخة الخاطئة الأرخص: نشر «صار active» فقط ثم إرغام كل مستهلك على حفظ نسخته السابقة.
   */
  it("يمنع حدث انتقال بلا من وإلى وتسلسل ونسخة خطة", () => {
    for (const [, def] of eventDefs.filter(([, item]) => eventType(item).startsWith("subscription."))) {
      const data = dataSchema(def);
      for (const key of ["from_state", "to_state", "state_sequence", "plan_version"]) {
        expect(Object.keys(data.properties ?? {}), `${eventType(def)}.${key}`).toContain(key);
        expect(data.required ?? [], `${eventType(def)}.${key}`).toContain(key);
      }
    }
  });
});
