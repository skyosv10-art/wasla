/**
 * `ZoneCatalogPort` over the geography service — port 8081 (Phase 05 · MR 5/6).
 *
 * ## Why this file replaces an environment variable
 *
 * Until this MR the catalogue was `DRIVER_DEV_ZONE_IDS`, a comma-separated list read at
 * startup, and it stood on the Postgres path too. That was a declared debt with a real
 * cost: the list is the answer to «may this driver serve this zone?», and an operator
 * who forgot an id turned a valid zone into `422 DRIVER_ZONE_UNKNOWN` — a rejection the
 * driver can neither understand nor fix. The hierarchy belongs to geography (ADR-006),
 * so the only honest catalogue is geography's own published endpoint.
 *
 * ## `existing` means «exists AND is active», and that is a decision
 *
 * `GET /geo/zones/{zoneId}` answers with a `status` (`active` | `inactive`), and this
 * adapter counts only `active` as existing. The port is consulted on WRITES, where a
 * zone id is being AUTHORED (`ports.ts` says so: this service is where the zone list is
 * written, and an id accepted here reaches every downstream row). Authoring work in a
 * zone geography has deactivated produces a driver who is offerable in a zone nobody
 * dispatches into — an eligible driver who never receives an order, which is the exact
 * complaint this phase exists to be able to answer.
 *
 * The alternative — «exists» meaning `200` regardless of status — was rejected because
 * it moves the decision nowhere: someone still has to refuse the inactive zone, and the
 * only other candidate is a second status check inside a use case, i.e. a rule that can
 * disagree with this one.
 *
 * **Declared limit:** zones already stored on a driver are NOT re-validated when
 * geography later deactivates one. Doing that needs a geography event, not a lookup,
 * and it lands with the relay in Phase 09. Until then a deactivated zone keeps
 * producing candidacy projections, and matching's own hierarchy check is the second
 * line — recorded here rather than left to be discovered.
 *
 * ## Failure is never «unknown zone»
 *
 * A timeout, a 5xx, or a body we cannot read is `DRIVER_UNAVAILABLE` (503), never an
 * absent zone. Turning an outage into an absence would answer `422 DRIVER_ZONE_UNKNOWN`
 * for a zone that exists — a permanent-looking rejection of a valid write, and the
 * caller would stop retrying because 422 tells him the input is wrong. There is no
 * retry here on purpose (precedent: `services/matching/src/infrastructure/http-geography.ts`):
 * a retry inside a write multiplies the time a transaction is open by the number of
 * zones, and the caller's own retry is both cheaper and visible to him.
 */

import { driverUnavailable, isDriverError } from "../domain/errors.js";
import type { ZoneCatalogPort } from "../ports.js";

export interface HttpZoneCatalogOptions {
  /** Base URL of the geography service, e.g. `http://geography:8081`. */
  readonly baseUrl: string;
  /** Per-request timeout in ms (default 2000). */
  readonly timeoutMs?: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

interface ZoneDetailResponse {
  id?: unknown;
  status?: unknown;
}

export class HttpZoneCatalogPort implements ZoneCatalogPort {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpZoneCatalogOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * One call per distinct id, all in flight together.
   *
   * Sequential calls would make the timeout of a driver with eight zones eight times
   * the per-request budget while holding a write open; `Promise.all` keeps the budget
   * flat and keeps a single failure loud — the first rejection fails the whole lookup,
   * which is the fail-closed answer a write needs.
   */
  async existing(zoneIds: readonly string[]): Promise<Set<string>> {
    const distinct = [...new Set(zoneIds)];
    const checked = await Promise.all(
      distinct.map(async (zoneId) => ({ zoneId, active: await this.isActive(zoneId) })),
    );
    const known = new Set<string>();
    for (const { zoneId, active } of checked) {
      if (active) known.add(zoneId);
    }
    return known;
  }

  private async isActive(zoneId: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/geo/zones/${encodeURIComponent(zoneId)}`,
        { method: "GET", signal: controller.signal },
      );
      if (response.status === 404) return false;
      if (response.status !== 200) {
        throw driverUnavailable("خدمة الجغرافيا أعادت حالة غير مقروءة لدليل المناطق");
      }
      const detail = (await response.json()) as ZoneDetailResponse;
      // An unreadable status is an error, not an assumption in either direction: the
      // permissive guess admits an unknown zone, and the strict guess refuses a valid
      // one — both are answers we did not receive.
      if (detail.status !== "active" && detail.status !== "inactive") {
        throw driverUnavailable("حالة المنطقة غير مفهومة في رد خدمة الجغرافيا");
      }
      return detail.status === "active";
    } catch (error) {
      if (isDriverError(error)) throw error;
      throw driverUnavailable("خدمة الجغرافيا غير متاحة");
    } finally {
      clearTimeout(timer);
    }
  }
}
