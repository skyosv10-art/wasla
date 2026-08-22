/**
 * Negotiation & Chat Domain Event types — hand-derived from
 * services/negotiations/contracts/events.json (JSON Schema 2020-12).
 *
 * Drift guards read the canonical schema at test time. ADR-013 decision 6:
 * an event says WHAT changed, never WHAT WAS SAID — no message body, no note
 * attached to an offer, no name, phone, coordinate or channel id ever enters a
 * payload. The amount DOES cross, because the amount **is** the change and a
 * negotiation event without it says nothing.
 */
export type NegotiationAggregateType =
  | "negotiation_thread"
  | "negotiation_round"
  | "negotiation_message";

/** طرفا التفاوض. النظام ليس طرفاً: لا يعرض سعراً ولا يقبله. */
export type NegotiationParty = "customer" | "driver";

/** كاتب الرسالة. `system` هنا ولا يظهر في `NegotiationParty`: النظام يُخبر ولا يساوم. */
export type NegotiationAuthorRole = NegotiationParty | "system";

export type NegotiationServiceKind = "ride" | "delivery";

export type NegotiationLocale = "ar" | "en" | "ur";

export type NegotiationThreadState =
  | "open"
  | "agreed"
  | "declined"
  | "expired"
  | "cancelled";

/** الحالات التي يحملها حدث الإغلاق: `agreed` لها حدثها الخاصّ (`negotiations.agreed`). */
export type NegotiationClosedState = "declined" | "expired" | "cancelled";

export type NegotiationRoundState =
  | "pending"
  | "accepted"
  | "rejected"
  | "superseded"
  | "expired";

/** لا إغلاق بلا سبب مُعدَّد. الأكواد تُقارَن وتُحصى؛ الرسائل تُترجَم وتتغيّر. */
export type NegotiationCloseReasonCode =
  | "agreed"
  | "declined_by_customer"
  | "declined_by_driver"
  | "max_rounds_reached"
  | "thread_expired"
  | "cancelled_by_dispatch"
  | "order_withdrawn";

/**
 * نتيجة محاولة تسليم السعر إلى محرّك الطلب. الفرق بين `rejected` و`unavailable` هو
 * الفرق بين «لا» و«لم يُسمع»: الأولى قرارٌ لا يُعاد سؤاله، والثانية عجزٌ تُعيده النبضة.
 */
export type NegotiationHandoffOutcome = "accepted" | "rejected" | "unavailable";

export type NegotiationHandoffState =
  | "pending"
  | "handed_off"
  | "rejected"
  | "abandoned";

export interface NegotiationEventEnvelope {
  event_id: string;
  event_type: string;
  event_version: string;
  occurred_at: string;
  producer: "negotiations-service";
  aggregate: { type: NegotiationAggregateType; id: string };
  trace_id?: string | null;
}

export interface NegotiationThreadOpenedV1 extends NegotiationEventEnvelope {
  event_type: "negotiations.thread_opened";
  event_version: "v1";
  data: {
    thread_id: string;
    order_public_id: string;
    customer_public_id: string;
    driver_public_id: string;
    dispatch_offer_id?: string;
    service_kind: NegotiationServiceKind;
    opened_by: NegotiationParty;
    opening_amount_minor: number;
    currency: string;
    policy_version: number;
    expires_at: string;
    occurred_for: string;
  };
}

export interface NegotiationRoundProposedV1 extends NegotiationEventEnvelope {
  event_type: "negotiations.round_proposed";
  event_version: "v1";
  data: {
    thread_id: string;
    round_id?: string;
    round_no: number;
    proposed_by: NegotiationParty;
    amount_minor: number;
    currency: string;
    supersedes_round_no?: number | null;
    expires_at: string;
    occurred_for: string;
  };
}

export interface NegotiationRoundRejectedV1 extends NegotiationEventEnvelope {
  event_type: "negotiations.round_rejected";
  event_version: "v1";
  data: {
    thread_id: string;
    round_no: number;
    rejected_by: NegotiationParty;
    /** يفصل «رفضتُ وسأقترح غيره» عن «رفضتُ وانتهى»؛ نيّةٌ لا تُخمَّن من الحالة وحدها. */
    thread_remains_open: boolean;
    occurred_for: string;
  };
}

