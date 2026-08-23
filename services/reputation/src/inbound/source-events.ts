/**
 * شكلُ حدثِ محرّك الطلب على السلك، والتحقُّقُ منه عند الحدّ (الطور 09 · المراجعة 5/6).
 *
 * ## لماذا نسخةٌ من الشكل ولا استيرادٌ من `@wasla/orders-service`
 *
 * ADR-014 يمنع استيراداً يعبر حدَّ الخدمة، و`purity.test.ts` يحرسه نصّاً. والسببُ ليس
 * تجميلاً معماريّاً: استيرادُ نوعٍ من محرّك الطلب كان سيجعل ترقيةَ حزمةٍ في خدمةٍ أخرى
 * تُفشل بناءَ السمعة، وكان سيُغري باستيراد دالّةٍ بعد النوع ثمّ مستودعٍ بعد الدالّة.
 *
 * والمصدرُ الحقيقيُّ لهذه الأنواع ليس هذا الملفَّ ولا حزمةَ المحرّك، بل
 * `services/orders/contracts/events.json` — والوثيقةُ
 * `docs/02-architecture/REPUTATION_SOURCE_EVENTS.md` §الانحرافات تُسمّي هذا التكرارَ
 * صريحاً وتقول ثمنَه: عقدُ المحرّك لو تغيّر فلن يُفشل هذا الملفَّ ترجمةً، وإنّما يُفشله
 * `source-events-drift.test.ts` الذي يقرأ `events.json` من القرص ويُقارن الحقلَ بالحقل.
 * حارسٌ يقرأ العقدَ أصدقُ من `import` يقرأ نوعاً: الأوّلُ يفشل حين يتغيّر العقد، والثاني
 * يفشل حين تتغيّر حزمةٌ — وليسا الشيءَ نفسَه.
 *
 * ## ولماذا تحقُّقٌ عند الحدّ ولم تكفِ حرّاسُ المجال
 *
 * `assertSourceEventId` في `domain/validation.ts` تقبل أيَّ نصٍّ غيرِ فارغ، وعمودُ
 * `source_event_id` في `contracts/schema.sql` سطر 181 من نوع **`UUID`**. فمُعرّفٌ مُركّبٌ
 * من جنس `c-ORD-000123-7` يمرّ من كلِّ اختبارِ ذاكرةٍ ثمّ يسقط على PostgreSQL بـSQLSTATE
 * `22P02` بلا اسمِ قيدٍ يُترجَم — أي بخطأٍ لا يقول أين وُلد. وهذا الملفُّ هو الموضعُ
 * الذي يُمسك ذلك: مَن يدخل من هنا معرّفُه UUID أو يُرفَض باسمٍ عند الباب.
 *
 * ولا يُصلح المجالُ نفسُه: تضييقُ `assertSourceEventId` إلى UUID كان سيُبطل
 * `POST /reputation/facts` لمُرسِلٍ يملك مُعرّفاً غيرَ UUID وهو مسموحٌ له بالعقد
 * (`api.openapi.yml` لا يشترط الصيغة)، وتضييقُ حرسٍ قائمٍ يحتاج ADR لا سطراً.
 *
 * Scope: خدمة السمعة · حدُّ الدخول من محرّك الطلب
 * Last Updated: 2026-08-23
 * Status: Active
 * Related Code: services/orders/contracts/events.json · src/inbound/translate.ts
 * Related Team: Reputation & Trust
 */

import { validationFailed } from "../domain/errors.js";
import { assertOrderPublicId, assertWaslaPublicId } from "../domain/validation.js";
import { assertTimestamp } from "../domain/time.js";

/**
 * نوعا الحدثِ الوحيدان الذان تستهلكهما السمعة، وهما بعينهما
 * `REPUTATION_SOURCE_EVENT_TYPES` في العقد.
 *
 * وأيُّ نوعٍ آخر يصل ليس خطأً بل **مُهمَلٌ مُسمّى** (انظر `translate.ts`): ناقلٌ يُسلّم
 * كلَّ أحداث المحرّك إلى كلِّ مشتركٍ أمرٌ عاديّ، ومستهلكٌ يرفع خطأً على حدثٍ لا يعنيه
 * يُنتج ضجيجاً يُغطّي أوّلَ خطأٍ حقيقيّ.
 */
