import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  CustomerProfile,
  UpsertCustomerProfileRequest,
  SavedPlace,
  CreateSavedPlaceRequest,
  OrderRequestInput,
  OrderRequest,
  OrderRequestPreview,
  OrderIntakeRequest,
  OrderIntakeResult,
  ErrorResponse,
  Money,
  Stop,
  StopInput,
  CustomerErrorCode,
  paths,
} from "../index.js";
import {
  CUSTOMER_ERROR_CODES,
  CUSTOMER_ERROR_CODE_CLASS,
  CUSTOMER_ERROR_CLASS_STATUS,
  httpStatusForCustomerError,
  SAVED_PLACES_LIMIT,
  STOPS_PER_ORDER_REQUEST,
  WASLA_PUBLIC_ID_PATTERN,
} from "../index.js";

/**
 * Contract First smoke tests (ADR-004) — compile-time type checks confirming
 * the generated types align with the published OpenAPI contract, plus runtime
 * drift guards that read the canonical contract files (errors.md, schema.sql,
 * api.openapi.yml) and assert the ADR-009 boundaries still hold.
 */

const CONTRACTS_DIR = resolve(
  __dirname,
  "../../../../../services/customers/contracts",
);
const errorsMd = readFileSync(resolve(CONTRACTS_DIR, "errors.md"), "utf8");
const schemaSql = readFileSync(resolve(CONTRACTS_DIR, "schema.sql"), "utf8");
const openApiYml = readFileSync(
  resolve(CONTRACTS_DIR, "api.openapi.yml"),
  "utf8",
);

