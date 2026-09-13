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
 * ومعَها مساراتُ **تشغيلٍ** لا ينشرُها العقدُ لأنَّها ليستْ وعداً لعميلٍ،
 * وموضعُ توصيفِها `docs/04-api/DELIVERY_HTTP.md`:
 *
 *   POST /delivery/idempotency-keys/sweep              → 200 (المراجعةُ 13/N · §4.15)
 *   GET  /delivery/inventory-conflicts                 → 200 (المراجعةُ 16/N · §4.18)
 *   POST /delivery/inventory-conflicts/{adjustmentId}/acknowledgement
 *                                                      → 200 (المراجعةُ 18/N · §4.20)
 *
 * ## هويّةُ الخدمةِ مفروضةٌ على الاثنَي عشرَ جميعاً (`M1-04` · المراجعةُ 17/N)
 *
 * عشرةٌ مُغلَقةٌ بصلاحيّةٍ، ومسارَا الرصدِ (`/delivery/health` ·
 * `/delivery/ready`) مفتوحانِ **بتصنيفٍ صريحٍ** لا بإغفالٍ. والحُجّةُ لكلِّ قرارٍ
 * عندَ التصنيفِ أدناهُ وفي [`service-identity.ts`](./service-identity.ts).
 * ومسارٌ يُسجَّلُ بلا تصنيفٍ **يُسقِطُ الإقلاعَ**.
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
  InventoryConflictAcknowledgementPort,
  RelayDeadLetterReadPort,
  InventoryConflictReadPort,
  InventoryReservationPort,
  InventoryReservationStore,
  ReadinessProbePort,
  StoreOrderCatalogPort,
  IdempotencyKeySweepPort,
  StoreOrderReadPort,
  StoreOrderWritePort,
} from "../ports.js";
import { assertIdempotencyKey, deriveRequestFingerprint } from "../domain/idempotency.js";
import {
  composeConflictAcknowledger,
  type InventoryConflictRow,
} from "../domain/inventory-conflict.js";
import { sendDeliveryError } from "./errors.js";
import {
  DELIVERY_SCOPES,
  registerServiceIdentity,
  type DeliveryRouteConfig,
  type DeliveryServiceIdentityOptions,
} from "./service-identity.js";
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
import {
  RELAY_DEAD_LETTER_THRESHOLDS,
  classifyRelayDeadLetterSeverity,
} from "../domain/relay-dead-letters.js";
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
  /**
   * قراءةُ راياتِ تضاربِ المخزونِ (المراجعةُ 16/N · ADR-026 §4.18).
   *
   * غائبٌ ⇒ `GET /delivery/inventory-conflicts` يُجيبُ 500
   * `DELIVERY_INTERNAL_ERROR` لا 200 بقائمةٍ فارغةٍ: قائمةٌ فارغةٌ تُقرأُ
   * «لا تضاربَ» والحقيقةُ «لا أدري» — وهي أخطرُ من خطأٍ مُعلَنٍ
   * (نفسُ حُجّةِ `idempotencySweepPort`: الصفرُ الكاذبُ يُقرأُ نظافةً).
   */
  readonly inventoryConflictReadPort?: InventoryConflictReadPort;
  /**
   * كتابةُ إقرارِ رايةٍ (المراجعةُ 18/N · ADR-026 §4.20).
   *
   * غائبٌ ⇒ `POST …/acknowledgement` يُجيبُ 500 `DELIVERY_INTERNAL_ERROR` —
   * **ولا 200 «أُقِرَّت»**، وهذا أشدُّ من نظيرِهِ في مسارِ القراءةِ: قائمةٌ فارغةٌ
   * كاذبةٌ تُقرأُ نظافةً، أمّا إقرارٌ كاذبٌ فيُغلِقُ حادثةً **حقيقيّةً** في ذهنِ
   * مُشغِّلٍ ولا يُبقي لها أثراً في القاعدةِ يُراجَعُ.
   */
  readonly inventoryConflictAcknowledgementPort?: InventoryConflictAcknowledgementPort;
  /**
   * قياسُ الرسائلِ المسمومةِ في دفترَي الاستهلاكِ (المراجعةُ 21/N · ADR-026 §4.23).
   *
   * غائبٌ ⇒ `GET /delivery/relay/dead-letters` يُجيبُ 500 `DELIVERY_INTERNAL_ERROR`
   * **ولا 200 بمقياسٍ صفريٍّ**: صفرٌ غيرُ مقيسٍ يُقرأُ «لا فقدَ» فيُغلِقُ لوحةَ
   * مُشغِّلٍ على خبرٍ لم يُسأَلْ عنهُ أحدٌ — وهذا أخطرُ من صفرٍ في قائمةٍ
   * (§4.18)، لأنَّ هذا المسارَ نفسُهُ هوَ العينُ التي تُراقِبُ الفقدَ.
   */
  readonly relayDeadLetterReadPort?: RelayDeadLetterReadPort;
  /**
   * فرضُ هويّةِ الخدمةِ على هذا الحدِّ (`M1-04`، الموجةُ السادسةُ · المراجعةُ
   * 17/N). **إلزاميٌّ بلا قيمةٍ افتراضيّةٍ بقصدٍ**: قيمةٌ افتراضيّةٌ «بلا فرضٍ»
   * تجعلُ نسيانَ التركيبِ في جذرٍ واحدٍ يمرُّ صامتاً في كلِّ اختبارٍ ويُكشَفُ في
   * الإنتاجِ وحدَهُ. والتفصيلُ في `http/service-identity.ts`.
   */
  readonly serviceIdentity: DeliveryServiceIdentityOptions;
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

