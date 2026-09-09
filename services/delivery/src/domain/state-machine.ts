/**
 * آلةُ حالةِ الوفاءِ — **جدولٌ مكتوبٌ ودالّةٌ نقيّةٌ**، لا شرطٌ متناثرٌ في مُتحكِّمٍ
 * (ADR-026 §2 القرارُ الثاني).
 *
 * لا قاعدةَ هنا ولا ساعةَ ولا عشوائيّةَ: مدخلٌ واحدٌ ⇒ مخرجٌ واحدٌ دائماً،
 * فيُختبَرُ الحكمُ بلا بيئةٍ.
 */
import {
  type Actor,
  type FailureReasonCode,
  type Fulfilment,
  type FulfilmentState,
  type FulfilmentTransition,
  type WaslaPublicId,
  isTerminal,
  isWellFormedActor,
} from "./model.js";

/** رمزُ رفضٍ مغلقٌ — يُعَدُّ ولا يُقرأُ. */
export const TRANSITION_REJECTION_CODES = [
  "DELIVERY_TERMINAL_STATE",
  "DELIVERY_TRANSITION_NOT_ALLOWED",
  "DELIVERY_ACTOR_NOT_PERMITTED",
  "DELIVERY_ACTOR_REF_INVALID",
  "DELIVERY_DRIVER_REQUIRED",
  "DELIVERY_DRIVER_NOT_EXPECTED",
  "DELIVERY_REASON_REQUIRED",
  "DELIVERY_REASON_NOT_EXPECTED",
  "DELIVERY_SEQUENCE_CONFLICT",
] as const;

export type TransitionRejectionCode =
  (typeof TRANSITION_REJECTION_CODES)[number];

export type TransitionResult =
  | {
      readonly ok: true;
      readonly next: Fulfilment;
      readonly transition: FulfilmentTransition;
    }
  | { readonly ok: false; readonly code: TransitionRejectionCode };

interface Edge {
  readonly to: FulfilmentState;
  readonly actors: readonly Actor["kind"][];
}

/**
 * الجدولُ الحاكمُ. **ما ليس فيه ممنوعٌ** — لا استثناءَ ضمنيّاً ولا «افتراضاً
 * مسموحاً». والحالاتُ المنتهيةُ لا تُذكَرُ مفاتيحَ لأنّها لا تُغادَرُ.
 */
const EDGES: Readonly<Record<FulfilmentState, readonly Edge[]>> = {
  requested: [
    { to: "accepted", actors: ["store"] },
    { to: "cancelled", actors: ["customer", "operator"] },
    { to: "failed", actors: ["store", "system", "operator"] },
  ],
  accepted: [
    { to: "preparing", actors: ["store"] },
    { to: "cancelled", actors: ["customer", "operator"] },
    { to: "failed", actors: ["store", "system", "operator"] },
  ],
  preparing: [
    { to: "ready_for_pickup", actors: ["store"] },
    { to: "cancelled", actors: ["operator"] },
    { to: "failed", actors: ["store", "system", "operator"] },
  ],
  ready_for_pickup: [
    { to: "assigned", actors: ["system", "operator"] },
    { to: "cancelled", actors: ["operator"] },
    { to: "failed", actors: ["system", "operator"] },
  ],
  assigned: [
    { to: "picked_up", actors: ["driver"] },
    // العودةُ إلى الانتظارِ حينَ يسقطُ الإسنادُ — لا إلغاءَ لأنّ المتجرَ جهّزَ فعلاً.
    { to: "ready_for_pickup", actors: ["system", "operator"] },
    { to: "failed", actors: ["system", "operator"] },
  ],
  picked_up: [
    { to: "delivered", actors: ["driver"] },
    { to: "failed", actors: ["driver", "system", "operator"] },
  ],
  delivered: [
    { to: "completed", actors: ["customer", "system", "operator"] },
    { to: "failed", actors: ["operator"] },
  ],
  completed: [],
  cancelled: [],
  failed: [],
};

