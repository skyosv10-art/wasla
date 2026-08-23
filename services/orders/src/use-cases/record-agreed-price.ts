/**
 * Record the outcome of a negotiation without taking ownership of negotiation.
 *
 * This use case writes no status-history row and emits no event. The negotiation
 * service owns `negotiations.agreed`; producing a second event for the same fact
 * would leave consumers with two sources of truth. Likewise, only
 * `transitionOrder` moves status, so a price recorder cannot become a second
 * lifecycle governor.
 */

import { assertOrderAcceptsAgreedPrice } from "../domain/agreed-price.js";
import { OrderError } from "../domain/errors.js";
import type {
  Order,
  RecordAgreedPriceCommand,
  RecordAgreedPriceOutcome,
} from "../domain/model.js";
import { assertPublicIdShape } from "../domain/validation.js";
import type { OrderDependencies } from "../ports.js";

function assertStoredPriceMatches(
  order: Order,
  command: RecordAgreedPriceCommand,
): RecordAgreedPriceOutcome {
  if (order.agreedNegotiationId !== command.negotiationId) {
    throw new OrderError(
      "ORDER_AGREED_PRICE_ALREADY_SET",
      "سجّل خيط تفاوض آخر سعراً على الطلب",
      { traceId: command.traceId },
    );
  }
  if (
    order.agreedPrice?.amountMinor !== command.amountMinor ||
    order.agreedPrice.currency !== command.currency
  ) {
    throw new OrderError(
      "ORDER_AGREED_PRICE_MISMATCH",
      "إعادة التسجيل لا تطابق مبلغ أو عملة السعر المسجل",
      { traceId: command.traceId },
    );
  }
  return { order, replayed: true };
}

/** Persist a complete agreement once, or return the identical existing agreement. */
export async function recordAgreedPrice(
  deps: OrderDependencies,
  command: RecordAgreedPriceCommand,
): Promise<RecordAgreedPriceOutcome> {
  const order = await deps.repository.findOrderByPublicId(command.orderPublicId);
  if (!order) {
    throw new OrderError("ORDER_NOT_FOUND", `الطلب ${command.orderPublicId} غير موجود`, {
      traceId: command.traceId,
    });
  }

  // The driver is deliberately an opaque cross-service reference. Its shape is
  // checked so malformed evidence cannot enter, while driver eligibility remains
  // owned by matching/identity rather than this order engine.
  assertPublicIdShape("driver_public_id", command.driverPublicId, command.traceId);
  assertOrderAcceptsAgreedPrice(order, command.traceId);

  if (order.agreedPrice !== null) return assertStoredPriceMatches(order, command);

  const recordedAt = deps.clock.now();
  const recorded = await deps.repository.recordAgreedPrice({
    orderId: order.id,
    negotiationId: command.negotiationId,
    amountMinor: command.amountMinor,
    currency: command.currency,
    agreedAt: command.agreedAt,
    recordedAt,
  });

  if (recorded !== null) return { order: recorded, replayed: false };

  // A concurrent writer won after our read. Classify its durable result instead
  // of overwriting it or returning success based on an outdated in-memory copy.
  const current = await deps.repository.findOrderById(order.id);
  if (current === null) {
    throw new OrderError("ORDER_NOT_FOUND", `الطلب ${command.orderPublicId} غير موجود`, {
      traceId: command.traceId,
    });
  }
  return assertStoredPriceMatches(current, command);
}
