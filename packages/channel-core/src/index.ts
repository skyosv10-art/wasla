/**
 * `@wasla/channel-core` — the neutral channel layer.
 *
 * Everything a bot needs to receive an update, answer it, retry a failed answer
 * and open a Mini App, with **zero knowledge of any specific messaging channel**
 * (ADR-007). A channel-specific adapter satisfies the ports exported here; the
 * core is never edited to add a channel.
 *
 * Public surface, in dependency order:
 *   domain  → vocabulary, events, deep-link codec, retry policy
 *   ports   → the nine seams to the outside world
 *   use cases → the behaviour
 *   infrastructure → in-memory/mock implementations for tests and local runs
 */

export * from "./domain/model.js";
export * from "./domain/errors.js";
export * from "./domain/events.js";
export * from "./domain/deep-link.js";
export * from "./domain/retry.js";

export * from "./ports.js";

export * from "./use-cases/deps.js";
export * from "./use-cases/receive-update.js";
export * from "./use-cases/send-message.js";
export * from "./use-cases/retry-due-deliveries.js";
export * from "./use-cases/launch-surfaces.js";

export * from "./infrastructure/in-memory.js";
