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
 *  - `courier_ref` / `customer_ref` are opaque WS-##########; `store_slug` is
 *    the marketplace's published store slug (review 8/N, ADR-026 §4.11)
 *    refs — no names, no phones, no coordinates anywhere (§2.6).
 *  - The HTTP layer is IMPLEMENTED since review 6/N (ADR-026 §4.2 lifted).
 *  - Both write operations REQUIRE an `Idempotency-Key` header since review
 *    7/N (§4.9-3 lifted); a replay answers the stored status/body verbatim and
 *    a same-key-different-request is `409 DELIVERY_IDEMPOTENCY_KEY_REUSED`.
 *  - `getDeliveryReadiness` is the ONE operation whose 503 body is not
 *    `ErrorResponse` — it reports state, not a defect (errors.md rule 6).
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
  "/store-orders/{orderPublicId}/payment-mirror": {
    put: operations["mirrorStoreOrderPayment"];
  };
  "/store-orders/{orderPublicId}/confirmation": {
    post: operations["confirmStoreOrder"];
  };
  "/store-orders/{orderPublicId}/delivery-task": {
    get: operations["getDeliveryTaskForOrder"];
  };
  "/delivery/health": {
    get: operations["getDeliveryHealth"];
  };
  "/delivery/ready": {
    get: operations["getDeliveryReadiness"];
  };
}

export interface operations {
  placeStoreOrder: {
    parameters: {
      header: { "Idempotency-Key": string };
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["PlaceStoreOrderRequest"];
      };
    };
    responses: {
      "201": { content: { "application/json": components["schemas"]["StoreOrderResponse"] } };
      "400": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "409": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "500": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "503": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
    };
  };
  getStoreOrder: {
    parameters: {
      path: { orderPublicId: components["schemas"]["WaslaPublicId"] };
    };
    responses: {
      "200": { content: { "application/json": components["schemas"]["StoreOrderResponse"] } };
      "400": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "404": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "500": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
    };
  };
  cancelStoreOrder: {
    parameters: {
      path: { orderPublicId: components["schemas"]["WaslaPublicId"] };
      header: { "Idempotency-Key": string };
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["CancelStoreOrderRequest"];
      };
    };
    responses: {
      "200": { content: { "application/json": components["schemas"]["StoreOrderResponse"] } };
      "400": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "404": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "409": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "500": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
    };
  };
  /**
   * المراجعةُ 9/N — مرآةُ الدفعِ (ADR-026 §2.2 · §3.2 · §4.12).
   *
   * `PUT` لا `POST`: المُرسِلُ يُعلنُ **حالةَ** المرآةِ التي يراها لا فعلاً يطلبُه،
   * وإعلانُ الحالةِ نفسِها مرّتَينِ لا يُنشئُ شيئاً ثانياً — وهذا معنى المرآةِ.
   */
  mirrorStoreOrderPayment: {
    parameters: {
      path: { orderPublicId: components["schemas"]["WaslaPublicId"] };
      header: { "Idempotency-Key": string };
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["PaymentMirrorRequest"];
      };
    };
    responses: {
      "200": { content: { "application/json": components["schemas"]["StoreOrderResponse"] } };
      "400": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "404": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "409": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "500": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
    };
  };
  /** المراجعةُ 9/N — البوّابةُ المركَّبةُ: placed → confirmed (ADR-026 §2.2). */
  confirmStoreOrder: {
    parameters: {
      path: { orderPublicId: components["schemas"]["WaslaPublicId"] };
      header: { "Idempotency-Key": string };
    };
    responses: {
      "200": { content: { "application/json": components["schemas"]["StoreOrderResponse"] } };
      "400": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "404": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "409": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "500": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
    };
  };
  getDeliveryTaskForOrder: {
    parameters: {
      path: { orderPublicId: components["schemas"]["WaslaPublicId"] };
    };
    responses: {
      "200": { content: { "application/json": components["schemas"]["DeliveryTaskResponse"] } };
      "400": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "404": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
      "500": { content: { "application/json": components["schemas"]["ErrorResponse"] } };
    };
  };
  getDeliveryHealth: {
    responses: {
      "200": { content: { "application/json": components["schemas"]["HealthResponse"] } };
    };
  };
  getDeliveryReadiness: {
    responses: {
      "200": { content: { "application/json": components["schemas"]["ReadinessResponse"] } };
      /** الجسمُ جاهزيّةٌ لا خطأٌ — استثناءٌ مُعلَنٌ واحدٌ (errors.md قاعدةُ 6). */
      "503": { content: { "application/json": components["schemas"]["ReadinessResponse"] } };
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
    /** slug متجرِ السوقِ: `^[a-z][a-z0-9-]{2,47}$` (المراجعةُ 8/N). */
    StoreSlug: string;
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
    InventoryState:
      | "none"
      | "reserving"
      | "reserved"
      | "released"
      | "consumed";
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
      store_slug: components["schemas"]["StoreSlug"];
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
    /**
     * مرآةُ نيّةِ دفعٍ خارجيّةٍ: **حالةٌ** ومرجعٌ وسببٌ مغلقٌ — لا مبلغَ ولا وسيلةَ
     * دفعٍ ولا أيَّ حقلٍ ماليٍّ. هذه الخدمةُ لا تُعالجُ مالاً (ADR-026 §2.2)، ومن
     * يُرسلُ المبلغَ هنا يجعلُ الخدمةَ طرفاً ماليّاً بلا قرارٍ يُجيزُ ذلك.
     */
    PaymentMirrorRequest: {
      payment_state: components["schemas"]["PaymentState"];
      reason_code:
        | "AUTHORIZATION_SUCCEEDED"
        | "CAPTURE_SUCCEEDED"
        | "AUTHORIZATION_FAILED"
        | "REFUND_INITIATED"
        | "REFUND_COMPLETED"
        | "PARTIAL_REFUND_COMPLETED";
      /** مرجعُ النيّةِ عندَ مُزوِّدِ الدفعِ — opaque، 1..128 محرفاً. */
      payment_ref?: string | null;
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
      store_slug: components["schemas"]["StoreSlug"];
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
    ReadinessCheck: {
      name: "database";
      ok: boolean;
      /** سببٌ مقتضبٌ للسجلِّ — لا أسرارَ ولا مُدخَلاتٍ. */
      detail?: string;
    };
    ReadinessResponse: {
      status: "ready" | "unavailable";
      checks: components["schemas"]["ReadinessCheck"][];
      /** تبعيّاتٌ مُعلَنةٌ غيرُ موصولةٍ — لا تُسبَرُ ولا تُدّعى. */
      not_claimed: ("marketplace_catalog_not_wired" | "marketplace_catalog_not_probed")[];
    };
  };
}
