/**
 * Delivery HTTP boundary — Fastify app (ADR-026 §4.2, lifted for the network
 * edge in review 6/N · contracts/api.openapi.yml).
 *
 * Exactly the nine routes the contract publishes, no more: a route that is not
 * in the contract is a private API nobody documented, and the first client that
 * finds it makes it permanent.
 *
 *   POST /store-orders                                 → 201 (Idempotency-Key)
 *   GET  /store-orders/{orderPublicId}                 → 200
 *   POST /store-orders/{orderPublicId}/cancellation    → 200 (Idempotency-Key)
 *   PUT  /store-orders/{orderPublicId}/payment-mirror  → 200 (Idempotency-Key)
 *   POST /store-orders/{orderPublicId}/confirmation    → 200 (Idempotency-Key)
 *   POST /store-orders/{orderPublicId}/fulfillment-transition → 200 (Idempotency-Key)
 *   GET  /store-orders/{orderPublicId}/delivery-task   → 200
 *   GET  /delivery/health                              → 200 (liveness)
 *   GET  /delivery/ready                               → 200/503 (readiness)
 *
 * ## Injected ports — this app never opens a database
 *
 * Every dependency arrives through `DeliveryHttpDeps`. Unit tests build the
 * app with fakes and assert real HTTP status codes and bodies; production
 * wiring lives in `server.ts`. An app that constructed its own `pg.Pool`
 * could not be tested without a database, and the tests that matter most
 * (does a refused cancellation really answer 409?) would silently not run.
 *
 * ## One error handler, no try/catch in handlers
 *
 * Handlers throw `DeliveryError` (or let a port throw) and a single
 * `setErrorHandler` translates through `sendDeliveryError`. Per-handler
 * try/catch would mean the same error translated in five places, and the
 * first route that forgot the body shape would answer something no client
 * can parse.
 *
 * ## The catalog port is OPTIONAL, and its absence is a 503 — not a fake
 *
 * `POST /store-orders` needs marketplace prices (§2.3). Review 8/N built the
 * real HTTP catalog adapter — placement now carries `store_slug`, which is the
 * reference marketplace actually publishes (§4.11) — so the port CAN be wired,
 * and in production it is. It stays optional here for one reason: an operator
 * may deliberately run this service without a catalog, and then the route must
 * answer `503 DELIVERY_MARKETPLACE_UNAVAILABLE` rather than invent prices,
 * while reads, cancellation, the payment mirror and confirmation — none of
 * which need a catalog — keep working fully.
 *
 * ## Liveness AND readiness — two routes because they answer two questions
 *
 * `GET /delivery/health` stays dependency-free: it answers "is this process
 * alive?", and coupling it to the database would let a database blink trigger
 * restarts. `GET /delivery/ready` (added to the contract in review 7/N,
 * §4.9-4 lifted) answers "should traffic come here?" by actually probing the
 * database. RISK-0030 is the precedent being avoided: `health: ok` while every
 * read answered 503.
 *
 * Readiness answers `ReadinessResponse` on 503 as well as 200 — the single
 * declared exception to "every failure is an `ErrorResponse`" (errors.md rule
 * 6), because an unready dependency is a state to report, not a defect to
 * translate. And what is not probed is not claimed: with no catalog port the
 * response lists `marketplace_catalog_not_wired` in `not_claimed` while still
 * reporting 200 if the database answers, because reads, cancellation and the
 * payment routes ARE servable then. Letting an unwireable dependency pin readiness at 503 forever
 * would make the route useless and it would be turned off — which is how a
 * service ends up with no readiness check at all.
 *
 * ## The idempotency key is required, and parsed here — not in the use case
 *
 * All four writes demand `Idempotency-Key` (§4.10). The header and the request
 * fingerprint are wire concerns, so the HTTP layer builds the intent and hands
 * it inward; the use cases and the store never read a header. A replay is
 * answered with the STORED status and body plus `Idempotent-Replay: true`, so
 * a client can tell "created" from "already created" without diffing bodies.
 */

import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";

