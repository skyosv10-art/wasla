/**
 * The read side: one thread, a filtered list, and the agreement.
 *
 * ## Reads never write
 *
 * A read of a thread whose deadline has passed reports the state as **stored**, and
 * adds `is_expired_by_time` so the caller is not misled. It does not expire it. A `GET`
 * that mutates cannot be cached, cannot be retried safely, and turns a monitoring
 * dashboard's polling into a source of state changes. Expiry belongs to the tick and to
 * the write actions (see `expiry-core`).
 *
 * ## A filter is required on the list (`FILTER_REQUIRED`)
 *
 * `GET /negotiations` with no filter would be «every negotiation on the platform»,
 * which is both the easiest request to write by accident and the one nobody has a
 * legitimate use for. Precedent: the same rule on driver and dispatch listings.
 */

import { agreementNotFound, filterRequired, threadNotFound, validationFailed } from "../domain/errors.js";
import { isDue } from "../domain/expiry.js";
import type {
  NegotiationAgreement,
  NegotiationMessage,
  NegotiationPriceHandoff,
  NegotiationRound,
  NegotiationThread,
} from "../domain/model.js";
import { turnBelongsTo } from "../domain/state-machine.js";
import { assertOrderPublicId, assertUuid, assertWaslaPublicId } from "../domain/validation.js";
import type { NegotiationDependencies, ThreadFilter } from "../ports.js";

/** The default and maximum page sizes for the list route. */
export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

export interface NegotiationView {
  readonly thread: NegotiationThread;
  readonly rounds: readonly NegotiationRound[];
  readonly messages: readonly NegotiationMessage[];
  readonly agreement: NegotiationAgreement | null;
  readonly handoffs: readonly NegotiationPriceHandoff[];
  /** The round still awaiting an answer, if any. */
  readonly pendingRound: NegotiationRound | null;
  /** Whose turn it is to propose. `null` means either party may. */
  readonly turn: "customer" | "driver" | null;
  /** Stored state says open, but the clock has passed `expires_at`. */
  readonly isExpiredByTime: boolean;
}

export async function readNegotiation(
  deps: NegotiationDependencies,
  threadId: unknown,
): Promise<NegotiationView> {
  const id = assertUuid(threadId, "threadId");
  const thread = await deps.threads.find(id);
  if (thread === null) throw threadNotFound();
  const [rounds, messages, agreement, handoffs, pendingRound] = await Promise.all([
    deps.rounds.list(id),
    deps.messages.list(id),
    deps.agreements.find(id),
    deps.handoffs.list(id),
    deps.rounds.findPending(id),
  ]);
  const now = deps.clock.now();
  return {
    thread,
    rounds,
    messages,
    agreement,
    handoffs,
    pendingRound,
    turn: turnBelongsTo(pendingRound),
    isExpiredByTime: thread.state === "open" && isDue(thread.expiresAt, now),
  };
}

export interface ListNegotiationsInput {
  readonly order_public_id?: unknown;
  readonly driver_public_id?: unknown;
  readonly state?: unknown;
  readonly limit?: unknown;
}

export async function listNegotiations(
  deps: NegotiationDependencies,
  input: ListNegotiationsInput,
): Promise<readonly NegotiationThread[]> {
  const filter: {
    orderPublicId?: string;
    driverPublicId?: string;
    state?: NegotiationThread["state"];
  } = {};
  if (input.order_public_id !== undefined && input.order_public_id !== null) {
    filter.orderPublicId = assertOrderPublicId(input.order_public_id);
  }
  if (input.driver_public_id !== undefined && input.driver_public_id !== null) {
    filter.driverPublicId = assertWaslaPublicId(input.driver_public_id, "driver_public_id");
  }
  if (input.state !== undefined && input.state !== null) {
    filter.state = assertThreadState(input.state);
  }
  // `state` alone is NOT a filter: «every open negotiation» is the same unbounded read
  // the rule exists to refuse. One of the two identifying filters must be present.
  if (filter.orderPublicId === undefined && filter.driverPublicId === undefined) {
    throw filterRequired();
  }
  const limit = normaliseLimit(input.limit);
  return deps.threads.list(filter as ThreadFilter, limit);
}

export async function readAgreement(
  deps: NegotiationDependencies,
  threadId: unknown,
): Promise<NegotiationAgreement> {
  const id = assertUuid(threadId, "threadId");
  const thread = await deps.threads.find(id);
  // 404 on the thread first: «no agreement» on a thread that does not exist would tell
  // a caller his id is fine when it is not.
  if (thread === null) throw threadNotFound();
  const agreement = await deps.agreements.find(id);
  if (agreement === null) throw agreementNotFound();
  return agreement;
}

function assertThreadState(value: unknown): NegotiationThread["state"] {
  const states = ["open", "agreed", "declined", "expired", "cancelled"] as const;
  if (typeof value !== "string" || !states.includes(value as (typeof states)[number])) {
    throw validationFailed("state", states.join(" | "));
  }
  return value as NegotiationThread["state"];
}

function normaliseLimit(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_LIST_LIMIT;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 1) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(parsed, MAX_LIST_LIMIT);
}
