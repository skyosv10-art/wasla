/**
 * Domain event factories.
 *
 * One factory per event type in `services/negotiations/contracts/events.json`, and
 * **no other way** to build an event in this service. That is the point: the
 * privacy rule of ADR-013 decision 6 — no message body, no note, no name, no
 * phone, no coordinate, no channel id in any payload — is enforceable only if there
 * is a single narrow place where payloads are assembled. A use case that could
 * spread an entity into `data` would eventually spread `body` with it.
 *
 * ## What DOES cross, and why
 *
 * The **amount**. A negotiation event without its amount says nothing: «round
 * proposed» with no number cannot drive a notification, cannot feed a funnel, and
 * cannot answer «what changed». The amount is not personal data; it is the change
 * itself. `body_length` crosses too — a count is an abuse signal, while the text is
 * what people said.
 *
 * ## `occurred_for` on every payload
 *
 * `occurred_at` is when we noticed; `occurred_for` is when it became true. For an
 * action they are the same instant. For an expiry they are not: a tick at 12:05
 * closing a round due at 12:02 carries `occurred_for: 12:02`, because a restart
 * delays discovery and must not rewrite history. Making the field **required** on
 * all nine payloads is what stops the distinction being quietly dropped by whoever
 * next simplifies a factory to reuse the clock it already has.
 */

import type {
  NegotiationAgreedPriceHandedOffV1,
  NegotiationAgreedV1,
  NegotiationDomainEvent,
  NegotiationMessagePostedV1,
  NegotiationPriceHandoffFailedV1,
  NegotiationRoundExpiredV1,
  NegotiationRoundProposedV1,
  NegotiationRoundRejectedV1,
  NegotiationThreadClosedV1,
  NegotiationThreadOpenedV1,
} from "@wasla/contracts-negotiation";

import type {
  NegotiationAgreement,
  NegotiationClosedThreadState,
  NegotiationHandoffOutcome,
  NegotiationMessage,
  NegotiationParty,
  NegotiationRound,
  NegotiationThread,
} from "./model.js";

/** Everything the envelope needs that the entity cannot supply. */
export interface EventMeta {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly traceId?: string | null;
}

function envelope(
  meta: EventMeta,
  aggregate: { type: NegotiationDomainEvent["aggregate"]["type"]; id: string },
): Omit<NegotiationDomainEvent, "event_type" | "event_version" | "data"> {
  return {
    event_id: meta.eventId,
    occurred_at: meta.occurredAt,
    producer: "negotiations-service",
    aggregate,
    trace_id: meta.traceId ?? null,
  } as Omit<NegotiationDomainEvent, "event_type" | "event_version" | "data">;
}

export function threadOpened(
  thread: NegotiationThread,
  meta: EventMeta,
): NegotiationThreadOpenedV1 {
  return {
    ...envelope(meta, { type: "negotiation_thread", id: thread.id }),
    event_type: "negotiations.thread_opened",
    event_version: "v1",
    data: {
      thread_id: thread.id,
      order_public_id: thread.orderPublicId,
      customer_public_id: thread.customerPublicId,
      driver_public_id: thread.driverPublicId,
      dispatch_offer_id: thread.dispatchOfferId,
      service_kind: thread.serviceKind,
      opened_by: thread.openedBy,
      opening_amount_minor: thread.openingAmountMinor,
      currency: thread.currency,
      policy_version: thread.policyVersion,
      expires_at: thread.expiresAt,
      // The opening note is NOT here, and there is no field for it. It is stored as
      // an ordinary message and reaches the counterparty through the chat, which is
      // the only surface that carries content.
      occurred_for: thread.createdAt,
    },
  };
}

export function roundProposed(
  round: NegotiationRound,
  meta: EventMeta,
  options: { readonly supersedesRoundNo: number | null },
): NegotiationRoundProposedV1 {
  return {
    ...envelope(meta, { type: "negotiation_round", id: round.id }),
    event_type: "negotiations.round_proposed",
    event_version: "v1",
    data: {
      thread_id: round.threadId,
      round_id: round.id,
      round_no: round.roundNo,
      proposed_by: round.proposedBy,
      amount_minor: round.amountMinor,
      currency: round.currency,
      supersedes_round_no: options.supersedesRoundNo,
      expires_at: round.expiresAt,
      occurred_for: round.createdAt,
    },
  };
}

/**
 * `thread_remains_open` is a **declared** intent, not one inferred from the state.
 *
 * «I refuse and I will counter» and «I refuse and I am done» are different messages
 * to the other party, and a consumer that guessed from `thread.state` would guess
 * wrong exactly when it matters: on the rejection that came with a counter-offer in
 * the same breath.
 */
export function roundRejected(
  round: NegotiationRound,
  meta: EventMeta,
  options: { readonly rejectedBy: NegotiationParty; readonly threadRemainsOpen: boolean },
): NegotiationRoundRejectedV1 {
  return {
    ...envelope(meta, { type: "negotiation_round", id: round.id }),
    event_type: "negotiations.round_rejected",
    event_version: "v1",
    data: {
      thread_id: round.threadId,
      round_no: round.roundNo,
      rejected_by: options.rejectedBy,
      thread_remains_open: options.threadRemainsOpen,
      occurred_for: meta.occurredAt,
    },
  };
}

/**
 * `occurredFor` is the round's **due moment**, supplied by the caller from
 * `expiry.dueMomentFor(round.expiresAt)` — never `meta.occurredAt`.
 */
