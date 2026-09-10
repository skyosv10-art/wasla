/**
 * @wasla/delivery-service — public surface (review 1/N).
 *
 * This review publishes the DOMAIN CORE plus the DISPATCH RELAY CONSUMER
 * (review 2/N: classification, the coarse-mirror projection, ports and the
 * engine — ADR-026 §2.4/§4.1). HTTP, Postgres adapters and the dispatch
 * delegation wire remain deferred (ADR-026 §4) — nothing here imports
 * fastify, pg or any runtime dependency by design.
 */

export type {
  DeliveryTask,
  ProofOfDelivery,
  StoreOrder,
  StoreOrderItem,
} from "./domain/model.js";
export {
  FULFILLMENT_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  DELIVERY_TASK_TRANSITIONS,
  STATE_SPACES,
  canCompleteDelivery,
  canConfirmOrder,
  isDeliveryTaskTerminal,
  isDeliveryTaskTransitionAllowed,
  isFulfillmentTerminal,
  isFulfillmentTransitionAllowed,
  isPaymentTerminal,
  isPaymentTransitionAllowed,
} from "./domain/state-machine.js";
export type {
  DeliveryTaskTransitionRule,
  FulfillmentTransitionRule,
  PaymentTransitionRule,
} from "./domain/state-machine.js";
export { DeliveryError, isDeliveryError, illegalTransition } from "./domain/errors.js";
export type { DeliveryErrorDetails } from "./domain/errors.js";
export type { DeliveryDomainEvent, EventContext } from "./domain/events.js";
export {
  deliveryCompletedEvent,
  deliveryDispatchRequestedEvent,
  deliveryDriverAssignedEvent,
  deliveryEligibilityResolvedEvent,
  deliveryFailedEvent,
  deliveryStatusChangedEvent,
  deliveryTaskCancelledEvent,
  deliveryTaskCreatedEvent,
  storeOrderCreatedEvent,
  storeOrderFulfillmentStateChangedEvent,
  storeOrderItemSubstitutedEvent,
  storeOrderPaymentStateChangedEvent,
} from "./domain/events.js";
export {
  assertPublicId,
  isValidPublicId,
  isValidUuid,
  validateCatalogSnapshot,
  validatePlaceOrderInput,
  validateProof,
  validateSubstitutionInput,
} from "./domain/validation.js";
export type { OrderLineInput, PlaceOrderInput } from "./domain/validation.js";

/* ── review 2/N: the dispatch relay consumer (ADR-026 §2.4, §4.1) ── */
export type {
  ConsumedStatus,
  DispatchEventClassification,
  DispatchEventType,
  DispatchOutboxRow,
  ProjectableDispatchEvent,
  RelayCheckpoint,
} from "./domain/consumed-events.js";
export {
  DISPATCH_EVENT_TYPES,
  DispatchPayloadError,
  ZERO_CHECKPOINT,
  classifyDispatchEvent,
  isTerminal,
} from "./domain/consumed-events.js";
export type { MirrorDecision, MirrorEmission, MirrorTask, MirrorTransition } from "./domain/dispatch-mirror.js";
export {
  DISPATCH_JOB_CANCELLED_REASON,
  projectDispatchEvent,
} from "./domain/dispatch-mirror.js";
export type {
  DispatchEventSource,
  MirrorContext,
  TaskMirrorStore,
} from "./ports.js";
export {
  DEFAULT_RELAY_CONFIG,
  SUPPORTED_EVENT_VERSION,
  rebuildAll,
  replayFrom,
  runRelayBatch,
} from "./relay.js";
export type { BatchOutcome, RelayConfig, RelayDeps, RelayLogEntry } from "./relay.js";