describe("@wasla/contracts-customer (typed contracts)", () => {
  it("exposes the customer profile shape", () => {
    const profile: CustomerProfile = {
      wasla_public_id: "WS-0000010427",
      display_name: "أحمد",
      preferred_locale: "ar",
      default_zone_id: "550e8400-e29b-41d4-a716-446655440000",
      status: "active",
      created_at: "2026-08-21T09:00:00Z",
      updated_at: "2026-08-21T09:00:00Z",
    };
    expect(profile.wasla_public_id).toMatch(WASLA_PUBLIC_ID_PATTERN);
    expect(profile.status).toBe("active");
  });

  it("accepts a profile upsert body without a public id in the body", () => {
    const body: UpsertCustomerProfileRequest = {
      display_name: "أحمد",
      preferred_locale: "ar",
      default_zone_id: null,
    };
    expect(body.preferred_locale).toBe("ar");
  });

  it("exposes saved place shapes with zone as the required anchor", () => {
    const create: CreateSavedPlaceRequest = {
      label: "البيت",
      zone_id: "550e8400-e29b-41d4-a716-446655440000",
      address_text: "حي الأنصار",
      coordinates: { latitude: 24.4686, longitude: 39.6142 },
    };
    const place: SavedPlace = {
      id: "660e8400-e29b-41d4-a716-446655440001",
      label: create.label,
      zone_id: create.zone_id,
      address_text: create.address_text,
      coordinates: create.coordinates,
      created_at: "2026-08-21T09:00:00Z",
    };
    expect(place.zone_id).toBe(create.zone_id);
  });

  it("models money as integer minor units plus an ISO currency", () => {
    const money: Money = { amount_minor: 2500, currency: "SAR" };
    expect(Number.isInteger(money.amount_minor)).toBe(true);
    expect(money.currency).toMatch(/^[A-Z]{3}$/);
  });

  it("accepts a valid ride order request with a customer offer", () => {
    const pickup: StopInput = {
      kind: "pickup",
      zone_id: "550e8400-e29b-41d4-a716-446655440000",
      label: "المسجد النبوي",
      source: "map",
    };
    const dropoff: StopInput = {
      kind: "dropoff",
      zone_id: "660e8400-e29b-41d4-a716-446655440001",
      source: "saved_place",
      saved_place_id: "770e8400-e29b-41d4-a716-446655440002",
    };
    const input: OrderRequestInput = {
      order_type: "ride",
      vehicle_class: "sedan",
      price_mode: "customer_offer",
      offered_price: { amount_minor: 3000, currency: "SAR" },
      stops: [pickup, dropoff],
      notes: "عند البوابة الشمالية",
    };
    expect(input.stops).toHaveLength(STOPS_PER_ORDER_REQUEST);
    expect(input.price_mode).toBe("customer_offer");
  });

  it("accepts a negotiable delivery request with shipment details", () => {
    const input: OrderRequestInput = {
      order_type: "delivery",
      vehicle_class: "motorcycle",
      price_mode: "negotiable",
      stops: [
        { kind: "pickup", zone_id: "550e8400-e29b-41d4-a716-446655440000", source: "manual_zone" },
        { kind: "dropoff", zone_id: "660e8400-e29b-41d4-a716-446655440001", source: "telegram_location" },
      ],
      shipment: { shipment_type: "documents", description: "أوراق", weight_kg: 0.5 },
    };
    expect(input.shipment?.shipment_type).toBe("documents");
    expect(input.offered_price).toBeUndefined();
  });

  it("exposes the preview shape with non-blocking warnings", () => {
    const preview: OrderRequestPreview = {
      valid: true,
      order_type: "ride",
      vehicle_class: "sedan",
      price_mode: "negotiable",
      warnings: ["no_price_offered"],
      stops: [
        {
          sequence: 1,
          kind: "pickup",
          zone_id: "550e8400-e29b-41d4-a716-446655440000",
          source: "map",
        },
        {
          sequence: 2,
          kind: "dropoff",
          zone_id: "660e8400-e29b-41d4-a716-446655440001",
          source: "map",
        },
      ],
    };
    expect(preview.valid).toBe(true);
    expect(preview.warnings).toContain("no_price_offered");
  });

  it("keeps order_public_id nullable — the order engine owns it", () => {
    const stops: Stop[] = [
      { sequence: 1, kind: "pickup", zone_id: "550e8400-e29b-41d4-a716-446655440000", source: "map" },
      { sequence: 2, kind: "dropoff", zone_id: "660e8400-e29b-41d4-a716-446655440001", source: "map" },
    ];
    const request: OrderRequest = {
      id: "880e8400-e29b-41d4-a716-446655440003",
      wasla_public_id: "WS-0000010427",
      status: "submission_failed",
      order_type: "ride",
      vehicle_class: "suv",
      price_mode: "negotiable",
      stops,
      order_public_id: null,
      created_at: "2026-08-21T09:00:00Z",
    };
    expect(request.order_public_id).toBeNull();
    expect(request.status).toBe("submission_failed");
  });

  it("exposes the order intake port payload and result", () => {
    const intake: OrderIntakeRequest = {
      order_request_id: "880e8400-e29b-41d4-a716-446655440003",
      customer_public_id: "WS-0000010427",
      order_type: "ride",
      vehicle_class: "sedan",
      price_mode: "customer_offer",
      offered_price: { amount_minor: 3000, currency: "SAR" },
      stops: [
        { sequence: 1, kind: "pickup", zone_id: "550e8400-e29b-41d4-a716-446655440000", source: "map" },
        { sequence: 2, kind: "dropoff", zone_id: "660e8400-e29b-41d4-a716-446655440001", source: "map" },
      ],
      requested_at: "2026-08-21T09:00:00Z",
    };
    const result: OrderIntakeResult = {
      order_public_id: "ORD-000000123",
      accepted_at: "2026-08-21T09:00:01Z",
    };
    expect(intake.customer_public_id).toMatch(WASLA_PUBLIC_ID_PATTERN);
    expect(result.order_public_id).toBeTruthy();
  });

  it("uses the standard error payload shape { code, message, trace_id }", () => {
    const err: ErrorResponse = {
      code: "CUSTOMER_PRICE_MODE_MISMATCH",
      message: "لا يمكن إرسال مبلغ في الوضع التفاوضي",
      trace_id: "01HXY000000000000000000000",
    };
    expect(err.code).toBe("CUSTOMER_PRICE_MODE_MISMATCH");
  });

  it("declares the documented paths", () => {
    type Paths = keyof paths;
    const declared: Paths[] = [
      "/customers/{waslaPublicId}/profile",
      "/customers/{waslaPublicId}/places",
      "/customers/{waslaPublicId}/places/{placeId}",
      "/customers/{waslaPublicId}/order-requests/preview",
      "/customers/{waslaPublicId}/order-requests",
      "/customers/{waslaPublicId}/order-requests/{orderRequestId}",
      "/health",
    ];
    expect(declared).toHaveLength(7);
  });
});

