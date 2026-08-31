/**
 * `CandidacyProjectionPort` over the matching service — port 8088 (Phase 05 · MR 5/6).
 *
 * The one outbound call Driver Core makes: `PUT /candidacy/{driverPublicId}`, a FULL
 * REPLACE (matching's own contract says so — a partial merge on a projection produces
 * blends nobody meant, such as new availability with stale zones). This adapter is what
 * finally makes Driver Core the owner of that row, and it is the payment of matching's
 * declared `eligibility_source: "claimed"` debt: every publication from here carries
 * `eligibility_source: "driver_core"`, so matching can tell a verdict it was told from
 * a verdict that was computed.
 *
 * ## Refusal and silence are different facts
 *
 * `publish` returns `{accepted:false, failureCode}` when matching ANSWERED and refused
 * (`400`, `409`, `422`) — a fact to record, with matching's own code kept verbatim so
 * the audit row says what matching said rather than what we assumed. It THROWS for
 * silence: a timeout, a network error, an unreadable body, and also matching's own
 * `503`. A `503` is matching telling us «not now, retry», which is much closer to «no
 * answer» than to «your projection is wrong» — recording it as a refusal would put a
 * permanent-looking verdict in the audit for a transient outage.
 *
 * The caller (`publishCandidacy`) turns the throw into an `unavailable` attempt and
 * leaves the local write standing (ADR-012 decision 3). Nothing here rolls anything
 * back, and nothing here retries: a retry inside a write extends the transaction by the
 * length of someone else's outage, and the recompute triggers already give the next
 * write a fresh attempt.
 *
 * ## Why the idempotency key carries a timestamp
 *
 * `Idempotency-Key` is mandatory on matching's write. The obvious key — a hash of the
 * projection — is a trap: a driver who goes `available → offline → available` would
 * send the third publication under the same key as the first, and matching, seeing a
 * known key with an identical payload, would replay the stored answer instead of
 * re-applying the write. The row would stay `offline` while our record says
 * `published`, which is the worst of both — silent drift with a clean audit.
 *
 * So the key is per-attempt: `drv-{driverId}-{attemptMillis}-{seq}-{contentHash}`. The
 * operation is already idempotent by construction (full replace of the same content is
 * the same row), so the key's job is to be unique per intent, not to deduplicate for
 * us. It stays readable on purpose: an operator holding a driver id can find the
 * matching-side audit rows without a translation table.
 *
 * ## Why a sequence number and not the timestamp alone (Phase 05 exit gate)
 *
 * The timestamp was the whole defence, and it was one millisecond deep. The exit gate
 * caught it: a driver goes `offline → available → offline` inside one clock tick, the
 * first and third publications carry the same content AND the same `attemptMillis`, so
 * they carry the same key — and matching replays the first answer instead of applying
 * the third. The row stays `available` while our `driver_candidacy_publications` row
 * says `published`. That is the exact drift the paragraph above set out to prevent,
 * reintroduced through the back door of clock resolution.
 *
 * Under a frozen test clock this is certain; under a real clock it is merely rare, and
 * «rare» is the wrong safety margin for «a busy driver silently keeps receiving offers».
 * A per-instance counter costs one integer and removes the dependence on how finely the
 * clock happens to tick. The counter is deliberately NOT persisted: it only has to break
 * ties within a process, and after a restart the timestamp has moved on anyway.
 */

import { createHash } from "node:crypto";

import type { ServiceRequestSigner } from "@wasla/service-auth";

import { driverUnavailable, isDriverError } from "../domain/errors.js";
import type { ProjectedAvailability } from "../domain/model.js";
import type { CandidacyProjection, CandidacyProjectionPort } from "../ports.js";

export interface HttpCandidacyOptions {
  /** Base URL of the matching service, e.g. `http://matching:8088`. */
  readonly baseUrl: string;
  /** Per-request timeout in ms (default 2000). */
  readonly timeoutMs?: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Injectable clock, so the generated key is deterministic under test. */
  readonly clock?: { now(): string };
  /**
   * Signs every outbound call (M1-03). Required with no default on purpose: a
   * default of «unsigned» would pass every test here and fail only in production,
   * where a 401 reads like matching being broken rather than us forgetting.
   */
  readonly signRequest: ServiceRequestSigner;
}

/** The scopes this client needs on matching's boundary, and no more. */
export const DRIVERS_MATCHING_SCOPES: readonly string[] = [
  "matching:candidacy:read",
  "matching:candidacy:write",
];

/** Matching's error body is FLAT (`{code,message,trace_id}`), unlike this service's nested one. */
interface MatchingErrorBody {
  code?: unknown;
}