/**
 * مُعامِلاتُ استعلامِ راياتِ التضاربِ — تُرفَضُ ولا تُصحَّحُ صامتةً.
 *
 * وأرقامُ `limit` **عشريةٌ فقط**: `Number("0x10")` يُعطي 16 و`Number.isInteger` يرضى
 * بهِ، ومُشغِّلٌ كتبَ `0x10` لم يطلبْ 16 — بل أخطأَ، والتصحيحُ الصامتُ يخفي
 * خطأَهُ. (نفسُ قاعدةِ حاسماتِ البيئةِ في هذا المستودعِ.)
 *
 * وتحقُّقُ `event_type_limit` في مسارِ المسمومِ يتبعُ نفسَ القاعدةِ حرفاً.
 */

/**
 * سقفُ تفصيلِ أنواعِ الأحداثِ لكلِّ دفترٍ (المراجعةُ 21/N).
 *
 * والافتراضُ عشرةٌ لا خمسونَ: هذا مسارُ **رصدٍ** يُنادى دوريًّا، وتفصيلٌ
 * طويلٌ في كلِّ دقيقةٍ حملٌ لا يقرأُهُ أحدٌ. والمجموعُ لا يُسقَفُ أبداً — السقفُ
 * على التفصيلِ وحدَهُ، فمجموعٌ مسقوفٌ كانَ سيُقرأُ عدداً أقلَّ ممّا وقعَ.
 */
const RELAY_DEAD_LETTER_EVENT_TYPE_DEFAULT_LIMIT = 10;
const RELAY_DEAD_LETTER_EVENT_TYPE_MAX_LIMIT = 100;

function parseRelayDeadLettersQuery(
  query: unknown,
  traceId: string,
): { eventTypeLimit: number } {
  const raw = (query ?? {}) as Record<string, unknown>;
  const rawLimit = raw["event_type_limit"];
  if (rawLimit === undefined || rawLimit === null || rawLimit === "") {
    return { eventTypeLimit: RELAY_DEAD_LETTER_EVENT_TYPE_DEFAULT_LIMIT };
  }

  const text = String(rawLimit);
  const decimalOnly = /^[0-9]+$/u.test(text);
  const parsed = Number(text);
  if (
    !decimalOnly ||
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > RELAY_DEAD_LETTER_EVENT_TYPE_MAX_LIMIT
  ) {
    throw new DeliveryError(
      "DELIVERY_VALIDATION_FAILED",
      `\`event_type_limit\` عددٌ عشريٌّ صحيحٌ بينَ 1 و${RELAY_DEAD_LETTER_EVENT_TYPE_MAX_LIMIT}`,
      { traceId, details: { field: "event_type_limit", actual: text } },
    );
  }

  return { eventTypeLimit: parsed };
}

const INVENTORY_CONFLICTS_DEFAULT_LIMIT = 50;
const INVENTORY_CONFLICTS_MAX_LIMIT = 500;