export const ORDER_SOURCE_EVENT_TYPES = ["order.status_changed", "order.assignment_resolved"] as const;

export type OrderSourceEventType = (typeof ORDER_SOURCE_EVENT_TYPES)[number];

/** حالاتُ الطلب التي تعنينا وحدها — لا نسخةَ للجدول كلِّه (انظر `translate.ts`). */
export const ORDER_REPUTABLE_STATUSES = ["completed", "customer_cancelled", "driver_cancelled"] as const;

/** نتائجُ عرضِ الإسناد كما يُعلنها `OrderAssignmentResolvedV1`. */
export const ORDER_ASSIGNMENT_STATES = ["accepted", "rejected", "expired", "cancelled"] as const;

export type OrderAssignmentState = (typeof ORDER_ASSIGNMENT_STATES)[number];

/**
 * المغلّفُ الموحّد كما في `events.json` §`EventEnvelope` — وما نقرؤه منه فقط.
 *
 * `producer` و`aggregate` موجودان في العقد ولا يُستعملان في الترجمة، فلا نُعيد تعريفهما
 * هنا: نسخةٌ من حقلٍ لا يُقرأ تتخلّف بصمتٍ ولا يُفشلها شيء. وحارسُ الانحراف يُثبت أنّ
 * ما نقرؤه **موجودٌ** في العقد، لا أنّ العقدَ لا يزيد عليه.
 */
export interface OrderEventEnvelope {
  readonly event_id: string;
  readonly event_type: string;
  readonly event_version: string;
  readonly occurred_at: string;
  readonly trace_id: string | null;
}

export interface OrderStatusChangedEvent extends OrderEventEnvelope {
  readonly event_type: "order.status_changed";
  readonly data: {
    readonly order_public_id: string;
    readonly customer_public_id: string;
    readonly to_status: string;
    readonly sequence: number;
    readonly reason_code: string | null;
    readonly actor_type: string;
    readonly driver_public_id: string | null;
  };
}

export interface OrderAssignmentResolvedEvent extends OrderEventEnvelope {
  readonly event_type: "order.assignment_resolved";
  readonly data: {
    readonly order_public_id: string;
    readonly driver_public_id: string;
    readonly sequence: number;
    readonly assignment_state: OrderAssignmentState;
    readonly reason_code: string | null;
    readonly resolved_at: string;
  };
}

export type OrderSourceEvent = OrderStatusChangedEvent | OrderAssignmentResolvedEvent;

/**
 * نتيجةُ قراءةِ حمولةٍ خام.
 *
 * `unsupported` ليست فشلاً: هي الجوابُ على حدثٍ صحيحٍ لا يعنينا، وتحملُ نوعَه كي يُسجّله
 * من يُشغّل المستهلك بلا أن يُفسّره خطأً. و`invalid` فشلٌ باسمِ حقلٍ ومتوقَّعٍ منه، لأنّ
 * «حمولة غير صالحة» بلا اسمِ حقلٍ تُنتج تحقيقاً يدويّاً في سجلٍّ من ألف سطر.
 */
export type SourceEventParse =
  | { readonly kind: "event"; readonly event: OrderSourceEvent }
  | { readonly kind: "unsupported"; readonly eventType: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * مُعرّفُ الحدث: UUID أو رفضٌ عند الباب.
 *
 * الحرسُ هنا لا في المجال، والسببُ في ترويسة الملفّ: عمودُ `source_event_id` من نوع
 * `UUID`، والقبولُ ثمّ الفشلُ في القاعدة يُنتج `22P02` بلا اسمِ قيد.
 */
function assertEventUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw validationFailed(field, "uuid");
  }
  return value;
}

function assertEventVersion(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^v[0-9]+$/.test(value)) {
    throw validationFailed(field, "version matching ^v[0-9]+$");
  }
  return value;
}

