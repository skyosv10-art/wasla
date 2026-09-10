/**
 * Store-order placement — the PURE builder (ADR-026 §2.1 · §2.3 · §2.6).
 *
 * This file turns a validated request plus catalog snapshots into the exact
 * aggregate the store will write, and nothing else: no I/O, no clock, no
 * uuid generation, no database. Everything it cannot know is passed in.
 *
 * ## Why the totals are computed HERE and never received
 *
 * `PlaceStoreOrderRequest` carries `{product_id, quantity}` and a delivery
 * fee — no prices. The unit price is read from the marketplace boundary
 * (§2.3) and multiplied here. A caller-supplied `unit_price_minor_units`
 * would let the caller mint money, and a total computed in the HTTP layer
 * would drift from the total computed by any other entry point. One arith-
 * metic site, integer minor units only, `total = items + delivery_fee` —
 * the same equality the schema CHECK enforces, so a mismatch is a test
 * failure here and a constraint violation there.
 *
 * ## Why placement produces a task in `pending_eligibility`
 *
 * §3.3 starts the delivery task at `pending_eligibility`: the order exists
 * before anyone knows whether it is deliverable. Eligibility is a later
 * decision (`delivery.eligibility_resolved`) — inventing `eligible` at
 * placement time would be a claim this service has not verified.
 */

import type { WaslaPublicId } from "@wasla/contracts-delivery";

import { DeliveryError } from "./errors.js";
import type { DeliveryTask, StoreOrder, StoreOrderItem } from "./model.js";
import { validateCatalogSnapshot, validatePlaceOrderInput, type PlaceOrderInput } from "./validation.js";

/** A price snapshot line as the catalog boundary returned it (§2.3). */
export interface PlacementSnapshot {
  readonly productId: string;
  readonly sku: string;
  readonly unitPriceMinorUnits: number;
}

/**
 * The identities the builder cannot invent: uuids come from the caller and
 * the public id from the store's sequence, so the events carry the SAME
 * identity the rows do.
 */
export interface PlacementIdentity {
  readonly orderId: string;
  readonly taskId: string;
  readonly publicId: WaslaPublicId;
  /** The internal marketplace store uuid resolved through the catalog port. */
  readonly storeId: string;
}

export interface PlacementResult {
  readonly order: StoreOrder;
  readonly task: DeliveryTask;
}

/**
 * Build the aggregate a placement writes.
 *
 * Throws `DELIVERY_VALIDATION_FAILED` when a requested product has no
 * snapshot in this store: the catalog answered, and the answer was "not
 * here". That is a client mistake (400), NOT a dependency failure (503) —
 * conflating them would make an unknown product look like an outage.
 */
export function buildStoreOrderPlacement(
  input: PlaceOrderInput,
  snapshots: readonly PlacementSnapshot[],
  identity: PlacementIdentity,
): PlacementResult {
  validatePlaceOrderInput(input);

  const byProduct = new Map<string, PlacementSnapshot>();
  for (const snapshot of snapshots) {
    validateCatalogSnapshot({
      sku: snapshot.sku,
      unit_price_minor_units: snapshot.unitPriceMinorUnits,
    });
    byProduct.set(snapshot.productId, snapshot);
  }

  const items: StoreOrderItem[] = [];
  let itemsTotal = 0;

  for (const [index, line] of input.items.entries()) {
    const snapshot = byProduct.get(line.product_id);
    if (snapshot === undefined) {
      throw new DeliveryError(
        "DELIVERY_VALIDATION_FAILED",
        `المنتجُ في السطرِ ${index + 1} ليس في كتالوجِ هذا المتجرِ`,
        { details: { field: `items[${index}].product_id`, actual: line.product_id } },
      );
    }
    const lineTotal = line.quantity * snapshot.unitPriceMinorUnits;
    itemsTotal += lineTotal;
    items.push({
      // Deterministic per (order, line): the caller's uuid namespace is the
      // order id, so a retried BUILD produces the same rows — the write is
      // what decides duplication, not the builder.
      orderItemId: deriveItemId(identity.orderId, index + 1),
      lineNo: index + 1,
      productId: line.product_id,
      sku: snapshot.sku,
      quantity: line.quantity,
      unitPriceMinorUnits: snapshot.unitPriceMinorUnits,
      lineTotalMinorUnits: lineTotal,
    });
  }

  const deliveryFee = input.delivery_fee_minor_units ?? 0;

  const order: StoreOrder = {
    orderId: identity.orderId,
    publicId: identity.publicId,
    customerRef: input.customer_ref as WaslaPublicId,
    storeId: identity.storeId,
    storePublicId: input.store_public_id as WaslaPublicId,
    // draft → placed happens AT placement: the ledger records the edge, the
    // row never lingers in `draft` (§3.1, reason `CART_CONFIRMED`).
    fulfillmentState: "placed",
    paymentState: "pending",
    paymentRef: null,
    currencyCode: "SAR",
    itemsTotalMinorUnits: itemsTotal,
    deliveryFeeMinorUnits: deliveryFee,
    totalMinorUnits: itemsTotal + deliveryFee,
    items,
    version: 1,
  };

  const task: DeliveryTask = {
    taskId: identity.taskId,
    orderId: identity.orderId,
    state: "pending_eligibility",
    ineligibilityReason: null,
    dispatchJobRef: null,
    courierRef: null,
    proof: null,
    version: 1,
  };

  return { order, task };
}

/**
 * A line's uuid derived from the order uuid and the line number.
 *
 * Not `crypto.randomUUID()`: this file must stay pure so the same inputs
 * produce the same rows in a test and in production. The last 12 hex digits
 * of the order id are replaced by the zero-padded line number — unique
 * within an order (the schema's real uniqueness key is `(order_id, line_no)`).
 */
function deriveItemId(orderId: string, lineNo: number): string {
  const head = orderId.slice(0, 24);
  return `${head}${lineNo.toString(16).padStart(12, "0")}`;
}
