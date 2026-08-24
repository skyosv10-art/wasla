import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MARKETPLACE_EVENT_FORBIDDEN_FIELDS, MARKETPLACE_EVENT_PRODUCER, MARKETPLACE_EVENT_TYPES,
  MARKETPLACE_FORBIDDEN_EVENT_TYPES,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(__dirname, "../../../../../services/marketplace/contracts");
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

describe("كتالوج أحداث السوق ↔ events.json", () => {
  it("يمنع نوع حدث مُصدَّراً غائباً أو تعريف حدث غير مُصدَّر", () => {
    expect(eventDefs.map(([, def]) => eventType(def)).sort()).toEqual([...MARKETPLACE_EVENT_TYPES].sort());
  });
  it("يمنع منتجاً غير خدمة السوق في كل غلاف حدث", () => {
    for (const [, def] of eventDefs) {
      expect(property(def, "producer")?.const, eventType(def)).toBe(MARKETPLACE_EVENT_PRODUCER);
    }
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
   * لماذا هذا الحارس: السعرُ بيانُ كتالوجٍ يُقرأ من المورد (القرار 4)، والنصُّ الحرُّ يملكه
   * المورد وحده (القرار 10)؛ ومستهلكٌ يحفظ السعرَ من حدثٍ يعرض على المشتري رقماً لا وجودَ له.
   * النسخة الخاطئة الأرخص: منعُها في حمولةٍ واحدةٍ وتركُها تتسرّب في تعريف data آخر.
   */
  it("يمنع أي حقل محرّم من كل properties في ملف الأحداث تكرارياً", () => {
    const keys = allPropertyKeys(events);
    for (const forbidden of MARKETPLACE_EVENT_FORBIDDEN_FIELDS) expect(keys, forbidden).not.toContain(forbidden);
  });
  /**
   * لماذا هذا الحارس: الظهورُ اقترانُ أربعةِ شروطٍ مُشتَقٍّ عند القراءة (القرار 3)، وحدثٌ
   * يعلنه يحتاج نقيضَه عند كلِّ إيقافِ متجرٍ وكلِّ نزولٍ للكميّةِ إلى صفر.
   * النسخة الخاطئة الأرخص: `product_became_visible` «ليُبني عليه الفهرس» فيتباعد الفهرسُ عن الحقيقة.
   */
  it("يمنع تعريف حدث ظهور أو حذف أو حجز أو مال في العقد", () => {
    const declaredConsts = [...raw.matchAll(/"const"\s*:\s*"([^"]+)"/g)].map((match) => match[1]!);
    for (const forbidden of MARKETPLACE_FORBIDDEN_EVENT_TYPES) {
      expect([...MARKETPLACE_EVENT_TYPES], forbidden).not.toContain(forbidden as never);
      expect(declaredConsts, forbidden).not.toContain(forbidden);
    }
  });
  /**
   * لماذا هذا الحارس: القرارُ بلا الحالةِ السابقةِ والتسلسلِ لا يمكن ترتيبه ولا تفسيرُه بعد
   * إعادةِ التسليم، فيصير دفترُ الاعتدالِ سرداً لا يُعاد بناؤه.
   * النسخة الخاطئة الأرخص: نشر «صار approved» فقط ثم إرغام كل مستهلك على حفظ نسخته السابقة.
   */
  it("يمنع حدث قرارِ متجرٍ بلا من وإلى وتسلسل وفاعل", () => {
    const storeDecisionEvents = ["store_review_requested", "store_approved", "store_rejected", "store_suspended", "store_archived"];
    for (const [, def] of eventDefs.filter(([, item]) => storeDecisionEvents.some((name) => eventType(item) === `marketplace.${name}`))) {
      const data = dataSchema(def);
      for (const key of ["from_state", "to_state", "state_sequence", "actor_type"]) {
        expect(Object.keys(data.properties ?? {}), `${eventType(def)}.${key}`).toContain(key);
        expect(data.required ?? [], `${eventType(def)}.${key}`).toContain(key);
      }
    }
  });
  /**
   * لماذا هذا الحارس: حدثٌ واحدٌ للقرارَين لا حدثان، والقرارُ يُقرأ من `to_state` لا من
   * حقلٍ ثانٍ يقول الشيءَ نفسَه؛ وحقلان لمعنىً واحدٍ يفترقان أولَ مرّةٍ يُكتب أحدُهما ويُنسى الآخر.
   * النسخة الخاطئة الأرخص: إضافة `decision` إلى الحمولة «ليقرأها المستهلك أسرع».
   */
  it("يمنع حدث اعتدالِ منتجٍ بلا تسلسل اعتدال وحالة وفاعل", () => {
    const def = eventDefs.find(([, item]) => eventType(item) === "marketplace.product_moderated")?.[1];
    expect(def, "marketplace.product_moderated يجب أن يوجد").toBeDefined();
    const data = dataSchema(def!);
    for (const key of ["from_state", "to_state", "moderation_sequence", "actor_type"]) {
      expect(data.required ?? [], key).toContain(key);
    }
    // السببُ موجودٌ واختياريٌّ: رفضٌ بلا سببٍ مُقفلٍ لا يُقاس ولا يُقال لصاحب المنتج.
    expect(Object.keys(data.properties ?? {})).toContain("reason_code");
    // ولا `decision` في الحمولة: `to_state` وحدَه يحمل القرار.
    expect(Object.keys(data.properties ?? {})).not.toContain("decision");
  });
  /**
   * لماذا هذا الحارس: فرقُ مخزونٍ بلا رصيدٍ ناتجٍ يجعل كلَّ مستهلكٍ يجمع الفروقَ بنفسه،
   * فأوّلُ حدثٍ يفوته يترك رقماً خاطئاً لا يُكتشف.
   * النسخة الخاطئة الأرخص: نشرُ الفرقِ وحدَه اقتصاداً في الحمولة.
   */
  it("يمنع حدث فرق مخزون بلا فرق موقّع ورصيد ناتج", () => {
    const def = eventDefs.find(([, item]) => eventType(item) === "marketplace.inventory_adjusted")?.[1];
    expect(def, "marketplace.inventory_adjusted يجب أن يوجد").toBeDefined();
    const data = dataSchema(def!);
    for (const key of ["quantity_delta", "quantity_after", "reason_code", "adjustment_sequence"]) {
      expect(data.required ?? [], key).toContain(key);
    }
  });
});
