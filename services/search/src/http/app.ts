/**
 * Search HTTP boundary — Fastify app (ADR-025 §5 / api.openapi.yml).
 *
 * Three routes: `GET /search/health` (liveness), `GET /search/ready`
 * (readiness) and `GET /search/products`. The app
 * depends on an injected `SearchProductsReadPort` — it never opens a DB
 * connection itself. Unit tests build the app with a fake port; production
 * wiring lives in `server.ts`.
 *
 * ## One error handler, no try/catch in handlers
 *
 * Handlers throw typed search errors (`SearchValidationError` / `SearchUnavailableError`)
 * or let the read port throw; a single `setErrorHandler` translates via
 * `sendSearchError`. No handler wraps its body in try/catch — that would mean a
 * second translation of the same error in a place nobody reads.
 *
 * ## Liveness and readiness are two different questions (review 5/N · RISK-0030)
 *
 * `GET /search/health` answers "is this process alive?" — it takes no
 * dependency and therefore CANNOT be a deployment gate. That was the whole bug:
 * with a degraded index the service answered `health: ok` while every
 * `/search/products` call returned `503`, so an orchestrator kept routing
 * traffic to a service that could not serve a single search.
 *
 * `GET /search/ready` answers "can this process serve a search?" by actually
 * touching the read model through `SearchIndexHealthPort`. It returns `200
 * { status: "ready" }` only when the index answered, and `503
 * SEARCH_INDEX_DEGRADED` otherwise. Orchestrators route on `/search/ready`;
 * `/search/health` stays for restart decisions.
 *
 * The probe is a REACHABILITY check, not a freshness check: it does not measure
 * relay lag, so a reachable-but-stale index still reads as ready. That limit is
 * declared in RISK-0032 rather than implied by a green probe.
 */

import Fastify, { type FastifyInstance } from "fastify";

import type { SearchIndexHealthPort, SearchProductsReadPort } from "../ports.js";
import { SearchUnavailableError, sendSearchError } from "./errors.js";
import { parseSearchRequest } from "./requests.js";
import { toSearchPage } from "./mappers.js";

export interface SearchHttpDeps {
  readonly searchReadPort: SearchProductsReadPort;
  /**
   * Readiness probe for `GET /search/ready`. Optional so existing callers keep
   * compiling; when absent the route reports `503` — a service that cannot
   * prove it reaches its index must not be declared ready by default.
   */
  readonly indexHealthPort?: SearchIndexHealthPort;
}

export interface SearchHttpApp {
  readonly fastify: FastifyInstance;
  readonly close: () => Promise<void>;
}

export function buildSearchHttpApp(deps: SearchHttpDeps): SearchHttpApp {
  const app = Fastify({
    // request.id is used as trace_id in error bodies.
    genReqId: () => crypto.randomUUID(),
  });

  app.setErrorHandler((error, request, reply) => {
    const traceId = String(request.id);
    return sendSearchError(reply, error, traceId);
  });

  // Liveness: no dependency, no DB. Never fails while the process runs.
  app.get("/search/health", async () => {
    return { status: "ok" as const };
  });

  // Readiness: queries the read model. No try/catch — a throwing probe is a
  // degraded probe, and the single error handler already maps that to 503.
  app.get("/search/ready", async (_request, reply) => {
    if (deps.indexHealthPort === undefined) {
      throw new SearchUnavailableError(
        "SEARCH_INDEX_DEGRADED",
        "لا مسبارَ جاهزيةٍ مُركَّبٌ — تعذّرَ إثباتُ الوصولِ إلى الفهرسِ",
      );
    }
    const health = await deps.indexHealthPort.probe();
    if (!health.index_reachable) {
      throw new SearchUnavailableError(
        "SEARCH_INDEX_DEGRADED",
        "الفهرسُ غيرُ قابلٍ للوصولِ",
      );
    }
    return reply.status(200).send({
      status: "ready" as const,
      index_reachable: true,
      indexed_documents: health.indexed_documents,
    });
  });

  app.get("/search/products", async (request, reply) => {
    const parsed = parseSearchRequest(
      request.query as Record<string, unknown>,
    );
    // No try/catch: the read port throws SearchUnavailableError on degraded
    // state; the single error handler translates it to 503.
    const page = await deps.searchReadPort.search({
      q: parsed.q,
      locale: parsed.locale,
      categorySlug: parsed.categorySlug,
      page: parsed.page,
      pageSize: parsed.pageSize,
      sort: parsed.sort,
    });
    return reply.status(200).send(toSearchPage(page));
  });

  return {
    fastify: app,
    close: async () => {
      await app.close();
    },
  };
}
