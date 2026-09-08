/**
 * @wasla/search-service — WASLA Marketplace Search domain core (Phase 12).
 *
 * Derived READ MODEL (ADR-025): the search index is a projection rebuilt from
 * consumed marketplace events, NOT a second source of truth. Visibility is
 * rebuilt from consumed state (ADR-016 decision 3) — never stored as a flag.
 * Bilingual (AR/EN) query normalization + explained rule-based ranking.
 *
 * Phase 12 acceptance criteria: "relevance/load gate" + "search ADR". This PR
 * is the foundational review (1/N): contracts + domain core + unit tests.
 * The ingestion relay, load gate, integration tests, and CI jobs are
 * deferred to later reviews (declared in ADR-025 §4 and TASK_LOG).
 */

export * from "./domain/model.js";
export * from "./domain/query.js";
export * from "./domain/visibility.js";
export * from "./domain/ranking.js";
