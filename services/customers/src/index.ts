/**
 * @wasla/customers-service — WASLA Customer Core domain (Phase 04).
 *
 * MR 2/6 delivered the pure core: the domain model, the ports, the use cases and
 * the in-memory adapters. MR 3/6 added the Postgres adapters behind the very same
 * ports — proven by `src/__tests__/port-conformance.integration.test.ts`, which
 * runs one set of scenarios through both adapters. MR 4/6 adds the HTTP layer
 * (`createCustomerApp`, port 8086) plus the HTTP adapters for the identity and
 * geography read ports; `src/http/server.ts` is the composition root and is the
 * only module that opens a connection.
 *
 * The Postgres exports are types and classes only; importing this package never
 * opens a connection. `createCustomerDb` does, and only when called.
 *
 * Contract First (ADR-004): the API DTOs, event types and the error catalog come
 * from @wasla/contracts-customer, which is drift-guarded against the contract
 * files in services/customers/contracts/.
 *
 * Phase 04 exit gate: "a customer creates a valid Order that reaches the Order
 * Engine with no real matching yet" — the handover contract is `OrderIntakePort`
 * and the gate itself is proven end to end in MR 6/6.
 */

export * from "./domain/model.js";
export * from "./domain/errors.js";
export * from "./domain/validation.js";
export * from "./domain/events.js";
export * from "./ports.js";
export * from "./infrastructure/in-memory.js";
export { HttpIdentityLookupPort } from "./infrastructure/http-identity-lookup.js";
export type { HttpIdentityLookupOptions } from "./infrastructure/http-identity-lookup.js";
export { HttpGeographyPort } from "./infrastructure/http-geography.js";
export type { HttpGeographyOptions } from "./infrastructure/http-geography.js";

export * as customerSchema from "./infrastructure/drizzle/schema.js";
export { createCustomerDb } from "./infrastructure/drizzle/db.js";
export type { Db, DbConfig } from "./infrastructure/drizzle/db.js";
export {
  PostgresCustomerOutbox,
  PostgresCustomerRepository,
} from "./infrastructure/drizzle/repository.js";

export type { UseCaseDeps } from "./use-cases/deps.js";
export { eventContext } from "./use-cases/deps.js";
export { requireActiveZone, requireActiveZones } from "./use-cases/zones.js";

export {
  getCustomerProfile,
  upsertCustomerProfile,
} from "./use-cases/customer-profile.js";
export type {
  UpsertCustomerProfileInput,
  UpsertCustomerProfileResult,
} from "./use-cases/customer-profile.js";

export {
  listSavedPlaces,
  removeSavedPlace,
  savePlace,
} from "./use-cases/saved-places.js";
export type { SavePlaceInput, SavePlaceResult } from "./use-cases/saved-places.js";

export {
  getOrderRequest,
  listOrderRequests,
  previewOrderRequest,
  submitOrderRequest,
} from "./use-cases/order-requests.js";
export type {
  PreviewOrderRequestResult,
  SubmitOrderRequestInput,
  SubmitOrderRequestResult,
} from "./use-cases/order-requests.js";

export { createCustomerApp } from "./http/app.js";
export type {
  CreateCustomerAppOptions,
  CustomerHealthDescriptor,
} from "./http/app.js";
export { sendCustomerError } from "./http/errors.js";
export type { CustomerErrorBody } from "./http/errors.js";
export {
  requireIdempotencyKey,
  toListLimit,
  toOrderRequestDraft,
  toProfilePatch,
  toSavedPlaceDraft,
} from "./http/requests.js";

export {
  toCustomerProfileDto,
  toOrderIntakeRequestDto,
  toOrderRequestDto,
  toOrderRequestPreviewDto,
  toSavedPlaceDto,
  toStopDto,
} from "./use-cases/mappers.js";
