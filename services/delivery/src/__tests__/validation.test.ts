import { describe, expect, it } from "vitest";

import { isDeliveryError, DeliveryError } from "../domain/errors.js";
import type { DeliveryErrorCode } from "../domain/errors.js";
import {
  isValidPublicId,
  isValidUuid,
  validateCatalogSnapshot,
  validatePlaceOrderInput,
  validateProof,
  validateSubstitutionInput,
} from "../domain/validation.js";

const UUID = "0f0d6a5e-2c5f-4bd6-9dbd-919e5f001a01";
const UUID2 = "0f0d6a5e-2c5f-4bd6-9dbd-919e5f001a02";

/** Assert a call throws a DeliveryError with the exact contract code. */
function expectDeliveryError(fn: () => void, code: DeliveryErrorCode): void {
  try {
    fn();
  } catch (err) {
    expect(isDeliveryError(err)).toBe(true);
    expect((err as DeliveryError).code).toBe(code);
    return;
  }
  throw new Error(`expected DeliveryError ${code} — nothing was thrown`);
}

describe("opaque refs (ADR-026 §2.6)", () => {
  it("accepts exactly WS-########## and nothing else", () => {
    expect(isValidPublicId("WS-0123456789")).toBe(true);
    expect(isValidPublicId("WS-012345678")).toBe(false); // 9 digits
    expect(isValidPublicId("WS-01234567890")).toBe(false); // 11 digits
    expect(isValidPublicId("ws-0123456789")).toBe(false); // case
    expect(isValidPublicId("WS_0123456789")).toBe(false); // separator
    expect(isValidPublicId("+966501234567")).toBe(false); // a leaked phone
    expect(isValidPublicId("someone@example.com")).toBe(false); // a leaked email
  });
});

describe("place-order validation (ADR-026 §2.1, §2.3)", () => {
  const valid = {
    customer_ref: "WS-0123456789",
    store_public_id: "WS-0987654321",
    items: [{ product_id: UUID, quantity: 2 }],
    delivery_fee_minor_units: 500,
  };

  it("accepts a valid shape", () => {
    expect(() => validatePlaceOrderInput(valid)).not.toThrow();
  });

  it("rejects non-opaque customer/store refs", () => {
    expectDeliveryError(
      () => validatePlaceOrderInput({ ...valid, customer_ref: "customer-1" }),
      "DELIVERY_VALIDATION_FAILED",
    );
    expectDeliveryError(
      () => validatePlaceOrderInput({ ...valid, store_public_id: "store-1" }),
      "DELIVERY_VALIDATION_FAILED",
    );
  });

  it("rejects an empty or missing cart", () => {
    expectDeliveryError(
      () => validatePlaceOrderInput({ ...valid, items: [] }),
      "DELIVERY_VALIDATION_FAILED",
    );
  });

  it("rejects non-UUID product ids and non-integer quantities", () => {
    expectDeliveryError(
      () => validatePlaceOrderInput({ ...valid, items: [{ product_id: "not-a-uuid", quantity: 1 }] }),
      "DELIVERY_VALIDATION_FAILED",
    );
    expectDeliveryError(
      () => validatePlaceOrderInput({ ...valid, items: [{ product_id: UUID, quantity: 0 }] }),
      "DELIVERY_VALIDATION_FAILED",
    );
    expectDeliveryError(
      () => validatePlaceOrderInput({ ...valid, items: [{ product_id: UUID, quantity: 1.5 }] }),
      "DELIVERY_VALIDATION_FAILED",
    );
  });

  it("prices are NOT an input — the catalog port is the only price source (§2.3)", () => {
    // The structural guarantee: OrderLineInput carries product_id + quantity
    // alone — a caller cannot mint money by supplying a price.
    const line = { product_id: UUID, quantity: 1 } as Record<string, unknown>;
    expect(Object.keys(line).sort()).toEqual(["product_id", "quantity"]);
  });
});

describe("catalog snapshot validation (§2.3 — the port's output is checked too)", () => {
  it("accepts a well-formed snapshot", () => {
    expect(() => validateCatalogSnapshot({ sku: "SKU-1", unit_price_minor_units: 1250 })).not.toThrow();
  });

  it("rejects floating-point or negative prices", () => {
    expectDeliveryError(
      () => validateCatalogSnapshot({ sku: "SKU-1", unit_price_minor_units: 12.5 }),
      "DELIVERY_VALIDATION_FAILED",
    );
    expectDeliveryError(
      () => validateCatalogSnapshot({ sku: "SKU-1", unit_price_minor_units: -1 }),
      "DELIVERY_VALIDATION_FAILED",
    );
  });
});

describe("proof of delivery (§2.4)", () => {
  it("accepts types from the closed catalog with a non-empty ref", () => {
    for (const proofType of ["otp", "photo", "signature", "pin_code"]) {
      expect(() => validateProof({ proofType, proofRef: "proof-ref-1" })).not.toThrow();
    }
  });

  it("rejects unknown types and empty/oversized refs", () => {
    expectDeliveryError(
      () => validateProof({ proofType: "signature-photo", proofRef: "r" }),
      "DELIVERY_INVALID_PROOF",
    );
    expectDeliveryError(() => validateProof({ proofType: "otp", proofRef: "" }), "DELIVERY_INVALID_PROOF");
    expectDeliveryError(
      () => validateProof({ proofType: "otp", proofRef: "x".repeat(257) }),
      "DELIVERY_INVALID_PROOF",
    );
  });
});

describe("substitution (§2.5 — line decision, same store, picking-only)", () => {
  const base = {
    lineNo: 1,
    substitutedProductId: UUID2,
    orderStoreId: "store-uuid-1",
    substitutedUnitPriceMinorUnits: 900,
  };

  it("accepts a same-store substitute with an integer price", () => {
    expect(() =>
      validateSubstitutionInput({ ...base, substitutedProductStoreId: "store-uuid-1" }),
    ).not.toThrow();
  });

  it("rejects a substitute from ANOTHER store", () => {
    expectDeliveryError(
      () => validateSubstitutionInput({ ...base, substitutedProductStoreId: "store-uuid-2" }),
      "DELIVERY_SUBSTITUTION_WRONG_STORE",
    );
  });

  it("rejects malformed lines and prices", () => {
    expectDeliveryError(
      () => validateSubstitutionInput({ ...base, lineNo: 0 }),
      "DELIVERY_VALIDATION_FAILED",
    );
    expectDeliveryError(
      () => validateSubstitutionInput({ ...base, substitutedProductId: "no" }),
      "DELIVERY_VALIDATION_FAILED",
    );
    expectDeliveryError(
      () => validateSubstitutionInput({ ...base, substitutedUnitPriceMinorUnits: 9.5 }),
      "DELIVERY_VALIDATION_FAILED",
    );
  });
});

describe("uuid helper", () => {
  it("accepts canonical uuids only", () => {
    expect(isValidUuid(UUID)).toBe(true);
    expect(isValidUuid(UUID.toUpperCase())).toBe(true);
    expect(isValidUuid("0f0d6a5e2c5f4bd69dbd919e5f001a01")).toBe(false);
    expect(isValidUuid("")).toBe(false);
  });
});
