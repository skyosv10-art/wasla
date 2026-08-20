/**
 * @wasla/identity-service — WASLA Identity domain core (Phase 01).
 *
 * Pure domain model, ports, in-memory adapters and use cases. Contract-First:
 * the API DTO and event types come from @wasla/contracts-identity (the
 * OpenAPI + JSON Schema source of truth). No HTTP or persistence runtime is
 * included here — Fastify and Drizzle/Postgres adapters arrive in later MRs.
 *
 * Phase 01 Exit Gate: "create a user from Telegram and identity stays stable
 * across Username change" — covered by resolveTelegramIdentity + tests.
 */

export * from "./domain/model.js";
export * from "./domain/errors.js";
export * from "./domain/public-id.js";
export * from "./domain/events.js";
export * from "./ports.js";
export * from "./infrastructure/in-memory.js";

export { resolveTelegramIdentity } from "./use-cases/resolve-telegram-identity.js";
export type { UseCaseDeps } from "./use-cases/resolve-telegram-identity.js";
export { getUser } from "./use-cases/get-user.js";
export { addIdentityLink } from "./use-cases/add-identity-link.js";
export type { AddIdentityLinkInput } from "./use-cases/add-identity-link.js";
export { startRecovery } from "./use-cases/start-recovery.js";
export type { StartRecoveryInput } from "./use-cases/start-recovery.js";
export { getIdentityHistory } from "./use-cases/get-identity-history.js";
export type { GetIdentityHistoryInput } from "./use-cases/get-identity-history.js";
