/**
 * The HTTP layer of Driver Core — port 8090 (Phase 05 · MR 4/6).
 *
 * ## The one structural rule of this file
 *
 * A handler receives a `DriverRunner` and nothing else. There is no `Db`, no pool, no
 * repository in scope, so **no route can open a transaction or touch a table** — the
 * mistake is unavailable rather than discouraged (`src/runner.ts` says so as the
 * binding criterion of MR 3/6, and this file is where it is either honoured or lost).
 * Every write goes through `runner.write`, which is one transaction on Postgres and a
 * plain call in memory, and every use case ends at `recomputeEligibility`.
 *
 * ## Where a status code comes from
 *
 * Never from a handler's opinion. `2xx` is chosen here because only the transport knows
 * whether a retry replayed (`200`) or created (`201`); every `4xx`/`5xx` comes from a
 * thrown `DriverError` whose class lives in `@wasla/contracts-driver`
 * (see `http/errors.ts`). That is why no handler contains a `try`/`catch`.
 *
 * ## The `502` that is deliberately not raised yet
 *
 * `DRIVER_CANDIDACY_PUBLISH_FAILED` is declared on eight operations in the contract and
 * is **unreachable in this MR** — and that is the domain's decision, not an oversight
 * here: `publishCandidacy` (use-cases/recompute-eligibility.ts) RECORDS a failed
 * publication and does not throw, because refusing our own write when a service behind
 * us is down would make our correctness depend on their uptime. Nothing between a use
 * case's return value and this file therefore carries the publication outcome. The
 * mapping is wired and tested (`http-errors.test.ts` asserts the `502`), so MR 5/6 —
 * which introduces the real `HttpCandidacyPort`, the first port that can fail — only
 * has to decide WHICH operations surface it. Until then a failed publication is visible
 * in `driver_candidacy_publications` and as `last_published_state` lag, never as a lie
 * about the local write.
 *
 * ## Reads that 404 and a read that writes
 *
 * The subresource reads go through `use-cases/read-driver.ts`, which owns the existence
 * check, because the repositories answer `[]` for an unknown driver. `GET
 * /drivers/{id}/eligibility` is the exception in the other direction: `readEligibility`
 * RECOMPUTES (it may log and publish), so it needs `runner.write` — a read that is a
 * write, exactly as `read-eligibility.ts` documents. Its own answer for a missing
 * profile is a fail-closed `unknown` verdict, which is right for an internal caller and
 * wrong for HTTP: the contract declares `404` there, and a `200 {"eligibility_state":
 * "unknown"}` for a mistyped id would tell an operator the driver exists and is
 * unverified. So the route checks existence first and keeps the fail-closed path for
 * in-process callers.
 */

import Fastify, { type FastifyInstance } from "fastify";

import {
  DRIVER_DECLARED_AVAILABILITY,
  DRIVER_SERVICE_PORT,
} from "@wasla/contracts-driver";

import {
  driverDocumentToWire,
  driverProfileToWire,
  eligibilityTickToWire,
  eligibilityToWire,
  healthToWire,
  serviceZoneToWire,
  vehicleToWire,
} from "../mappers.js";
import type { DriverRunner } from "../runner.js";
import { submitDocument, reviewDocument } from "../use-cases/manage-documents.js";
import {
  declareAvailability,
  reinstateDriver,
  setServiceZones,
  suspendDriver,
  updateProfile,
} from "../use-cases/manage-profile.js";
import { patchVehicle, registerVehicle } from "../use-cases/manage-vehicles.js";
import {
  listDriverDocuments,
  listDriverVehicles,
  listDriverZones,
  readDriverProfile,
} from "../use-cases/read-driver.js";
import { readEligibility, runExpiryTick } from "../use-cases/read-eligibility.js";
import { registerDriver } from "../use-cases/register-driver.js";

import { sendDriverError } from "./errors.js";
import { classifyReplay, payloadFingerprint, registrationKey } from "./idempotency.js";
import {
  assertNoBody,
  assertRequestIdLength,
  nullableInteger,
  nullableString,
  oneOf,
  optionalBoolean,
  requireIdempotencyKey,
  toAvailabilityBody,
  toDocumentReviewBody,
  toDocumentSubmissionBody,
  toDriverRegistrationBody,
  toPathUuid,
  toProfilePatchBody,
  toSuspensionBody,
  toVehiclePatchBody,
  toVehicleRegistrationBody,
  toWaslaPublicId,
  toZonesBody,
} from "./requests.js";

export interface DriverHealthDescriptor {
  readonly persistence: "postgres" | "memory";
}

/**
 * The tick indicator, held in memory ON PURPOSE.
 *
 * It answers "is anything calling the tick on this process?", which is a liveness
 * question about the caller (Phase 09 owns the scheduler). Persisting it would answer a
 * different question — "was a tick ever run in history" — and that one already has an
 * answer in `eligibility_recheck_at`.
 */
