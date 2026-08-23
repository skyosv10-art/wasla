/**
 * حارسُ انحرافِ قارئِ الأحداث عن عقدِ محرّك الطلب.
 *
 * هذا الاختبارُ هو الوعدُ المكتوبُ في ترويسة `inbound/source-events.ts`، وبلا وجودِه
 * تكون تلك الترويسةُ دعوى. يقرأ `services/orders/contracts/events.json` **وقتَ التشغيل**
 * ويقارن حقلاً بحقل: كلُّ حقلٍ إلزاميٍّ في العقد يُقرأ عندنا، وكلُّ ما نقرؤه موجودٌ في
 * العقد، وكلُّ قيمةٍ مُعدودةٍ نُفرّعها مُعلَنةٌ هناك.
 *
 * ## لِمَ يُقرأ الملفُّ ولا تُنسَخ قائمةٌ
 *
 * السؤالُ الذي يحكم هذا الملفّ: ماذا يحدث يومَ يُضيف فريقُ الطلب حالةً نهائيّةً جديدة
 * أو يُعيد تسميةَ حقل؟ الجوابُ الوحيدُ المقبول: **يسقط البناءُ عندنا**. وقائمةٌ منسوخةٌ
 * بأيدينا كانت ستُجيب «لا شيء»: تبقى صحيحةً في نظر نفسِها إلى الأبد، ويُكتشف الانحرافُ
 * أوّلَ مرّةٍ في الإنتاج على شكلِ حدثٍ يُهمَل بصمتٍ أو يُرفَض بـ`400` لا يفهمه أحد.
 *
 * ولا يعبُر هذا الاستيرادُ حدَّ الخدمة: قراءةُ ملفِّ عقدٍ من القرص في **اختبار** ليست
 * استدعاءً متزامناً ولا مفتاحاً أجنبيّاً (ADR-014). و`purity.test.ts` يمنع الاستيرادَ
 * من `services/` في `src/` خارج `__tests__/` بعينه لهذا السبب: الحدُّ يُحرَس في الكود،
 * والعقدُ يُقارَن في الاختبار.
 *
 * Scope: خدمة السمعة · حرسُ عقدِ الأحداث الواردة
 * Last Updated: 2026-08-23
 * Status: Active
 * Related Code: src/inbound/source-events.ts · services/orders/contracts/events.json
 * Related Team: Reputation & Trust
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { REPUTATION_SOURCE_EVENT_TYPES } from "@wasla/contracts-reputation";

import {
  ORDER_ASSIGNMENT_STATES,
  ORDER_REPUTABLE_STATUSES,
  ORDER_SOURCE_EVENT_TYPES,
  parseSourceEvent,
} from "../inbound/source-events.js";
import { UNOWNED_TERMINAL_STATUSES } from "../inbound/translate.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const CONTRACT_PATH = path.join(REPO_ROOT, "services", "orders", "contracts", "events.json");

interface JsonSchemaNode {
  readonly type?: string;
  readonly required?: readonly string[];
  readonly properties?: Record<string, JsonSchemaNode>;
  readonly enum?: readonly string[];
  readonly $ref?: string;
}

const CONTRACT = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as {
  readonly $defs: Record<string, JsonSchemaNode>;
};

function def(name: string): JsonSchemaNode {
  const node = CONTRACT.$defs[name];
  if (node === undefined) {
    throw new Error(`عقدُ الطلب لم يعد يُعرّف ${name} — انحرافُ عقدٍ لا عطلُ اختبار`);
  }
  return node;
}

function propertyNames(node: JsonSchemaNode): readonly string[] {
  return Object.keys(node.properties ?? {});
}

describe("عقدُ محرّك الطلب موجودٌ ويُقرأ من القرص", () => {
  it("الملفُّ في مكانه وفيه التعريفاتُ الثلاثة", () => {
    /**
     * لو نُقل الملفُّ أو أُعيد هيكلتُه فالاختبارُ يسقط هنا برسالةٍ تقول أين يُبحَث —
     * وذاك أفضلُ من أن تمرّ بقيّةُ الاختبارات على كائنٍ فارغٍ فتُصبح كلُّها بلا معنى.
     */
    expect(def("EventEnvelope").properties).toBeDefined();
    expect(def("OrderStatusChangedV1").properties).toBeDefined();
    expect(def("OrderAssignmentResolvedV1").properties).toBeDefined();
  });
});

