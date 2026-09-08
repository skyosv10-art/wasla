/**
 * @wasla/search-service — WASLA Marketplace Search domain core + relay (Phase 12).
 *
 * Derived READ MODEL (ADR-025): the search index is a projection rebuilt from
 * consumed marketplace events, NOT a second source of truth. Visibility is
 * rebuilt from consumed state (ADR-016 decision 3) — never stored as a flag.
 * Bilingual (AR/EN) query normalization + explained rule-based ranking.
 *
 * Review 2/N — Relay Consumer: consumes `marketplace_outbox` events, projects
 * them into search-owned state tables, and builds/refreshes the searchable
 * index via the catalog read port (GET /products/{productId}). Idempotent,
 * retryable, with dead-letter + checkpoint + replay. End-to-end proof:
 * outbox event → relay → search read model → correct resulting state.
 *
 * Phase 12 acceptance criteria: "relevance/load gate" + "search ADR". The HTTP
 * layer and relevance/load gate are deferred to later reviews (their formal
 * dependency on the relay must complete first).
 */

export * from "./domain/model.js";
export * from "./domain/query.js";
export * from "./domain/visibility.js";
export * from "./domain/ranking.js";
export * from "./domain/consumed-events.js";
export * from "./domain/projector.js";
export * from "./ports.js";
export * from "./relay.js";