export interface DriverTickState {
  lastTickAt: string | null;
}

export interface CreateDriverAppOptions {
  readonly runner: DriverRunner;
  readonly health?: DriverHealthDescriptor;
  readonly tickState?: DriverTickState;
  readonly logger?: boolean;
}

const DEFAULT_HEALTH: DriverHealthDescriptor = { persistence: "memory" };

export function createDriverApp(options: CreateDriverAppOptions): FastifyInstance {
  const health = options.health ?? DEFAULT_HEALTH;
  const tickState = options.tickState ?? { lastTickAt: null };
  const runner = options.runner;
  // `requestIdHeader` makes a caller-supplied `x-request-id` become `request.id`, so
  // one id spans the caller's logs, ours, and the `trace_id` in the answer. Fastify
  // generates one when the header is absent, so `trace_id` is never empty.
  const app = Fastify({ logger: options.logger ?? false, requestIdHeader: "x-request-id" });

  app.setErrorHandler((error, request, reply) => {
    sendDriverError(reply, error, request.id);
  });

  app.get("/health", async (_request, reply) => {
    return reply.status(200).send(
      healthToWire({
        // `degraded` on memory is not pessimism: a service holding driver files in RAM
        // will lose them, and a green check on that state is how it reaches production.
        status: health.persistence === "postgres" ? "ok" : "degraded",
        persistence: health.persistence,
        lastTickAt: tickState.lastTickAt,
      }),
    );
  });

  app.post("/drivers", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const body = toDriverRegistrationBody(request.body);
    // Read before the domain does, because the namespaced idempotency key is built from
    // it. `registerDriver` re-validates; this is a shape check for a key, not a second
    // rule.
    const waslaPublicId = toWaslaPublicId(body.wasla_public_id);
    const fingerprint = payloadFingerprint(body);

    const outcome = await runner.write(async (deps) => {
      const verdict = await classifyReplay(
        deps,
        registrationKey(waslaPublicId, idempotencyKey),
        fingerprint,
      );
      if (verdict === "replay") {
        const existing = await deps.profiles.find(waslaPublicId);
        // A remembered key whose driver is gone means the registration was rolled back
        // (or the row was removed). Registering again is the honest repair: the caller
        // asked for a driver and there is none.
        if (existing !== null) return { profile: existing, replayed: true };
      }
      const profile = await registerDriver(deps, {
        waslaPublicId,
        displayName: nullableString(body, "display_name"),
        preferredLocale: body.preferred_locale,
        workCityZoneId: nullableString(body, "work_city_zone_id") ?? null,
        serviceKinds: body.service_kinds,
        traceId,
      });
      return { profile, replayed: false };
    });

    return reply
      .status(outcome.replayed ? 200 : 201)
      .send(driverProfileToWire(outcome.profile));
  });

  app.post("/drivers/eligibility/tick", async (request, reply) => {
    // No `traceId` forwarded, unlike every other write: `runExpiryTick` fans out over
    // up to 500 drivers, and stamping one caller's request id on 500 eligibility rows
    // would claim they were all caused by that request. Each recompute keeps its own
    // trigger (`document_expired`), which is the true cause.
    assertRequestIdLength(request.headers);
    // The contract requires the header and the tick stores NO replay record, which is
    // consistent rather than sloppy: the tick's idempotence comes from its own state —
    // a second run finds nothing due and changes nothing — while the header keeps the
    // operation's shape identical to every other retryable write a scheduler calls.
    requireIdempotencyKey(request.headers);
    assertNoBody(request.body);

    const result = await runner.write(async (deps) => {
      const outcome = await runExpiryTick(deps);
      return { outcome, at: deps.clock.now() };
    });
    tickState.lastTickAt = result.at;
    return reply.status(200).send(eligibilityTickToWire(result.outcome));
  });

  app.get("/drivers/:waslaPublicId", async (request, reply) => {
    assertRequestIdLength(request.headers);
    const waslaPublicId = toWaslaPublicId(
      (request.params as { waslaPublicId?: unknown }).waslaPublicId,
    );
    const profile = await runner.read((deps) => readDriverProfile(deps, waslaPublicId));
    return reply.status(200).send(driverProfileToWire(profile));
  });

  app.patch("/drivers/:waslaPublicId", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const waslaPublicId = toWaslaPublicId(
      (request.params as { waslaPublicId?: unknown }).waslaPublicId,
    );
    const body = toProfilePatchBody(request.body);
    // Built key by key with `in`, never spread: `updateProfile` distinguishes a field
    // that is present-and-null (clear it) from one that is absent (leave it), and a
    // spread of the whole body would erase that distinction for every caller at once.
    const input: Parameters<typeof updateProfile>[2] = { traceId };
    if ("display_name" in body) {
      Object.assign(input, { displayName: nullableString(body, "display_name") ?? null });
    }
    if ("preferred_locale" in body) {
      Object.assign(input, { preferredLocale: body.preferred_locale });
    }
    if ("work_city_zone_id" in body) {
      Object.assign(input, { workCityZoneId: nullableString(body, "work_city_zone_id") ?? null });
    }
    if ("service_kinds" in body) Object.assign(input, { serviceKinds: body.service_kinds });

    const profile = await runner.write((deps) => updateProfile(deps, waslaPublicId, input));
    return reply.status(200).send(driverProfileToWire(profile));
  });

  app.put("/drivers/:waslaPublicId/zones", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const waslaPublicId = toWaslaPublicId(
      (request.params as { waslaPublicId?: unknown }).waslaPublicId,
    );
    const zones = toZonesBody(request.body);
    const replaced = await runner.write((deps) =>
      setServiceZones(deps, waslaPublicId, { zones, traceId }),
    );
    return reply.status(200).send({ zones: replaced.map(serviceZoneToWire) });
  });

  app.get("/drivers/:waslaPublicId/zones", async (request, reply) => {
    assertRequestIdLength(request.headers);
    const waslaPublicId = toWaslaPublicId(
      (request.params as { waslaPublicId?: unknown }).waslaPublicId,
    );
    const zones = await runner.read((deps) => listDriverZones(deps, waslaPublicId));
    return reply.status(200).send({ zones: zones.map(serviceZoneToWire) });
  });

  app.post("/drivers/:waslaPublicId/vehicles", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const waslaPublicId = toWaslaPublicId(
      (request.params as { waslaPublicId?: unknown }).waslaPublicId,
    );
    const body = toVehicleRegistrationBody(request.body);

    // The lookup and the write share ONE transaction, and the lookup decides ONLY the
    // status code. `registerVehicle` owns replay itself — it returns the same row for
    // the same key with the same payload and throws `409` when the payload differs — so
    // the use case is called either way and its answer is never pre-empted here.
    // Returning the found row directly instead (the shortcut this line replaced) would
    // have made a reused key with a DIFFERENT payload answer `200 OK`: the caller would
    // believe the second payload was applied, and the vehicle he thinks he registered
    // would not exist.
    const outcome = await runner.write(async (deps) => {
      const existed =
        (await deps.vehicles.findByIdempotencyKey(waslaPublicId, idempotencyKey)) !== null;
      const vehicle = await registerVehicle(deps, waslaPublicId, {
        vehicleClass: body.vehicle_class,
        idempotencyKey,
        make: nullableString(body, "make") ?? null,
        model: nullableString(body, "model") ?? null,
        modelYear: nullableInteger(body, "model_year") ?? null,
        color: nullableString(body, "color") ?? null,
        plateNumber: nullableString(body, "plate_number") ?? null,
        isPrimary: optionalBoolean(body, "is_primary") ?? false,
        traceId,
      });
      return { vehicle, replayed: existed };
    });

    return reply.status(outcome.replayed ? 200 : 201).send(vehicleToWire(outcome.vehicle));
  });

  app.get("/drivers/:waslaPublicId/vehicles", async (request, reply) => {
    assertRequestIdLength(request.headers);
    const waslaPublicId = toWaslaPublicId(
      (request.params as { waslaPublicId?: unknown }).waslaPublicId,
    );
    const vehicles = await runner.read((deps) => listDriverVehicles(deps, waslaPublicId));
    return reply.status(200).send({ vehicles: vehicles.map(vehicleToWire) });
  });

  app.patch("/drivers/:waslaPublicId/vehicles/:vehicleId", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const params = request.params as { waslaPublicId?: unknown; vehicleId?: unknown };
    const waslaPublicId = toWaslaPublicId(params.waslaPublicId);
    const vehicleId = toPathUuid(params.vehicleId, "vehicleId");
    const body = toVehiclePatchBody(request.body);
    const input: Parameters<typeof patchVehicle>[3] = { traceId };
    // `retired` is the only status this operation accepts, and the contract now says so
    // too: reactivation is a new registration because a car that left service needs its
    // papers looked at again.
    if ("status" in body) {
      Object.assign(input, { status: oneOf(body, "status", ["retired"] as const) });
    }
    if ("is_primary" in body) {
      Object.assign(input, { isPrimary: optionalBoolean(body, "is_primary") });
    }

    const vehicle = await runner.write((deps) =>
      patchVehicle(deps, waslaPublicId, vehicleId, input),
    );
    return reply.status(200).send(vehicleToWire(vehicle));
  });

  app.post("/drivers/:waslaPublicId/documents", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const waslaPublicId = toWaslaPublicId(
      (request.params as { waslaPublicId?: unknown }).waslaPublicId,
    );
    const body = toDocumentSubmissionBody(request.body);

    // As with vehicles: the lookup picks the status code, `submitDocument` decides what
    // a replay means.
    const outcome = await runner.write(async (deps) => {
      const existed =
        (await deps.documents.findByIdempotencyKey(waslaPublicId, idempotencyKey)) !== null;
      const document = await submitDocument(deps, waslaPublicId, {
        documentType: body.document_type,
        storageRef: body.storage_ref,
        idempotencyKey,
        vehicleId: nullableString(body, "vehicle_id") ?? null,
        issuedAt: nullableString(body, "issued_at") ?? null,
        expiresAt: nullableString(body, "expires_at") ?? null,
        traceId,
      });
      return { document, replayed: existed };
    });

    return reply
      .status(outcome.replayed ? 200 : 201)
      .send(driverDocumentToWire(outcome.document));
  });

  app.get("/drivers/:waslaPublicId/documents", async (request, reply) => {
    assertRequestIdLength(request.headers);
    const waslaPublicId = toWaslaPublicId(
      (request.params as { waslaPublicId?: unknown }).waslaPublicId,
    );
    const documents = await runner.read((deps) => listDriverDocuments(deps, waslaPublicId));
    return reply.status(200).send({ documents: documents.map(driverDocumentToWire) });
  });

  app.post("/drivers/:waslaPublicId/documents/:documentId/review", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const params = request.params as { waslaPublicId?: unknown; documentId?: unknown };
    const waslaPublicId = toWaslaPublicId(params.waslaPublicId);
    const documentId = toPathUuid(params.documentId, "documentId");
    const body = toDocumentReviewBody(request.body);
    // The wire field is `decision` and the use-case field is `status`. Renaming either
    // one to match the other was the tempting alternative: the contract's word is the
    // right one for a caller (a review is a decision) and the model's word is the right
    // one for a stored document (it has a status), so the rename is a mapping, in the
    // layer whose whole job is mapping.
    const decision = oneOf(body, "decision", ["verified", "rejected"] as const);
    const document = await runner.write((deps) =>
      reviewDocument(deps, waslaPublicId, documentId, {
        status: decision,
        reviewedBy: body.reviewed_by,
        // Forwarded even when absent-or-null so the domain can enforce the contract's
        // conditional: `rejected` REQUIRES a reason code, `verified` forbids one.
        rejectionReasonCode: body.rejection_reason_code,
        traceId,
      }),
    );
    return reply.status(200).send(driverDocumentToWire(document));
  });

  app.put("/drivers/:waslaPublicId/availability", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const waslaPublicId = toWaslaPublicId(
      (request.params as { waslaPublicId?: unknown }).waslaPublicId,
    );
    const body = toAvailabilityBody(request.body);
    // `busy` is refused here and not in the domain because the domain's parameter is
    // already typed to the two declarable values; the closed set comes from the
    // contracts package, so this route cannot drift from what the driver may declare.
    const declared = oneOf(body, "declared_availability", DRIVER_DECLARED_AVAILABILITY);
    const profile = await runner.write((deps) =>
      declareAvailability(deps, waslaPublicId, declared, traceId),
    );
    return reply.status(200).send(driverProfileToWire(profile));
  });

  app.post("/drivers/:waslaPublicId/suspend", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const waslaPublicId = toWaslaPublicId(
      (request.params as { waslaPublicId?: unknown }).waslaPublicId,
    );
    const body = toSuspensionBody(request.body);
    const profile = await runner.write((deps) =>
      suspendDriver(deps, waslaPublicId, body.reason_code, traceId),
    );
    return reply.status(200).send(driverProfileToWire(profile));
  });

  app.post("/drivers/:waslaPublicId/reinstate", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const waslaPublicId = toWaslaPublicId(
      (request.params as { waslaPublicId?: unknown }).waslaPublicId,
    );
    assertNoBody(request.body);
    const profile = await runner.write((deps) =>
      reinstateDriver(deps, waslaPublicId, traceId),
    );
    return reply.status(200).send(driverProfileToWire(profile));
  });

  app.get("/drivers/:waslaPublicId/eligibility", async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const waslaPublicId = toWaslaPublicId(
      (request.params as { waslaPublicId?: unknown }).waslaPublicId,
    );
    const decision = await runner.write(async (deps) => {
      // The existence check first, in the same unit of work: `readEligibility` answers
      // `unknown` for a missing profile (fail-closed, correct for an internal caller),
      // and the contract declares `404` for this route.
      await readDriverProfile(deps, waslaPublicId);
      const result = await readEligibility(deps, waslaPublicId, traceId);
      return result.decision;
    });
    return reply.status(200).send(eligibilityToWire(waslaPublicId, decision));
  });

  return app;
}

export { DRIVER_SERVICE_PORT };
