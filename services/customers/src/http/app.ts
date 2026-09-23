/**
 * Fastify HTTP app factory for the Customer Core service (MR 4/6).
 *
 * Wires the 7 contract paths of services/customers/contracts/api.openapi.yml to
 * the use cases delivered in MR 2/6, over the ports whose Postgres adapters
 * arrived in MR 3/6. The factory takes the shared `UseCaseDeps` (hexagonal
 * wiring), so tests inject the in-memory adapters through `app.inject` while the
 * bootstrap (server.ts) wires Drizzle/Postgres and the real order-engine
 * adapter. The factory never listens — that is server.ts's single job.
 *
 * Routes (exactly the published contract, nothing more):
 *   GET    /health                                                (ops)
 *   GET    /customers/:waslaPublicId/profile
 *   PUT    /customers/:waslaPublicId/profile
 *   GET    /customers/:waslaPublicId/places
 *   POST   /customers/:waslaPublicId/places                       (Idempotency-Key)
 *   DELETE /customers/:waslaPublicId/places/:placeId
 *   POST   /customers/:waslaPublicId/order-requests/preview
 *   GET    /customers/:waslaPublicId/order-requests
 *   POST   /customers/:waslaPublicId/order-requests               (Idempotency-Key)
 *   GET    /customers/:waslaPublicId/order-requests/:orderRequestId
 *
 * What this layer does NOT do, on purpose:
 *  - it does not validate meaning (enums, lengths, price coherence, stop count):
 *    those live in the domain, because the bot (MR 5/6) calls the use cases
 *    directly and must be rejected identically;
 *  - it does not classify errors: `CustomerError` already carries the contract
 *    code and the status derived from its documented class (see errors.ts);
 *  - it does not own a database connection: the pool belongs to server.ts.
 *
 * Status codes come from the contract, not from convention: a replayed
 * `Idempotency-Key` answers 200 with the stored entity while a fresh write
 * answers 201, so the caller can tell «created» from «already existed» without
 * comparing bodies (§43).
 */

import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { ownerPublicIdOf } from "@wasla/auth-sdk";
import { SAVED_PLACES_LIMIT } from "@wasla/contracts-customer";

import { CustomerError } from "../domain/errors.js";

import type { CustomerProfile, CustomerStatus, ZoneReference } from "../domain/model.js";
import type { GeographyPort } from "../ports.js";
import type { UseCaseDeps } from "../use-cases/deps.js";
import {
  getCustomerProfile,
  upsertCustomerProfile,
} from "../use-cases/customer-profile.js";
import {
  toCustomerProfileDto,
  toOrderRequestDto,
  toOrderRequestPreviewDto,
  toSavedPlaceDto,
} from "../use-cases/mappers.js";
import {
  getOrderRequest,
  listOrderRequests,
  previewOrderRequest,
  submitOrderRequest,
} from "../use-cases/order-requests.js";
import {
  listSavedPlaces,
  removeSavedPlace,
  savePlace,
} from "../use-cases/saved-places.js";

import { sendCustomerError } from "./errors.js";
import {
  CUSTOMER_SCOPES,
  registerServiceIdentity,
  type CustomerRouteConfig,
  type CustomerServiceIdentityOptions,
} from "./service-identity.js";
import {
  requireIdempotencyKey,
  toListLimit,
  toOrderRequestDraft,
  toProfilePatch,
  toSavedPlaceDraft,
} from "./requests.js";

/** What `/health` reports about the adapters this process actually wired. */
export interface CustomerHealthDescriptor {
  /** `postgres` when DATABASE_URL was set, `memory` for the dev fallback. */
  persistence: "postgres" | "memory";
  /** `configured` only when a real order-engine adapter is wired (Phase 06). */
  orderIntake: "configured" | "unconfigured";
}