import { DeliveryError } from "../domain/errors.js";
import type {
  IdempotencyIntent,
  InventoryReservationPort,
  InventoryReservationStore,
  ReadinessProbePort,
  StoreOrderCatalogPort,
  IdempotencyKeySweepPort,
  StoreOrderReadPort,
  StoreOrderWritePort,
} from "../ports.js";
import { assertIdempotencyKey, deriveRequestFingerprint } from "../domain/idempotency.js";
import { sendDeliveryError } from "./errors.js";
import { toDeliveryTaskResponse, toStoreOrderResponse } from "./mappers.js";
import {
  parseCancelBody,
  parseFulfillmentTransitionBody,
  parseOrderPublicIdParam,
  parsePaymentMirrorBody,
  parsePlaceStoreOrderBody,
} from "./requests.js";
import type {
  DependencyObservation,
  DependencyObservationPort,
} from "../domain/dependency-probe.js";
import { buildReadinessResponse } from "./readiness.js";
import { placeStoreOrder } from "../use-cases/place-store-order.js";
import { cancelStoreOrder } from "../use-cases/cancel-store-order.js";
import { mirrorPayment } from "../use-cases/mirror-payment.js";
import { confirmStoreOrder } from "../use-cases/confirm-store-order.js";
import { fulfillmentTransition } from "../use-cases/fulfillment-transition.js";
import { sweepExpiredIdempotencyKeys } from "../use-cases/sweep-expired-idempotency-keys.js";

export interface DeliveryHttpDeps {
  readonly readPort: StoreOrderReadPort;
  readonly writePort: StoreOrderWritePort;
  /** Absent → `POST /store-orders` answers 503 (see the file header). */
  readonly catalogPort?: StoreOrderCatalogPort;
  /** Absent → `POST /store-orders` answers 503 (review 10/N). */
  readonly reservationPort?: InventoryReservationPort;
  /** Required by placement and cancellation when `reservationPort` is wired. */
  readonly reservationStore?: InventoryReservationStore;
  /** Absent → `GET /delivery/ready` answers 503 `probe_not_wired`: an
   *  un-probed dependency is never reported as healthy. */
  readonly readinessPort?: ReadinessProbePort;
  /**
   * Absent → `POST /delivery/idempotency-keys/sweep` answers 500
   * `DELIVERY_INTERNAL_ERROR` (خلافاً لـ503 التي تعني تبعيّةً خارجيّةً عاجزةً:
   * مُكنسةٌ غيرُ مُركَّبةٍ خطأُ تركيبٍ عندَنا لا عجزُ جارٍ): مُكنسةٌ غيرُ مُركَّبةٍ لا تُجيبُ «مسحتُ صفراً»،
   * فالصفرُ الكاذبُ يُقرأُ نظافةً (المراجعةُ 13/N · ADR-026 §4.15).
   */
  readonly idempotencySweepPort?: IdempotencyKeySweepPort;
  /**
   * رصدُ حدِّ السوقِ للجاهزيّةِ (المراجعةُ 15/N · ADR-026 §4.17).
   *
   * غائبٌ ⇒ `GET /delivery/ready` يبقى على `marketplace_catalog_not_probed`
   * كما كانَ: تركيبٌ بلا مسبارٍ لا يدّعي سبراً. وموجودٌ ⇒ يُنشَرُ الرصدُ في
   * `dependencies` **ولا يُغيّرُ `status`** — العطلُ في خدمةٍ أخرى لا يُخرِجُ
   * هذه الخدمةَ من الدورةِ (`http/readiness.ts` يُفصِّلُ الحُجّةَ).
   */
  readonly marketplaceObservationPort?: DependencyObservationPort;
  /** Injected for determinism in tests; defaults to the real clock/uuid. */
  readonly newUuid?: () => string;
  readonly now?: () => string;
}

export interface DeliveryHttpApp {
  readonly fastify: FastifyInstance;
  readonly close: () => Promise<void>;
}

