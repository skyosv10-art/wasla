/**
 * نواةُ مجالِ الوفاءِ — الأنواعُ وحدَها، بلا إدخالٍ ولا إخراجٍ (ADR-026).
 *
 * لا مالَ هنا ولا نصَّ حرٍّ ولا بياناً شخصيّاً: المراجعُ كلُّها مُعتِمةٌ،
 * والدفعُ حدُّ `M5-17` ولم يُبنَ بعدُ (ADR-026 §2 القرارُ الثالثُ).
 */

/** مرجعٌ عامٌّ مُعتِمٌ — الصيغةُ نفسُها في كلِّ الأطوارِ (ADR-001). */
export type WaslaPublicId = `WS-${string}`;

export const WASLA_PUBLIC_ID_PATTERN = /^WS-[0-9]{10}$/;

export function isWaslaPublicId(value: string): value is WaslaPublicId {
  return WASLA_PUBLIC_ID_PATTERN.test(value);
}

/**
 * حالاتُ الشحنةِ الثمانِ السائرةُ ونهايتانِ منتهيتانِ.
 * القائمةُ **مغلقةٌ**: حالةٌ حرّةٌ نصّيّةٌ تجعلُ «كم شحنةً عَلِقت قبلَ الالتقاطِ؟»
 * سؤالاً يُجابُ بالقراءةِ لا بالعدِّ (ADR-026 §3).
 */
export const FULFILMENT_STATES = [
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

export type FulfilmentState = (typeof FULFILMENT_STATES)[number];

/** الحالاتُ المنتهيةُ: لا انتقالَ يخرجُ منها إطلاقاً. */
export const TERMINAL_STATES: readonly FulfilmentState[] = [
  "completed",
  "cancelled",
  "failed",
];

export function isTerminal(state: FulfilmentState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * الفاعلُ مُصنَّفٌ لا حرٌّ — ومن يجوزُ له الانتقالُ جزءٌ من جدولِ الانتقالاتِ
 * لا من طبقةِ HTTP، لأنّ صلاحيّةً تعيشُ في المُتحكِّمِ تُنسى في المستهلكِ
 * وفي المهمّةِ المجدولةِ (ADR-026 §2 القرارُ الرابعُ).
 */
export const ACTOR_KINDS = [
  "store",
  "driver",
  "customer",
  "system",
  "operator",
] as const;

export type ActorKind = (typeof ACTOR_KINDS)[number];

/** فاعلٌ: صنفُه ومرجعُه المُعتِمُ. `system` بلا مرجعٍ لأنّه ليس شخصاً. */
export interface Actor {
  readonly kind: ActorKind;
  readonly ref: WaslaPublicId | null;
}

/** أسبابُ الإخفاقِ والإلغاءِ — قائمةٌ مغلقةٌ كي تُعَدَّ لا تُقرأَ. */
export const FAILURE_REASON_CODES = [
  "store_rejected",
  "out_of_stock",
  "customer_cancelled",
  "no_driver_found",
  "pickup_failed",
  "delivery_failed",
  "address_unreachable",
  "operator_intervention",
] as const;

export type FailureReasonCode = (typeof FAILURE_REASON_CODES)[number];

/**
 * الشحنةُ: **لا تحملُ نسخةَ رصيدِ مخزونٍ ولا مبلغاً**. الرصيدُ يُقرأُ من مالكِه
 * (ADR-026 §3)، والمالُ حدُّ `M5-17`.
 */
export interface Fulfilment {
  readonly fulfilment_ref: WaslaPublicId;
  readonly order_ref: WaslaPublicId;
  readonly store_ref: WaslaPublicId;
  readonly driver_ref: WaslaPublicId | null;
  readonly state: FulfilmentState;
  readonly sequence: number;
  readonly failure_reason: FailureReasonCode | null;
}

/** أثرُ انتقالٍ دخلَ الدفترَ — حالتُه السابقةُ واللاحقةُ وتسلسلُه وفاعلُه. */
export interface FulfilmentTransition {
  readonly fulfilment_ref: WaslaPublicId;
  readonly from_state: FulfilmentState;
  readonly to_state: FulfilmentState;
  readonly sequence: number;
  readonly actor: Actor;
  readonly failure_reason: FailureReasonCode | null;
}
