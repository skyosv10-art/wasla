/**
 * Delivery service input validation.
 *
 * Pure functions, no I/O: they decide whether a shape may enter the domain.
 * Everything rejected here is rejected BEFORE any decision is recorded — a
 * validation failure must never reach the transition ledger.
 *
 * The OpaquePublicId rule (ADR-026 §2.6): every external human/store
 * reference is `WS-` + exactly 10 digits. Not "some string" — a shape, so a
 * leaked email or phone number is a validation error, not an incident.
 */

import { DeliveryError } from "./errors.js";

/** WS-########## — opaque by construction. */
const PUBLIC_ID_PATTERN = /^WS-[0-9]{10}$/;

export function isValidPublicId(value: string): boolean {
  return PUBLIC_ID_PATTERN.test(value);
}

export function assertPublicId(value: string, field: string): void {
  if (!isValidPublicId(value)) {
    throw new DeliveryError("DELIVERY_VALIDATION_FAILED", `${field} ليس مرجعًا opaque صالحًا`, {
      details: { field, actual: value },
    });
  }
}

/** An item line as it arrives from the (deferred) API surface. */
export interface OrderLineInput {
  readonly product_id: string;
  readonly quantity: number;
}

export interface PlaceOrderInput {
  readonly customer_ref: string;
  readonly store_public_id: string;
  readonly items: readonly OrderLineInput[];
  readonly delivery_fee_minor_units?: number;
}

/**
 * Validate a place-order request shape.
 *
 * Note what is NOT accepted: prices. The unit price snapshot is taken from
 * the marketplace catalog port at order time (§2.3) — a caller-supplied
 * price would let the caller mint money.
 */
export function validatePlaceOrderInput(input: PlaceOrderInput): void {
  assertPublicId(input.customer_ref, "customer_ref");
  assertPublicId(input.store_public_id, "store_public_id");

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new DeliveryError("DELIVERY_VALIDATION_FAILED", "الطلب يجب أن يحمل صنفًا واحدًا على الأقل", {
      details: { field: "items" },
    });
  }

  for (const [index, item] of input.items.entries()) {
    if (!isValidUuid(item.product_id)) {
      throw new DeliveryError("DELIVERY_VALIDATION_FAILED", `product_id للسطر ${index + 1} ليس UUID`, {
        details: { field: `items[${index}].product_id` },
      });
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new DeliveryError("DELIVERY_VALIDATION_FAILED", `كمية السطر ${index + 1} يجب أن تكون عددًا صحيحًا ≥ 1`, {
        details: { field: `items[${index}].quantity`, actual: String(item.quantity) },
      });
    }
  }

  const fee = input.delivery_fee_minor_units ?? 0;
  if (!Number.isInteger(fee) || fee < 0) {
    throw new DeliveryError("DELIVERY_VALIDATION_FAILED", "رسوم التوصيل يجب أن تكون عددًا صحيحًا ≥ 0", {
      details: { field: "delivery_fee_minor_units" },
    });
  }
}

/**
 * Validate a snapshot line as it comes back from the marketplace catalog
 * port (§2.3). The port is the only price source — and even its output is
 * checked for shape before it becomes an order snapshot.
 */
export function validateCatalogSnapshot(
  snapshot: { sku: string; unit_price_minor_units: number; quantity_on_hand?: number },
): void {
  if (typeof snapshot.sku !== "string" || snapshot.sku.length < 1 || snapshot.sku.length > 64) {
    throw new DeliveryError("DELIVERY_VALIDATION_FAILED", "sku من منفذ الكتالوج غير صالح", {
      details: { field: "sku" },
    });
  }
  if (!Number.isInteger(snapshot.unit_price_minor_units) || snapshot.unit_price_minor_units < 0) {
    throw new DeliveryError("DELIVERY_VALIDATION_FAILED", "سعر الكتالوج يجب أن يكون عددًا صحيحًا ≥ 0", {
      details: { field: "unit_price_minor_units" },
    });
  }
}

/** Validate proof of delivery shape (§2.4): type from the closed catalog + non-empty ref. */
export function validateProof(
  proof: { proofType: string; proofRef: string },
): void {
  const validTypes = ["otp", "photo", "signature", "pin_code"];
  if (!validTypes.includes(proof.proofType)) {
    throw new DeliveryError("DELIVERY_INVALID_PROOF", "نوع الإثبات ليس من الكتالوج المغلق", {
      details: { field: "proof_type", actual: proof.proofType },
    });
  }
  if (typeof proof.proofRef !== "string" || proof.proofRef.length < 1 || proof.proofRef.length > 256) {
    throw new DeliveryError("DELIVERY_INVALID_PROOF", "مرجع الإثبات مفقود أو طويل", {
      details: { field: "proof_ref" },
    });
  }
}

/** Validate a substitution request window precondition (§2.5 callers re-check state). */
export function validateSubstitutionInput(input: {
  lineNo: number;
  substitutedProductId: string;
  substitutedStoreProductId?: string;
  orderStoreId: string;
  substitutedProductStoreId?: string;
  substitutedUnitPriceMinorUnits: number;
}): void {
  if (!Number.isInteger(input.lineNo) || input.lineNo < 1) {
    throw new DeliveryError("DELIVERY_VALIDATION_FAILED", "رقم السطر يجب أن يكون عددًا صحيحًا ≥ 1", {
      details: { field: "line_no" },
    });
  }
  if (!isValidUuid(input.substitutedProductId)) {
    throw new DeliveryError("DELIVERY_VALIDATION_FAILED", "معرّف المنتج البديل ليس UUID", {
      details: { field: "substituted_product_id" },
    });
  }
  // Same store, always (§2.5): a substitute from another store is a new order.
  if (
    input.substitutedProductStoreId !== undefined &&
    input.substitutedProductStoreId !== input.orderStoreId
  ) {
    throw new DeliveryError(
      "DELIVERY_SUBSTITUTION_WRONG_STORE",
      "البديل من متجر آخر — الاستبدال داخل المتجر نفسه فقط",
      { details: { expected: input.orderStoreId, actual: input.substitutedProductStoreId } },
    );
  }
  if (
    !Number.isInteger(input.substitutedUnitPriceMinorUnits) ||
    input.substitutedUnitPriceMinorUnits < 0
  ) {
    throw new DeliveryError("DELIVERY_VALIDATION_FAILED", "سعر البديل يجب أن يكون عددًا صحيحًا ≥ 0", {
      details: { field: "substituted_unit_price_minor_units" },
    });
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
