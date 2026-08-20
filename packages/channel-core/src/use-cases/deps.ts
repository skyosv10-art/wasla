/**
 * The dependency bundle every use case receives.
 *
 * Assembled once by a composition root (a bot in MR 4, a test in MR 2/7). Use
 * cases never construct their own dependencies, which is precisely why the
 * production channel adapter can be replaced by a mock without touching them.
 */

import type {
  ChannelPort,
  ClockPort,
  DeliveryStorePort,
  IdGeneratorPort,
  IdentityBootstrapPort,
  MiniAppRegistryPort,
  OutboxPort,
  ProcessedUpdateStorePort,
  UpdateParserPort,
} from "../ports.js";
import type { RetryPolicy } from "../domain/retry.js";

/** Dependencies for the inbound path (`receiveUpdate`). */
export interface InboundDeps {
  readonly parser: UpdateParserPort;
  readonly processedUpdates: ProcessedUpdateStorePort;
  readonly outbox: OutboxPort;
  readonly identity: IdentityBootstrapPort;
  readonly clock: ClockPort;
  readonly ids: IdGeneratorPort;
  /** Commands this bot answers. `start` is mandatory for identity bootstrap. */
  readonly supportedCommands?: readonly string[];
}

/** Dependencies for the outbound path (`sendMessage`, `retryDueDeliveries`). */
export interface OutboundDeps {
  readonly channel: ChannelPort;
  readonly deliveries: DeliveryStorePort;
  readonly outbox: OutboxPort;
  readonly retry: RetryPolicy;
  readonly clock: ClockPort;
  readonly ids: IdGeneratorPort;
  /** Attempt ceiling written on new deliveries (defaults to the contract's). */
  readonly maxAttempts?: number;
}

/** Dependencies for the launch surfaces (Mini App descriptor, deep links). */
export interface LaunchDeps {
  readonly registry: MiniAppRegistryPort;
}
