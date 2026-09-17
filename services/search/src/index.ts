/**
 * @wasla/search-service — WASLA Marketplace Search domain core, relay, and HTTP
 * boundary (Phase 12).
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
 * Review 3/N — HTTP Boundary (ADR-025 §5): Fastify app exposing
 * `GET /search/products` + `GET /search/health`, injected `SearchProductsReadPort`,
 * request parsing/validation, domain→wire mapping, single error handler (503 as
 * the last resort, never 500). Unit-tested with a fake port; the real pg reader
 * (`SearchIndexReader`) is integration-tested. The relevance/load exit gate and
 * the `search-db-integration` CI job remain deferred (ADR-025 §4) — declared.
 *
 * Review 5/N — Truthful `total` and real readiness (RISK-0029 · RISK-0030):
 * `count(*) OVER ()` makes `total` exact beyond any candidate cap, the cap
 * becomes a declared ranking window that REFUSES deeper pages with
 * `SEARCH_PAGE_OUT_OF_RANGE` instead of serving a truncated set, and
 * `GET /search/ready` (`SearchIndexHealthPort` + `SearchIndexHealthProbe`)
 * answers readiness by touching the index while `/search/health` stays liveness.
 */

export * from "./domain/model.js";
export * from "./domain/query.js";
export * from "./domain/visibility.js";
export * from "./domain/ranking.js";
export * from "./domain/consumed-events.js";
export * from "./domain/projector.js";
export * from "./ports.js";
export * from "./relay.js";
export * from "./http/errors.js";
export * from "./http/requests.js";
export * from "./http/mappers.js";
export * from "./http/app.js";
export {
  SEARCH_SERVICE_AUDIENCE,
  SEARCH_SCOPES,
  registerServiceIdentity,
  type SearchServiceIdentityOptions,
  type SearchRouteConfig,
  type SearchRouteIdentity,
} from "./http/service-identity.js";
export * from "./infrastructure/search-index-reader.js";
export * from "./infrastructure/search-index-health-probe.js";

/*
 * محوّلاتُ الناقلِ الإنتاجيّةُ — تُصدَّرُ كي تستعملَها بوّابةُ الخروجِ (`@wasla/search-e2e`)
 * **بأعيانِها لا بنسخةٍ منها**. فبوّابةٌ تُعيدُ كتابةَ مصدرِ الأحداثِ أو مستودعِ الإسقاطِ في
 * مِشْكاتِها إنّما تختبرُ مِشْكاتَها، وتمرُّ سالمةً على عطبٍ في المحوّلِ الذي يعملُ في الإنتاجِ.
 */
export * from "./infrastructure/marketplace-event-source.js";
export * from "./infrastructure/projection-store.js";
export * from "./infrastructure/catalog-read-port.js";
