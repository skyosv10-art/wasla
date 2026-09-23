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
 * ## The `502` that was DECIDED against, and removed (MR 5/6)
 *
 * MR 4/6 left one question open: which operations surface a failed publication to
 * matching as `502 DRIVER_CANDIDACY_PUBLISH_FAILED`? The answer is **none**, and the
 * code plus the ten declarations in the contract are gone with it.
 *
 * A publication that fails never invalidates the local write (ADR-012 decision 3), so a
 * write that succeeded must answer with its resource — a `502` would throw away the
 * body of a change that really happened and invite the caller to repeat it. And a
 * refusal by matching is not a gateway failure at all: matching ANSWERED, so retrying
 * our request cannot change its mind. The failure is reported where it can be acted on
 * instead: `last_published_state`/`last_published_at` on the profile, `publish_failures`
 * on the tick result (a count, which is more than a status code), and the full
 * `driver_candidacy_publications` row with matching's own code.
 *
 * Full reasoning, kept where the next reader will look: `contracts/errors.md`
 * §«الرمز المتقاعد». What DOES fail a write is a mandatory port that cannot answer
 * BEFORE the write — the zone catalogue — and that is `503`, because retrying works.
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

import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import {
  DRIVER_DECLARED_AVAILABILITY,
  DRIVER_SERVICE_PORT,
} from "@wasla/contracts-driver";
import { ownerPublicIdOf } from "@wasla/auth-sdk";

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

import { DriverError } from "../domain/errors.js";
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
import {
  DRIVER_SCOPES,
  type DriverRouteConfig,
  type DriverServiceIdentityOptions,
  registerServiceIdentity,
} from "./service-identity.js";

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
  /**
   * فرضُ هويّةِ الخدمةِ على هذا الحدِّ. **إلزاميٌّ بلا قيمةٍ افتراضيّةٍ بقصدٍ**
   * (سابقةُ حدِّ العميلِ): قيمةٌ افتراضيّةٌ تجعلُ نسيانَ التركيبِ في جذرٍ ما حدَّ
   * سائقينَ **مفتوحاً يمرُّ كلَّ اختباراتِه** — وهيَ بعينِها الثغرةُ التي قاسَتْها
   * الموجةُ الثامنةُ (`RISK-0051`) وتسدُّها هذهِ. فمن أرادَ حدّاً بلا فرضٍ فليكتبْ
   * ذلكَ صراحةً في جذرِ تركيبِه، ولا موضعَ في المستودعِ يكتبُه.
   */
  readonly serviceIdentity: DriverServiceIdentityOptions;
}

const DEFAULT_HEALTH: DriverHealthDescriptor = { persistence: "memory" };

/** `/health` وحدَهُ: لا يقرأُ ولا يكتبُ بياناتٍ مجاليّةً. */
const OPEN: DriverRouteConfig = { serviceIdentity: "open" };

/**
 * مسارٌ يمسُّ مَورِداً **مملوكاً لإنسانٍ بعينِهِ** — وهوَ كلُّ مسارٍ يبدأُ بـ
 * `/drivers/:waslaPublicId/…` ما خلا `/health`. فـ`beneficiary: "required"` يجعلُ
 * الوسيطَ المركزيَّ يرفضُ كلَّ رمزٍ لا يحملُ هويّةَ المُنتَفِعِ **قبلَ** أن يمسَّ
 * المسارُ قاعدةَ البياناتِ.
 */
function ownerScoped(...scopes: readonly string[]): DriverRouteConfig {
  return { serviceIdentity: { scopes, beneficiary: "required" } };
}

/**
 * مسارُ عمليّاتٍ داخليٌّ لا مُنتَفِعَ إنسانٍ له: يفرضُ الصلاحيّةَ بلا مُنتَفِعٍ.
 * `POST /drivers/eligibility/tick` هوَ الوحيدُ من هذا الصنفِ على هذا الحدِّ.
 */
function internalScoped(...scopes: readonly string[]): DriverRouteConfig {
  return { serviceIdentity: { scopes } };
}

/**
 * مسارٌ إداريٌّ: يفرضُ الصلاحيّةَ بلا مُنتَفِعٍ، مثلُ `internalScoped`،
 * لكنّهُ يُعلِنُ أنّ هذا المسارَ مُخصَّصٌ للوحةِ الإدارةِ لا للعمليّاتِ الداخليّةِ.
 * الربطُ بينَ صلاحيّةِ `RBAC` في الواجهةِ (`drivers:read`) وصلاحيّةِ الخدمةِ هنا
 * (`drivers:admin:read`) يُبنَى عندَ البوّابةِ (`M3-09`).
 */
function adminScoped(...scopes: readonly string[]): DriverRouteConfig {
  return { serviceIdentity: { scopes } };
}