export interface CreateCustomerAppOptions {
  deps: UseCaseDeps;
  /** Enable Fastify's request logger (pino). Off by default for tests. */
  logger?: boolean;
  /**
   * Reported by `/health`. Defaults to the honest Phase 04 state: in-memory
   * persistence and no order-engine adapter — a build that cannot complete a
   * handover says so instead of claiming to be healthy.
   */
  health?: CustomerHealthDescriptor;
  /**
   * فرضُ هويّةِ الخدمةِ على هذا الحدِّ. **إلزاميٌّ بلا قيمةٍ افتراضيّةٍ بقصدٍ**
   * (سابقةُ حدِّ السوقِ وحدِّ الطلباتِ): قيمةٌ افتراضيّةٌ تجعلُ نسيانَ التركيبِ
   * في جذرٍ ما حدَّ عميلٍ **مفتوحاً يمرُّ كلَّ اختباراتِه** — وهيَ بعينِها
   * الثغرةُ التي قاسَتْها الموجةُ الثامنةُ (`RISK-0051`) وتسدُّها هذهِ. فمن
   * أرادَ حدّاً بلا فرضٍ فليكتبْ ذلكَ صراحةً في جذرِ تركيبِه، ولا موضعَ في
   * المستودعِ يكتبُه.
   */
  serviceIdentity: CustomerServiceIdentityOptions;
}

const DEFAULT_HEALTH: CustomerHealthDescriptor = {
  persistence: "memory",
  orderIntake: "unconfigured",
};

/** الصلاحيّاتُ المُعلَنةُ على مساراتِ العميلِ (domain:resource:action). */
export const CUSTOMER_ROUTE_SCOPES = CUSTOMER_SCOPES;

/** `/health` وحدَهُ: لا يقرأُ ولا يكتبُ بياناتٍ مجاليّةً. */
const OPEN: CustomerRouteConfig = { serviceIdentity: "open" };

/**
 * مسارٌ يمسُّ مَورِداً **مملوكاً لإنسانٍ بعينِهِ** — وهوَ كلُّ مسارٍ في هذا
 * الحدِّ ما خلا `/health`. فـ`beneficiary: "required"` يجعلُ الوسيطَ المركزيَّ
 * يرفضُ كلَّ رمزٍ لا يحملُ هويّةَ المُنتَفِعِ **قبلَ** أن يمسَّ المسارُ قاعدةَ
 * البياناتِ، ثمَّ يُقارِنُ `requireBeneficiary` المُنتَفِعَ المُوَقَّعَ
 * بـ`:waslaPublicId` المكتوبِ في المسارِ.
 */
function ownerScoped(...scopes: readonly string[]): CustomerRouteConfig {
  return { serviceIdentity: { scopes, beneficiary: "required" } };
}

/**
 * مسارٌ إداريٌّ بلا مُنتَفِعٍ: القائمةُ والتفاصيلُ والتعليقُ والإعادةُ التي
 * يناديها admin portal. لا يملكُ مَورِداً لإنسانٍ بعينِهِ، فلا `beneficiary`.
 * الصلاحيّاتُ منفصلةٌ عن `ownerScoped` لأنّها نطاقٌ مختلف: مُشغِّلٌ لا مالك.
 */
function adminScoped(...scopes: readonly string[]): CustomerRouteConfig {
  return { serviceIdentity: { scopes } };
}

/** 
 * تعويلُ الـ admin portal لملخّصِ العميلِ: الحقولُ التي تملكُها خدمةُ العملاء
 * حقيقيّاً، وما لا تملكُهُ تُعادُ فيهِ `null` أو `0` صراحةً — لا تُخفى.
 */
function toAdminUserSummary(profile: CustomerProfile): Record<string, unknown> {
  return {
    wasla_public_id: profile.waslaPublicId,
    display_name: profile.displayName,
    phone_number: null, // identity service owns phone numbers
    preferred_locale: profile.preferredLocale,
    status: profile.status,
    suspension_reason_code: profile.suspensionReasonCode,
    order_count: 0, // orders service owns order count
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  };
}