describe("المغلَّفُ: كلُّ حقلٍ إلزاميٍّ عند المصدر يُقرأ عندنا", () => {
  /**
   * لا نقرأ **كلَّ** حقول المغلَّف: `producer` و`aggregate` لا يُغيّران قراراً في السمعة،
   * وقراءتُهما كانت ستُلزمنا بشكلٍ لا نستعمله. ولذلك القائمةُ صريحةٌ ومُبرَّرة، والاختبارُ
   * يؤكّد أنّ ما **نستعمله** ما زال موجوداً وإلزاميّاً — لا أنّنا نستعمل كلَّ شيء.
   */
  const CONSUMED = ["event_id", "event_type", "event_version", "occurred_at", "trace_id"] as const;

  it("الحقولُ التي نقرؤها ما زالت مُعرَّفةً في المغلَّف", () => {
    const names = propertyNames(def("EventEnvelope"));
    for (const field of CONSUMED) expect(names).toContain(field);
  });

  it("والحقولُ الأربعةُ التي نُلزم بها إلزاميّةٌ عند المصدر أيضاً", () => {
    /**
     * `trace_id` ليس إلزاميّاً في العقد، ولذلك يُقرأ عندنا `string | null` لا نصّاً
     * مضموناً — والاختبارُ يُثبّت هذا الفرق بدل أن يتركه فهماً شفويّاً.
     */
    const required = def("EventEnvelope").required ?? [];
    expect(required).toContain("event_id");
    expect(required).toContain("event_type");
    expect(required).toContain("event_version");
    expect(required).toContain("occurred_at");
    expect(required).not.toContain("trace_id");
  });
});

describe("order.status_changed: الحقولُ والحالات", () => {
  const schema = def("OrderStatusChangedV1");

  it("كلُّ حقلٍ نقرؤه من الحمولة مُعرَّفٌ في العقد", () => {
    const names = propertyNames(schema.properties?.["data"] ?? {});
    for (const field of [
      "order_public_id",
      "customer_public_id",
      "to_status",
      "sequence",
      "reason_code",
      "actor_type",
      "driver_public_id",
    ]) {
      expect(names).toContain(field);
    }
  });

  it("والإلزاميُّ عندنا إلزاميٌّ عندهم، والاختياريُّ اختياريّ", () => {
    const required = schema.properties?.["data"]?.required ?? [];
    for (const field of ["order_public_id", "customer_public_id", "to_status", "sequence", "actor_type"]) {
      expect(required).toContain(field);
    }
    /**
     * `driver_public_id` اختياريٌّ عند المصدر، وهذا بعينه سببُ وجود
     * `driver_absent_in_payload` في أسباب الإهمال. فلو صار إلزاميّاً يوماً لسقط هذا
     * السطرُ ولوجب حينئذٍ حذفُ ذلك السبب لا الإبقاء عليه ميّتاً.
     */
    expect(required).not.toContain("driver_public_id");
    expect(required).not.toContain("reason_code");
  });

  it("كلُّ حالةٍ نُترجمها أو نُهملها بالاسم مُعلَنةٌ في تعداد العقد", () => {
    /**
     * هذا أهمُّ سطرٍ في الملفّ. `ORDER_REPUTABLE_STATUSES` و`UNOWNED_TERMINAL_STATUSES`
     * أسماءٌ كتبناها بأيدينا، وحرفٌ واحدٌ زائدٌ فيها يُنتج فرعاً لا يُدخَل أبداً: الحدثُ
     * يُهمَل بـ`status_not_reputable` بصمتٍ، ولا سمعةَ تُحتسب، ولا اختبارَ يشتكي.
     */
    const statuses = def("OrderStatus").enum ?? schema.properties?.["data"]?.properties?.["to_status"]?.enum ?? [];
    expect(statuses.length).toBeGreaterThan(0);
    for (const status of ORDER_REPUTABLE_STATUSES) expect(statuses).toContain(status);
    for (const status of UNOWNED_TERMINAL_STATUSES) expect(statuses).toContain(status);
  });

  it("ولا حالةَ نهائيّةً في العقد بلا قرارٍ مكتوبٍ عندنا", () => {
    /**
     * الاتجاهُ المعاكس، وهو ما يجعل الحارسَ حارساً: حالةٌ نهائيّةٌ جديدةٌ تُضاف عند
     * فريق الطلب يجب أن تُصنَّف عندنا صريحاً — تُترجَم واقعةً أو تُهمَل مملوكةً لا أحد.
     * وبلا هذا السطر كانت ستمرّ إلى `status_not_reputable` وهو الفرعُ المُعَدّ لحالات
     * **الرحلة** لا للنهائيّات، فتُقرأ اللوحةُ خطأً ولا يُلاحَظ أحدٌ شيئاً.
     */
    const TERMINAL_IN_CONTRACT = [
      "completed",
      "customer_cancelled",
      "driver_cancelled",
      "expired",
      "no_driver_found",
      "driver_rejected",
      "driver_timeout",
      "partner_cancelled",
      "blocked",
      "failed",
      "payment_disputed",
      "under_review",
    ] as const;
    const classified = new Set<string>([
      ...ORDER_REPUTABLE_STATUSES,
      ...UNOWNED_TERMINAL_STATUSES,
    ]);
    const statuses = def("OrderStatus").enum ?? [];
    for (const status of TERMINAL_IN_CONTRACT) {
      expect(statuses, `${status} اختفى من عقد الطلب`).toContain(status);
      expect(classified.has(status), `${status} نهائيّةٌ بلا قرارٍ مكتوب`).toBe(true);
    }
  });
});

