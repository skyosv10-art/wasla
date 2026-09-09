/**
 * @wasla/contracts-delivery — Delivery API types (Contract-First, ADR-004).
 *
 * Hand-authored to match services/delivery/contracts/api.openapi.yml — the
 * OpenAPI document is the source of truth. Regenerate/reconcile after any
 * OpenAPI change; the drift guard in __tests__/contracts.test.ts compares
 * these shapes against the contract files.
 *
 * Boundary reminders (ADR-026):
 *  - This service owns the STORE ORDER aggregate (§2.1) — not the transport
 *    order (that is services/orders, ADR-010).
 *  - `payment_state` is a mirror of an external payment intent, never money
 *    processing (§2.2 — billing is M5-17).
 *  - `courier_ref` / `customer_ref` / `store_public_id` are opaque WS-##########
 *    refs — no names, no phones, no coordinates anywhere (§2.6).
 *  - The HTTP layer is DECLARED, NOT IMPLEMENTED in review 1/N (ADR-026 §4.2).
 */

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

export interface paths {
  "/store-orders": {
    post: operations["placeStoreOrder"];
  };
  "/store-orders/{orderPublicId}": {
    get: operations["getStoreOrder"];
  };
  "/store-orders/{orderPublicId}/cancellation": {
    post: operations["cancelStoreOrder"];
  };
  "/store-orders/{orderPublicId}/delivery-task": {
    get: operations["getDeliveryTaskForOrder"];
  };
  "/delivery/health": {
    get: operations["getDeliveryHealth"];
  };
}

export interface operations {
  placeStoreOrder: {
    requestBody: {
      content: {
        "application/json": components["schemas"]["PlaceStoreOrderRequest"];
      };
    };
    responses: {
      "201": { content: { "application/json": components["schemas"]["StoreOrderResponse"] } };
      "400": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "409": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "503": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
    };
  };
  getStoreOrder: {
    parameters: {
      path: { orderPublicId: components["schemas"]["WaslaPublicId"] };
    };
    responses: {
      "200": { content: { "application/json": components["schemas"]["StoreOrderResponse"] } };
      "404": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
    };
  };
  cancelStoreOrder: {
    parameters: {
      path: { orderPublicId: components["schemas"]["WaslaPublicId"] };
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["CancelStoreOrderRequest"];
      };
    };
    responses: {
      "200": { content: { "application/json": components["schemas"]["StoreOrderResponse"] } };
      "404": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "409": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
    };
  };
  getDeliveryTaskForOrder: {
    parameters: {
      path: { orderPublicId: components["schemas"]["WaslaPublicId"] };
    };
    responses: {
      "200": { content: { "application/json": components["schemas"]["DeliveryTaskResponse"] } };
      "404": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
    };
  };
  getDeliveryHealth: {
    responses: {
      "200": { content: { "application/json": components["schemas"]["HealthResponse"] } };
    };
  };
}

/* ------------------------------------------------------------------ */
/* Components / Schemas                                                */
/* ------------------------------------------------------------------ */

export interface components {
  schemas: {
    /** مرجعٌ opaque — لا بياناتِ شخصيّةَ (ADR-026 §2.6). */
    WaslaPublicId: string;
    FulfillmentState:
      | "draft"
      | "placed"
      | "confirmed"
      | "picking"
      | "picked"
      | "ready_for_delivery"
      | "handed_to_courier"
      | "delivered"
      | "cancelled"
      | "rejected"
      | "failed";
    PaymentState:
      | "pending"
      | "authorized"
      | "captured"
      | "failed"
      | "refunding"
      | "partially_refunded"
      | "refunded";
    DeliveryTaskState:
      | "pending_eligibility"
      | "eligible"
      | "dispatch_requested"
      | "driver_assigned"
      | "timed_out"
      | "reassigned"
      | "exhausted"
      | "picked_up"
      | "in_transit"
      | "arrived"
      | "delivered"
      | "ineligible"
      | "failed"
      | "cancelled";
    ProofType: "otp" | "photo" | "signature" | "pin_code";
    OrderLineInput: {
      product_id: string;
      quantity: number;
    };
    PlaceStoreOrderRequest: {
      customer_ref: components["schemas"]["WaslaPublicId"];
      store_public_id: components["schemas"]["WaslaPublicId"];
      items: components["schemas"]["OrderLineInput"][];
      /** رسومُ التوصيلِ (هللة) — لقطةُ عرضِ التوصيلِ وقتَ الطلبِ. */
      delivery_fee_minor_units: number;
    };
    CancelStoreOrderRequest: {
      reason_code:
        | "CUSTOMER_CHANGED_MIND"
        | "CUSTOMER_UNAVAILABLE"
        | "PAYMENT_FAILED"
        | "STORE_REQUESTED"
        | "SYSTEM_MAINTENANCE"
        | "DELIVERY_NOT_FEASIBLE";
    };
    OrderLine: {
      line_no: number;
      product_id: string;
      sku: string;
      quantity: number;
      unit_price_minor_units: number;
      line_total_minor_units: number;
      substituted_product_id?: string | null;
      substitution_reason?:
        | "out_of_stock"
        | "customer_approved_alternative"
        | "store_policy"
        | null;
    };
    StoreOrderResponse: {
      order_id: string;
      public_id: components["schemas"]["WaslaPublicId"];
      customer_ref: components["schemas"]["WaslaPublicId"];
      store_public_id: components["schemas"]["WaslaPublicId"];
      fulfillment_state: components["schemas"]["FulfillmentState"];
      payment_state: components["schemas"]["PaymentState"];
      currency_code: "SAR";
      items_total_minor_units: number;
      delivery_fee_minor_units: number;
      total_minor_units: number;
      items: components["schemas"]["OrderLine"][];
      version: number;
    };
    DeliveryTaskResponse: {
      task_id: string;
      order_id: string;
      state: components["schemas"]["DeliveryTaskState"];
      ineligibility_reason?:
        | "outside_coverage"
        | "store_not_orderable"
        | "no_courier_service"
        | null;
      dispatch_job_ref?: string | null;
      /** مرجعٌ opaque للمندوبِ — لا اسمَ ولا هاتفَ (ADR-026 §2.6). */
      courier_ref?: components["schemas"]["WaslaPublicId"] | null;
      proof_type?: components["schemas"]["ProofType"] | null;
      proof_ref?: string | null;
      version: number;
    };
    ErrorResponse: {
      /** كودٌ ثابتٌ من كتالوجِ errors.md — لا نصٍّ حرٍّ. */
      error_code: string;
      /** رسالةٌ للسجلِّ لا للمستخدمِ (التوطينُ مسارُ قناةٍ). */
      message: string;
      trace_id: string;
    };
    HealthResponse: {
      status: "ok";
    };
  };
}
