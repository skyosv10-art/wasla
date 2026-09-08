/**
 * Search HTTP boundary — Fastify app (ADR-025 §5 / api.openapi.yml).
 *
 * Two routes only: `GET /search/health` and `GET /search/products`. The app
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
 * ## Health is not a DB gate (this review)
 *
 * `GET /search/health` returns `{ status: "ok" }`. It is NOT a readiness probe
 * that queries the index — turning health into a load/relevance gate is deferred
 * to the exit-gate review (ADR-025 §4). Declared, not forgotten.
 */

import Fastify, { type FastifyInstance } from "fastify";

import type { SearchProductsReadPort } from "../ports.js";
import { sendSearchError } from "./errors.js";
import { parseSearchRequest } from "./requests.js";
import { toSearchPage } from "./mappers.js";

export interface SearchHttpDeps {
  readonly searchReadPort: SearchProductsReadPort;
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

  app.get("/search/health", async () => {
    return { status: "ok" as const };
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
