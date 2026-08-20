/**
 * @wasla/contracts-identity
 *
 * Typed Identity contracts generated from the OpenAPI source-of-truth
 * (services/identity/contracts/api.openapi.yml) via `openapi-typescript`.
 *
 * These are Contract First artifacts (ADR-004) — NOT a runtime implementation.
 * Consumers (Telegram adapter, future services) import these types to stay
 * aligned with the published Identity API contract.
 *
 * Regenerate with: pnpm --filter @wasla/contracts-identity generate
 */

export type * from "./api-types.js";

// Re-export the key types for convenience.
import type { paths, components } from "./api-types.js";

/** All API paths and their operations. */
export type { paths };

/**
 * Request payload the Telegram adapter sends to resolve/create a Wasla user
 * from a Telegram identity.
 */
export type ResolveIdentityRequest =
  components["schemas"]["ResolveIdentityRequest"];

/** Response returned on a successful resolve. */
export type ResolveIdentityResponse =
  components["schemas"]["ResolveIdentityResponse"];

/** The resolved/created user entity. */
export type IdentityUser = components["schemas"]["User"];

/** A linked external identity (telegram/phone/email/...). */
export type IdentityLink = components["schemas"]["IdentityLink"];