function parseInventoryConflictsQuery(
  query: unknown,
  traceId: string,
): { unacknowledgedOnly: boolean; limit: number } {
  const raw = (query ?? {}) as Record<string, unknown>;

  const rawUnack = raw["unacknowledged_only"];
  let unacknowledgedOnly = true; // الافتراضُ ما يحتاجُهُ مُشغِّلٌ في حادثةٍ.
  if (rawUnack !== undefined && rawUnack !== null && rawUnack !== "") {
    if (rawUnack !== "true" && rawUnack !== "false") {
      throw new DeliveryError(
        "DELIVERY_VALIDATION_FAILED",
        "`unacknowledged_only` تقبلُ `true` أو `false` حرفاً",
        { traceId, details: { field: "unacknowledged_only", actual: String(rawUnack) } },
      );
    }
    unacknowledgedOnly = rawUnack === "true";
  }

  const rawLimit = raw["limit"];
  let limit = INVENTORY_CONFLICTS_DEFAULT_LIMIT;
  if (rawLimit !== undefined && rawLimit !== null && rawLimit !== "") {
    const text = String(rawLimit);
    const decimalOnly = /^[0-9]+$/u.test(text);
    const parsed = Number(text);
    if (!decimalOnly || !Number.isInteger(parsed) || parsed < 1 || parsed > INVENTORY_CONFLICTS_MAX_LIMIT) {
      throw new DeliveryError(
        "DELIVERY_VALIDATION_FAILED",
        `\`limit\` عددٌ عشريٌّ صحيحٌ بينَ 1 و${INVENTORY_CONFLICTS_MAX_LIMIT}`,
        { traceId, details: { field: "limit", actual: text } },
      );
    }
    limit = parsed;
  }

  return { unacknowledgedOnly, limit };
}

/**
 * صورةُ الرايةِ على السلكِ — **دالّةٌ واحدةٌ لمسارَينِ** (المراجعةُ 18/N).
 *
 * القراءةُ والإقرارُ يُظهِرانِ نفسَ الكائنِ، ونسخُ حروفِ الحقولِ في مُعالِجَينِ
 * يعني أنَّ أوّلَ حقلٍ يُضافُ لاحقاً يظهرُ في مسارٍ ويغيبُ عن الآخرِ — فيرى
 * المُشغِّلُ صفّاً في القائمةِ لا يُطابِقُ الصفَّ الذي أقرَّهُ للحظتِهِ.
 * ولا `trace_id` هنا في الجسمِ العامِّ: هوَ في الصفِّ للتحقيقِ، ومغلَّفُ الجوابِ
 * يحملُ `trace_id` الطلبِ الحاليِّ لا تتبُّعَ الحدثِ الأصليِّ — والاثنانِ في حقلٍ
 * واحدٍ خلطٌ يُضيِّعُ التحقيقَ.
 */
function toInventoryConflictWire(row: InventoryConflictRow): Record<string, unknown> {
  return {
    adjustment_id: row.adjustmentId,
    marketplace_event_id: row.marketplaceEventId,
    store_id: row.storeId,
    product_id: row.productId,
    conflict_kind: row.kind,
    reason_code: row.reasonCode,
    quantity_delta: row.quantityDelta,
    observed_quantity_after: row.observedQuantityAfter,
    adjustment_sequence: row.adjustmentSequence,
    affected_order_count: row.affectedOrderCount,
    affected_units_total: row.affectedUnitsTotal,
    affected_order_public_ids: row.affectedOrderPublicIds,
    changes_order_state: row.changesOrderState,
    occurred_for: row.occurredFor,
    detected_at: row.detectedAt,
    acknowledged_at: row.acknowledgedAt,
    acknowledged_by: row.acknowledgedBy,
  };
}

