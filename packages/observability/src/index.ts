/**
 * @wasla/observability — Shared observability package for WASLA services.
 *
 * Provides:
 * - Prometheus metrics (request count, latency histogram, in-progress gauge)
 * - Fastify middleware for automatic HTTP instrumentation
 * - /metrics endpoint in Prometheus text format
 * - OpenTelemetry tracing setup (opt-in via OTEL_EXPORTER_OTLP_ENDPOINT)
 *
 * Usage:
 *   import { registerMetrics, instrumentApp, addMetricsEndpoint, startTracing } from "@wasla/observability";
 *
 *   startTracing("customers"); // no-op without OTEL_EXPORTER_OTLP_ENDPOINT
 *   const metrics = registerMetrics("customers");
 *   instrumentApp(app, metrics);
 *   addMetricsEndpoint(app, metrics);
 */

export { registerMetrics, type ServiceMetrics } from "./metrics.js";
export { instrumentApp, addMetricsEndpoint, createMetricsPlugin, createMetricsEndpoint } from "./middleware.js";
export { startTracing } from "./tracing.js";