describe("error catalog drift guard (errors.md)", () => {
  /** Parse `| \`CODE\` | \`class\` | ...` rows out of the catalog table. */
  const documented = new Map<string, string>();
  for (const line of errorsMd.split("\n")) {
    const m = line.match(/^\|\s*`(CUSTOMER_[A-Z_]+)`\s*\|\s*`([a-z_]+)`\s*\|/);
    if (m) documented.set(m[1], m[2]);
  }

  it("finds the documented catalog", () => {
    expect(documented.size).toBeGreaterThan(10);
  });

  it("CUSTOMER_ERROR_CODES matches the codes documented in errors.md", () => {
    // Intake reason codes live in their own table and are not HTTP error codes.
    const reasonOnly = new Set([
      "CUSTOMER_ORDER_INTAKE_REJECTED",
      "CUSTOMER_ORDER_INTAKE_TIMEOUT",
    ]);
    const docCodes = [...documented.keys()].filter((c) => !reasonOnly.has(c)).sort();
    expect([...CUSTOMER_ERROR_CODES].sort()).toEqual(docCodes);
  });

  it("each code's class matches errors.md", () => {
    for (const code of CUSTOMER_ERROR_CODES) {
      expect(documented.get(code)).toBe(CUSTOMER_ERROR_CODE_CLASS[code]);
    }
  });

  it("derives only documented HTTP statuses", () => {
    const allowed = new Set(Object.values(CUSTOMER_ERROR_CLASS_STATUS));
    for (const code of CUSTOMER_ERROR_CODES) {
      expect(allowed.has(httpStatusForCustomerError(code) as 400)).toBe(true);
    }
    expect(httpStatusForCustomerError("CUSTOMER_ORDER_INTAKE_UNAVAILABLE")).toBe(503);
    expect(httpStatusForCustomerError("CUSTOMER_IDEMPOTENCY_KEY_REUSED")).toBe(409);
    expect(httpStatusForCustomerError("CUSTOMER_MULTI_STOP_NOT_SUPPORTED")).toBe(422);
  });

  it("has no duplicate codes", () => {
    expect(new Set(CUSTOMER_ERROR_CODES).size).toBe(CUSTOMER_ERROR_CODES.length);
  });

  it("codes are asserted, never Arabic copy: every code is SCREAMING_SNAKE ASCII", () => {
    for (const code of CUSTOMER_ERROR_CODES) {
      expect(code).toMatch(/^CUSTOMER_[A-Z_]+$/);
    }
  });
});

describe("ADR-009 boundary guards (schema.sql)", () => {
  it("never declares or writes an orders table — the engine owns orders", () => {
    expect(schemaSql).not.toMatch(/CREATE TABLE IF NOT EXISTS orders\b/);
    expect(schemaSql).not.toMatch(/REFERENCES\s+orders\b/i);
  });

  it("holds no FK to identity or geography tables (cross-service encapsulation)", () => {
    expect(schemaSql).not.toMatch(/REFERENCES\s+identity_users/i);
    expect(schemaSql).not.toMatch(/REFERENCES\s+geo_zones/i);
  });

  it("guards the public id format with a CHECK on every owning table", () => {
    const checks = schemaSql.match(/wasla_public_id ~ '\^WS-\[0-9\]\{10\}\$'/g) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps money integral (BIGINT minor units, no NUMERIC amount)", () => {
    expect(schemaSql).toMatch(/offered_amount_minor\s+BIGINT/);
    expect(schemaSql).not.toMatch(/offered_amount\s+NUMERIC/);
  });

  it("enforces idempotency uniqueness per customer for writes", () => {
    expect(schemaSql).toMatch(
      /ux_customer_order_requests_idempotency[\s\S]*?\(wasla_public_id, idempotency_key\)/,
    );
    expect(schemaSql).toMatch(
      /ux_customer_saved_places_idempotency[\s\S]*?\(wasla_public_id, idempotency_key\)/,
    );
  });

  it("stores stops as an ordered list, so multi-stop needs no migration", () => {
    expect(schemaSql).toMatch(/PRIMARY KEY \(order_request_id, sequence\)/);
    expect(schemaSql).not.toMatch(/UNIQUE\s*\(order_request_id, kind\)/i);
  });

  it("keeps order_public_id nullable and unowned", () => {
    expect(schemaSql).toMatch(/order_public_id\s+TEXT,/);
    expect(schemaSql).not.toMatch(/order_public_id\s+TEXT\s+NOT NULL/);
  });
});

describe("ADR-009 boundary guards (api.openapi.yml)", () => {
  it("requires Idempotency-Key on order-request and saved-place creation", () => {
    // Declared once as a reusable parameter component, referenced by both POSTs.
    expect(openApiYml).toMatch(
      /IdempotencyKey:\s*\n\s*name: Idempotency-Key\s*\n\s*in: header\s*\n\s*required: true/,
    );
    const refs =
      openApiYml.match(/\$ref: '#\/components\/parameters\/IdempotencyKey'/g) ?? [];
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });

  it("caps stops at exactly two for this phase", () => {
    expect(openApiYml).toMatch(/minItems: 2\s*\n\s*maxItems: 2/);
  });

  it("exposes no endpoint that mutates orders", () => {
    expect(openApiYml).not.toMatch(/^\s{2}\/orders/m);
    expect(openApiYml).not.toMatch(/operationId: (create|cancel|assign)Order\b/);
  });

  it("documents the local policy limits used by the use-case layer", () => {
    expect(SAVED_PLACES_LIMIT).toBe(20);
    expect(STOPS_PER_ORDER_REQUEST).toBe(2);
  });

  it("keeps the error code type usable as a discriminator", () => {
    const code: CustomerErrorCode = "CUSTOMER_ZONE_INACTIVE";
    expect(CUSTOMER_ERROR_CODES).toContain(code);
  });
});