/**
 * `adjustmentId` من المسارِ — **UUID أو 400، لا 404**.
 *
 * ولمَ لا 404؟ لأنَّ `not-a-uuid` ليسَ «رايةً غيرَ موجودةٍ» بل نداءٌ معطوبٌ:
 * مُشغِّلٌ لصقَ سطراً كاملاً من سجلٍّ يجبُ أن يُقالَ لهُ «شكلُ المُعرِّفِ خطأٌ» لا
 * «لا رايةَ» — والثاني يُرسِلُهُ يبحثُ في القاعدةِ عن صفٍّ موجودٍ. ولولا هذا
 * الحاجزُ لبلغَ النصُّ `::uuid` في العبارةِ فارتدَّ خطأَ قاعدةٍ خاماً (22P02)
 * مُترجَماً 500 — أي عيبٌ عندَنا على خطأِ منادٍ.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function parseAdjustmentIdParam(params: unknown, traceId: string): string {
  const raw = (params ?? {}) as Record<string, unknown>;
  const value = raw["adjustmentId"];
  if (typeof value !== "string" || !UUID_PATTERN.test(value.toLowerCase())) {
    throw new DeliveryError("DELIVERY_VALIDATION_FAILED", "`adjustmentId` مُعرِّفُ UUID", {
      traceId,
      details: { field: "adjustmentId" },
    });
  }
  return value.toLowerCase();
}

/**
 * جسمُ الإقرارِ: **لا جسمَ**. وأيُّ جسمٍ يُرَدُّ 400 ولا يُتَجاهَلُ صامتاً.
 *
 * وهذا أهمُّ قرارٍ في هذا المسارِ. المنادي الذي يبعثُ
 * `{"acknowledged_by":"فريقُ العملياتِ"}` **يظنُّ أنَّهُ سمّى المُقِرَّ**؛ وتجاهُلُ
 * الحقلِ صامتاً يعني أنَّ الصفَّ سيحملُ اسماً آخرَ غيرَ الذي أرسلَهُ وهوَ لا
 * يدري — أي دفترُ مسؤوليّةٍ يُخالِفُ ما يعتقدُهُ مَن كتبَ فيهِ. فالرفضُ الصريحُ
 * هوَ الذي يُعلِّمُهُ أنَّ المُقِرَّ من الرمزِ لا من الجسمِ.
 *
 * ومُحلِّلُ هذا التطبيقِ يجعلُ الجسمَ الفارغَ `undefined` (انظرْ
 * `addContentTypeParser` أدناهُ)، فالنداءُ الشريفُ `curl -X POST` يمرُّ بلا
 * تحايُلٍ.
 */