/** 
 * تعويلُ الـ admin portal لتفاصيلِ العميلِ: نفسُ ملخّصِ العميلِ + حقولُ
 * السمعةِ والطلباتِ الحديثةِ التي تملكُها خدماتٌ أخرى.
 */
function toAdminUserDetail(profile: CustomerProfile): Record<string, unknown> {
  return {
    ...toAdminUserSummary(profile),
    rating_avg: null, // reputation service owns ratings
    rating_count: 0,
    recent_orders: [], // orders service owns order history
  };
}

/**
 * مالكُ المَورِدِ كما **يُثبِتُهُ الرمزُ**، مُطابَقاً بما كُتِبَ في المسارِ.
 *
 * ── لِمَ لا يكفي المسارُ ───────────────────────────────────────────────────
 * `:waslaPublicId` قيمةٌ **يكتبُها المُنادي**. فلو فُرِضَتِ الصلاحيّةُ وحدَها
 * لكانَ حاملُ `customers:profile:read` يقرأُ ملفَّ كلِّ عميلٍ بتبديلِ حرفٍ في
 * المسارِ — وهذا وجهُ `RISK-0042` نفسُهُ الذي أُغلِقَ على حدِّ الطلباتِ في
 * `M1-05B`، ويُغلَقُ هنا في الدفعةِ التي تفرضُ الهويّةَ لا بعدَها.
 *
 * ── لِمَ 404 لا 403 ────────────────────────────────────────────────────────
 * المُنادي أعلَنَ مُنتَفِعاً في الرمزِ ومُنتَفِعاً آخرَ في المسارِ، فلا يُفصَحُ
 * لهُ أيُّهما لهُ ملفٌّ: `ADR-009` — «المساراتُ المملوكةُ تُجيبُ 404 لا 403»،
 * وهيَ سياسةُ هذا الحدِّ المكتوبةُ أصلاً عندَ حذفِ مكانٍ ليسَ لصاحبِه.
 *
 * ── ولِمَ يبقى فرعُ الغيابِ مكتوباً ───────────────────────────────────────
 * لا يُبلَغُ من مسارٍ مُصنَّفٍ بـ`ownerScoped` (الوسيطُ رفضَ قبلَهُ)، وهوَ
 * **حارسُ تركيبٍ**: مَن سجَّلَ مساراً جديداً ونسِيَ `ownerScoped` يرى 503 في
 * الاختبارِ لا 200 بملكيّةٍ غيرِ مفحوصةٍ.
 */
function requireBeneficiary(request: FastifyRequest, traceId: string): string {
  const caller = request.serviceCaller;
  const beneficiary = caller === undefined ? undefined : ownerPublicIdOf(caller);

  if (beneficiary === undefined || beneficiary.trim() === "") {
    throw new Error(
      'مسارٌ يمسُّ مَورِداً مملوكاً مُسجَّلٌ بلا beneficiary: "required" — راجِعِ ownerScoped().',
    );
  }

  const { waslaPublicId } = request.params as { waslaPublicId: string };
  if (waslaPublicId !== beneficiary) {
    throw new CustomerError(
      "CUSTOMER_PROFILE_NOT_FOUND",
      `لا ملف عميل للمعرّف ${waslaPublicId}`,
      { traceId },
    );
  }

  return beneficiary;
}

/**
 * Resolve zone paths for display, best effort.
 *
 * `zone_path` is a convenience the bot prints; the zone id is the truth and the
 * path is never stored (see mappers.ts). So a geography lookup that fails must
 * not fail a read of the customer's own local data: the path comes back null and
 * the row is still returned. The alternative — 503 on a saved-place list because
 * a display string could not be resolved — would make an unrelated service an
 * availability dependency of every read.
 *
 * One lookup per distinct zone: `GeographyPort` has no batch method because
 * nothing needed one until now. That cost is declared in the architecture doc
 * rather than hidden behind a silent loop.
 */
