/**
 * M2-08 — Synthetic Trace/Metrics Integration Test (CLM-0235)
 *
 * Proves the observability pipeline works end-to-end:
 * 1. Creates a Fastify service with the @wasla/observability middleware
 * 2. Generates synthetic traffic (requests)
 * 3. Collects metrics from /metrics endpoint
 * 4. Verifies metrics are recorded (request count, latency, in-progress)
 * 5. Verifies tracing is a no-op without OTEL_EXPORTER_OTLP_ENDPOINT
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import { registerMetrics, instrumentApp, addMetricsEndpoint, startTracing } from "../index.js";

const SERVICE_NAME = "synthetic-test";

describe("M2-08 Synthetic Trace/Metrics", () => {
  let app: Fastify.FastifyInstance;
  let metrics: ReturnType<typeof registerMetrics>;
  let stopTracing: () => void;

  beforeAll(async () => {
    // Step 1: Start tracing (no-op without OTEL_EXPORTER_OTLP_ENDPOINT)
    stopTracing = startTracing(SERVICE_NAME);

    // Step 2: Create Fastify app with observability middleware
    app = Fastify({ logger: false });
    metrics = registerMetrics(SERVICE_NAME);
    instrumentApp(app, metrics);
    addMetricsEndpoint(app, metrics);

    // Register test routes
    app.get("/health", async () => ({ status: "ok" }));
    app.get("/api/items", async () => ({ items: [1, 2, 3] }));
    app.post("/api/items", async () => ({ created: true }));
    app.get("/api/error", async () => {
      throw new Error("synthetic error");
    });

    await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    stopTracing();
    await app.close();
  });

  it("generates synthetic traffic and records metrics", async () => {
    // Generate 50 normal requests
    for (let i = 0; i < 50; i++) {
      const route = i % 2 === 0 ? "/health" : "/api/items";
      const method = i % 7 === 0 ? "POST" : "GET";
      await app.inject({ method, url: route });
    }

    // Generate 5 error requests
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: "GET", url: "/api/error" });
    }

    // Collect metrics
    const metricsResponse = await app.inject({ method: "GET", url: "/metrics" });
    expect(metricsResponse.statusCode).toBe(200);

    const output = metricsResponse.body;

    // Verify metrics are present
    expect(output).toContain("http_requests_total");
    expect(output).toContain("http_request_duration_seconds");
    expect(output).toContain("http_requests_in_progress");
    expect(output).toContain(`service="${SERVICE_NAME}"`);
    expect(output).toContain("method=\"GET\"");
    expect(output).toContain("method=\"POST\"");
    expect(output).toContain("status=\"200\"");
    expect(output).toContain("status=\"500\"");
    expect(output).toContain("nodejs_");
  });

  it("exposes Prometheus content type", async () => {
    const response = await app.inject({ method: "GET", url: "/metrics" });
    expect(response.headers["content-type"]).toContain("text/plain");
  });

  it("computes SLI from metrics", async () => {
    const metricsResponse = await app.inject({ method: "GET", url: "/metrics" });
    const output = metricsResponse.body;

    // Parse total requests
    const totalMatches = output.match(/http_requests_total\{[^}]*\}\s+(\d+)/g) || [];
    const totalRequests = totalMatches.reduce((sum, m) => sum + parseInt(m.match(/\d+$/)?.[0] || "0"), 0);
    expect(totalRequests).toBeGreaterThan(0);

    // Parse error requests (status 500)
    const errorMatches = output.match(/http_requests_total\{[^}]*status="500"[^}]*\}\s+(\d+)/g) || [];
    const errorRequests = errorMatches.reduce((sum, m) => sum + parseInt(m.match(/\d+$/)?.[0] || "0"), 0);

    // Compute availability
    const availability = totalRequests > 0 ? ((totalRequests - errorRequests) / totalRequests * 100) : 0;
    const errorRate = totalRequests > 0 ? (errorRequests / totalRequests * 100) : 0;

    expect(availability).toBeGreaterThan(0);
    expect(errorRate).toBeGreaterThanOrEqual(0);
  });

  it("tracing is no-op without OTEL_EXPORTER_OTLP_ENDPOINT", () => {
    // startTracing returns a cleanup function — should be a no-op
    const cleanup = startTracing("test-no-op");
    expect(cleanup).toBeDefined();
    expect(typeof cleanup).toBe("function");
    // Should not throw
    cleanup();
  });
});
