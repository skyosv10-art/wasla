/**
 * Shared dependencies injected into Customer Core use cases (hexagonal wiring).
 *
 * Tests inject the in-memory adapters; the HTTP bootstrap (MR 4/6) wires the
 * Postgres repository (MR 3/6) and, from Phase 06, the real order-engine
 * adapter. `orderIntake` is deliberately required: a build with no adapter must
 * be impossible, and the fail-closed default (`UnavailableOrderIntake`) has to
 * be chosen explicitly rather than happen by omission.
 */

import type {
  Clock,
  CustomerRepository,
  GeographyPort,
  IdGenerator,
  IdentityLookupPort,
  OrderIntakePort,
  Outbox,
} from "../ports.js";

export interface UseCaseDeps {
  repo: CustomerRepository;
  outbox: Outbox;
  clock: Clock;
  idGen: IdGenerator;
  identityLookup: IdentityLookupPort;
  geography: GeographyPort;
  orderIntake: OrderIntakePort;
  /** Optional correlation id propagated into event envelopes and errors. */
  traceId?: string;
}

/** Event context built from the injected clock and id generator. */
export function eventContext(deps: UseCaseDeps): {
  eventId: string;
  occurredAt: string;
  traceId?: string;
} {
  return {
    eventId: deps.idGen.uuid(),
    occurredAt: deps.clock.now(),
    ...(deps.traceId === undefined ? {} : { traceId: deps.traceId }),
  };
}