async function resolveZones(
  geography: GeographyPort,
  zoneIds: readonly string[],
): Promise<ZoneReference[]> {
  const distinct = [...new Set(zoneIds)];
  const resolved = await Promise.all(
    distinct.map(async (zoneId) => {
      try {
        return await geography.findZone(zoneId);
      } catch {
        return null;
      }
    }),
  );
  return resolved.filter((zone): zone is ZoneReference => zone !== null);
}

/** Build the Customer Core Fastify app without starting to listen. */
export function createCustomerApp(
  options: CreateCustomerAppOptions,
): FastifyInstance {
  const { deps } = options;
  const health = options.health ?? DEFAULT_HEALTH;
  // `requestIdHeader` is off by default in Fastify 5, which would make every
  // request id local to this process. Honouring `x-request-id` lets a caller —
  // the bot in MR 5/6, or the gateway later — pass one correlation id that ends
  // up in the outbox envelopes of this service, so a customer complaint can be
  // followed across services instead of stopping at our door. An absent header
  // still yields Fastify's own generated id, so nothing depends on the caller.
  const app = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: "x-request-id",
  });

  app.setErrorHandler((error, request, reply) => {
    sendCustomerError(reply, error, request.id);
  });

  // قبلَ تسجيلِ أيِّ مسارٍ بقصدٍ: حاجزُ التصنيفِ يرى ما يُسجَّلُ بعدَهُ وحدَهُ،
  // فمسارٌ يُسجَّلُ قبلَ هذا السطرِ يمرُّ بلا فرضٍ ولا يُكشَفُ.
  registerServiceIdentity(app, options.serviceIdentity);

  // Per-request deps: the Fastify request id becomes the event `trace_id`, so an
  // outbox envelope can be traced back to the HTTP call that produced it.
  const withTrace = (traceId: string): UseCaseDeps => ({ ...deps, traceId });

  // --- ops -----------------------------------------------------------------

  // Readiness, per the contract's /health schema. `degraded` when no order-engine
  // adapter is wired: reads and writes work, but a handover cannot succeed, and
  // reporting `ok` in that state would hide the one thing Phase 04 exists to do.
  app.get("/health", { config: OPEN }, async (_request, reply) => {
    return reply.status(200).send({
      status: health.orderIntake === "configured" ? "ok" : "degraded",
      service: "customers-service",
      persistence: health.persistence,
      order_intake: health.orderIntake,
    });
  });

  // --- admin routes (M3-04) ------------------------------------------------
  // No beneficiary: admin portal uses user-session auth, not service-owner tokens.
  // The mapping between RBAC roles (ADMIN_MVP_SPEC §7) and these service-auth
  // scopes is built at the gateway (M3-09), not here.

  app.get("/customers", { config: adminScoped(CUSTOMER_SCOPES.adminRead) }, async (request, reply) => {
    const query = request.query as { q?: unknown; status?: unknown; limit?: unknown; offset?: unknown };
    const limit = Math.min(Math.max(parseInt(query.limit as string) || 50, 1), 200);
    const offset = Math.max(parseInt(query.offset as string) || 0, 0);
    const status = typeof query.status === "string" && query.status !== "all" ? query.status : undefined;
    const profiles = await deps.repo.listProfiles({
      q: typeof query.q === "string" && query.q.trim() ? query.q.trim() : undefined,
      status: status as CustomerStatus | undefined,
      limit,
      offset,
    });
    return reply.status(200).send({
      customers: profiles.map(toAdminUserSummary),
      limit,
      offset,
    });
  });

  app.get("/customers/:id", { config: adminScoped(CUSTOMER_SCOPES.adminRead) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const profile = await deps.repo.findProfile(id);
    if (profile === null) {
      throw new CustomerError("CUSTOMER_PROFILE_NOT_FOUND", `لا ملف عميل للمعرّف ${id}`, { traceId: request.id });
    }
    return reply.status(200).send(toAdminUserDetail(profile));
  });

  app.post("/customers/:id/suspend", { config: adminScoped(CUSTOMER_SCOPES.adminSuspend) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { reason_code?: unknown };
    const reasonCode = typeof body?.reason_code === "string" ? body.reason_code.trim() : "";
    if (!reasonCode || reasonCode.length < 1 || reasonCode.length > 128) {
      throw new CustomerError("CUSTOMER_INVALID_REQUEST_BODY", "reason_code مطلوب (1–128 حرفًا)", { traceId: request.id });
    }
    const profile = await deps.repo.findProfile(id);
    if (profile === null) {
      throw new CustomerError("CUSTOMER_PROFILE_NOT_FOUND", `لا ملف عميل للمعرّف ${id}`, { traceId: request.id });
    }
    // Idempotent: suspending an already-suspended customer returns current state.
    if (profile.status === "suspended" && profile.suspensionReasonCode === reasonCode) {
      return reply.status(200).send(toAdminUserDetail(profile));
    }
    const updated = await deps.repo.saveProfile({
      ...profile,
      status: "suspended",
      suspensionReasonCode: reasonCode,
      updatedAt: new Date().toISOString(),
    });
    return reply.status(200).send(toAdminUserDetail(updated));
  });

  app.post("/customers/:id/reinstate", { config: adminScoped(CUSTOMER_SCOPES.adminReinstate) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const profile = await deps.repo.findProfile(id);
    if (profile === null) {
      throw new CustomerError("CUSTOMER_PROFILE_NOT_FOUND", `لا ملف عميل للمعرّف ${id}`, { traceId: request.id });
    }
    // Idempotent: reinstating an already-active customer returns current state.
    if (profile.status === "active") {
      return reply.status(200).send(toAdminUserDetail(profile));
    }
    const updated = await deps.repo.saveProfile({
      ...profile,
      status: "active",
      suspensionReasonCode: null,
      updatedAt: new Date().toISOString(),
    });
    return reply.status(200).send(toAdminUserDetail(updated));
  });

  // --- profile -------------------------------------------------------------

  app.get(
    "/customers/:waslaPublicId/profile",
    { config: ownerScoped(CUSTOMER_SCOPES.profileRead) },
    async (request, reply) => {
    const waslaPublicId = requireBeneficiary(request, request.id);
    const profile = await getCustomerProfile(deps, { waslaPublicId });
    return reply.status(200).send(toCustomerProfileDto(profile));
    },
  );

  app.put(
    "/customers/:waslaPublicId/profile",
    { config: ownerScoped(CUSTOMER_SCOPES.profileWrite) },
    async (request, reply) => {
    const waslaPublicId = requireBeneficiary(request, request.id);
    const result = await upsertCustomerProfile(withTrace(request.id), {
      waslaPublicId,
      patch: toProfilePatch(request.body),
    });
    return reply
      .status(result.created ? 201 : 200)
      .send(toCustomerProfileDto(result.profile));
    },
  );

  // --- saved places --------------------------------------------------------

  app.get(
    "/customers/:waslaPublicId/places",
    { config: ownerScoped(CUSTOMER_SCOPES.placeRead) },
    async (request, reply) => {
    const waslaPublicId = requireBeneficiary(request, request.id);
    const places = await listSavedPlaces(deps, { waslaPublicId });
    const zones = await resolveZones(
      deps.geography,
      places.map((place) => place.zoneId),
    );
    const paths = new Map(zones.map((zone) => [zone.zoneId, zone.path ?? null]));
    return reply.status(200).send({
      items: places.map((place) =>
        toSavedPlaceDto(place, paths.get(place.zoneId) ?? null),
      ),
      limit: SAVED_PLACES_LIMIT,
    });
    },
  );

  app.post(
    "/customers/:waslaPublicId/places",
    { config: ownerScoped(CUSTOMER_SCOPES.placeWrite) },
    async (request, reply) => {
    const waslaPublicId = requireBeneficiary(request, request.id);
    const idempotencyKey = requireIdempotencyKey(
      request.headers["idempotency-key"],
    );
    const result = await savePlace(withTrace(request.id), {
      waslaPublicId,
      idempotencyKey,
      draft: toSavedPlaceDraft(request.body),
    });
    const zones = await resolveZones(deps.geography, [result.place.zoneId]);
    return reply
      .status(result.replayed ? 200 : 201)
      .send(toSavedPlaceDto(result.place, zones[0]?.path ?? null));
    },
  );

  // 204 with no body. Deleting an already-deleted place is a 404 rather than a
  // silent success: the customer asked to remove something that is not theirs or
  // no longer exists, and owner-scoped reads answer 404 not 403 (ADR-009).
  app.delete(
    "/customers/:waslaPublicId/places/:placeId",
    { config: ownerScoped(CUSTOMER_SCOPES.placeWrite) },
    async (request, reply) => {
      const waslaPublicId = requireBeneficiary(request, request.id);
      const { placeId } = request.params as { placeId: string };
      await removeSavedPlace(withTrace(request.id), { waslaPublicId, placeId });
      return reply.status(204).send();
    },
  );

  // --- order requests ------------------------------------------------------

  // Preview writes nothing and calls no engine: same validation, no side effect.
  app.post(
    "/customers/:waslaPublicId/order-requests/preview",
    { config: ownerScoped(CUSTOMER_SCOPES.orderRequestPreview) },
    async (request, reply) => {
      const waslaPublicId = requireBeneficiary(request, request.id);
      const preview = await previewOrderRequest(deps, {
        waslaPublicId,
        draft: toOrderRequestDraft(request.body),
      });
      return reply.status(200).send(toOrderRequestPreviewDto(preview));
    },
  );

  app.get(
    "/customers/:waslaPublicId/order-requests",
    { config: ownerScoped(CUSTOMER_SCOPES.orderRequestRead) },
    async (request, reply) => {
    const waslaPublicId = requireBeneficiary(request, request.id);
    const limit = toListLimit((request.query as { limit?: unknown }).limit);
    const requests = await listOrderRequests(deps, {
      waslaPublicId,
      ...(limit === undefined ? {} : { limit }),
    });
    const zones = await resolveZones(
      deps.geography,
      requests.flatMap((item) => item.stops.map((stop) => stop.zoneId)),
    );
    return reply.status(200).send({
      items: requests.map((item) => toOrderRequestDto(item, zones)),
    });
    },
  );

  // A failed handover throws CUSTOMER_ORDER_INTAKE_UNAVAILABLE (503) *after* the
  // request row and its failure event were written, so the customer sees an error
  // and the request is still visible in the list — fail-closed, not fail-silent.
  app.post(
    "/customers/:waslaPublicId/order-requests",
    { config: ownerScoped(CUSTOMER_SCOPES.orderRequestWrite) },
    async (request, reply) => {
    const waslaPublicId = requireBeneficiary(request, request.id);
    const idempotencyKey = requireIdempotencyKey(
      request.headers["idempotency-key"],
    );
    const result = await submitOrderRequest(withTrace(request.id), {
      waslaPublicId,
      idempotencyKey,
      draft: toOrderRequestDraft(request.body),
    });
    const zones = await resolveZones(
      deps.geography,
      result.orderRequest.stops.map((stop) => stop.zoneId),
    );
    return reply
      .status(result.replayed ? 200 : 201)
      .send(toOrderRequestDto(result.orderRequest, zones));
    },
  );

  app.get(
    "/customers/:waslaPublicId/order-requests/:orderRequestId",
    { config: ownerScoped(CUSTOMER_SCOPES.orderRequestRead) },
    async (request, reply) => {
      const waslaPublicId = requireBeneficiary(request, request.id);
      const { orderRequestId } = request.params as { orderRequestId: string };
      const orderRequest = await getOrderRequest(deps, {
        waslaPublicId,
        orderRequestId,
      });
      const zones = await resolveZones(
        deps.geography,
        orderRequest.stops.map((stop) => stop.zoneId),
      );
      return reply.status(200).send(toOrderRequestDto(orderRequest, zones));
    },
  );

  return app;
}
