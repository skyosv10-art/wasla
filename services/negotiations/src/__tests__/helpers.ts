/**
 * Test fixtures.
 *
 * Two rules the whole suite follows, and both are load-bearing:
 *
 *   1. **Assert codes, never Arabic copy.** `expect(err.code).toBe("NEGOTIATION_…")`.
 *      A test that asserts a message turns every wording improvement into a red build,
 *      so the wording stops improving.
 *   2. **Move the clock, never sleep.** Every deadline in this service is checked
 *      against an injected `Clock`, so expiry is tested by setting a time. A suite that
 *      waits 120 seconds for a round TTL is a suite somebody deletes.
 */

import { expect } from "vitest";

import { isNegotiationError } from "../domain/errors.js";
import {
  createInMemoryNegotiationDependencies,
  type InMemoryNegotiationDependencies,
} from "../infrastructure/in-memory.js";
import { LAUNCH_POLICY_VERSION } from "../domain/policy.js";
import { openThread } from "../use-cases/open-thread.js";
import type { NegotiationThread } from "../domain/model.js";

export const ORDER_ID = "ORD-1000000001";
export const CUSTOMER_ID = "WS-2000000001";
export const DRIVER_ID = "WS-3000000001";
export const OFFER_ID = "11111111-1111-4111-8111-111111111111";
export const START = "2026-08-23T00:00:00.000Z";

/** Deps with one active, negotiable dispatch offer already known. */
export function makeDeps(): InMemoryNegotiationDependencies {
  const deps = createInMemoryNegotiationDependencies();
  deps.clock.set(START);
  deps.offers.put({
    dispatchOfferId: OFFER_ID,
    orderPublicId: ORDER_ID,
    driverPublicId: DRIVER_ID,
    serviceKind: "ride",
    active: true,
    negotiable: true,
  });
  return deps;
}

let keyCounter = 0;

/** A fresh idempotency key of legal length (8..128). */
export function key(label = "k"): string {
  keyCounter += 1;
  return `${label}-idem-${String(keyCounter).padStart(6, "0")}`;
}

export function openInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_public_id: ORDER_ID,
    customer_public_id: CUSTOMER_ID,
    driver_public_id: DRIVER_ID,
    dispatch_offer_id: OFFER_ID,
    service_kind: "ride",
    opening_amount_minor: 3000,
    currency: "SAR",
    opened_by: "customer",
    ...overrides,
  };
}

/** The common arrangement: one open thread, nothing proposed yet. */
export async function withOpenThread(
  deps: InMemoryNegotiationDependencies = makeDeps(),
  overrides: Record<string, unknown> = {},
): Promise<{ deps: InMemoryNegotiationDependencies; thread: NegotiationThread }> {
  const result = await openThread(deps, openInput(overrides) as never, {
    idempotencyKey: key("open"),
  });
  return { deps, thread: result.thread };
}

/**
 * Assert that a call fails with a specific published error code.
 *
 * Returns the error so a test can go on to check `details` — which is where the
 * database constraint name lives, and the reason a reader can find the second line of
 * defence instead of assuming the rule exists only in TypeScript.
 */
export async function expectCode(
  operation: Promise<unknown>,
  code: string,
): Promise<{ code: string; details?: Record<string, unknown> }> {
  try {
    await operation;
  } catch (error) {
    if (!isNegotiationError(error)) {
      throw new Error(`expected NegotiationError ${code}, got ${String(error)}`);
    }
    expect(error.code).toBe(code);
    return { code: error.code, details: error.details as Record<string, unknown> };
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

export const LAUNCH_POLICY = LAUNCH_POLICY_VERSION;