/** الحالاتُ التي تُوجبُ سائقاً بعدَها. */
const DRIVER_BEARING_STATES: readonly FulfilmentState[] = [
  "assigned",
  "picked_up",
  "delivered",
  "completed",
];

/** الحالاتُ التي تُوجبُ سببَ إخفاقٍ. */
const REASON_BEARING_STATES: readonly FulfilmentState[] = ["cancelled", "failed"];

export interface TransitionCommand {
  readonly to: FulfilmentState;
  readonly actor: Actor;
  readonly expected_sequence: number;
  readonly driver_ref?: WaslaPublicId | null;
  readonly failure_reason?: FailureReasonCode | null;
}

export function allowedTransitions(
  state: FulfilmentState,
): readonly FulfilmentState[] {
  return EDGES[state].map((e) => e.to);
}

/**
 * الانتقالُ. يَرُدُّ إمّا شحنةً جديدةً وأثرَ انتقالٍ، وإمّا رمزَ رفضٍ —
 * **ولا يرمي**: الرفضُ حكمٌ من أحكامِ المجالِ لا استثناءٌ برمجيٌّ.
 */
export function transition(
  current: Fulfilment,
  command: TransitionCommand,
): TransitionResult {
  if (command.expected_sequence !== current.sequence) {
    return { ok: false, code: "DELIVERY_SEQUENCE_CONFLICT" };
  }
  if (isTerminal(current.state)) {
    return { ok: false, code: "DELIVERY_TERMINAL_STATE" };
  }

  const edge = EDGES[current.state].find((e) => e.to === command.to);
  if (edge === undefined) {
    return { ok: false, code: "DELIVERY_TRANSITION_NOT_ALLOWED" };
  }
  if (!edge.actors.includes(command.actor.kind)) {
    return { ok: false, code: "DELIVERY_ACTOR_NOT_PERMITTED" };
  }
  // سطرُ تدقيقٍ يقولُ «متجرٌ ما» لا يُجيبُ عن «من فعلَ هذا؟» — والحكمُ هنا
  // لا في طبقةِ HTTP كي لا يُنسى في المستهلكِ وفي المهمّةِ المجدولةِ.
  if (!isWellFormedActor(command.actor)) {
    return { ok: false, code: "DELIVERY_ACTOR_REF_INVALID" };
  }

  const reason = command.failure_reason ?? null;
  const reasonExpected = REASON_BEARING_STATES.includes(command.to);
  if (reasonExpected && reason === null) {
    return { ok: false, code: "DELIVERY_REASON_REQUIRED" };
  }
  if (!reasonExpected && reason !== null) {
    return { ok: false, code: "DELIVERY_REASON_NOT_EXPECTED" };
  }

  // السائقُ يُسمّى مرّةً واحدةً عندَ الإسنادِ، ويُنزَعُ عندَ سقوطِه.
  let driverRef = current.driver_ref;
  if (command.to === "assigned") {
    const incoming = command.driver_ref ?? null;
    if (incoming === null) {
      return { ok: false, code: "DELIVERY_DRIVER_REQUIRED" };
    }
    driverRef = incoming;
  } else if (command.driver_ref !== undefined && command.driver_ref !== null) {
    return { ok: false, code: "DELIVERY_DRIVER_NOT_EXPECTED" };
  } else if (command.to === "ready_for_pickup") {
    driverRef = null;
  }

  if (DRIVER_BEARING_STATES.includes(command.to) && driverRef === null) {
    return { ok: false, code: "DELIVERY_DRIVER_REQUIRED" };
  }

  const next: Fulfilment = {
    ...current,
    state: command.to,
    driver_ref: driverRef,
    sequence: current.sequence + 1,
    failure_reason: reason,
  };

  return {
    ok: true,
    next,
    transition: {
      fulfilment_ref: current.fulfilment_ref,
      from_state: current.state,
      to_state: command.to,
      sequence: next.sequence,
      actor: command.actor,
      failure_reason: reason,
    },
  };
}
