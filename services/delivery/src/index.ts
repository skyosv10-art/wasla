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
  RelayConsumerLock,
  TaskMirrorStore,
} from "./ports.js";
export {
  PostgresRelayConsumerLock,
  RELAY_ADVISORY_LOCK_NAMESPACE,
  relayAdvisoryLockKey,
} from "./infrastructure/relay-advisory-lock.js";
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

/* ── review 10/N: محوّلُ حجزِ المخزونِ عبرَ السوقِ (ADR-026 §2.3) ── */
export {
  DELIVERY_MARKETPLACE_RESERVATION_SCOPES,
  HttpMarketplaceReservationPort,
} from "./infrastructure/http-marketplace-reservation.js";
export type { HttpMarketplaceReservationOptions } from "./infrastructure/http-marketplace-reservation.js";

/* ── review 9/N: مرآةُ الدفعِ والتأكيدُ ثمّ بوّابةُ خروجِ الطورِ 13 (§2.2 · §3.2) ── */
export { decidePaymentMirror } from "./domain/payment-mirror.js";
export type { PaymentMirrorDecision, PaymentMirrorInput } from "./domain/payment-mirror.js";
export { decideConfirmation } from "./domain/store-order-confirmation.js";
export type { ConfirmationDecision } from "./domain/store-order-confirmation.js";
export { mirrorPayment } from "./use-cases/mirror-payment.js";
export type { MirrorPaymentDeps, MirrorPaymentResult } from "./use-cases/mirror-payment.js";
export { confirmStoreOrder } from "./use-cases/confirm-store-order.js";
export type {
  ConfirmStoreOrderDeps,
  ConfirmStoreOrderResult,
} from "./use-cases/confirm-store-order.js";
export type {
  ConfirmOrderOutcome,
  ConfirmationWrite,
  MirrorPaymentOutcome,
  PaymentMirrorWrite,
} from "./ports.js";
/**
 * محوّلاتُ Postgres الأربعةُ التي كانت مكتوبةً وغيرَ مُصدَّرةٍ.
 *
 * بوّابةُ الخروجِ (`@wasla/delivery-e2e`) ترفعُ الرحلةَ على خدمتَينِ حقيقيّتَينِ، ولا
 * تستطيعُ ذلكَ بنسخٍ محليّةٍ من المحوّلاتِ: نسخةٌ في الاختبارِ تُثبِتُ أنَّ النسخةَ
 * تعملُ لا أنَّ الخدمةَ تعملُ. وتصديرُها هنا هو الفرقُ بينَ بوّابةٍ تشهدُ للإنتاجِ
 * وبينَ اختبارٍ يشهدُ لنفسِهِ.
 */
export { PostgresInventoryObservationStore } from "./infrastructure/inventory-observation-store.js";
export { PostgresMarketplaceInventoryEventSource } from "./infrastructure/marketplace-inventory-event-source.js";
export { PostgresTaskMirrorStore } from "./infrastructure/task-mirror-store.js";
export { PostgresDispatchEventSource } from "./infrastructure/dispatch-event-source.js";

/* ── review 13/N: حياةُ مفاتيحِ التماثُلِ ومُكنستُها (ADR-026 §4.15 · رفعُ دَينِ §4.10) ── */
export {
  IDEMPOTENCY_KEY_TTL_SECONDS,
  IDEMPOTENCY_KEY_TTL_FLOOR_SECONDS,
  resolveIdempotencyTtlSeconds,
} from "./domain/idempotency.js";
export {
  sweepExpiredIdempotencyKeys,
  IDEMPOTENCY_SWEEP_BATCH_SIZE,
  IDEMPOTENCY_SWEEP_MAX_BATCHES,
} from "./use-cases/sweep-expired-idempotency-keys.js";
export type {
  SweepExpiredIdempotencyKeysInput,
  SweepExpiredIdempotencyKeysResult,
} from "./use-cases/sweep-expired-idempotency-keys.js";
export type { IdempotencyKeySweepBatch, IdempotencyKeySweepPort } from "./ports.js";

/* ── review 14/N: مُنادي المُكنسةِ (ADR-026 §4.16 · رفعُ دَينِ §4.15 أ) ──
 *
 * يُصدَّرُ المنطقُ لا حدُّ التشغيلِ: `idempotency-sweep-cli.ts` يُنهي العمليّةَ
 * عندَ استيرادِهِ (`process.exit`)، فتصديرُهُ من فهرسِ الحزمةِ كانَ سيقتلُ كلَّ
 * من استوردَ الحزمةَ.
 */