interface CandidacyResponse {
  availability_state?: unknown;
}

const AVAILABILITY_STATES: readonly string[] = ["available", "busy", "offline"];

function contentHash(projection: CandidacyProjection): string {
  const canonical = JSON.stringify([
    projection.eligibilityState,
    projection.availabilityState,
    [...projection.serviceKinds].sort(),
    [...projection.zoneIds].sort(),
    projection.vehicleClass,
  ]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 8);
}

export class HttpCandidacyPort implements CandidacyProjectionPort {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: { now(): string };
  private readonly signRequest: ServiceRequestSigner;
  /** Breaks key ties between same-content publications inside one clock tick. */
  private attemptSequence = 0;

  constructor(options: HttpCandidacyOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
    this.signRequest = options.signRequest;
  }

  /**
   * Read the current projected availability.
   *
   * This is the guard that keeps a driver's «I am free» from overwriting a live
   * commitment: matching owns `busy`, so a publication has to know the current value
   * to avoid upgrading it. `404` is a real answer — no row yet — and returns `null`.
   * Anything else throws, because the fail-open reading (treat an outage as «no row»)
   * is precisely the case where we would publish `available` over `busy` and offer a
   * second order to a driver who is already carrying one.
   */
  async read(waslaPublicId: string): Promise<{ availabilityState: ProjectedAvailability } | null> {
    const response = await this.call(
      `/candidacy/${encodeURIComponent(waslaPublicId)}`,
      { method: "GET" },
    );
    if (response.status === 404) return null;
    if (response.status !== 200) {
      throw driverUnavailable("خدمة المطابقة أعادت حالة غير مقروءة لقراءة الترشيح");
    }
    const body = (await this.json<CandidacyResponse>(response)).availability_state;
    if (typeof body !== "string" || !AVAILABILITY_STATES.includes(body)) {
      throw driverUnavailable("رد المطابقة لا يحمل حالة توافر مفهومة");
    }
    return { availabilityState: body as ProjectedAvailability };
  }

  async publish(
    projection: CandidacyProjection,
    options: { readonly traceId?: string | null } = {},
  ): Promise<{ accepted: boolean; failureCode: string | null }> {
    const attemptedAt = this.clock.now();
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "Idempotency-Key": this.idempotencyKey(projection, attemptedAt),
    };
    // `x-request-id` becomes matching's `trace_id`, in its response AND in its audit
    // row. Threading ours through is what makes one driver complaint readable across
    // two services instead of two unrelated halves.
    if (options.traceId !== undefined && options.traceId !== null) {
      headers["x-request-id"] = options.traceId;
    }

    const response = await this.call(
      `/candidacy/${encodeURIComponent(projection.waslaPublicId)}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          availability_state: projection.availabilityState,
          eligibility_state: projection.eligibilityState,
          // The whole point of this adapter: a computed verdict, declared as computed.
          eligibility_source: "driver_core",
          service_kinds: projection.serviceKinds,
          vehicle_class: projection.vehicleClass,
          zone_ids: projection.zoneIds,
          actor_type: "driver_core",
        }),
      },
    );

    if (response.status === 200) return { accepted: true, failureCode: null };
    if (response.status === 400 || response.status === 409 || response.status === 422) {
      const body = await this.json<MatchingErrorBody>(response).catch(() => ({ code: undefined }));
      const code = typeof body.code === "string" && body.code.length > 0 ? body.code : null;
      return { accepted: false, failureCode: code ?? `MATCHING_HTTP_${response.status}` };
    }
    throw driverUnavailable("خدمة المطابقة غير متاحة لنشر إسقاط الترشيح");
  }

  /** `drv-{driverId}-{attemptMillis}-{seq}-{contentHash}`; 8..128 chars per matching's contract. */
  private idempotencyKey(projection: CandidacyProjection, attemptedAt: string): string {
    const millis = Date.parse(attemptedAt);
    const stamp = Number.isNaN(millis) ? "0" : String(millis);
    this.attemptSequence += 1;
    return `drv-${projection.waslaPublicId}-${stamp}-${this.attemptSequence}-${contentHash(projection)}`;
  }

  /** `path` is signed as it goes on the wire, so the binding matches what matching reads. */
  private async call(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const method = init.method ?? "GET";
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), ...this.signRequest(method, path) },
        signal: controller.signal,
      });
    } catch (error) {
      if (isDriverError(error)) throw error;
      throw driverUnavailable("تعذّر الوصول إلى خدمة المطابقة");
    } finally {
      clearTimeout(timer);
    }
  }

  private async json<T>(response: Response): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch {
      throw driverUnavailable("رد المطابقة ليس JSON صالحاً");
    }
  }
}