export interface NegotiationRoundExpiredV1 extends NegotiationEventEnvelope {
  event_type: "negotiations.round_expired";
  event_version: "v1";
  data: {
    thread_id: string;
    round_no: number;
    proposed_by?: NegotiationParty;
    /** استحقاق الانتهاء لا لحظة النبضة: إعادة التشغيل تُؤجّل الاكتشاف ولا تُغيّر متى انتهى. */
    occurred_for: string;
  };
}

export interface NegotiationMessagePostedV1 extends NegotiationEventEnvelope {
  event_type: "negotiations.message_posted";
  event_version: "v1";
  /** لا `body` هنا ولا في أي حمولة أخرى — القرار 6. `body_length` عددٌ لا نصّ. */
  data: {
    thread_id: string;
    message_id: string;
    sequence_no: number;
    author_role: NegotiationAuthorRole;
    body_length: number;
    system_code?: string | null;
    round_no?: number | null;
    source_locale: NegotiationLocale;
    occurred_for: string;
  };
}

export interface NegotiationAgreedV1 extends NegotiationEventEnvelope {
  event_type: "negotiations.agreed";
  event_version: "v1";
  data: {
    thread_id: string;
    order_public_id: string;
    customer_public_id: string;
    driver_public_id: string;
    round_no: number;
    amount_minor: number;
    currency: string;
    accepted_by: NegotiationParty;
    policy_version: number;
    round_count: number;
    occurred_for: string;
  };
}

export interface NegotiationAgreedPriceHandedOffV1 extends NegotiationEventEnvelope {
  event_type: "negotiations.agreed_price_handed_off";
  event_version: "v1";
  data: {
    thread_id: string;
    order_public_id: string;
    attempt_no: number;
    amount_minor: number;
    currency: string;
    occurred_for: string;
  };
}

export interface NegotiationPriceHandoffFailedV1 extends NegotiationEventEnvelope {
  event_type: "negotiations.price_handoff_failed";
  event_version: "v1";
  data: {
    thread_id: string;
    order_public_id: string;
    attempt_no: number;
    outcome: NegotiationHandoffOutcome;
    error_code: string;
    retry_scheduled: boolean;
    occurred_for: string;
  };
}

export interface NegotiationThreadClosedV1 extends NegotiationEventEnvelope {
  event_type: "negotiations.thread_closed";
  event_version: "v1";
  data: {
    thread_id: string;
    order_public_id: string;
    customer_public_id: string;
    driver_public_id: string;
    state: NegotiationClosedState;
    close_reason_code: NegotiationCloseReasonCode;
    round_count: number;
    occurred_for: string;
  };
}

export type NegotiationDomainEvent =
  | NegotiationThreadOpenedV1
  | NegotiationRoundProposedV1
  | NegotiationRoundRejectedV1
  | NegotiationRoundExpiredV1
  | NegotiationMessagePostedV1
  | NegotiationAgreedV1
  | NegotiationAgreedPriceHandedOffV1
  | NegotiationPriceHandoffFailedV1
  | NegotiationThreadClosedV1;

export const NEGOTIATION_EVENT_TYPES = [
  "negotiations.thread_opened",
  "negotiations.round_proposed",
  "negotiations.round_rejected",
  "negotiations.round_expired",
  "negotiations.message_posted",
  "negotiations.agreed",
  "negotiations.agreed_price_handed_off",
  "negotiations.price_handoff_failed",
  "negotiations.thread_closed",
] as const;
export type NegotiationEventType = (typeof NEGOTIATION_EVENT_TYPES)[number];

/**
 * الحقول التي **لا يجوز** أن تظهر في أي حمولة حدث. القائمة أسماءُ مفاتيح كاملة لا
 * أجزاءً منها: `body_length` مسموح و`body` ممنوع، والفرق هو الفرق بين عدّاد إساءة
 * وبين كلام الناس. الحارس آليّ لأنّ الانضباط اليدويّ ينهار عند أول تعديل مستعجل.
 */
export const NEGOTIATION_EVENT_FORBIDDEN_FIELDS = [
  "body",
  "note",
  "opening_note",
  "message",
  "message_body",
  "text",
  "translated_body",
  "display_name",
  "name",
  "phone",
  "phone_number",
  "lat",
  "lng",
  "latitude",
  "longitude",
  "chat_id",
  "telegram_id",
  "telegram_user_id",
] as const;
