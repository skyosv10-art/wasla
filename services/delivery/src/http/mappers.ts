/**
 * Domain → wire mappers (ADR-026 §2.6 · api.openapi.yml).
 *
 * Explicit field-by-field construction, never `{...order}`. A spread would
 * publish whatever the domain gains next — the aggregate holds `storeId` (an
 * internal marketplace uuid) and could tomorrow hold something worse, and the
 * contract's `StoreOrderResponse` deliberately does not expose it. Privacy at
 * a boundary cannot depend on nobody adding a field.
 *
 * `payment_ref` is likewise absent from the response by contract: the payment
 * mirror is external (§2.2) and its reference is not a customer-facing value.
 */

import type { components } from "@wasla/contracts-delivery";

import type { DeliveryTask, StoreOrder } from "../domain/model.js";

type StoreOrderResponse = components["schemas"]["StoreOrderResponse"];
type DeliveryTaskResponse = components["schemas"]["DeliveryTaskResponse"];

export function toStoreOrderResponse(order: StoreOrder): StoreOrderResponse {
  return {
    order_id: order.orderId,
    public_id: order.publicId,
    customer_ref: order.customerRef,
    store_slug: order.storeSlug,
    fulfillment_state: order.fulfillmentState,
    payment_state: order.paymentState,
    currency_code: "SAR",
    items_total_minor_units: order.itemsTotalMinorUnits,
    delivery_fee_minor_units: order.deliveryFeeMinorUnits,
    total_minor_units: order.totalMinorUnits,
    items: order.items.map((item) => ({
      line_no: item.lineNo,
      product_id: item.productId,
      sku: item.sku,
      quantity: item.quantity,
      unit_price_minor_units: item.unitPriceMinorUnits,
      line_total_minor_units: item.lineTotalMinorUnits,
      substituted_product_id: item.substitutedProductId ?? null,
      substitution_reason: item.substitutionReason ?? null,
    })),
    version: order.version,
  };
}

export function toDeliveryTaskResponse(task: DeliveryTask): DeliveryTaskResponse {
  return {
    task_id: task.taskId,
    order_id: task.orderId,
    state: task.state,
    ineligibility_reason: task.ineligibilityReason,
    dispatch_job_ref: task.dispatchJobRef,
    courier_ref: task.courierRef,
    proof_type: task.proof?.proofType ?? null,
    proof_ref: task.proof?.proofRef ?? null,
    version: task.version,
  };
}
