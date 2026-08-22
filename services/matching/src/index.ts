/**
 * @wasla/matching-service — public surface of the matching service.
 *
 * Phase 07 · MR 2/6 delivers the PURE domain: the eight hard filters in their
 * documented order with their deficit codes, ranking by frozen ruleset version 1
 * with integer arithmetic, and a declared tie-break. There is deliberately no
 * database and no HTTP here — persistence arrives in MR 3/6 and the Fastify app
 * on port 8088 in MR 5/6, behind these same ports.
 *
 * What this service will never export, by design (ADR-011): anything about an
 * offer, a wave, a deadline, or an order transition. That vocabulary belongs to
 * `services/dispatch`, and a drift guard in @wasla/contracts-matching fails the
 * build if it appears on the matching surface.
 */

export * from "./domain/model.js";
export * from "./domain/errors.js";
export * from "./domain/ruleset.js";
export * from "./domain/filters.js";
export * from "./domain/scoring.js";
export * from "./domain/events.js";
export * from "./domain/validation.js";
export * from "./ports.js";
export * from "./infrastructure/in-memory.js";
export * from "./mappers.js";

export { evaluateCandidates } from "./use-cases/evaluate-candidates.js";
export type {
  EvaluateCandidatesInput,
  EvaluateCandidatesResult,
} from "./use-cases/evaluate-candidates.js";
export { changeAvailability, readCandidacy, upsertCandidacy } from "./use-cases/manage-candidacy.js";
export type {
  ChangeAvailabilityRequest,
  UpsertCandidacyRequest,
} from "./use-cases/manage-candidacy.js";
export { listRulesets, readDecision } from "./use-cases/read-audit.js";

// Postgres adapters (Phase 07 · MR 3/6). Exported so the HTTP layer of MR 5/6 —
// and the exit-gate harness of MR 6/6 — can bind the real engine without knowing
// how the tables are shaped. The repositories themselves are deliberately NOT
// exported: callers get them from `bindMatchingAdapters`, which is the only way
// to obtain a set that shares one transaction.
export { createMatchingDb } from "./infrastructure/drizzle/db.js";
export type { Db, DbConfig, DbOrTx } from "./infrastructure/drizzle/db.js";
export { PostgresMatchingOutbox } from "./infrastructure/drizzle/repository.js";
export {
  bindMatchingAdapters,
  PostgresMatchingUnitOfWork,
} from "./infrastructure/drizzle/transaction.js";
export type {
  MatchingSharedDeps,
  MatchingUnitOfWorkDeps,
} from "./infrastructure/drizzle/transaction.js";

// طبقة النقل وحد التركيب (Phase 07 · MR 5/6). تصديرها يبقي الاختبارات
// والمستهلك التشغيلي على المصنع والمحوّل نفسيهما من دون كشف تفاصيل المسارات.
export * from "./runner.js";
export * from "./http/app.js";
export * from "./http/errors.js";
export * from "./http/requests.js";
export * from "./infrastructure/http-geography.js";