export function roundExpired(
  round: NegotiationRound,
  meta: EventMeta,
  options: { readonly occurredFor: string },
): NegotiationRoundExpiredV1 {
  return {
    ...envelope(meta, { type: "negotiation_round", id: round.id }),
    event_type: "negotiations.round_expired",
    event_version: "v1",
    data: {
      thread_id: round.threadId,
      round_no: round.roundNo,
      proposed_by: round.proposedBy,
      occurred_for: options.occurredFor,
    },
  };
}

/**
 * The one event built from a row that HAS content — and it carries none.
 *
 * `body_length` is computed from the stored body here rather than accepted as an
 * argument, so a caller cannot pass a length that does not match the message. And
 * `body` itself is not spread, not renamed, not truncated «for debugging»: the
 * privacy guard in the test suite reads every payload key against
 * `NEGOTIATION_EVENT_FORBIDDEN_FIELDS` and fails the build, because manual
 * discipline collapses at the first urgent edit.
 */
export function messagePosted(
  message: NegotiationMessage,
  meta: EventMeta,
): NegotiationMessagePostedV1 {
  return {
    ...envelope(meta, { type: "negotiation_message", id: message.id }),
    event_type: "negotiations.message_posted",
    event_version: "v1",
    data: {
      thread_id: message.threadId,
      message_id: message.id,
      sequence_no: message.sequenceNo,
      author_role: message.authorRole,
      body_length: message.body === null ? 0 : message.body.length,
      system_code: message.systemCode,
      round_no: message.roundNo,
      source_locale: message.sourceLocale,
      occurred_for: message.createdAt,
    },
  };
}

export function agreed(
  thread: NegotiationThread,
  agreement: NegotiationAgreement,
  meta: EventMeta,
): NegotiationAgreedV1 {
  return {
    ...envelope(meta, { type: "negotiation_thread", id: thread.id }),
    event_type: "negotiations.agreed",
    event_version: "v1",
    data: {
      thread_id: thread.id,
      order_public_id: thread.orderPublicId,
      customer_public_id: thread.customerPublicId,
      driver_public_id: thread.driverPublicId,
      round_no: agreement.roundNo,
      amount_minor: agreement.amountMinor,
      currency: agreement.currency,
      accepted_by: agreement.acceptedBy,
      policy_version: agreement.policyVersion,
      round_count: thread.roundCount,
      occurred_for: agreement.agreedAt,
    },
  };
}

export function agreedPriceHandedOff(
  agreement: NegotiationAgreement,
  meta: EventMeta,
  options: { readonly attemptNo: number; readonly occurredFor: string },
): NegotiationAgreedPriceHandedOffV1 {
  return {
    ...envelope(meta, { type: "negotiation_thread", id: agreement.threadId }),
    event_type: "negotiations.agreed_price_handed_off",
    event_version: "v1",
    data: {
      thread_id: agreement.threadId,
      order_public_id: agreement.orderPublicId,
      attempt_no: options.attemptNo,
      amount_minor: agreement.amountMinor,
      currency: agreement.currency,
      occurred_for: options.occurredFor,
    },
  };
}

/**
 * A failed hand-off is an event, not an exception.
 *
 * It exists so the failure is **visible** — to the tick that will retry it, to the
 * dashboard that counts it, and to whoever asks later why an order has no price. It
 * does not exist to invalidate the agreement: `retry_scheduled` tells a consumer
 * whether anything will happen next, which is the only thing it can act on
 * (ADR-013 decision 2).
 */
export function priceHandoffFailed(
  agreement: NegotiationAgreement,
  meta: EventMeta,
  options: {
    readonly attemptNo: number;
    readonly outcome: NegotiationHandoffOutcome;
    readonly errorCode: string;
    readonly retryScheduled: boolean;
  },
): NegotiationPriceHandoffFailedV1 {
  return {
    ...envelope(meta, { type: "negotiation_thread", id: agreement.threadId }),
    event_type: "negotiations.price_handoff_failed",
    event_version: "v1",
    data: {
      thread_id: agreement.threadId,
      order_public_id: agreement.orderPublicId,
      attempt_no: options.attemptNo,
      outcome: options.outcome,
      error_code: options.errorCode,
      retry_scheduled: options.retryScheduled,
      occurred_for: meta.occurredAt,
    },
  };
}

/**
 * Closure for every reason **except** agreement, which has its own event.
 *
 * Two events rather than one with a state field, because a consumer subscribing to
 * «a deal happened» must not have to filter a stream of «a deal did not happen» —
 * and the one that forgets the filter sends a driver to a passenger who declined.
 */
export function threadClosed(
  thread: NegotiationThread,
  meta: EventMeta,
  options: { readonly state: NegotiationClosedThreadState; readonly occurredFor: string },
): NegotiationThreadClosedV1 {
  if (thread.closeReasonCode === null) {
    // Unreachable through the use cases: closure always sets a reason. Asserted
    // rather than defaulted, because a default would satisfy the type system and
    // put an unexplained closure in the stream — the exact thing
    // `ck_negotiation_threads_closed_has_reason` exists to prevent.
    throw new Error("thread_closed event requires close_reason_code");
  }
  return {
    ...envelope(meta, { type: "negotiation_thread", id: thread.id }),
    event_type: "negotiations.thread_closed",
    event_version: "v1",
    data: {
      thread_id: thread.id,
      order_public_id: thread.orderPublicId,
      customer_public_id: thread.customerPublicId,
      driver_public_id: thread.driverPublicId,
      state: options.state,
      close_reason_code: thread.closeReasonCode,
      round_count: thread.roundCount,
      occurred_for: options.occurredFor,
    },
  };
}
