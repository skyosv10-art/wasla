/**
 * The choice of OUTBOUND adapters, read from an environment bag (Phase 05 · MR 5/6).
 *
 * ## Why this is a module and not two functions inside `http/server.ts`
 *
 * As of MR 5/6 this service has two composition roots, not one: its own HTTP process
 * (`http/server.ts`, port 8090) and the driver bot, which reaches the same use cases in
 * process (`bots/driver-bot/src/driver-core.ts`). Both must answer the same two
 * questions — where does a candidacy publication go, and what counts as a real zone —
 * and if each answered them privately the two would drift. The failure that drift
 * produces is specific and nasty: the bot would accept a zone the HTTP service rejects,
 * or publish nowhere while the service publishes to matching, and a driver's verdict
 * would depend on which surface he happened to use.
 *
 * So the rule is one line: **a root chooses whether to call this; it never re-derives
 * what it returns.**
 *
 * ## The shape both questions share
 *
 * A URL variable present → the real adapter. Absent → a fallback that is *visible*:
 * either a refusal carrying a readable code, or a degraded catalogue that warns. And
 * nothing defaults to a URL — guessing `http://localhost:8088` would turn a missing
 * variable into someone else's outage in every log an operator reads afterwards.
 *
 * The environment is a parameter and not `process.env`, so a test states the
 * configuration it is describing instead of mutating the process it runs in.
 */

import { createServiceRequestSigner, keyRegistryFromEnv } from "@wasla/service-auth";

import { DRIVERS_MATCHING_SCOPES, HttpCandidacyPort } from "./http-candidacy.js";
import { HttpZoneCatalogPort } from "./http-zone-catalog.js";
import { InMemoryZoneCatalogPort } from "./in-memory.js";
import type { CandidacyProjectionPort, ZoneCatalogPort } from "../ports.js";

/** Exactly the variables this wiring reads. Nothing else may be added silently. */
export interface DriverOutboundEnv {
  readonly MATCHING_SERVICE_URL?: string | undefined;
  /** M1-03: `kid:status:secret` entries; read only when a matching URL is configured. */
  readonly WASLA_SERVICE_AUTH_KEYS?: string | undefined;
  readonly WASLA_SERVICE_AUTH_ACTIVE_KID?: string | undefined;
  readonly GEOGRAPHY_SERVICE_URL?: string | undefined;
  readonly DRIVER_DEV_ZONE_IDS?: string | undefined;
}

/** Where a wiring warning goes. `console.warn` in a process, a spy in a test. */
export type WiringLog = (message: string) => void;

/** The code recorded when no matching URL was ever configured. */
export const MATCHING_NOT_CONFIGURED_CODE = "matching_not_configured";

/**
 * The candidacy port when `MATCHING_SERVICE_URL` is absent.
 *
 * It refuses instead of pretending to succeed. `publishCandidacy` records a refusal as
 * a failed publication and lets the local write stand (ADR-012 decision 3), so an
 * unconfigured matching service costs visible publication lag — never a silently
 * dropped projection that leaves matching believing a suspended driver is available.
 *
 * Note it returns `accepted: false` rather than throwing: «nobody configured a URL» is a
 * settled fact about this process, not an outage that a retry might survive, so it is
 * recorded as `rejected` with a code an operator can read — `matching_not_configured` —
 * and not as `MATCHING_UNREACHABLE`, which would send an operator hunting for a network
 * problem that does not exist.
 *
 * `read` returns `null` for the same reason it must not throw: a thrown read aborts the
 * publication attempt (`recompute-eligibility.ts`), and there is nothing to abort here.
 * `null` means «matching holds no row», which is exactly true when there is no matching.
 */
export class UnconfiguredCandidacyPort implements CandidacyProjectionPort {
  async read(): Promise<null> {
    return null;
  }
  async publish(): Promise<{ accepted: boolean; failureCode: string | null }> {
    return { accepted: false, failureCode: MATCHING_NOT_CONFIGURED_CODE };
  }
}

/**
 * The candidacy port: matching over HTTP when configured (MR 5/6).
 *
 * `MATCHING_SERVICE_URL` is read here and nowhere else. It has no default on purpose:
 * defaulting to `http://localhost:8088` would make a misconfigured deployment look like
 * a matching outage in the publication log, and «the URL is missing» is a different
 * incident from «matching is down».
 */
export function configuredCandidacy(env: DriverOutboundEnv): CandidacyProjectionPort {
  const baseUrl = env.MATCHING_SERVICE_URL?.trim();
  if (baseUrl === undefined || baseUrl.length === 0) return new UnconfiguredCandidacyPort();
  // M1-03: a configured URL now also requires identity keys. Reading them here — and
  // throwing when they are absent — keeps «unconfigured» (a settled fact, handled above)
  // apart from «configured but unable to prove who we are» (a misconfiguration that must
  // stop the process rather than turn every publication into an unexplained 401).
  return new HttpCandidacyPort({
    baseUrl,
    signRequest: createServiceRequestSigner({
      serviceName: "drivers",
      audience: "matching",
      keys: keyRegistryFromEnv(env as Record<string, string | undefined>),
      scopes: DRIVERS_MATCHING_SCOPES,
    }),
  });
}

/** Whether a real matching URL was configured — the choice a root may need to see. */
export function matchingConfigured(env: DriverOutboundEnv): boolean {
  return (env.MATCHING_SERVICE_URL ?? "").trim().length > 0;
}

/**
 * The zone catalogue: geography over HTTP when configured (MR 5/6).
 *
 * There is no `PostgresZoneCatalogPort` and there should not be: the zone hierarchy
 * belongs to geography (ADR-006), and `schema.ts` says in its own header that
 * `work_city_zone_id` deliberately carries no foreign key to it — reading another
 * service's table would be exactly the cross-database coupling ADR-012 forbids.
 *
 * `GEOGRAPHY_SERVICE_URL` present → the real catalogue, on BOTH storage paths (a
 * developer running in-memory storage against a real geography is a normal setup, and
 * storage and outbound calls are independent choices).
 *
 * `DRIVER_DEV_ZONE_IDS` survives ONLY as the explicit no-geography fallback, and it is
 * now loud: the retired behaviour was this list standing in for the hierarchy on the
 * Postgres path too, which meant a forgotten id turned a valid zone into
 * `422 DRIVER_ZONE_UNKNOWN` — a rejection the driver could neither understand nor fix.
 * Keeping the list for the offline case is what lets `PUT /zones` be exercised without
 * geography; the warning is what stops that convenience from reaching an environment
 * where a real hierarchy exists.
 */
export function configuredZoneCatalog(env: DriverOutboundEnv, log: WiringLog): ZoneCatalogPort {
  const baseUrl = env.GEOGRAPHY_SERVICE_URL?.trim();
  if (baseUrl !== undefined && baseUrl.length > 0) {
    return new HttpZoneCatalogPort({ baseUrl });
  }
  const catalog = new InMemoryZoneCatalogPort();
  const configured = (env.DRIVER_DEV_ZONE_IDS ?? "")
    .split(",")
    .map((zoneId) => zoneId.trim())
    .filter((zoneId) => zoneId.length > 0);
  catalog.seed(...configured);
  log(
    `GEOGRAPHY_SERVICE_URL غير مضبوط: دليل المناطق من DRIVER_DEV_ZONE_IDS (${configured.length} منطقة). ` +
      `الكتابات سترفض أي منطقة خارج القائمة بـ422 DRIVER_ZONE_UNKNOWN.`,
  );
  return catalog;
}
