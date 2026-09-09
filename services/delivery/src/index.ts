/**
 * @wasla/delivery-service — public surface (review 1/N).
 *
 * This review publishes the DOMAIN CORE only: the model, the state machines
 * (edge-by-edge, ADR-026 §3), the event builders, validation and the typed
 * error. HTTP, persistence, relay and dispatch delegation are declared in
 * the contracts and deferred (ADR-026 §4) — nothing here imports fastify,
 * pg or any runtime dependency by design.
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
