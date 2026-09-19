import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerMetrics, instrumentApp, addMetricsEndpoint } from "../index.js";

describe("registerMetrics", () => {
  it("creates a registry with default service label", () => {
    const metrics = registerMetrics("test-service");
    expect(metrics.registry).toBeDefined();
    expect(metrics.requestCount).toBeDefined();
    expect(metrics.requestDuration).toBeDefined();
    expect(metrics.requestsInProgress).toBeDefined();
  });

  it("collects default Node.js metrics", async () => {
    const metrics = registerMetrics("test-service");
    const output = await metrics.registry.metrics();
    expect(output).toContain("nodejs_");
  });
});

describe("instrumentApp + addMetricsEndpoint", () => {
  let metrics: ReturnType<typeof registerMetrics>;

  beforeEach(() => {
    metrics = registerMetrics("test-service");
  });

  it("records request count and duration", async () => {
    const app = Fastify();
    instrumentApp(app, metrics);
    addMetricsEndpoint(app, metrics);

    app.get("/test", async () => ({ ok: true }));

    const response = await app.inject({ method: "GET", url: "/test" });
    expect(response.statusCode).toBe(200);

    const metricsOutput = await app.inject({ method: "GET", url: "/metrics" });
    expect(metricsOutput.statusCode).toBe(200);
    expect(metricsOutput.body).toContain("http_requests_total");
    expect(metricsOutput.body).toContain("http_request_duration_seconds");
    expect(metricsOutput.body).toContain("GET");
    expect(metricsOutput.body).toContain("/test");
    expect(metricsOutput.body).toContain("200");

    await app.close();
  });

  it("tracks in-progress requests", async () => {
    const app = Fastify();
    instrumentApp(app, metrics);
    addMetricsEndpoint(app, metrics);

    let resolveHandler: () => void;
    const handlerPromise = new Promise<void>((resolve) => {
      resolveHandler = resolve;
    });

    app.get("/slow", async () => {
      await handlerPromise;
      return { ok: true };
    });

    // Start request but don't await it yet
    const requestPromise = app.inject({ method: "GET", url: "/slow" });

    // Give the request time to start
    await new Promise((r) => setTimeout(r, 100));

    // Check in-progress is incremented
    const metricsDuring = await app.inject({ method: "GET", url: "/metrics" });
    expect(metricsDuring.body).toContain("http_requests_in_progress");

    // Complete the request
    resolveHandler!();
    await requestPromise;

    // Check in-progress is back to 0
    const metricsAfter = await app.inject({ method: "GET", url: "/metrics" });
    const inProgressMatch = metricsAfter.body.match(/http_requests_in_progress\{[^}]*method="GET"[^}]*\}\s+(\d+)/);
    expect(inProgressMatch).toBeTruthy();
    expect(inProgressMatch![1]).toBe("0");

    await app.close();
  });

  it("records error status codes", async () => {
    const app = Fastify();
    instrumentApp(app, metrics);
    addMetricsEndpoint(app, metrics);

    app.get("/error", async () => {
      throw new Error("test error");
    });

    await app.inject({ method: "GET", url: "/error" });

    const metricsOutput = await app.inject({ method: "GET", url: "/metrics" });
    expect(metricsOutput.body).toContain("500");

    await app.close();
  });

  it("returns Prometheus content type", async () => {
    const app = Fastify();
    instrumentApp(app, metrics);
    addMetricsEndpoint(app, metrics);

    app.get("/test", async () => ({ ok: true }));

    await app.inject({ method: "GET", url: "/test" });

    const metricsResponse = await app.inject({ method: "GET", url: "/metrics" });
    expect(metricsResponse.headers["content-type"]).toContain("text/plain");

    await app.close();
  });
});