export {
  SWEEP_EXIT_DRAINED,
  SWEEP_EXIT_FAILED,
  SWEEP_EXIT_ACCUMULATING,
  SWEEP_EXIT_CONTENDED,
  resolveSweepRunnerConfig,
  exitCodeForSweep,
  runIdempotencySweepRound,
  formatSweepReportLine,
} from "./ops/idempotency-sweep-runner.js";
export type {
  IdempotencySweepRunnerConfig,
  IdempotencySweepRunReport,
  RunIdempotencySweepRoundInput,
} from "./ops/idempotency-sweep-runner.js";

/* ── review 15/N: a real marketplace readiness observation (ADR-026 §4.17) ── */
export {
  CachedDependencyProbe,
  DEFAULT_MARKETPLACE_PROBE_TTL_MS,
  DEPENDENCY_NAMES,
  PROBE_THREW_DETAIL,
  resolveMarketplaceProbeConfig,
} from "./domain/dependency-probe.js";
export type {
  CachedDependencyProbeOptions,
  DependencyName,
  DependencyObservation,
  DependencyObservationPort,
  DependencyProbePort,
  DependencyProbeResult,
  MarketplaceProbeConfig,
} from "./domain/dependency-probe.js";
export {
  DEFAULT_MARKETPLACE_PROBE_TIMEOUT_MS,
  DELIVERY_MARKETPLACE_PROBE_SCOPES,
  HttpMarketplaceHealthProbe,
  MARKETPLACE_PROBE_REASONS,
} from "./infrastructure/http-marketplace-probe.js";
export type {
  HttpMarketplaceHealthProbeOptions,
  MarketplaceProbeReason,
} from "./infrastructure/http-marketplace-probe.js";
export type { DependencyObservationBody } from "./http/readiness.js";

/* ── review 17/N: فرضُ هويّةِ الخدمةِ الداخلةِ (`M1-04` الموجةُ السادسةُ) ──
 *
 * يُصدَّرُ الجمهورُ والصلاحيّاتُ **لأنَّ كلَّ منادٍ يحتاجُهما ليُوقِّعَ**، ولا
 * يُصدَّرانِ نسخةً ثانيةً عندَ المنادي: نسختانِ من اسمِ صلاحيّةٍ تفترقانِ في
 * مراجعةٍ ويُكتشَفُ الفرقُ بـ403 في الإنتاجِ.
 */
export {
  DELIVERY_SCOPES,
  DELIVERY_SERVICE_AUDIENCE,
  registerServiceIdentity,
} from "./http/service-identity.js";
export type {
  DeliveryRouteConfig,
  DeliveryRouteIdentity,
  DeliveryServiceIdentityOptions,
} from "./http/service-identity.js";

/* ── المراجعةُ 21/N: قياسُ رسائلِ الناقلِ المسمومةِ (ADR-026 §4.23) ──
 *
 * يُصدَّرُ العقدُ والمحوّلُ معاً لأنَّ **البوّابةَ الشاملةَ تُركِّبُ ما يُركِّبُهُ
 * جذرُ الإنتاجِ بالحرفِ**: بوّابةٌ تُركِّبُ غيرَهُ تشهدُ على نظامٍ آخرَ، وتمرُّ
 * خضراءَ على مسارٍ يُجيبُ 500 في الإنتاجِ. والعتباتُ تُصدَّرُ كذلكَ كي يقرأَها
 * المراقِبُ من موضعٍ واحدٍ لا من نسخةٍ عندَهُ تفترقُ في مراجعةٍ.
 */
export {
  RELAY_DEAD_LETTER_LEDGERS,
  RELAY_DEAD_LETTER_THRESHOLDS,
  RELAY_POISONED_STATUS,
  classifyRelayDeadLetterSeverity,
  oldestPoisonedAgeSeconds,
} from "./domain/relay-dead-letters.js";
export type {
  RelayDeadLetterEventTypeCount,
  RelayDeadLetterLedger,
  RelayDeadLetterLedgerMetric,
  RelayDeadLetterMetric,
  RelayDeadLetterSeverity,
  RelayDeadLetterVerdict,
  RelayDeadLetterVerdictReason,
} from "./domain/relay-dead-letters.js";
export { PostgresRelayDeadLetterStore } from "./infrastructure/relay-dead-letter-store.js";
export type { RelayDeadLetterReadPort } from "./ports.js";
export {
  RELAY_REQUEUE_TARGET_STATUS,
  decideRelayRequeue,
} from "./domain/relay-reprocess.js";
export type {
  RelayRequeueAccepted,
  RelayRequeueDecision,
  RelayRequeueRejected,
  RelayRequeueRejectionReason,
} from "./domain/relay-reprocess.js";
export { PostgresRelayRequeueStore } from "./infrastructure/relay-requeue-store.js";
export type { RelayRequeueEffect } from "./infrastructure/relay-requeue-store.js";
export type { RelayRequeuePort } from "./ports.js";
/* ── M5-13R · §4.24-ب: إعادةُ السمِّ تحتَ قفلِ المُستهلِكِ ── */
