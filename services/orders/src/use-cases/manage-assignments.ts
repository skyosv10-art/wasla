/**
 * Assignment records: a log, not a decision (ADR-010 decision 4 · §16).
 *
 * Phase 07 decides WHO is offered an order and when. This service writes down
 * what was decided, and nothing here inspects a driver: `driverPublicId` is an
 * opaque reference, never validated against a driver service, because the
 * engine that both matched and recorded would make matching untestable in
 * isolation and would couple Phase 06 to Phase 05.
 *
 * The one thing acceptance DOES change is the order: an accepted offer becomes
 * the order's active assignment, which is the precondition for every state that
 * names a driver. That coupling is the whole reason assignments live here rather
 * than in the matching service.
 */

import { OrderError } from "../domain/errors.js";
import { assignmentOfferedEvent, assignmentResolvedEvent } from "../domain/events.js";
import type {
  Assignment,
  RecordAssignmentCommand,
  ResolveAssignmentCommand,
} from "../domain/model.js";
import { assertPublicIdShape, assertReasonCodeKnown } from "../domain/validation.js";
import type { OrderDependencies } from "../ports.js";

/**
 * Record an offer made to a driver.
 *
 * Refused when the order is in a state that cannot receive an offer: offering an
 * order that already has an accepted driver, or one that ended, produces a
 * record Phase 07 would read as a live candidate.
 */
export async function recordAssignment(
  deps: OrderDependencies,
  orderId: string,
  command: RecordAssignmentCommand,
): Promise<Assignment> {
  const traceId = command.traceId;
  const order = await deps.repository.findOrderById(orderId);
  if (!order) {
    throw new OrderError("ORDER_NOT_FOUND", `الطلب ${orderId} غير موجود`, { traceId });
  }

  assertPublicIdShape("driver_public_id", command.driverPublicId, traceId);

  if (order.activeAssignmentId != null) {
    throw new OrderError(
      "ORDER_ASSIGNMENT_FORBIDDEN",
      "الطلب مُسند لسائق بالفعل",
      { traceId, details: { from: order.status } },
    );
  }

  const assignment = await deps.repository.insertAssignment({
    id: deps.ids.uuid(),
    orderId: order.id,
    driverPublicId: command.driverPublicId,
    offeredAt: deps.clock.now(),
  });

  await deps.outbox.append(
    assignmentOfferedEvent(order, assignment, {
      eventId: deps.ids.uuid(),
      occurredAt: assignment.offeredAt,
      traceId: traceId ?? null,
    }),
  );

  return assignment;
}

/**
 * Resolve an offer: accepted · rejected · expired · cancelled.
 *
 * Acceptance binds the assignment to the order. It deliberately does NOT move
 * the order's status: the move `offered → accepted` is a transition like any
 * other and goes through `transitionOrder`, so it is refused if the table does
 * not allow it and it produces its own audit row. Doing both here would create
 * the one status change with no transition check.
 *
 * Rejection and expiry likewise do not end the order (ADR-010 decision 3.5).
 *
 * All four resolutions apply to an `offered` record only: an offer is resolved
 * once (§6). An accepted driver who then backs out is not an edited assignment
 * record — it is an order transition to `driver_cancelled`, which keeps the
 * history of what actually happened instead of overwriting it.
 */
export async function resolveAssignment(
  deps: OrderDependencies,
  orderId: string,
  command: ResolveAssignmentCommand,
): Promise<Assignment> {
  const traceId = command.traceId;
  const order = await deps.repository.findOrderById(orderId);
  if (!order) {
    throw new OrderError("ORDER_NOT_FOUND", `الطلب ${orderId} غير موجود`, { traceId });
  }

  const current = await deps.repository.findAssignment(order.id, command.assignmentId);
  if (!current) {
    throw new OrderError(
      "ORDER_ASSIGNMENT_NOT_FOUND",
      `الإسناد ${command.assignmentId} غير موجود على هذا الطلب`,
      { traceId },
    );
  }

  assertReasonCodeKnown(command.reasonCode, traceId);

  const resolvedAt = deps.clock.now();
  const assignment = await deps.repository.resolveAssignment({
    assignmentId: current.id,
    state: command.state,
    reasonCode: command.reasonCode,
    resolvedAt,
  });

  // Acceptance deliberately does NOT write the order row here.
  //
  // `ck_orders_assignment_matches_status` says an order in a pre-assignment
  // status (`published` · `searching` · `offered` · `negotiating`) carries NO
  // active assignment, and acceptance does not move the status (that is a
  // transition like any other). So binding the driver at this line would write
  // exactly the row the constraint forbids: `offered` + an active assignment.
  // On PostgreSQL that write fails; in memory it used to succeed — which is the
  // impossible state ADR-010 §7 image 4 names, hidden by an adapter that did
  // not enforce the constraint. Phase 06's exit gate caught it on Postgres.
  //
  // The binding therefore happens inside `transitionOrder`, in the SAME UPDATE
  // that moves the status to a driver-bound state — one statement, so the row is
  // never visible in a state the constraint rejects. `transitionOrder` reads the
  // accepted record from the assignment log; the caller still cannot name a
  // driver.
  // No release branch here on purpose. An offer is resolved once (§6), so a
  // BOUND assignment can never arrive at this line — it is already `accepted`.
  // Releasing the driver is the order's business, not the record's: it happens
  // inside `transitionOrder` when the order moves to a pre-assignment status.
  // A defensive branch here would be unreachable code pretending to be a
  // safeguard, and would hide the fact that release has exactly one owner.

  await deps.outbox.append(
    assignmentResolvedEvent(order, assignment, resolvedAt, {
      eventId: deps.ids.uuid(),
      occurredAt: resolvedAt,
      traceId: traceId ?? null,
    }),
  );

  return assignment;
}