function assertNoAcknowledgementBody(body: unknown, traceId: string): void {
  if (body === undefined || body === null) return;
  if (typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0) return;
  throw new DeliveryError(
    "DELIVERY_VALIDATION_FAILED",
    "لا جسمَ لهذا المسارِ — المُقِرُّ يُؤخَذُ من الهويّةِ المُثبَتةِ لا من الجسمِ (ADR-026 §4.20)",
    { traceId, details: { field: "body" } },
  );
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
   * ── تصنيفُ المساراتِ لهويّةِ الخدمةِ (`M1-04` الموجةُ السادسةُ) ──────────
   *
   * مسارَا الرصدِ وحدَهما مفتوحانِ، **وكلاهما بقرارٍ مكتوبٍ لا بإغفالٍ**:
   *
   *   - `GET /delivery/health` — لا يقرأُ ولا يكتبُ بياناتٍ مجاليّةً، و«الإنفاذُ
   *     لا يُعمي المراقبةَ»: حياةٌ مربوطةٌ برمزٍ تعني أنَّ انتهاءَ سرٍّ يُقرأُ
   *     موتَ عمليّةٍ فتُعادُ تشغيلاً وهيَ سليمةٌ.
   *   - `GET /delivery/ready` — **وهذا قرارٌ يُعلَنُ لأنَّهُ ليسَ نسخاً عن
   *     الموجاتِ السابقةِ**: حدُّ التوزيعِ لم يكنْ لهُ مسارُ جاهزيّةٍ أصلاً،
   *     فلا سابقةَ تُنسَخُ. ومُنادي الجاهزيّةِ ليسَ خدمةً بل **مُنسِّقُ النشرِ**
   *     (kubelet وموازِنُ حِملٍ)، وهوَ لا يملكُ رمزَ خدمةٍ ولا يجوزُ أن يملكَهُ:
   *     إعطاءُ المُنسِّقِ سرَّ توقيعٍ ليقرأَ جاهزيّةً مُقايضةٌ أسوأُ من الانفتاحِ.
   *     وإغلاقُهُ **يوقِفُ النشرَ** لا المهاجمَ: نسخةٌ جاهزيّتُها 401 لا تدخلُ
   *     الدورةَ أبداً. وما يُسرَّبُ محصورٌ مقيساً: أسماءُ تبعيّاتٍ وحالاتُها
   *     و`not_claimed` — **لا مُعرِّفَ طلبٍ ولا متجرٍ ولا مبلغَ** (`http/readiness.ts`).
   *
   * وكلُّ ما بعدَهُما مُغلَقٌ بصلاحيّةٍ. **ومسارٌ يُسجَّلُ بلا تصنيفٍ يُسقِطُ
   * الإقلاعَ** — وقد جُرِّبَ هذا فعلاً: المسارُ الثاني عشرَ (إقرارُ الرايةِ ·
   * المراجعةُ 18/N) لم يمرَّ بلا صلاحيّةٍ مُصنَّفةٍ، فالحاجزُ ليسَ وعداً.
   */
  const OPEN: DeliveryRouteConfig = { serviceIdentity: "open" };
  const scoped = (...scopes: readonly string[]): DeliveryRouteConfig => ({
    serviceIdentity: { scopes },
  });

  // قبلَ أوّلِ مسارٍ: حاجزُ التصنيفِ يرى ما يُسجَّلُ بعدَهُ لا ما قبلَهُ.
  registerServiceIdentity(app, deps.serviceIdentity);

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

  app.post("/store-orders", { config: scoped(DELIVERY_SCOPES.storeOrderWrite) }, async (request, reply) => {
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

  app.get("/store-orders/:orderPublicId", { config: scoped(DELIVERY_SCOPES.storeOrderRead) }, async (request, reply) => {
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

  app.post("/store-orders/:orderPublicId/cancellation", { config: scoped(DELIVERY_SCOPES.storeOrderCancel) }, async (request, reply) => {
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
  app.put("/store-orders/:orderPublicId/payment-mirror", { config: scoped(DELIVERY_SCOPES.paymentMirrorWrite) }, async (request, reply) => {
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
  app.post("/store-orders/:orderPublicId/confirmation", { config: scoped(DELIVERY_SCOPES.storeOrderConfirm) }, async (request, reply) => {
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
  app.post("/store-orders/:orderPublicId/fulfillment-transition", { config: scoped(DELIVERY_SCOPES.fulfillmentTransition) }, async (request, reply) => {
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

  app.get("/store-orders/:orderPublicId/delivery-task", { config: scoped(DELIVERY_SCOPES.deliveryTaskRead) }, async (request, reply) => {
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
  app.get("/delivery/health", { config: OPEN }, async () => {
    return { status: "ok" as const };
  });

  // Readiness: a real probe. 503 carries the readiness body, not an error body
  // (contracts/api.openapi.yml · errors.md rule 6).
  app.get("/delivery/ready", { config: OPEN }, async (_request, reply) => {
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
  app.post("/delivery/idempotency-keys/sweep", { config: scoped(DELIVERY_SCOPES.idempotencySweep) }, async (request, reply) => {
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

  /*
   * قراءةُ راياتِ تضاربِ المخزونِ (المراجعةُ 16/N · ADR-026 §4.18 · رفعُ دَينِ §4.8).
   *
   * مسارُ **قراءةٍ تشغيليَّةٍ** لا مسارُ عميلٍ — ولذلكَ ليسَ في
   * `contracts/api.openapi.yml` بل في `docs/04-api/DELIVERY_HTTP.md` وحدهِ، على سابقةِ
   * `POST /delivery/idempotency-keys/sweep` (المراجعةُ 13/N): العقدُ المنشورُ وعدٌ
   * لعميلٍ خارجيٍّ، ومسارُ صيانةٍ يُناديهِ مُشغِّلٌ ليسَ وعداً لأحدٍ.
   *
   * **ولا هويّةَ خدمةٍ عليهِ** — وهذا نقصٌ مُعلَنٌ لا اختيارٌ مُريحٌ: هذهِ الخدمةُ
   * تُوقِّعُ طلباتِها الصادرةَ (`createServiceRequestSigner` في `server.ts`) ولا
   * تتحقّقُ من واردٍ أبداً — فلا موضعَ أُعلِّقُ عليهِ تحقّقاً، وإضافةُ طبقةِ
   * تحقّقٍ واردٍ للمرّةِ الأولى في مراجعةٍ موضوعُها كشفُ تضاربٍ توسيعُ نطاقٍ
   * يمسُّ المساراتِ التسعةَ كلَّها. والدَّينُ مكتوبٌ في §4.18 لا مسكوتٌ عنهُ.
   *
   * والردُّ يحملُ `changes_order_state: false` على كلِّ صفٍّ: من يقرأُ رايةً في
   * حادثةٍ لا يقرأُ ADR — سابقةُ `gates_readiness: false` (§4.17-2).
   */
  app.get("/delivery/inventory-conflicts", { config: scoped(DELIVERY_SCOPES.inventoryConflictsRead) }, async (request, reply) => {
    const traceId = String(request.id);
    if (deps.inventoryConflictReadPort === undefined) {
      throw new DeliveryError(
        "DELIVERY_INTERNAL_ERROR",
        "لا منفذَ قراءةِ راياتٍ مُركَّبٌ — لا يُدَّعى خلوٌّ لم يُقسَ (ADR-026 §4.18)",
        { traceId },
      );
    }
    const { unacknowledgedOnly, limit } = parseInventoryConflictsQuery(request.query, traceId);
    const rows = await deps.inventoryConflictReadPort.listInventoryConflicts({
      unacknowledgedOnly,
      limit,
    });
    return reply.status(200).send({
      // المُعامِلاتُ المطبّقةُ تُردَّدُ: قارئٌ يرى عشرةً ولا يدري أَسقفٌ أم كلٌّ
      // يقرأُ خطأً. ولا «total»: عدٌّ كاملٌ طلبٌ ثانٍ لا يطلبُهُ أحدٌ بعدُ.
      applied_filter: { unacknowledged_only: unacknowledgedOnly, limit },
      count: rows.length,
      conflicts: rows.map(toInventoryConflictWire),
    });
  });

  /*
   * ── إقرارُ رايةٍ (المراجعةُ 18/N · ADR-026 §4.20) ─────────────────────────
   *
   * `POST /delivery/inventory-conflicts/{adjustmentId}/acknowledgement`
   *
   * ## المسارُ الثانيَ عشرَ، ومسارُ تشغيلٍ ثالثٌ خارجَ العقدِ المنشورِ
   *
   * على سابقةِ مسارِ المُكنسةِ ومسارِ القراءةِ حرفاً (§4.16 · §4.18-9): ليسَ في
   * `api.openapi.yml` لأنَّهُ سطحُ مُشغِّلٍ لا سطحُ مستهلكٍ، وموضعُ توصيفِهِ
   * `docs/04-api/DELIVERY_HTTP.md`.
   *
   * ## ولا `Idempotency-Key` — والسببُ ليسَ تخفيفاً
   *
   * مساراتُ الكتابةِ الأربعةُ تطلبُهُ (§4.10) لأنَّ إعادةَ نداءٍ فيها **تُنشئُ
   * أثراً ثانياً**: طلبٌ ثانٍ، إلغاءٌ ثانٍ، انتقالٌ ثانٍ. وهذا المسارُ **مُتماثِلٌ
   * في طبيعتِهِ** لا بآلةٍ: العمليّةُ «اضبطْ `acknowledged_at` إن كانَ فارغاً»
   * والإعادةُ لا تُنتِجُ شيئاً ثانياً بل تُعيدُ نفسَ الصفِّ. ومفتاحٌ مطلوبٌ هنا
   * كانَ سيُضيفُ مخزنَ مفاتيحَ وصفوفاً تُمسَحُ لاحقاً بلا حمايةٍ جديدةٍ — وأسوأُ
   * من ذلكَ: كانَ سيُوهِمُ القارئَ أنَّ الحمايةَ **من المفتاحِ** لا من `WHERE
   * acknowledged_at IS NULL`، فأوّلُ من يُبسِّطُ المفتاحَ يفقدُ الحمايةَ كلَّها.
   *
   * ## والجوابُ 200 في الحالتَينِ، **مع تمييزٍ صريحٍ في الجسمِ**
   *
   * `outcome: "acknowledged" | "already_acknowledged"`. ولمَ لا 409 على الثانيةِ؟
   * لأنَّ الحالةَ المطلوبةَ **مُتحقِّقةٌ**: الرايةُ مُقَرَّةٌ، ورفضٌ يدفعُ المُنادي
   * إلى إعادةٍ لا تُفيدُ أو إلى ظنِّ عيبٍ. ولمَ لا 200 صامتاً؟ لأنَّ المُقِرَّ
   * **قد يكونُ غيري** — والجوابُ يحملُ `acknowledged_by` الفعليَّ، فيرى المُشغِّلُ
   * الثاني اسمَ الأوّلِ ولا يظنُّ الواقعةَ لهُ. التمييزُ في الجسمِ لا في الرمزِ
   * لأنَّهُ **معلومةٌ** لا فشلٌ.
   */
  app.post(
    "/delivery/inventory-conflicts/:adjustmentId/acknowledgement",
    { config: scoped(DELIVERY_SCOPES.inventoryConflictAcknowledge) },
    async (request, reply) => {
      const traceId = String(request.id);
      if (deps.inventoryConflictAcknowledgementPort === undefined) {
        throw new DeliveryError(
          "DELIVERY_INTERNAL_ERROR",
          "لا منفذَ إقرارٍ مُركَّبٌ — لا يُدَّعى إقرارٌ لم يُكتَبْ (ADR-026 §4.20)",
          { traceId },
        );
      }

      const adjustmentId = parseAdjustmentIdParam(request.params, traceId);
      assertNoAcknowledgementBody(request.body, traceId);

      /*
       * الهويّةُ المُثبَتةُ هيَ المصدرُ الوحيدُ للمُقِرِّ.
       *
       * وغيابُها على مسارٍ **مُغلَقٍ** مستحيلٌ بالبناءِ: الوسيطُ يملأُ
       * `serviceCaller` قبلَ كلِّ مُعالِجٍ مفروضٍ أو يردُّ 401/403 ولا يبلغُ
       * المُعالِجَ. فهذا الفرعُ حرسُ عيبٍ عندَنا — تصنيفُ المسارِ غُيِّرَ إلى
       * `open` سهواً — و500 هوَ جوابُهُ الصادقُ. **ولا يُكتَبُ إقرارٌ بلا اسمٍ
       * أبداً**: القاعدةُ ترفضُهُ بـ`ck_..._ack` والشيفرةُ ترفضُهُ قبلَها،
       * فالمنعُ في موضعَينِ لأنَّ «إقرارٌ بلا مُقِرٍّ» هوَ عينُ ما مَنعَ هذا
       * المسارَ سنةً كاملةً (§4.18).
       */
      const caller = request.serviceCaller;
      if (caller === undefined) {
        throw new DeliveryError(
          "DELIVERY_INTERNAL_ERROR",
          "لا هويّةَ مُثبَتةً على مسارٍ مُغلَقٍ — لا يُكتَبُ إقرارٌ بلا مُقِرٍّ",
          { traceId },
        );
      }

      const composed = composeConflictAcknowledger({
        serviceName: caller.serviceName,
        onBehalfOfPublicId: caller.onBehalfOfPublicId,
      });
      if (composed.acknowledger === "rejected") {
        // اسمٌ لا يُكتَبُ في العمودِ عيبُ تركيبٍ (اسمُ خدمةٍ فارغٌ أو أطولُ من
        // 128 حرفاً)، لا خطأُ منادٍ: هوَ لا يملكُ تغييرَ اسمِ رمزِهِ من الجسمِ.
        throw new DeliveryError(
          "DELIVERY_INTERNAL_ERROR",
          `تعذَّرَ تركيبُ اسمِ المُقِرِّ من الهويّةِ المُثبَتةِ (${composed.because})`,
          { traceId },
        );
      }

      const outcome = await deps.inventoryConflictAcknowledgementPort.acknowledgeInventoryConflict({
        adjustmentId,
        acknowledgedBy: composed.value,
        acknowledgedAt: now(),
      });

      if (outcome.acknowledgement === "unknown_conflict") {
        throw new DeliveryError(
          "DELIVERY_INVENTORY_CONFLICT_NOT_FOUND",
          "لا رايةَ تضاربٍ بهذا المُعرِّفِ",
          { traceId },
        );
      }

      return reply.status(200).send({
        outcome:
          outcome.acknowledgement === "recorded" ? "acknowledged" : "already_acknowledged",
        conflict: toInventoryConflictWire(outcome.row),
      });
    },
  );

  /*
   * ── مقياسُ الرسائلِ المسمومةِ (المراجعةُ 21/N · ADR-026 §4.23) ──────────
   *
   * `GET /delivery/relay/dead-letters`
   *
   * ## المسارُ الثالثَ عشرَ، ومسارُ تشغيلٍ رابعٌ خارجَ العقدِ المنشورِ
   *
   * على سابقةِ §4.15 · §4.18 · §4.20 حرفاً: ليسَ في `contracts/api.openapi.yml` بل في
   * `docs/04-api/DELIVERY_HTTP.md` وحدهِ — العقدُ المنشورُ وعدٌ لعميلٍ خارجيٍّ،
   * وعينُ مُشغِّلٍ على فقدٍ داخليٍّ ليسَت وعداً لأحدٍ.
   *
   * ## والحكمُ يُحسَبُ **هنا** ويُنشَرُ معَ العتبةِ التي أنتجَتْهُ
   *
   * الجوابُ يحمِلُ `alert.severity` و`alert.because` و`alert.thresholds` معاً.
   * ونشرُ العتبةِ ليسَ حشواً: مراقِبٌ يقرأُ `warning` ولا يعرِفُ عندَ أيِّ
   * عددٍ أُطلِقَ لا يستطيعُ أن يكتبَ حادِثةً مفهومةً؛ وكتابةُ العتبةِ في المراقِبِ
   * كانتْ ستجعلُها **مصدرَ حقيقةٍ مُكرَّراً** ينحرِفُ عن الثابِتِ بلا أن يُسقِطَ
   * اختباراً. فالمراقِبُ يُنبِّهُ على `severity` ولا يُعيدُ حسابَهُ.
   *
   * ## و200 دائماً وإن كانَ الحكمُ `critical`
   *
   * والسببُ حدٌّ معنويٌّ: القياسُ **نجحَ** — ورمزُ خطأٍ على قياسٍ ناجحٍ لأنَّ
   * مقيسَهُ سيّئٌ يجعلُ مُراقِباً يرى `HTTP 5xx` فيُعيدُ المحاولةَ ثمَّ يُنبِّهُ
   * «مسارُ الرصدِ معطوبٌ» والحقيقةُ «الفقدُ واقعٌ». والخطأُ يُحفَظُ لما لم
   * يُقَسْ وحدَهُ.
   *
   * ## ولا يمسُّ الجاهزيّةَ
   *
   * `gates_readiness: false` منشورٌ في الجوابِ لا مدفونٌ في ADR — سابقةُ §4.17-2
   * و§4.18: مَن يقرأُ تنبيهاً في حادثةٍ لا يقرأُ قراراً معماريًّا.
   */
  app.get(
    "/delivery/relay/dead-letters",
    { config: scoped(DELIVERY_SCOPES.relayDeadLettersRead) },
    async (request, reply) => {
      const traceId = String(request.id);
      if (deps.relayDeadLetterReadPort === undefined) {
        throw new DeliveryError(
          "DELIVERY_INTERNAL_ERROR",
          "لا منفذَ قياسِ مسمومٍ مُركَّبٌ — لا يُدَّعى خلوٌّ لم يُقَسْ (ADR-026 §4.23)",
          { traceId },
        );
      }

      const { eventTypeLimit } = parseRelayDeadLettersQuery(request.query, traceId);
      const metric = await deps.relayDeadLetterReadPort.readRelayDeadLetters({ eventTypeLimit });
      const verdict = classifyRelayDeadLetterSeverity(metric, new Date(now()));

      return reply.status(200).send({
        applied_filter: { event_type_limit: eventTypeLimit },
        measured_at: metric.measuredAt,
        total_poisoned: metric.totalPoisoned,
        ledgers: metric.ledgers.map((ledger) => ({
          ledger: ledger.ledger,
          poisoned: ledger.poisoned,
          oldest_poisoned_at: ledger.oldestPoisonedAt,
          newest_poisoned_at: ledger.newestPoisonedAt,
          by_event_type: ledger.byEventType.map((entry) => ({
            event_type: entry.eventType,
            poisoned: entry.poisoned,
          })),
        })),
        alert: {
          severity: verdict.severity,
          because: verdict.because,
          oldest_poisoned_age_seconds: verdict.oldestPoisonedAgeSeconds,
          thresholds: {
            warning_poisoned: RELAY_DEAD_LETTER_THRESHOLDS.warningPoisoned,
            critical_poisoned: RELAY_DEAD_LETTER_THRESHOLDS.criticalPoisoned,
            critical_age_seconds: RELAY_DEAD_LETTER_THRESHOLDS.criticalAgeSeconds,
          },
          gates_readiness: false,
        },
      });
    },
  );

  return {
    fastify: app,
    close: async () => {
      await app.close();
    },
  };
}
