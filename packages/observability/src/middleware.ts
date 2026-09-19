/**
 * Fastify middleware for instrumenting HTTP requests with Prometheus metrics.
 *
 * Usage:
 *   import { registerMetrics, instrumentApp, addMetricsEndpoint } from "@wasla/observability";
 *   const metrics = registerMetrics("customers");
 *   instrumentApp(app, metrics);
 *   addMetricsEndpoint(app, metrics);
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ServiceMetrics } from "./metrics.js";

/**
 * Get a normalized route pattern from a request.
 * Uses the route options URL if available (Fastify 4/5), falls back to the
 * deprecated routerPath (Fastify 4 only), then the URL pathname.
 */
function getRoute(request: FastifyRequest): string {
  const routeOptionsUrl = (request as unknown as { routeOptions?: { url?: string } }).routeOptions?.url;
  if (routeOptionsUrl) return routeOptionsUrl;
  const legacyRoute = (request as unknown as { routerPath?: string }).routerPath;
  if (legacyRoute) return legacyRoute;
  const url = request.url.split("?")[0];
  return url || "/";
}

/**
 * Check if a request is to the /metrics endpoint (should not be instrumented).
 */
function isMetricsRequest(request: FastifyRequest): boolean {
  return request.url === "/metrics" || request.url.startsWith("/metrics?");
}

/**
 * Instrument a Fastify app with Prometheus metrics.
 * Adds onRequest and onResponse hooks directly to the app instance.
 * Excludes /metrics endpoint from instrumentation to avoid self-referential metrics.
 * Must be called before registering routes.
 */
export function instrumentApp(app: FastifyInstance, metrics: ServiceMetrics): void {
  app.addHook("onRequest", async (request: FastifyRequest) => {
    if (isMetricsRequest(request)) return;
    const method = request.method;
    metrics.requestsInProgress.inc({ method });
  });

  app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    if (isMetricsRequest(request)) return;
    const method = request.method;
    const route = getRoute(request);
    const status = String(reply.statusCode);

    metrics.requestsInProgress.dec({ method });
    metrics.requestCount.inc({ method, route, status });

    const durationSeconds = reply.elapsedTime / 1000;
    metrics.requestDuration.observe(
      { method, route, status },
      durationSeconds,
    );
  });
}

/**
 * Add a /metrics endpoint to a Fastify app.
 * Returns Prometheus text format metrics.
 *
 * The route is registered with `serviceIdentity: "open"` so the central
 * service-auth middleware (M1-04) allows unauthenticated access — the
 * `/metrics` endpoint exposes aggregate counters/histograms only, never
 * request bodies or user data.
 */
export function addMetricsEndpoint(app: FastifyInstance, metrics: ServiceMetrics): void {
  app.get("/metrics", { config: { serviceIdentity: "open" } }, async (_request, reply) => {
    const output = await metrics.registry.metrics();
    reply
      .header("Content-Type", metrics.registry.contentType)
      .send(output);
  });
}

// Backward-compatible exports
export function createMetricsPlugin(metrics: ServiceMetrics) {
  return async (app: FastifyInstance) => {
    instrumentApp(app, metrics);
  };
}

export function createMetricsEndpoint(metrics: ServiceMetrics) {
  return async (app: FastifyInstance) => {
    addMetricsEndpoint(app, metrics);
  };
}
