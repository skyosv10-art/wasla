import Fastify, { type FastifyInstance } from "fastify";

import { offerNotFound, validationFailed } from "../domain/errors.js";
import { offerDetailToWire, toApiJob, toApiOffer, toApiOfferList, toApiTickResult } from "../mappers.js";
import { runTick } from "../run-tick.js";
import type { DispatchRunner } from "../runner.js";
import { acceptOffer } from "../use-cases/accept-offer.js";
import { cancelDispatchJob } from "../use-cases/cancel-job.js";
import { createDispatchJob } from "../use-cases/create-job.js";
import { listDispatchOffers, readDispatchJob, readDispatchOffer } from "../use-cases/read-job.js";
import { rejectOffer } from "../use-cases/reject-offer.js";

import { sendDispatchError } from "./errors.js";
import {
  DISPATCH_SCOPES,
  registerServiceIdentity,
  type DispatchRouteConfig,
  type DispatchServiceIdentityOptions,
} from "./service-identity.js";
import {
  assertRequestIdLength,
  requireIdempotencyKey,
  toCancelJobRequest,
  toCreateJobRequest,
  toPathId,
  toRejectOfferRequest,
} from "./requests.js";

export interface DispatchHealthDescriptor {
  persistence: "postgres" | "memory";
}

export interface DispatchTickState {
  lastTickAt: string | null;
}

export interface CreateDispatchAppOptions {
  runner: DispatchRunner;
  /**
   * فرضُ هويّةِ الخدمةِ على هذا الحدِّ (`M1-04`). **إلزاميٌّ بلا قيمةٍ
   * افتراضيّةٍ بقصدٍ**: قيمةٌ افتراضيّةٌ «بلا فرضٍ» تجعلُ نسيانَ التركيبِ في
   * جذرٍ واحدٍ يمرُّ صامتاً في كلِّ اختبارٍ ويُكشَفُ في الإنتاجِ وحدَه.
   */
  serviceIdentity: DispatchServiceIdentityOptions;
  health?: DispatchHealthDescriptor;
  tickState?: DispatchTickState;
  logger?: boolean;
}

/** `/health` وحدَه مفتوحٌ: لا يقرأُ ولا يكتبُ بياناتٍ مجاليّةً. */
const OPEN: DispatchRouteConfig = { serviceIdentity: "open" };

function scoped(...scopes: readonly string[]): DispatchRouteConfig {
  return { serviceIdentity: { scopes } };
}

const DEFAULT_HEALTH: DispatchHealthDescriptor = { persistence: "memory" };

export function createDispatchApp(options: CreateDispatchAppOptions): FastifyInstance {
  const health = options.health ?? DEFAULT_HEALTH;
  const tickState = options.tickState ?? { lastTickAt: null };
  const app = Fastify({ logger: options.logger ?? false, requestIdHeader: "x-request-id" });

  app.setErrorHandler((error, request, reply) => {
    sendDispatchError(reply, error, request.id);
  });

  // قبلَ أوّلِ مسارٍ: حاجزُ التصنيفِ يرى ما يُسجَّلُ بعدَه لا ما قبلَه.
  registerServiceIdentity(app, options.serviceIdentity);

  app.get("/health", { config: OPEN }, async (_request, reply) => {
    return reply.status(200).send({
      status: health.persistence === "postgres" ? "ok" : "degraded",
      service: "dispatch-service",
      persistence: health.persistence,
      last_tick_at: tickState.lastTickAt,
    });
  });

  app.post("/dispatch/jobs", { config: scoped(DISPATCH_SCOPES.jobWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    const idempotencyKey = requireIdempotencyKey(request.headers, traceId);
    const body = toCreateJobRequest(request.body, traceId);
    const result = await options.runner.write((deps) => createDispatchJob(deps, {
      orderId: body.order_id,
      orderPublicId: body.order_public_id,
      zoneId: body.zone_id,
      orderType: body.order_type,
      vehicleClass: body.vehicle_class,
      idempotencyKey,
      traceId,
    }));
    return reply.status(result.replayed ? 200 : 201).send(toApiJob(result.job));
  });

  app.get("/dispatch/jobs/:job_id", { config: scoped(DISPATCH_SCOPES.jobRead) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    const jobId = toPathId((request.params as { job_id?: unknown }).job_id, "job_id", traceId);
    const job = await options.runner.read((deps) => readDispatchJob(deps, { jobId, traceId }));
    return reply.status(200).send(toApiJob(job));
  });

  app.get("/dispatch/jobs/:job_id/offers", { config: scoped(DISPATCH_SCOPES.offerRead) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    const jobId = toPathId((request.params as { job_id?: unknown }).job_id, "job_id", traceId);
    const offers = await options.runner.read((deps) => listDispatchOffers(deps, { jobId, traceId }));
    return reply.status(200).send(toApiOfferList(offers));
  });

  app.get("/dispatch/offers/:offer_id", { config: scoped(DISPATCH_SCOPES.offerRead) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    const offerId = toPathId((request.params as { offer_id?: unknown }).offer_id, "offer_id", traceId);
    const offer = await options.runner.read((deps) => readDispatchOffer(deps, { offerId, traceId }));
    if (offer === null) throw offerNotFound(traceId);
    return reply.status(200).send(offerDetailToWire(offer));
  });

  app.post("/dispatch/tick", { config: scoped(DISPATCH_SCOPES.tickWrite) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    requireIdempotencyKey(request.headers, traceId);
    if (request.body !== undefined && request.body !== null) {
      throw validationFailed("body", "جسم فارغ", traceId);
    }
    const outcome = await runTick(options.runner, { traceId });
    tickState.lastTickAt = outcome.tickAt;
    return reply.status(200).send(toApiTickResult(outcome));
  });

  app.post("/dispatch/offers/:offer_id/accept", { config: scoped(DISPATCH_SCOPES.offerAccept) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    const idempotencyKey = requireIdempotencyKey(request.headers, traceId);
    const offerId = toPathId((request.params as { offer_id?: unknown }).offer_id, "offer_id", traceId);
    const result = await options.runner.write((deps) => acceptOffer(deps, { offerId, idempotencyKey, traceId }));
    return reply.status(200).send(toApiOffer(result.offer));
  });

  app.post("/dispatch/offers/:offer_id/reject", { config: scoped(DISPATCH_SCOPES.offerReject) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    const idempotencyKey = requireIdempotencyKey(request.headers, traceId);
    const offerId = toPathId((request.params as { offer_id?: unknown }).offer_id, "offer_id", traceId);
    const body = toRejectOfferRequest(request.body, traceId);
    const result = await options.runner.write((deps) => rejectOffer(deps, {
      offerId,
      reasonCode: body.reason_code,
      idempotencyKey,
      traceId,
    }));
    return reply.status(200).send(toApiOffer(result.offer));
  });

  app.post("/dispatch/jobs/:job_id/cancel", { config: scoped(DISPATCH_SCOPES.jobCancel) }, async (request, reply) => {
    const traceId = request.id;
    assertRequestIdLength(request.headers, traceId);
    const idempotencyKey = requireIdempotencyKey(request.headers, traceId);
    const jobId = toPathId((request.params as { job_id?: unknown }).job_id, "job_id", traceId);
    const body = toCancelJobRequest(request.body, traceId);
    const result = await options.runner.write((deps) => cancelDispatchJob(deps, {
      jobId,
      reasonCode: body.reason_code,
      idempotencyKey,
      traceId,
    }));
    return reply.status(200).send(toApiJob(result.job));
  });

  return app;
}