/**
 * Replay a stored first response: its status, its body, plus an explicit
 * header. Without the header a client cannot distinguish "created now" from
 * "created earlier", and a retry that silently looks like a fresh 201 hides
 * the very duplicate the key prevented.
 */
function sendReplay(reply: FastifyReply, status: number, body: unknown): FastifyReply {
  return reply.status(status).header("Idempotent-Replay", "true").send(body);
}

/**
 * حدودُ جَولةِ المسحِ من الجسمِ — اختياريّةٌ كلُّها.
 *
 * والتحقُّقُ صريحٌ لا `Number(x) || default`: صفرٌ وسالبٌ وكسرٌ ونصٌّ كلُّها
 * أخطاءُ منادٍ تُقالُ لهُ بـ400، لا قيمٌ تُصحَّحُ لهُ صامتةً إلى الافتراضِ
 * (`errors.md` القاعدةُ 3).
 */
function parseSweepOptions(
  body: unknown,
  traceId: string,
): { batchSize?: number; maxBatches?: number } {
  if (body === undefined || body === null) return {};
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new DeliveryError("DELIVERY_VALIDATION_FAILED", "جسمُ المسحِ كائنٌ أو لا شيءَ", {
      traceId,
      details: { field: "body", actual: Array.isArray(body) ? "array" : typeof body },
    });
  }
  const raw = body as Record<string, unknown>;
  const read = (field: "batch_size" | "max_batches"): number | undefined => {
    const value = raw[field];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      throw new DeliveryError("DELIVERY_VALIDATION_FAILED", "حدُّ المسحِ عددٌ صحيحٌ ≥ 1", {
        traceId,
        details: { field, actual: String(value) },
      });
    }
    return value;
  };
  const batchSize = read("batch_size");
  const maxBatches = read("max_batches");
  return {
    ...(batchSize === undefined ? {} : { batchSize }),
    ...(maxBatches === undefined ? {} : { maxBatches }),
  };
}

