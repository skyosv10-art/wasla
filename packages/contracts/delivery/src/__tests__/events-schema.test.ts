/**
 * حارسُ بنيةِ عقدِ الأحداثِ.
 *
 * **لماذا بنيةٌ لا تصديقٌ بمدقّقٍ:** لا مدقّقَ JSON Schema معلَنٌ اعتماداً في هذه
 * الشجرةِ، وإضافةُ اعتمادٍ جديدٍ قرارٌ يمرُّ ببوّابةِ الاعتماديّاتِ (`M0-06`) لا
 * يُتّخذُ عرَضاً في مراجعةٍ تأسيسيّةٍ. فيُختبَرُ هنا **ما كانَ مكسوراً فعلاً**:
 * جذرٌ بلا `oneOf` ولا `required` كانَ يُصدِّقُ وثيقةً فارغةً `{}` وأيَّ غريبٍ.
 * **والحدُّ مُعلَنٌ:** هذا يُثبتُ أنّ العقدَ يَمنعُ، ولا يُثبتُ تصديقَ مثالٍ حيٍّ.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DELIVERY_EVENT_TYPES } from "../index.js";

const schemaPath = fileURLToPath(
  new URL("../../../../../services/delivery/contracts/events.json", import.meta.url),
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, any>;

const ENVELOPE_FIELDS = [
  "event_id",
  "event_type",
  "event_version",
  "occurred_at",
  "producer",
  "aggregate",
];

describe("عقدُ أحداثِ الوفاءِ — البنيةُ حكمٌ", () => {
  it("الجذرُ يختارُ نوعاً واحداً ولا يقبلُ وثيقةً بلا حقولٍ", () => {
    expect(Array.isArray(schema.oneOf)).toBe(true);
    expect(schema.oneOf).toHaveLength(DELIVERY_EVENT_TYPES.length);
    expect(schema.required).toEqual(
      expect.arrayContaining([...ENVELOPE_FIELDS, "data"]),
    );
  });

  it("كلُّ نوعٍ يُركِّبُ المغلَّفَ ويُثبِّتُ نوعَه ونسختَه ويرفضُ الزائدَ", () => {
    for (const type of DELIVERY_EVENT_TYPES) {
      const key = `Event_${type.replace(/\./g, "_")}`;
      const variant = schema.$defs[key];
      expect(variant, key).toBeDefined();
      expect(variant.allOf?.[0]?.$ref).toBe("#/$defs/EventEnvelope");
      expect(variant.properties.event_type.const).toBe(type);
      expect(variant.properties.event_version.const).toBe("v1");
      expect(variant.properties.producer.const).toBe("delivery-service");
      expect(variant.properties.data.$ref).toBe(
        `#/$defs/Payload_${type.replace(/\./g, "_")}`,
      );
      expect(variant.additionalProperties).toBe(false);
      expect(variant.required).toEqual(
        expect.arrayContaining([...ENVELOPE_FIELDS, "data"]),
      );
    }
  });

  it("لم يبقَ في الجذرِ خريطةُ حمولاتٍ اختياريّةٍ — وهي عينُ ما كانَ يُمرِّرُ {}", () => {
    expect(schema.properties).toBeUndefined();
  });

  it("المرجعُ الأجنبيُّ بصيغةِ مالكِه في كلِّ حمولةٍ تحملُه", () => {
    for (const type of DELIVERY_EVENT_TYPES) {
      const payload = schema.$defs[`Payload_${type.replace(/\./g, "_")}`];
      const props = payload.properties ?? {};
      if (props.order_ref) expect(props.order_ref.$ref).toBe("#/$defs/OrderRef");
      if (props.store_ref) expect(props.store_ref.$ref).toBe("#/$defs/StoreRef");
    }
    expect(schema.$defs.OrderRef.pattern).toBe("^ORD-[0-9]{10}$");
    expect(schema.$defs.StoreRef.format).toBe("uuid");
  });

  it("كلُّ حمولةٍ ترفضُ الحقولَ الزائدةَ ولا تحملُ مالاً", () => {
    for (const type of DELIVERY_EVENT_TYPES) {
      const payload = schema.$defs[`Payload_${type.replace(/\./g, "_")}`];
      expect(payload.additionalProperties, type).toBe(false);
      for (const key of Object.keys(payload.properties ?? {})) {
        expect(key).not.toMatch(/amount|price|fee|currency|total|phone|address|lat|lng/);
      }
    }
  });
});
