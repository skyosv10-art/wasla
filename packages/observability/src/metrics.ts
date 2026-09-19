/**
 * Prometheus metrics for WASLA services.
 *
 * Exposes three core metrics:
 * - http_requests_total (counter): total requests by method, route, status
 * - http_request_duration_seconds (histogram): request latency by method, route, status
 * - http_requests_in_progress (gauge): in-flight requests by method
 *
 * Usage:
 *   import { registerMetrics, metricsMiddleware, metricsEndpoint } from "@wasla/observability";
 *   const metrics = registerMetrics("customers");
 *   app.addHook("onRequest", metricsMiddleware(metrics));
 *   app.get("/metrics", metricsEndpoint(metrics));
 */

import { Counter, Histogram, Gauge, Registry, collectDefaultMetrics } from "prom-client";

export interface ServiceMetrics {
  registry: Registry;
  requestCount: Counter<string>;
  requestDuration: Histogram<string>;
  requestsInProgress: Gauge<string>;
}

/**
 * Register standard HTTP metrics for a service.
 * Service name is used as a label to distinguish between services.
 */
export function registerMetrics(serviceName: string): ServiceMetrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service: serviceName });

  collectDefaultMetrics({ register: registry });

  const requestCount = new Counter({
    name: "http_requests_total",
    help: "Total number of HTTP requests",
    labelNames: ["method", "route", "status"],
    registers: [registry],
  });

  const requestDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "Duration of HTTP requests in seconds",
    labelNames: ["method", "route", "status"],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  const requestsInProgress = new Gauge({
    name: "http_requests_in_progress",
    help: "Number of HTTP requests currently in progress",
    labelNames: ["method"],
    registers: [registry],
  });

  return { registry, requestCount, requestDuration, requestsInProgress };
}
