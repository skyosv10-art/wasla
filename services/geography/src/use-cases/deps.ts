/**
 * Shared dependencies injected into geography use cases (hexagonal wiring).
 *
 * Tests inject in-memory adapters; the bootstrap (MR 5 Fastify server) wires
 * Postgres adapters (MR 4). The `identityLookup` port validates that a
 * wasla_public_id references a real identity without coupling to identity
 * internals (ADR-006).
 */

import type {
  Clock,
  IdGenerator,
  GeographyRepository,
  IdentityLookupPort,
  Outbox,
} from "../ports.js";

export interface UseCaseDeps {
  repo: GeographyRepository;
  outbox: Outbox;
  clock: Clock;
  idGen: IdGenerator;
  identityLookup: IdentityLookupPort;
  /** Optional correlation id propagated into event envelopes. */
  traceId?: string;
}

/** Supported locale accepted by use cases (ar = default/fallback). */
export type UseCaseLocale = "ar" | "en" | "ur";