/* ── marketplace inventory consumer (ADR-026 §2.3) ── */
export type {
  InventoryAdjustedData,
  InventoryConsumedStatus,
  InventoryRelayCheckpoint,
  MarketplaceInventoryClassification,
  MarketplaceInventoryEventType,
  MarketplaceOutboxRow,
} from "./domain/marketplace-inventory-events.js";
export {
  MARKETPLACE_INVENTORY_EVENT_TYPES,
  MarketplacePayloadError,
  ZERO_INVENTORY_CHECKPOINT,
  classifyMarketplaceInventoryEvent,
  isInventoryTerminal,
} from "./domain/marketplace-inventory-events.js";
export type {
  InventoryObservationStore,
  MarketplaceInventoryEventSource,
} from "./ports.js";
export {
  DEFAULT_INVENTORY_RELAY_CONFIG,
  SUPPORTED_INVENTORY_EVENT_VERSION,
  rebuildInventoryObservations,
  replayInventoryFrom,
  runInventoryRelayBatch,
} from "./marketplace-inventory-relay.js";
export type { InventoryRelayConfig, InventoryRelayDeps } from "./marketplace-inventory-relay.js";

/* ── review 6/N: the HTTP boundary + store-order aggregate (ADR-026 §4.2) ── */
export { buildDeliveryHttpApp } from "./http/app.js";
export type { DeliveryHttpApp, DeliveryHttpDeps } from "./http/app.js";
export { sendDeliveryError } from "./http/errors.js";
export type { DeliveryErrorBody } from "./http/errors.js";
export {
  parseCancelBody,
  parseOrderPublicIdParam,
  parsePlaceStoreOrderBody,
} from "./http/requests.js";
export { toDeliveryTaskResponse, toStoreOrderResponse } from "./http/mappers.js";
export { buildStoreOrderPlacement } from "./domain/store-order-placement.js";
export type {
  PlacementIdentity,
  PlacementResult,
  PlacementSnapshot,
} from "./domain/store-order-placement.js";
export { decideCancellation } from "./domain/store-order-cancellation.js";
export type { CancellationDecision } from "./domain/store-order-cancellation.js";
export { placeStoreOrder } from "./use-cases/place-store-order.js";
export type { PlaceStoreOrderDeps } from "./use-cases/place-store-order.js";
export { cancelStoreOrder } from "./use-cases/cancel-store-order.js";
export type { CancelStoreOrderDeps } from "./use-cases/cancel-store-order.js";
export { StoreOrderStore } from "./infrastructure/store-order-store.js";
export type {
  CancellationWrite,
  CatalogProductSnapshot,
  PlacementWrite,
  StoreOrderCatalogPort,
  StoreOrderReadPort,
  StoreOrderWritePort,
} from "./ports.js";

/* ── review 7/N: idempotency + readiness (ADR-026 §4.10) ── */
export {
  IDEMPOTENCY_KEY_PATTERN,
  IDEMPOTENT_ROUTES,
  assertIdempotencyKey,
  canonicalJson,
  deriveRequestFingerprint,
} from "./domain/idempotency.js";
export type { IdempotentRoute } from "./domain/idempotency.js";
export { resolveIdempotentReplay } from "./use-cases/idempotency-guard.js";
export { buildReadinessResponse } from "./http/readiness.js";
export type { ReadinessResponseBody } from "./http/readiness.js";
export {
  DEFAULT_READINESS_TIMEOUT_MS,
  PostgresReadinessProbe,
  readinessFailureReason,
} from "./infrastructure/readiness-probe.js";
export type {
  IdempotencyIntent,
  IdempotentReplay,
  ReadinessCheckResult,
  ReadinessProbePort,
  StoredIdempotentResponse,
} from "./ports.js";

/* ── review 8/N: محوّلُ كتالوجِ السوقِ الحقيقيُّ (ADR-026 §4.9-2 → §4.11) ── */
export {
  DELIVERY_MARKETPLACE_SCOPES,
  HttpMarketplaceCatalogPort,
  MARKETPLACE_FAILURE_REASONS,
} from "./infrastructure/http-marketplace-catalog.js";
export type {
  HttpMarketplaceCatalogOptions,
  MarketplaceFailureReason,
} from "./infrastructure/http-marketplace-catalog.js";
export { assertStoreSlug, isValidStoreSlug } from "./domain/validation.js";
