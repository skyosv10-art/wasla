/**
 * `@wasla/channel-postgres` — the durable side of the channel layer.
 *
 * Why a separate package (ENGINEERING_DOCUMENTATION_LAW §7, ADR-007):
 * `@wasla/channel-core` is guarded by `neutrality.guard.test.ts`, which pins its
 * dependency list to `@wasla/contracts-channel` + `@wasla/errors`. A Postgres
 * adapter needs `drizzle-orm` and `pg`, so it cannot live in the core without
 * breaking the guard — and the core staying free of infrastructure is the whole
 * point of the hexagonal boundary. Keeping the adapter here also lets a bot run
 * entirely in memory (local dev, tests) by simply not wiring this package.
 *
 * Contents: three adapters for three ports — inbound de-duplication, outbound
 * delivery state + retry queue, and the domain-event outbox — plus the Drizzle
 * projection of `packages/channel-core/contracts/schema.sql`.
 */

export { createChannelDb, type ChannelDb, type ChannelDbConfig } from "./db.js";
export {
  channelDeliveries,
  channelOutbox,
  channelSchema,
  channelUpdates,
} from "./schema.js";
export { PostgresProcessedUpdateStore } from "./processed-update-store.js";
export { PostgresDeliveryStore } from "./delivery-store.js";
export { PostgresChannelOutbox } from "./outbox.js";
export { createChannelStores, type ChannelStores } from "./stores.js";
