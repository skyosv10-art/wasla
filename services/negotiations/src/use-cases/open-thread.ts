/**
 * `POST /negotiations` — open a bilateral thread on one dispatch offer.
 *
 * ## The order of the checks is the design
 *
 * Shape → policy → offer → uniqueness. Reversed, a malformed id would reach the
 * dispatch service, and an outage there would answer `503` to a request that was
 * simply wrong — teaching a client to retry a payload that will never work.
 *
 * ## An opening amount is not a round
 *
 * The thread stores `opening_amount_minor` and `round_count` starts at zero. The
 * opening is the asking price, not an offer awaiting an answer: making it round 1
 * would spend a fifth of the round budget before either party has said anything,
 * and would let the opener be the one accepting his own number.
 *
 * ## The opening note is a message
 *
 * Not a thread column, not an event field. It goes into `negotiation_messages`
 * because chat is the one surface that carries content (ADR-013 decision 6), so
 * there is exactly one place to look for what was said and exactly one place to
 * redact it.
 */

import { offerNotActive, orderNotNegotiable, partyMismatch, negotiationUnavailable, validationFailed, amountOutOfBounds, currencyMismatch } from "../domain/errors.js";
import { addSeconds, computeNextTickAt } from "../domain/expiry.js";
import * as events from "../domain/events.js";
import type { NegotiationMessage, NegotiationThread } from "../domain/model.js";
import { LAUNCH_POLICY_VERSION, amountWithinBounds, requireUsablePolicy } from "../domain/policy.js";
import {
  assertLocale,
  assertOptionalNote,
  assertOrderPublicId,
  assertParty,
  assertServiceKind,
  assertUuid,
  assertWaslaPublicId,
} from "../domain/validation.js";
import { assertAmountMinor, assertCurrency } from "../domain/money.js";
import type { NegotiationDependencies } from "../ports.js";
import { appendMessage, guardIdempotency, metaFrom, type WriteOptions } from "./shared.js";

export interface OpenThreadInput {
  readonly order_public_id: unknown;
  readonly customer_public_id: unknown;
  readonly driver_public_id: unknown;
  readonly dispatch_offer_id: unknown;
  readonly service_kind: unknown;
  readonly opening_amount_minor: unknown;
  readonly currency: unknown;
  readonly opened_by: unknown;
  readonly opening_note?: unknown;
  readonly source_locale?: unknown;
}

export interface OpenThreadResult {
  readonly thread: NegotiationThread;
  readonly openingMessage: NegotiationMessage | null;
  readonly replay: boolean;
}

export async function openThread(
  deps: NegotiationDependencies,
  input: OpenThreadInput,
  options: WriteOptions = {},
): Promise<OpenThreadResult> {
  const orderPublicId = assertOrderPublicId(input.order_public_id);
  const customerPublicId = assertWaslaPublicId(input.customer_public_id, "customer_public_id");
  const driverPublicId = assertWaslaPublicId(input.driver_public_id, "driver_public_id");
  const dispatchOfferId = assertUuid(input.dispatch_offer_id, "dispatch_offer_id");
  const serviceKind = assertServiceKind(input.service_kind);
  const openingAmountMinor = assertAmountMinor(input.opening_amount_minor, "opening_amount_minor");
  const currency = assertCurrency(input.currency);
  const openedBy = assertParty(input.opened_by, "opened_by");
  const sourceLocale = assertLocale(input.source_locale ?? "ar");
  // The customer and driver ids share a pattern, so «same person on both sides» is
  // shape-valid and has to be refused explicitly. A thread where one party can
  // accept his own price is a priced order with no second party in it.
  if (customerPublicId === driverPublicId) throw partyMismatch("driver_public_id");

  const policy = requireUsablePolicy(
    await deps.policies.find(LAUNCH_POLICY_VERSION),
    LAUNCH_POLICY_VERSION,
  );
  const openingNote = assertOptionalNote(input.opening_note, policy.maxMessageLength);
  if (currency !== policy.currency) throw currencyMismatch(policy.currency);
  if (!amountWithinBounds(policy, openingAmountMinor)) {
    throw amountOutOfBounds(policy.minAmountMinor, policy.maxAmountMinor);
  }

  const payload = {
    orderPublicId,
    customerPublicId,
    driverPublicId,
    dispatchOfferId,
    serviceKind,
    openingAmountMinor,
    currency,
    openedBy,
    openingNote,
    sourceLocale,
  };
  const guard = await guardIdempotency(deps, "open_thread", options.idempotencyKey, payload);
  if (guard === "replay") {
    // The retried request is the same request. Answer with the thread it created
    // rather than raising a conflict: a client whose response was lost to a timeout
    // is not making a mistake, and telling him «already exists» sends him looking
    // for a bug that is not there.
    const existing = await deps.threads.findByDispatchOffer(dispatchOfferId);
    if (existing !== null) {
      const messages = await deps.messages.list(existing.id);
      return { thread: existing, openingMessage: messages[0] ?? null, replay: true };
    }
  }

  let offer;
  try {
    offer = await deps.offers.describe(dispatchOfferId);
  } catch {
    // Dispatch unreachable is `503` — «try again» — and never `422`, which would
    // tell the caller his correct offer id is invalid.
    throw negotiationUnavailable("خدمة الإرسال غير متاحة الآن");
  }
  if (offer === null) throw offerNotActive();
  if (!offer.active) throw offerNotActive();
  if (!offer.negotiable) throw orderNotNegotiable();
  // The offer is the authority on who it belongs to. Trusting the request body here
  // would let a caller open a thread binding an unrelated driver to an order.
  if (offer.orderPublicId !== orderPublicId) throw partyMismatch("order_public_id");
  if (offer.driverPublicId !== driverPublicId) throw partyMismatch("driver_public_id");
  if (offer.serviceKind !== serviceKind) throw validationFailed("service_kind", offer.serviceKind);

  const at = deps.clock.now();
  const expiresAt = addSeconds(at, policy.threadTtlSeconds);
  const thread = await deps.threads.create({
    id: deps.ids.uuid(),
    orderPublicId,
    customerPublicId,
    driverPublicId,
    dispatchOfferId,
    serviceKind,
    policyVersion: policy.policyVersion,
    currency,
    openingAmountMinor,
    openedBy,
    expiresAt,
    // No round is pending yet, so the only deadline is the thread's own.
    nextTickAt: computeNextTickAt({
      threadState: "open",
      threadExpiresAt: expiresAt,
      pendingRoundExpiresAt: null,
    }),
    createdAt: at,
  });

  await deps.outbox.append(events.threadOpened(thread, metaFrom(deps, options, at)));

  let openingMessage: NegotiationMessage | null = null;
  if (openingNote !== null) {
    openingMessage = await appendMessage(deps, thread, policy, {
      authorRole: openedBy,
      body: openingNote,
      sourceLocale,
      at,
      traceId: options.traceId,
    });
  }

  return { thread, openingMessage, replay: false };
}
