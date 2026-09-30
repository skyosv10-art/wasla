/**
 * صفوفُ `delivery_outbox` بشكلِ عقدِ التوصيلِ (M5-17Q · CLM-0376).
 *
 * كلُّ حمولةٍ هنا تتبعُ `services/delivery/contracts/events.json` حرفيّاً
 * (`StoreOrderCreatedV1` · `StoreOrderFulfillmentStateChangedV1` ·
 * `StoreOrderItemSubstitutedV1` · `DeliveryCompletedV1`)، ويُفحَصُ ذلكَ آليّاً في
 * `delivery-contract.test.ts` — فلا تنجرفُ المُثبَّتاتُ عن المنتِجِ بصمت. والإثباتُ
 * بالمنتِجِ الحقيقيِّ نفسِهِ في `packages/billing-e2e`.
 */

import { randomUUID } from "node:crypto";

import type { DeliveryOutboxRow } from "../domain/consumed-events.js";

export const STORE_ID = "cccccccc-0000-4000-8000-000000000003";
export const STORE_SLUG = "madinah-electronics";
export const SYSTEM_ACTOR = { actor_type: "system", actor_ref: null } as const;

export interface OrderRef {
  readonly orderId: string;
  readonly publicId: string;
}

export function orderRef(n: number): OrderRef {
  return {
    orderId: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`,
    publicId: `WS-${String(3000000000 + n).padStart(10, "0")}`,
  };
}

interface RowInit {
  readonly eventId?: string;
  readonly occurredAt: string;
  /** Defaults to `occurredAt` in epoch ms — a unit script reads in timestamp order (RISK-0012). */
  readonly commitSequence?: string;
  readonly eventVersion?: string;
}

function envelope(
  eventType: string,
  aggregateType: "store_order" | "delivery_task",
  aggregateId: string,
  payload: Record<string, unknown>,
  init: RowInit,
): DeliveryOutboxRow {
  return {
    event_id: init.eventId ?? randomUUID(),
    event_type: eventType,
    event_version: init.eventVersion ?? "v1",
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    occurred_at: init.occurredAt,
    commit_sequence: init.commitSequence ?? String(Date.parse(init.occurredAt)),
    trace_id: null,
    payload,
  };
}

/** `store_order.created` — لقطةُ المالِ: سطرٌ واحدٌ بكمّيّةٍ واحدةٍ بسعرِ `itemsTotal`. */
export function createdRow(
  order: OrderRef,
  itemsTotal: number,
  deliveryFee: number,
  init: RowInit,
): DeliveryOutboxRow {
  return envelope(
    "store_order.created",
    "store_order",
    order.orderId,
    {
      public_id: order.publicId,
      customer_ref: "WS-2000000007",
      store_id: STORE_ID,
      store_slug: STORE_SLUG,
      from_state: "draft",
      to_state: "placed",
      items: [
        {
          line_no: 1,
          product_id: "bbbbbbbb-0000-4000-8000-000000000001",
          sku: "SKU-bbbb",
          quantity: 1,
          unit_price_minor_units: itemsTotal,
          line_total_minor_units: itemsTotal,
        },
      ],
      totals: {
        currency_code: "SAR",
        items_total_minor_units: itemsTotal,
        delivery_fee_minor_units: deliveryFee,
        total_minor_units: itemsTotal + deliveryFee,
      },
      actor: SYSTEM_ACTOR,
    },
    init,
  );
}

/** `store_order.fulfillment_state_changed` — `delivered` يحملُ إثباتاً كما يفرضُهُ المنتِج. */
export function transitionRow(
  order: OrderRef,
  from: string,
  to: string,
  init: RowInit,
): DeliveryOutboxRow {
  return envelope(
    "store_order.fulfillment_state_changed",
    "store_order",
    order.orderId,
    {
      public_id: order.publicId,
      from_state: from,
      to_state: to,
      reason_code: to === "delivered" ? "DELIVERED_WITH_PROOF" : to === "cancelled" ? "CUSTOMER_CHANGED_MIND" : "PICKING_STARTED",
      payment_state: "captured",
      proof: to === "delivered" ? { proof_type: "otp", proof_ref: "OTP-BILLING-0001" } : null,
      actor: SYSTEM_ACTOR,
    },
    init,
  );
}

export function deliveredRow(order: OrderRef, init: RowInit): DeliveryOutboxRow {
  return transitionRow(order, "handed_to_courier", "delivered", init);
}

export function substitutedRow(order: OrderRef, priceDelta: number, init: RowInit): DeliveryOutboxRow {
  return envelope(
    "store_order.item_substituted",
    "store_order",
    order.orderId,
    {
      public_id: order.publicId,
      line_no: 1,
      original_product_id: "bbbbbbbb-0000-4000-8000-000000000001",
      substituted_product_id: "bbbbbbbb-0000-4000-8000-000000000002",
      quantity: 1,
      reason_code: "out_of_stock",
      price_delta_minor_units: priceDelta,
      actor: SYSTEM_ACTOR,
    },
    init,
  );
}

/** `delivery.completed` — مجموعةُ `delivery_task`: غريبٌ عن الفوترة. */
export function deliveryCompletedRow(order: OrderRef, init: RowInit): DeliveryOutboxRow {
  return envelope(
    "delivery.completed",
    "delivery_task",
    randomUUID(),
    {
      order_id: order.orderId,
      from_state: "arrived",
      to_state: "delivered",
      proof_type: "otp",
      proof_ref: "OTP-BILLING-0001",
      courier_ref: "WS-4000000001",
    },
    init,
  );
}

/** ساعةٌ تتقدّمُ ثانيةً في كلِّ نداءٍ — ترتيبُ المنتِجِ الحقيقيِّ بالطوابع. */
export function ticker(start = "2026-09-27T10:00:00.000000Z"): () => string {
  let t = Date.parse(start);
  return () => {
    const iso = new Date(t).toISOString(); // …sss Z
    t += 1000;
    return iso.replace(/\.(\d{3})Z$/, ".$1000Z");
  };
}
