/**
 * services/billing/src/index.ts
 *
 * Public entry point for @wasla/billing-service (ADR-050).
 * Exports domain model, errors, and ports for use by HTTP/relay layers
 * in later reviews.
 */

export * from "./domain/model.js";
export * from "./domain/errors.js";
export {
  type DeliveryOutboxRow,
  type RelayCheckpoint,
  type ConsumedStatus,
  type StoreOrderSnapshot,
  classifyDeliveryEvent,
  SETTLEMENT_TRIGGER_STATES,
  ZERO_CHECKPOINT,
  isBefore,
  isTerminal as isConsumedTerminal,
} from "./domain/consumed-events.js";
export * from "./ports.js";
export * from "./relay.js";