/**
 * مالكُ المَورِدِ كما **يُثبِتُهُ الرمزُ**، مُطابَقاً بما كُتِبَ في المسارِ.
 *
 * `:waslaPublicId` قيمةٌ **يكتبُها المُنادي**. فلو فُرِضَتِ الصلاحيّةُ وحدَها لكانَ
 * حاملُ `drivers:profile:read` يقرأُ ملفَّ كلِّ سائقٍ بتبديلِ حرفٍ في المسارِ —
 * وهذا وجهُ `RISK-0042` نفسُهُ الذي أُغلِقَ على حدِّ الطلباتِ في `M1-05B`،
 * ويُغلَقُ هنا في الدفعةِ التي تفرضُ الهويّةَ لا بعدَها.
 */
function requireBeneficiary(request: FastifyRequest, traceId: string): string {
  const caller = request.serviceCaller;
  const beneficiary = caller === undefined ? undefined : ownerPublicIdOf(caller);

  if (beneficiary === undefined || beneficiary.trim() === "") {
    throw new Error(
      'مسارٌ يمسُّ مَورِداً مملوكاً مُسجَّلٌ بلا beneficiary: "required" — راجِعِ ownerScoped().',
    );
  }

  const { waslaPublicId: rawId } = request.params as { waslaPublicId: unknown };
  // تحقّقُ الصيغةِ قبلَ المطابقةِ: قيمةٌ غيرُ صالحةٍ تُرَدُّ `400` لا `404`.
  const waslaPublicId = toWaslaPublicId(rawId);
  if (waslaPublicId !== beneficiary) {
    throw new DriverError(
      "DRIVER_NOT_FOUND",
      `لا ملف سائق للمعرّف ${waslaPublicId}`,
      { traceId },
    );
  }

  return beneficiary;
}

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

  // قبلَ تسجيلِ أيِّ مسارٍ بقصدٍ: حاجزُ التصنيفِ يرى ما يُسجَّلُ بعدَهُ وحدَهُ،
  // فمسارٌ يُسجَّلُ قبلَ هذا السطرِ يمرُّ بلا فرضٍ ولا يُكشَفُ.
  registerServiceIdentity(app, options.serviceIdentity);

  app.get("/health", { config: OPEN }, async (_request, reply) => {
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

  app.get("/drivers", { config: adminScoped(DRIVER_SCOPES.adminRead) }, async (request, reply) => {
    assertRequestIdLength(request.headers);
    const limit = Math.min(Math.max(parseInt(request.query.limit as string) || 50, 1), 200);
    const offset = Math.max(parseInt(request.query.offset as string) || 0, 0);
    const profiles = await runner.read((deps) => deps.profiles.list(limit, offset));
    return reply.status(200).send({
      drivers: profiles.map(driverProfileToWire),
      limit,
      offset,
    });
  });

  app.post("/drivers", { config: ownerScoped(DRIVER_SCOPES.profileWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const body = toDriverRegistrationBody(request.body);
    // Read before the domain does, because the namespaced idempotency key is built from
    // it. `registerDriver` re-validates; this is a shape check for a key, not a second
    // rule.
    const waslaPublicId = toWaslaPublicId(body.wasla_public_id);
    // `wasla_public_id` comes from the body, not the path. The beneficiary in the
    // token must still match it: a caller who can mint a token for one driver must
    // not register another.
    const caller = request.serviceCaller;
    const beneficiary = caller === undefined ? undefined : ownerPublicIdOf(caller);
    if (beneficiary === undefined || beneficiary.trim() === "") {
      throw new Error(
        'مسارٌ يمسُّ مَورِداً مملوكاً مُسجَّلٌ بلا beneficiary: "required" — راجِعِ ownerScoped().',
      );
    }
    if (waslaPublicId !== beneficiary) {
      throw new DriverError(
        "DRIVER_NOT_FOUND",
        `لا ملف سائق للمعرّف ${waslaPublicId}`,
        { traceId },
      );
    }
    const fingerprint = payloadFingerprint(body);

    const outcome = await runner.write(async (deps) => {
      const verdict = await classifyReplay(
        deps,
        registrationKey(waslaPublicId, idempotencyKey),
        fingerprint,
      );
      if (verdict.kind === "replay") {
        const body = verdict.response.body as { replayed: boolean };
        return { ...body, replayed: true } as never;
      }
      // legacy-replay falls through to reprocessing (pre-G6 row)
      const profile = await registerDriver(deps, {
        waslaPublicId,
        displayName: nullableString(body, "display_name"),
        preferredLocale: body.preferred_locale,
        workCityZoneId: nullableString(body, "work_city_zone_id") ?? null,
        serviceKinds: body.service_kinds,
        traceId,
      });
      const result = { profile, replayed: false };
      await deps.idempotency.remember(
        registrationKey(waslaPublicId, idempotencyKey),
        fingerprint,
        { status: 201, body: result },
      );
      return result;
    });

    return reply
      .status(outcome.replayed ? 200 : 201)
      .send(driverProfileToWire(outcome.profile));
  });

  app.post("/drivers/eligibility/tick", { config: internalScoped(DRIVER_SCOPES.eligibilityTick) }, async (request, reply) => {
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

  app.get("/drivers/:waslaPublicId", { config: ownerScoped(DRIVER_SCOPES.profileRead) }, async (request, reply) => {
    assertRequestIdLength(request.headers);
    const waslaPublicId = requireBeneficiary(request, request.id);
    const profile = await runner.read((deps) => readDriverProfile(deps, waslaPublicId));
    return reply.status(200).send(driverProfileToWire(profile));
  });

  app.patch("/drivers/:waslaPublicId", { config: ownerScoped(DRIVER_SCOPES.profileWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const waslaPublicId = requireBeneficiary(request, traceId);
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

  app.put("/drivers/:waslaPublicId/zones", { config: ownerScoped(DRIVER_SCOPES.zoneWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const waslaPublicId = requireBeneficiary(request, traceId);
    const zones = toZonesBody(request.body);
    const replaced = await runner.write((deps) =>
      setServiceZones(deps, waslaPublicId, { zones, traceId }),
    );
    return reply.status(200).send({ zones: replaced.map(serviceZoneToWire) });
  });

  app.get("/drivers/:waslaPublicId/zones", { config: ownerScoped(DRIVER_SCOPES.zoneRead) }, async (request, reply) => {
    assertRequestIdLength(request.headers);
    const waslaPublicId = requireBeneficiary(request, request.id);
    const zones = await runner.read((deps) => listDriverZones(deps, waslaPublicId));
    return reply.status(200).send({ zones: zones.map(serviceZoneToWire) });
  });

  app.post("/drivers/:waslaPublicId/vehicles", { config: ownerScoped(DRIVER_SCOPES.vehicleWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const waslaPublicId = requireBeneficiary(request, traceId);
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

  app.get("/drivers/:waslaPublicId/vehicles", { config: ownerScoped(DRIVER_SCOPES.vehicleRead) }, async (request, reply) => {
    assertRequestIdLength(request.headers);
    const waslaPublicId = requireBeneficiary(request, request.id);
    const vehicles = await runner.read((deps) => listDriverVehicles(deps, waslaPublicId));
    return reply.status(200).send({ vehicles: vehicles.map(vehicleToWire) });
  });

  app.patch("/drivers/:waslaPublicId/vehicles/:vehicleId", { config: ownerScoped(DRIVER_SCOPES.vehicleWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const params = request.params as { waslaPublicId?: unknown; vehicleId?: unknown };
    const waslaPublicId = requireBeneficiary(request, traceId);
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

  app.post("/drivers/:waslaPublicId/documents", { config: ownerScoped(DRIVER_SCOPES.documentWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const idempotencyKey = requireIdempotencyKey(request.headers);
    const waslaPublicId = requireBeneficiary(request, traceId);
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

  app.get("/drivers/:waslaPublicId/documents", { config: ownerScoped(DRIVER_SCOPES.documentRead) }, async (request, reply) => {
    assertRequestIdLength(request.headers);
    const waslaPublicId = requireBeneficiary(request, request.id);
    const documents = await runner.read((deps) => listDriverDocuments(deps, waslaPublicId));
    return reply.status(200).send({ documents: documents.map(driverDocumentToWire) });
  });

  app.post("/drivers/:waslaPublicId/documents/:documentId/review", { config: ownerScoped(DRIVER_SCOPES.documentReview) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const params = request.params as { waslaPublicId?: unknown; documentId?: unknown };
    const waslaPublicId = requireBeneficiary(request, traceId);
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

  app.put("/drivers/:waslaPublicId/availability", { config: ownerScoped(DRIVER_SCOPES.availabilityWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const waslaPublicId = requireBeneficiary(request, traceId);
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

  app.post("/drivers/:waslaPublicId/suspend", { config: ownerScoped(DRIVER_SCOPES.profileSuspend) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const waslaPublicId = requireBeneficiary(request, traceId);
    const body = toSuspensionBody(request.body);
    const profile = await runner.write((deps) =>
      suspendDriver(deps, waslaPublicId, body.reason_code, traceId),
    );
    return reply.status(200).send(driverProfileToWire(profile));
  });

  app.post("/drivers/:waslaPublicId/reinstate", { config: ownerScoped(DRIVER_SCOPES.profileReinstate) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const waslaPublicId = requireBeneficiary(request, traceId);
    assertNoBody(request.body);
    const profile = await runner.write((deps) =>
      reinstateDriver(deps, waslaPublicId, traceId),
    );
    return reply.status(200).send(driverProfileToWire(profile));
  });

  app.get("/drivers/:waslaPublicId/eligibility", { config: ownerScoped(DRIVER_SCOPES.eligibilityRead) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers);
    const waslaPublicId = requireBeneficiary(request, traceId);
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
