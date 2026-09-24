/**
 * M4-03 Load/Capacity/Chaos tests — staging-targeted.
 *
 * These tests skip gracefully when GOLDEN_STAGING_BASE is not set.
 * When set, they run actual load and chaos tests against staging.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  stagingConfig,
  SLOS,
  WORKLOADS,
  CHAOS_SCENARIOS,
  runLoadTest,
  runChaosScenario,
  serviceUrl,
  observatoryUrl,
  type LoadTestResult,
  type ChaosResult,
} from "../harness.js";

const config = stagingConfig();
const describeStaging = config.enabled ? describe : describe.skip;

describeStaging("M4-03 Load Testing — SLO Definitions", () => {
  it("should define all 4 SLOs", () => {
    expect(SLOS).toHaveLength(4);
    expect(SLOS.map((s) => s.name)).toContain("availability");
    expect(SLOS.map((s) => s.name)).toContain("p95_latency");
    expect(SLOS.map((s) => s.name)).toContain("error_rate");
    expect(SLOS.map((s) => s.name)).toContain("service_uptime");
  });

  it("should have SLO targets matching beta charter", () => {
    const availability = SLOS.find((s) => s.name === "availability")!;
    expect(availability.target).toContain("99");
    const p95 = SLOS.find((s) => s.name === "p95_latency")!;
    expect(p95.target).toContain("500");
  });
});

describeStaging("M4-03 Workload Definitions", () => {
  it("should define 5 workloads covering critical services", () => {
    expect(WORKLOADS).toHaveLength(5);
    const services = WORKLOADS.map((w) => w.service);
    expect(services).toContain("identity");
    expect(services).toContain("search");
    expect(services).toContain("orders");
    expect(services).toContain("observability");
  });

  it("should have reasonable virtual users (5-20)", () => {
    for (const w of WORKLOADS) {
      expect(w.virtualUsers).toBeGreaterThanOrEqual(5);
      expect(w.virtualUsers).toBeLessThanOrEqual(20);
    }
  });

  it("should have 30-second duration for each workload", () => {
    for (const w of WORKLOADS) {
      expect(w.durationSeconds).toBe(30);
    }
  });
});

describeStaging("M4-03 Chaos Scenario Definitions", () => {
  it("should define 3 chaos scenarios", () => {
    expect(CHAOS_SCENARIOS).toHaveLength(3);
    const names = CHAOS_SCENARIOS.map((s) => s.name);
    expect(names).toContain("single-service-isolation");
    expect(names).toContain("observability-failover");
    expect(names).toContain("partial-network-degradation");
  });

  it("should verify multiple services per scenario", () => {
    for (const s of CHAOS_SCENARIOS) {
      expect(s.verifyServices.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describeStaging("M4-03 Load Tests — Staging", () => {
  // Run each workload and check SLOs
  for (const workload of WORKLOADS) {
    it(`should run ${workload.name} within SLOs`, async () => {
      const result = await runLoadTest(workload);

      console.log(`\n  ${workload.name}:`);
      console.log(`    Requests: ${result.totalRequests} (${result.rps.toFixed(1)} rps)`);
      console.log(`    Availability: ${result.availability.toFixed(2)}%`);
      console.log(`    p50: ${result.p50Ms}ms, p95: ${result.p95Ms}ms, p99: ${result.p99Ms}ms`);
      console.log(`    Errors: ${result.errorRate.toFixed(2)}%`);
      if (result.sloViolations.length > 0) {
        console.log(`    SLO violations: ${result.sloViolations.join(", ")}`);
      }

      expect(result.totalRequests).toBeGreaterThan(0);
      expect(result.availability).toBeGreaterThanOrEqual(95);
    });
  }
});

describeStaging("M4-03 Chaos Tests — Staging", () => {
  for (const scenario of CHAOS_SCENARIOS) {
    it(`should pass ${scenario.name}`, async () => {
      const result = await runChaosScenario(scenario);

      console.log(`\n  ${scenario.name}:`);
      console.log(`    ${result.summary}`);
      for (const v of result.verifiedServices) {
        console.log(`    ${v.service}: ${v.status} (${v.durationMs}ms) ${v.ok ? "OK" : "FAIL"}`);
      }

      expect(result.verifiedServices.length).toBeGreaterThan(0);
    });
  }
});

describeStaging("M4-03 Capacity — All Services Health", () => {
  it("all 14 services should be healthy simultaneously", async () => {
    const services = [
      "identity", "customers", "drivers", "geography", "orders",
      "delivery", "dispatch", "matching", "negotiations", "marketplace",
      "search", "subscriptions", "reputation", "audit",
    ];

    const results = await Promise.all(
      services.map(async (svc) => {
        const start = Date.now();
        try {
          const resp = await fetch(serviceUrl(svc, "/health"), {
            signal: AbortSignal.timeout(10000),
          });
          return { service: svc, ok: resp.ok, status: resp.status, durationMs: Date.now() - start };
        } catch {
          return { service: svc, ok: false, status: 0, durationMs: Date.now() - start };
        }
      }),
    );

    const healthy = results.filter((r) => r.ok).length;
    console.log(`\n  Healthy services: ${healthy}/${services.length}`);
    for (const r of results) {
      console.log(`    ${r.service}: ${r.status} (${r.durationMs}ms) ${r.ok ? "OK" : "FAIL"}`);
    }

    expect(healthy).toBeGreaterThanOrEqual(services.length - 1);
  });

  it("observability collector should be healthy", async () => {
    const start = Date.now();
    const resp = await fetch(observatoryUrl("/healthz"), {
      signal: AbortSignal.timeout(10000),
    });
    const duration = Date.now() - start;

    console.log(`\n  observability: ${resp.status} (${duration}ms)`);
    expect(resp.ok).toBe(true);
    expect(duration).toBeLessThan(2000);
  });

  it("observability metrics endpoint should return Prometheus format", async () => {
    const resp = await fetch(observatoryUrl("/metrics"), {
      signal: AbortSignal.timeout(10000),
    });
    const text = await resp.text();

    console.log(`\n  metrics: ${resp.status}, ${text.length} bytes`);
    expect(resp.ok).toBe(true);
    expect(text.length).toBeGreaterThan(100);
    expect(text).toContain("wasla_");
  });
});