export function buildDeliveryHttpApp(deps: DeliveryHttpDeps): DeliveryHttpApp {
  const app = Fastify({
    // request.id becomes `trace_id` in every error body and every event.
    genReqId: () => crypto.randomUUID(),
  });

  const newUuid = deps.newUuid ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => new Date().toISOString());

  app.setErrorHandler((error, request, reply) => {
    return sendDeliveryError(reply, error, String(request.id));
  });

  /*
   * جسمٌ فارغٌ مع `content-type: application/json` = **«لا جسمَ»**، لا خطأٌ.
   *
   * ومن أينَ جاءتِ الحاجةُ؟ `POST …/confirmation` (المراجعةُ 9/N) لا جسمَ لهُ
   * في العقدِ: القرارُ كلُّهُ في المسارِ والحالةِ المحفوظةِ. وكلُّ عميلٍ عامٍّ
   * (`curl -X POST -H 'content-type: application/json'`، ومعهُ أكثرُ مكتباتِ
   * HTTP إذا لم يُحذَفِ الرأسُ صراحةً) يبعثُ الرأسَ ولا يبعثُ بايتاً؛
   * ومُحلِّلُ Fastify الافتراضيُّ يُسقِطُ ذلكَ بـ`FST_ERR_CTP_EMPTY_JSON_BODY`. وأوّلُ
   * من كشفَ أنَّ المسارَ غيرُ قابلٍ للنِّداءِ على السلكِ بوّابةُ الخروجِ: اختباراتُ
   * الوحدةِ تستعملُ `app.inject` بلا رأسٍ، فلم ترَ ما يراهُ المُتكامِلُ.
   *
   * ولمَ لا يُتركُ للمُتكامِلِ أن يبعثَ `{}`؟ لأنَّ العقدَ لا يطلبُ جسماً، وشرطٌ غيرُ
   * مكتوبٍ في الورقةِ يُكتَشَفُ في الإنتاجِ وحدهُ. ومساراتُ الكتابةِ التي **تطلبُ**
   * جسماً لا تتسامحُ بهذا: مُحلِّلاتُها ترفضُ الغائبَ بـ400
   * `DELIVERY_VALIDATION_FAILED` من عقدِنا لا من رسالةِ إطارٍ.
   */
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, payload, done) => {
      const raw = typeof payload === "string" ? payload.trim() : "";
      if (raw === "") {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(raw) as unknown);
      } catch {
        // وJSON معطوبٌ خطأُ مُنادٍ أيضاً — ورسالةُ المُحلِّلِ لا تُسَرَّبُ: قد تحملُ
        // مقطعاً من الجسمِ، والجسمُ قد يحملُ مرجعَ دفعٍ (§2.6).
        done(
          new DeliveryError("DELIVERY_VALIDATION_FAILED", "جسمُ الطلبِ ليسَ JSON صالحاً", {
            traceId: String(request.id),
            details: { field: "body" },
          }),
        );
      }
    },
  );

  app.post("/store-orders", async (request, reply) => {
    const traceId = String(request.id);
    if (deps.catalogPort === undefined) {
      throw new DeliveryError(
        "DELIVERY_MARKETPLACE_UNAVAILABLE",
        "لا منفذَ كتالوجٍ مُركَّبٌ — لقطةُ السعرِ لا تُخترعُ (ADR-026 §2.3 · §4.9-2)",
        { traceId },
      );
    }
    if (deps.reservationPort === undefined || deps.reservationStore === undefined) {
      throw new DeliveryError(
        "DELIVERY_MARKETPLACE_UNAVAILABLE",
        "لا منفذَ حجزِ مخزونٍ مُركَّبٌ — الحجزُ لا يُتخطّى (ADR-026 §2.3 · المراجعةُ 10/N)",
        { traceId },
      );
    }
    const input = parsePlaceStoreOrderBody(request.body);
    // The fingerprint hashes the PARSED input, not the raw body: two byte-wise
    // different bodies that mean the same request (key order, whitespace) are
    // the same request, and an honest retry must not be refused as a reuse.
    const idempotency: IdempotencyIntent = {
      key: assertIdempotencyKey(request.headers["idempotency-key"]),
      route: "POST /store-orders",
      fingerprint: deriveRequestFingerprint("POST /store-orders", null, input),
      responseStatus: 201,
      buildResponseBody: (written) => toStoreOrderResponse(written),
    };
    const result = await placeStoreOrder(
      { catalogPort: deps.catalogPort, readPort: deps.readPort, writePort: deps.writePort, reservationPort: deps.reservationPort, reservationStore: deps.reservationStore, newUuid, now },
      input,
      traceId,
      idempotency,
    );
    if (result.kind === "replayed") return sendReplay(reply, result.status, result.body);
    return reply.status(201).send(toStoreOrderResponse(result.order));
  });

  app.get("/store-orders/:orderPublicId", async (request, reply) => {
    const publicId = parseOrderPublicIdParam(request.params);
    const order = await deps.readPort.getOrderByPublicId(publicId);
    if (order === null) {
      throw new DeliveryError("DELIVERY_ORDER_NOT_FOUND", "لا طلبَ بهذا المرجعِ", {
        traceId: String(request.id),
        details: { field: "orderPublicId", actual: publicId },
      });
    }
    return reply.status(200).send(toStoreOrderResponse(order));
  });

  app.post("/store-orders/:orderPublicId/cancellation", async (request, reply) => {
    const traceId = String(request.id);
    const publicId = parseOrderPublicIdParam(request.params);
    const reasonCode = parseCancelBody(request.body);
    const route = "POST /store-orders/{orderPublicId}/cancellation" as const;
    const idempotency: IdempotencyIntent = {
      key: assertIdempotencyKey(request.headers["idempotency-key"]),
      route,
      // The order's public id is part of the fingerprint: the same key on a
      // DIFFERENT order with the same body must be a reuse, not a replay.
      fingerprint: deriveRequestFingerprint(route, publicId, { reason_code: reasonCode }),
      responseStatus: 200,
      buildResponseBody: (written) => toStoreOrderResponse(written),
    };
    const result = await cancelStoreOrder(
      { readPort: deps.readPort, writePort: deps.writePort, reservationPort: deps.reservationPort, reservationStore: deps.reservationStore, newUuid, now },
      publicId,
      reasonCode,
      traceId,
      idempotency,
    );
    if (result.kind === "replayed") return sendReplay(reply, result.status, result.body);
    return reply.status(200).send(toStoreOrderResponse(result.order));
  });

  /**
   * مرآةُ الدفعِ: `PUT` لا `POST` — الطلبُ يُعلنُ حالةَ الدفعِ كما هيَ عندَ المُزوِّدِ،
   * وإعلانُ نفسِ الحالةِ مرّتَينِ لا يُنشئُ شيئاً ثانياً. و`POST` كانَ سيوحي بأنَّ كلَّ
   * نداءٍ يُنشئُ حركةَ دفعٍ جديدةً — ولا حركةَ دفعٍ تُنشَأُ هنا أصلاً (§2.2).
   */
  app.put("/store-orders/:orderPublicId/payment-mirror", async (request, reply) => {
    const traceId = String(request.id);
    const publicId = parseOrderPublicIdParam(request.params);
    const body = parsePaymentMirrorBody(request.body);
    const route = "PUT /store-orders/{orderPublicId}/payment-mirror" as const;
    const idempotency: IdempotencyIntent = {
      key: assertIdempotencyKey(request.headers["idempotency-key"]),
      route,
      // البصمةُ تشملُ `payment_ref` أيضاً: نفسُ المفتاحِ بمرجعٍ آخرَ إعادةُ استعمالٍ
      // (409) لا إعادةُ محاولةٍ — ومُزوِّدانِ مختلفانِ لطلبٍ واحدٍ خطأُ تركيبٍ.
      //
      // والحقلُ الغائبُ **يُحذَفُ** من المُبصَّمِ ولا يُمرَّرُ `undefined`: البصمةُ
      // ترفضُ `undefined` صراحةً (§4.10 · `canonicalJson`)، ولأنَّ «غائبٌ» و`null`
      // معنيانِ مختلفانِ هنا فحذفُهُ هو ما يجعلُ البصمتَينِ مختلفتَينِ فعلاً.
      fingerprint: deriveRequestFingerprint(route, publicId, {
        payment_state: body.paymentState,
        reason_code: body.reasonCode,
        ...("paymentRef" in body ? { payment_ref: body.paymentRef } : {}),
      }),
      responseStatus: 200,
      buildResponseBody: (written) => toStoreOrderResponse(written),
    };
    const result = await mirrorPayment(
      { readPort: deps.readPort, writePort: deps.writePort, newUuid, now },
      publicId,
      {
        paymentState: body.paymentState,
        reasonCode: body.reasonCode,
        ...("paymentRef" in body ? { paymentRef: body.paymentRef } : {}),
      },
      traceId,
      idempotency,
    );
    if (result.kind === "replayed") return sendReplay(reply, result.status, result.body);
    // `applied` و`unchanged` يُجابانِ سواءً: الحدُّ الشبكيُّ لا يملكُ ما يقولُهُ
    // للمُزوِّدِ عن الفرقِ، والطلبُ في الحالتَينِ حيثُ أعلنَ المُزوِّدُ أنَّهُ يكونُ.
    return reply.status(200).send(toStoreOrderResponse(result.order));
  });

  /**
   * التأكيدُ: البوّابةُ المركَّبةُ (`placed` + مرآةُ دفعٍ `authorized`) — و409 هوَ
   * جوابُ «الطريقُ غيرُ مسموحٍ» و«الدفعُ غيرُ مُخوَّلٍ» معاً، بشفرتَي خطأٍ متمايزتَينِ
   * كي يعرفَ العميلُ أيَّ الشرطَينِ اختلَّ.
   */
  app.post("/store-orders/:orderPublicId/confirmation", async (request, reply) => {
    const traceId = String(request.id);
    const publicId = parseOrderPublicIdParam(request.params);
    const route = "POST /store-orders/{orderPublicId}/confirmation" as const;
    const idempotency: IdempotencyIntent = {
      key: assertIdempotencyKey(request.headers["idempotency-key"]),
      route,
      // لا جسمَ للتأكيدِ، فالبصمةُ هيَ المسارُ والطلبُ وحدَهما — وكائنٌ فارغٌ صريحٌ
      // أصدقُ من إسقاطِ الوسيطِ: البصمةُ تبقى محسوبةً على نفسِ الشكلِ.
      fingerprint: deriveRequestFingerprint(route, publicId, {}),
      responseStatus: 200,
      buildResponseBody: (written) => toStoreOrderResponse(written),
    };
    const result = await confirmStoreOrder(
      { readPort: deps.readPort, writePort: deps.writePort, newUuid, now },
      publicId,
      traceId,
      idempotency,
    );
    if (result.kind === "replayed") return sendReplay(reply, result.status, result.body);
    return reply.status(200).send(toStoreOrderResponse(result.order));
  });

  // ── Fulfillment transition (review 11/N, ADR-026 §4.13) ────────────
  // One route for the remaining fulfillment edges:
  // confirmed → picking → picked → ready_for_delivery → handed_to_courier → delivered
  // `delivered` requires proof of delivery (§2.4) and triggers inventory
  // `reserved → consumed` in the same transaction (no marketplace call).
  app.post("/store-orders/:orderPublicId/fulfillment-transition", async (request, reply) => {
    const traceId = String(request.id);
    const publicId = parseOrderPublicIdParam(request.params);
    const parsed = parseFulfillmentTransitionBody(request.body);
    const route = "POST /store-orders/{orderPublicId}/fulfillment-transition" as const;

    // Build proof if both fields are present
    let proof: { proofType: "otp" | "photo" | "signature" | "pin_code"; proofRef: string } | null = null;
    if (parsed.proofType !== undefined && parsed.proofRef !== undefined) {
      const validProofTypes = ["otp", "photo", "signature", "pin_code"];
      if (!validProofTypes.includes(parsed.proofType)) {
        throw new DeliveryError(
          "DELIVERY_VALIDATION_FAILED",
          "نوعُ الإثباتِ ليس من الكتالوجِ المغلقِ",
          { details: { field: "proof_type", actual: parsed.proofType } },
        );
      }
      proof = {
        proofType: parsed.proofType as "otp" | "photo" | "signature" | "pin_code",
        proofRef: parsed.proofRef,
      };
    }

    const idempotency: IdempotencyIntent = {
      key: assertIdempotencyKey(request.headers["idempotency-key"]),
      route,
      fingerprint: deriveRequestFingerprint(route, publicId, parsed),
      responseStatus: 200,
      buildResponseBody: (written) => toStoreOrderResponse(written),
    };

    const result = await fulfillmentTransition(
      {
        readPort: deps.readPort,
        writePort: deps.writePort,
        reservationStore: deps.reservationStore,
        newUuid,
        now,
      },
      publicId,
      parsed.toState,
      proof,
      traceId,
      idempotency,
    );
    if (result.kind === "replayed") return sendReplay(reply, result.status, result.body);
    return reply.status(200).send(toStoreOrderResponse(result.order));
  });

  app.get("/store-orders/:orderPublicId/delivery-task", async (request, reply) => {
    const publicId = parseOrderPublicIdParam(request.params);
    const task = await deps.readPort.getTaskByOrderPublicId(publicId);
    if (task === null) {
      // One code for "no order" and "no task" would hide which is missing;
      // the catalog publishes both, so the route distinguishes them.
      const order = await deps.readPort.getOrderByPublicId(publicId);
      throw new DeliveryError(
        order === null ? "DELIVERY_ORDER_NOT_FOUND" : "DELIVERY_TASK_NOT_FOUND",
        order === null ? "لا طلبَ بهذا المرجعِ" : "لا مهمّةَ توصيلٍ لهذا الطلبِ",
        { traceId: String(request.id), details: { field: "orderPublicId", actual: publicId } },
      );
    }
    return reply.status(200).send(toDeliveryTaskResponse(task));
  });

  // Liveness: no dependency, no DB. Never fails while the process runs.
  app.get("/delivery/health", async () => {
    return { status: "ok" as const };
  });

  // Readiness: a real probe. 503 carries the readiness body, not an error body
  // (contracts/api.openapi.yml · errors.md rule 6).
  app.get("/delivery/ready", async (_request, reply) => {
    const checks =
      deps.readinessPort === undefined
        ? // No probe wired → nothing was measured → nothing is claimed. A
          // "ready" answer here would be the RISK-0030 lie in a new place.
          ([{ name: "database", ok: false, detail: "probe_not_wired" }] as const)
        : await deps.readinessPort.probe();
    /*
     * الرصدُ لا يُسقِطُ المسارَ: منفذُ الرصدِ يتعهّدُ ألّا يرمي، ولو خُرِقَ
     * التعهُّدُ لَأجابَ مُعالجُ الأخطاءِ `ErrorResponse` على مسارٍ عقدُهُ
     * `ReadinessResponse` في 200 و503 معاً (errors.md قاعدةُ 6). فالحرسُ هنا
     * ليسَ تزيّداً بل حفظُ عقدِ المسارِ من عيبٍ في محوّلٍ.
     */
    let observation: DependencyObservation | undefined;
    if (deps.marketplaceObservationPort !== undefined) {
      try {
        observation = await deps.marketplaceObservationPort.observe();
      } catch {
        observation = undefined;
      }
    }
    const body = buildReadinessResponse(
      checks,
      deps.catalogPort !== undefined,
      observation,
    );
    return reply.status(body.status === "ready" ? 200 : 503).send(body);
  });

  /*
   * صيانةُ حياةِ مفاتيحِ التماثُلِ (المراجعةُ 13/N · ADR-026 §4.15).
   *
   * ولمَ مسارٌ لا `setInterval` في الخدمةِ؟ لأنَّ المنظومةَ قرَّرَت ذلكَ قبلَ هذهِ
   * المراجعةِ ولها فيهِ حُجّةٌ: خدماتُ السمعةِ والاشتراكاتِ تحرسُ بـ`purity.test.ts`
   * أن لا مُجدوِلَ داخلَ خدمةٍ، وتعرضُ العملَ الدوريَّ مساراً يُنادى
   * (`POST /reputation/tick`). ومُجدوِلٌ في العمليّةِ يعني: عملاً يتضاعفُ بعددِ
   * النُّسَخِ، ولا سبيلَ لإيقافِهِ في حادثةٍ إلّا بإعادةِ نشرٍ، ولا قياسَ لهُ إلّا
   * في السجلِّ. والمسارُ يُنادى من جدولٍ خارجيٍّ فيبقى القرارُ «متى» عندَ التشغيلِ.
   *
   * والردُّ يحملُ الأرقامَ المقيسةَ لا «تمَّ»: عددُ الدفعاتِ والمحذوفُ والباقي
   * وسببُ التوقُّفِ — فمراقبٌ يقرأُ `remaining` المتزايدَ يعرفُ أنَّ الجَولةَ أصغرُ
   * من التراكُمِ قبلَ أن يمتلئَ قرصٌ.
   */
  app.post("/delivery/idempotency-keys/sweep", async (request, reply) => {
    const traceId = String(request.id);
    if (deps.idempotencySweepPort === undefined) {
      throw new DeliveryError(
        "DELIVERY_INTERNAL_ERROR",
        "لا مُكنسةَ مفاتيحَ مُركَّبةٌ — لا يُدَّعى مسحٌ لم يقعْ (ADR-026 §4.15)",
        { traceId },
      );
    }
    const options = parseSweepOptions(request.body, traceId);
    const result = await sweepExpiredIdempotencyKeys({
      sweepPort: deps.idempotencySweepPort,
      ...options,
    });
    return reply.status(200).send({
      batches: result.batches,
      deleted: result.deleted,
      remaining: result.remaining,
      stopped_because: result.stoppedBecause,
    });
  });

  return {
    fastify: app,
    close: async () => {
      await app.close();
    },
  };
}