describe("order.assignment_resolved: الحقولُ والنتائج", () => {
  const schema = def("OrderAssignmentResolvedV1");

  it("كلُّ حقلٍ نقرؤه مُعرَّفٌ في العقد، والإلزاميُّ إلزاميّ", () => {
    const data = schema.properties?.["data"] ?? {};
    const names = propertyNames(data);
    for (const field of [
      "order_public_id",
      "driver_public_id",
      "sequence",
      "assignment_state",
      "reason_code",
      "resolved_at",
    ]) {
      expect(names).toContain(field);
    }
    const required = data.required ?? [];
    for (const field of ["order_public_id", "driver_public_id", "sequence", "assignment_state", "resolved_at"]) {
      expect(required).toContain(field);
    }
    expect(required).not.toContain("reason_code");
  });

  it("نتائجُ الإسناد الأربعةُ هي نفسُها في الجهتين — لا زيادةَ ولا نقصان", () => {
    /**
     * هنا تُفحَص المساواةُ لا الاحتواء، لأنّ الاثنين مؤذيان: نتيجةٌ عندنا لا عندهم فرعٌ
     * ميّت، ونتيجةٌ عندهم لا عندنا حدثٌ يُرفَض `400` عند حدِّ القراءة فيُعاد تسليمُه إلى
     * الأبد بلا أن يُسجَّل شيء.
     */
    const states = schema.properties?.["data"]?.properties?.["assignment_state"]?.enum ?? [];
    expect([...states].sort()).toEqual([...ORDER_ASSIGNMENT_STATES].sort());
  });
});

describe("أنواعُ الأحداث تُطابق حزمةَ العقود", () => {
  it("ما نقرؤه = ما تُعلنه `@wasla/contracts-reputation`", () => {
    /**
     * ثلاثةُ مصادرَ لاسمِ نوعِ الحدث: حزمةُ العقود، وقارئُنا، وعقدُ الطلب. واتّفاقُ
     * اثنين منها لا يكفي: الحزمةُ هي ما يُعلَن للمستهلكين، والقارئُ هو ما يُنفَّذ فعلاً.
     */
    expect([...ORDER_SOURCE_EVENT_TYPES].sort()).toEqual([...REPUTATION_SOURCE_EVENT_TYPES].sort());
  });

  it("ونوعٌ غيرُ معروفٍ يُردّ `unsupported` لا يُرفَع خطأً", () => {
    /**
     * سطرُ ربطٍ لا سطرُ عقد: من يربط الناقلَ سيسمع على موضوعٍ فيه أحداثُ خدماتٍ أخرى،
     * وحدثٌ لا يعنينا يجب أن يُستهلَك ويُسقَط — لا أن يُرفَع خطأً فيُعاد تسليمُه أبداً.
     */
    const parsed = parseSourceEvent({ event_type: "order.published", data: {} });
    expect(parsed.kind).toBe("unsupported");
  });
});
