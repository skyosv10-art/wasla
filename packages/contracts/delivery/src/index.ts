/**
 * عقودُ سيرِ الوفاءِ (ADR-026) — **أشكالٌ بلا تنفيذٍ**.
 * القوائمُ هنا مصدرُ الحقيقةِ للمستهلكينَ، ونسخُها في مستهلكٍ يجعلُ تغييرَ
 * الجدولِ تغييراً في سبعةِ مواضعَ.
 */

export const DELIVERY_STATES = [
  "requested",
  "accepted",
  "preparing",
  "ready_for_pickup",
  "assigned",
  "picked_up",
  "delivered",
  "completed",
  "cancelled",
  "failed",
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const DELIVERY_ACTOR_KINDS = ["store", "driver", "customer", "system", "operator"] as const;
export type DeliveryActorKind = (typeof DELIVERY_ACTOR_KINDS)[number];

export const DELIVERY_FAILURE_REASON_CODES = [
  "store_rejected",
  "out_of_stock",
  "customer_cancelled",
  "no_driver_found",
  "pickup_failed",
  "delivery_failed",
  "address_unreachable",
  "operator_intervention",
] as const;
export type DeliveryFailureReasonCode = (typeof DELIVERY_FAILURE_REASON_CODES)[number];

/** أنواعُ الأحداثِ المنشورةِ — **أثرُ قرارٍ دخلَ الدفترَ لا إعلانُ نيّةٍ**. */
export const DELIVERY_EVENT_TYPES = [
  "fulfilment.requested",
  "fulfilment.state_changed",
  "fulfilment.driver_assigned",
  "fulfilment.driver_released",
  "fulfilment.terminated",
] as const;
export type DeliveryEventType = (typeof DELIVERY_EVENT_TYPES)[number];

/**
 * **صيغُ المراجعِ الأجنبيّةِ يملكُها أصحابُها لا نحنُ** (ADR-010 · ADR-016):
 * الطلبُ `ORD-##########` والمتجرُ `UUID`. وفرضُ صيغتِنا عليهما كانَ يجعلُ
 * العقدَ **لا يستوفيه زوجٌ حقيقيٌّ** — رُصدَ في المراجعةِ وصُحِّحَ قبلَ الدمجِ.
 */
export const DELIVERY_REF_PATTERNS = {
  fulfilment: /^WS-[0-9]{10}$/,
  driver: /^WS-[0-9]{10}$/,
  actor: /^WS-[0-9]{10}$/,
  order: /^ORD-[0-9]{10}$/,
  store: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
} as const;

export interface DeliveryEventEnvelope {
  readonly event_id: string;
  readonly event_type: DeliveryEventType;
  readonly event_version: `v${number}`;
  readonly occurred_at: string;
  readonly producer: "delivery-service";
  readonly aggregate: { readonly type: "fulfilment"; readonly id: string };
  readonly trace_id: string | null;
}

export interface DeliveryStateChangedPayload {
  readonly fulfilment_ref: string;
  /** `ORD-##########` — صيغةُ محرّكِ الطلبِ. */
  readonly order_ref: string;
  /** `UUID` — صيغةُ السوقِ. */
  readonly store_ref: string;
  readonly driver_ref: string | null;
  readonly from_state: DeliveryState;
  readonly to_state: DeliveryState;
  readonly sequence: number;
  readonly actor_kind: DeliveryActorKind;
  readonly actor_ref: string | null;
  readonly failure_reason: DeliveryFailureReasonCode | null;
}