/** نصٌّ اختياريٌّ بطولٍ محدود — `trace_id` و`reason_code` كلاهما كذا في العقد. */
function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw validationFailed(field, `string with length 1..${maxLength}`);
  }
  return value;
}

function assertObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validationFailed(field, "object");
  }
  return value as Record<string, unknown>;
}

function assertSequence(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw validationFailed(field, "integer >= 1");
  }
  return value as number;
}

function assertNonEmptyText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw validationFailed(field, "non-empty string");
  return value;
}

function assertMemberOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw validationFailed(field, allowed.join("|"));
  }
  return value as T;
}

/**
 * يقرأ حمولةً خام ويُعيد حدثاً مُضيَّقَ النوع، أو يُعلن أنّه غيرُ مدعوم.
 *
 * والترتيبُ مقصود: نوعُ الحدث **أوّلاً** قبل أيِّ حقلٍ آخر. فحدثٌ لا يعنينا يخرج بـ
 * `unsupported` بلا أن نتحقّق من حقولٍ لا نقرؤها ولا نملك عقدَها — ولو انعكس الترتيب
 * لصار كلُّ حدثٍ في المنصّة يُرفَض من السمعة بـ400 لأنّ حمولتَه ليست حمولتَنا.
 */
export function parseSourceEvent(raw: unknown): SourceEventParse {
  const envelope = assertObject(raw, "event");
  const eventType = assertNonEmptyText(envelope["event_type"], "event.event_type");
  if (!(ORDER_SOURCE_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return { kind: "unsupported", eventType };
  }

  const head = {
    event_id: assertEventUuid(envelope["event_id"], "event.event_id"),
    event_version: assertEventVersion(envelope["event_version"], "event.event_version"),
    occurred_at: assertTimestamp(envelope["occurred_at"], "event.occurred_at"),
    trace_id: optionalText(envelope["trace_id"], "event.trace_id", 128),
  } as const;

  const data = assertObject(envelope["data"], "event.data");

  if (eventType === "order.status_changed") {
    return {
      kind: "event",
      event: {
        ...head,
        event_type: "order.status_changed",
        data: {
          order_public_id: assertOrderPublicId(data["order_public_id"], "event.data.order_public_id"),
          customer_public_id: assertWaslaPublicId(
            data["customer_public_id"],
            "event.data.customer_public_id",
          ),
          to_status: assertNonEmptyText(data["to_status"], "event.data.to_status"),
          sequence: assertSequence(data["sequence"], "event.data.sequence"),
          reason_code: optionalText(data["reason_code"], "event.data.reason_code", 64),
          actor_type: assertNonEmptyText(data["actor_type"], "event.data.actor_type"),
          /**
           * السائقُ اختياريٌّ في هذا الحدث بالعقد، وغيابُه ليس خطأً: طلبٌ يُلغيه العميل
           * قبل الإسناد لا سائقَ له. ومَن يقرؤه يقرأ `null` صريحاً لا نصّاً فارغاً.
           */
          driver_public_id:
            data["driver_public_id"] === null || data["driver_public_id"] === undefined
              ? null
              : assertWaslaPublicId(data["driver_public_id"], "event.data.driver_public_id"),
        },
      },
    };
  }

  return {
    kind: "event",
    event: {
      ...head,
      event_type: "order.assignment_resolved",
      data: {
        order_public_id: assertOrderPublicId(data["order_public_id"], "event.data.order_public_id"),
        /** إلزاميٌّ هنا بخلاف الحدث الأوّل: عرضُ إسنادٍ بلا سائقٍ لا معنى له. */
        driver_public_id: assertWaslaPublicId(data["driver_public_id"], "event.data.driver_public_id"),
        sequence: assertSequence(data["sequence"], "event.data.sequence"),
        assignment_state: assertMemberOf(
          data["assignment_state"],
          ORDER_ASSIGNMENT_STATES,
          "event.data.assignment_state",
        ),
        reason_code: optionalText(data["reason_code"], "event.data.reason_code", 64),
        resolved_at: assertTimestamp(data["resolved_at"], "event.data.resolved_at"),
      },
    },
  };
}
