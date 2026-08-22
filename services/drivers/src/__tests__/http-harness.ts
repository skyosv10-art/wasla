/**
 * One app over the in-memory environment, for the `app.inject` suites.
 *
 * `inject` and not a listening socket: it drives the SAME router, hooks and error
 * handler the process serves, without a port. A suite that bound a port would make the
 * tests order-dependent on a free port and would test the network stack instead of the
 * layer under test.
 *
 * The environment is the one `helpers.environment()` builds — the same seeded policies
 * and the same two known zones the pure use-case tests use — so a difference between an
 * HTTP result and a use-case result is a difference the HTTP layer created.
 */

import { createDriverApp } from "../http/app.js";
import { createDirectRunner } from "../runner.js";
import { environment } from "./helpers.js";
import type { InMemoryDriverEnvironment } from "../infrastructure/in-memory.js";
import type { FastifyInstance } from "fastify";
import type { DriverTickState } from "../http/app.js";

export { DRIVER, NOW, ZONE_A, ZONE_B } from "./helpers.js";

export interface HttpHarness {
  readonly env: InMemoryDriverEnvironment;
  readonly app: FastifyInstance;
  readonly tickState: DriverTickState;
}

export function httpHarness(now?: string): HttpHarness {
  const env = environment(now);
  const tickState: DriverTickState = { lastTickAt: null };
  const app = createDriverApp({ runner: createDirectRunner(env), tickState });
  return { env, app, tickState };
}

/** A distinct key per call; a shared one would be testing replay by accident. */
let counter = 0;
export function key(prefix = "http"): string {
  counter += 1;
  return `${prefix}-idempotency-${counter.toString().padStart(4, "0")}`;
}

export const registration = (waslaPublicId: string): Record<string, unknown> => ({
  wasla_public_id: waslaPublicId,
  display_name: "سائق تجربة",
  service_kinds: ["ride"],
});
