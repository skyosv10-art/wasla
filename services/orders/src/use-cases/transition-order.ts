/**
 * The single path a status ever changes through.
 *
 * Every rule that makes a state legitimate is applied here, in a fixed order,
 * because the order determines which error the caller sees — and the error is
 * the only diagnostic they get:
 *   1. does the order exist?                      → 404
 *   2. is the pair in the published table?        → 409 (the phase's core rule)
 *   3. is the reason code known and required?     → 422
 *   4. is the actor ref shaped correctly?         → 422
 *   5. does the assignment coupling hold?         → 422
 * Checking the table BEFORE the reason code matters: telling a caller their
 * reason is missing for a transition that was never allowed sends them to fix
 * the wrong thing.
 */

import { illegalTransition, OrderError } from "../domain/errors.js";
import { orderStatusChangedEvent } from "../domain/events.js";
import type { Order, StatusHistoryEntry, TransitionCommand } from "../domain/model.js";
import {
  assignmentRequirement,
  isTransitionAllowed,
} from "../domain/state-machine.js";
import {
  assertActorRefShape,
  assertReasonCodeForTarget,
  assertReasonCodeKnown,
} from "../domain/validation.js";
import type { OrderDependencies } from "../ports.js";

/** The result of a transition: the new order plus the audit row it produced. */
export interface TransitionOutcome {
  readonly order: Order;
  readonly historyEntry: StatusHistoryEntry;
}

/**
 * Move an order to a new status.
 *
 * A no-op transition (`X → X`) is refused rather than ignored: the table has no
 * self-edges, so accepting one would create an audit row claiming a change that
 * did not happen, and the audit trail is the artifact this phase is judged on.
 */
export async function transitionOrder(
  deps: OrderDependencies,
  orderId: string,
  command: TransitionCommand,
): Promise<TransitionOutcome> {
  const traceId = command.traceId;

  const order = await deps.repository.findOrderById(orderId);
  if (!order) {
    throw new OrderError("ORDER_NOT_FOUND", `الطلب ${orderId} غير موجود`, {
      traceId,
    });
  }

  if (!isTransitionAllowed(order.status, command.toStatus)) {
    throw illegalTransition(order.status, command.toStatus, traceId);
  }

  assertReasonCodeKnown(command.reasonCode, traceId);
  assertReasonCodeForTarget(command.toStatus, command.reasonCode, traceId);
  assertActorRefShape(command.actorType, command.actorRef, traceId);

  // The assignment carried into the new state. Resolved from the order's own
  // active assignment rather than from the request: a caller must not be able to
  // name a driver, or the engine would be deciding assignment (ADR-010 §4).
  const requirement = assignmentRequirement(command.toStatus);
  let activeAssignmentId: string | null = order.activeAssignmentId;
  if (requirement === "required" && activeAssignmentId == null) {
    // The order row is not yet bound, so the accepted offer is read from the
    // assignment log and bound BY THIS transition — the same UPDATE that moves
    // the status. Binding earlier (at acceptance time) would leave an `offered`
    // order carrying an active assignment, which `ck_orders_assignment_matches_status`
    // rejects; binding here keeps the row legal at every instant.
    //
    // Still not a decision: the driver is read from what was already accepted,
    // never from the request, so the engine records and does not choose (ADR-010 §4).
    const accepted = (await deps.repository.listAssignments(order.id)).filter(
      (candidate) => candidate.state === "accepted",
    );
    activeAssignmentId = accepted[accepted.length - 1]?.id ?? null;
  }
  if (requirement === "required" && activeAssignmentId == null) {
    throw new OrderError(
      "ORDER_ASSIGNMENT_REQUIRED",
      `الحالة ${command.toStatus} تستلزم إسناداً مقبولاً مُسجَّلاً`,
      { traceId, details: { from: order.status, to: command.toStatus } },
    );
  }
  if (requirement === "forbidden") {
    // Returning to the search unbinds the driver: a searching order that still
    // names one is an impossible state, and this is the moment it would appear.
    activeAssignmentId = null;
  }

  const occurredAt = deps.clock.now();
  const applied = await deps.repository.applyTransition({
    orderId: order.id,
    toStatus: command.toStatus,
    reasonCode: command.reasonCode,
    actorType: command.actorType,
    actorRef: command.actorRef,
    activeAssignmentId,
    occurredAt,
    traceId: traceId ?? null,
  });

  const activeAssignment =
    activeAssignmentId == null
      ? null
      : await deps.repository.findAssignment(order.id, activeAssignmentId);

  await deps.outbox.append(
    orderStatusChangedEvent(
      applied.order,
      applied.historyEntry,
      activeAssignment?.driverPublicId ?? null,
      { eventId: deps.ids.uuid(), occurredAt, traceId: traceId ?? null },
    ),
  );

  return applied;
}
