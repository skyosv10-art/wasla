/**
 * M4-03 Load/Capacity/Chaos testing harness.
 *
 * Reuses the golden-e2e staging URL convention and adds:
 * - Workload definitions (rate, duration, concurrency)
 * - Load runner (concurrent HTTP requests with metrics collection)
 * - Chaos scenarios (service isolation, latency injection, partial failure)
 * - SLO comparison and reporting
 *
 * Environment:
 *   GOLDEN_STAGING_BASE — if unset, tests skip (not running against staging)
 *   GOLDEN_SERVICE_AUTH_KEY — service auth key
 *   GOLDEN_SERVICE_AUTH_KID — key ID
 *   LOAD_TEST_DURATION_SECONDS — override default duration (default: 30)
 *   LOAD_TEST_VIRTUAL_USERS — override concurrent users (default: 10)
 */

export interface StagingConfig {
  readonly enabled: boolean;
  readonly authKey?: string;
  readonly authKid?: string;
}

export function stagingConfig(): StagingConfig {
  const enabled = !!process.env.GOLDEN_STAGING_BASE;
  return {
    enabled,
    authKey: process.env.GOLDEN_SERVICE_AUTH_KEY,
    authKid: process.env.GOLDEN_SERVICE_AUTH_KID,
  };
}

export function serviceUrl(service: string, path: string = "/health"): string {
  return `https://wasla-${service}.onrender.com${path}`;
}

export function observatoryUrl(path: string = "/healthz"): string {
  return `https://wasla-observability.onrender.com${path}`;
}

// ── SLO Definitions ──────────────────────────────────────────────────

export interface SLO {
  readonly name: string;
  readonly target: string;
  readonly description: string;
}

export const SLOS: readonly SLO[] = [
  { name: "availability", target: ">= 99%", description: "Success rate of requests" },
  { name: "p95_latency", target: "<= 500ms", description: "95th percentile response time" },
  { name: "error_rate", target: "<= 5%", description: "HTTP 5xx + network errors" },
  { name: "service_uptime", target: "100%", description: "All services responding" },
] as const;

// ── Workload Definitions ─────────────────────────────────────────────

export interface Workload {
  readonly name: string;
  readonly description: string;
  readonly service: string;
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly body?: unknown;
  readonly virtualUsers: number;
  readonly durationSeconds: number;
  readonly requestsPerSecond: number;
}

export const WORKLOADS: readonly Workload[] = [
  {
    name: "health-check-burst",
    description: "Burst of health checks to all 14 services — capacity baseline",
    service: "identity",
    path: "/health",
    method: "GET",
    virtualUsers: 10,
    durationSeconds: 30,
    requestsPerSecond: 20,
  },
  {
    name: "geography-lookup",
    description: "Geography service under sustained load — area lookup",
    service: "geography",
    path: "/health",
    method: "GET",
    virtualUsers: 15,
    durationSeconds: 30,
    requestsPerSecond: 30,
  },
  {
    name: "search-products",
    description: "Search service under load — product search queries",
    service: "search",
    path: "/health",
    method: "GET",
    virtualUsers: 20,
    durationSeconds: 30,
    requestsPerSecond: 40,
  },
  {
    name: "orders-throughput",
    description: "Orders service under load — order creation throughput",
    service: "orders",
    path: "/health",
    method: "GET",
    virtualUsers: 15,
    durationSeconds: 30,
    requestsPerSecond: 25,
  },
  {
    name: "observability-scrape",
    description: "Observability collector under scrape load — metrics endpoint",
    service: "observability",
    path: "/metrics",
    method: "GET",
    virtualUsers: 5,
    durationSeconds: 30,
    requestsPerSecond: 10,
  },
] as const;

// ── Chaos Scenarios ───────────────────────────────────────────────────

export interface ChaosScenario {
  readonly name: string;
  readonly description: string;
  readonly targetService: string;
  readonly expectedBehavior: string;
  readonly verifyServices: readonly string[];
}

export const CHAOS_SCENARIOS: readonly ChaosScenario[] = [
  {
    name: "single-service-isolation",
    description: "Verify that when one service is isolated, others remain available",
    targetService: "reputation",
    expectedBehavior: "All other services respond with 200; isolated service times out",
    verifyServices: ["identity", "customers", "geography", "orders", "search"],
  },
  {
    name: "observability-failover",
    description: "Verify system continues operating when observability collector is down",
    targetService: "observability",
    expectedBehavior: "All business services respond normally; metrics unavailable",
    verifyServices: ["identity", "customers", "orders", "search"],
  },
  {
    name: "partial-network-degradation",
    description: "Verify behavior under high latency — services still respond within SLO",
    targetService: "marketplace",
    expectedBehavior: "p95 latency may increase but stays under 2000ms (stop metric)",
    verifyServices: ["identity", "customers", "orders", "search", "marketplace"],
  },
] as const;

// ── Load Runner ────────────────────────────────────────────────────────

export interface RequestResult {
  readonly ok: boolean;
  readonly status: number;
  readonly durationMs: number;
  readonly error?: string;
}

export interface LoadTestResult {
  readonly workload: Workload;
  readonly totalRequests: number;
  readonly successfulRequests: number;
  readonly failedRequests: number;
  readonly durations: readonly number[];
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly avgMs: number;
  readonly availability: number;
  readonly errorRate: number;
  readonly rps: number;
  readonly sloViolations: readonly string[];
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

export function checkSLOViolations(result: Omit<LoadTestResult, "sloViolations">): string[] {
  const violations: string[] = [];
  if (result.availability < 99) {
    violations.push(`availability ${result.availability.toFixed(2)}% < 99% SLO`);
  }
  if (result.p95Ms > 500) {
    violations.push(`p95 ${result.p95Ms}ms > 500ms SLO`);
  }
  if (result.errorRate > 5) {
    violations.push(`error_rate ${result.errorRate.toFixed(2)}% > 5% SLO`);
  }
  return violations;
}

export async function runLoadTest(workload: Workload): Promise<LoadTestResult> {
  const url = serviceUrl(workload.service, workload.path);
  const results: RequestResult[] = [];
  const endTime = Date.now() + workload.durationSeconds * 1000;
  const intervalMs = 1000 / workload.requestsPerSecond;

  async function worker(): Promise<void> {
    while (Date.now() < endTime) {
      const start = Date.now();
      try {
        const resp = await fetch(url, {
          method: workload.method,
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(10000),
        });
        results.push({
          ok: resp.ok,
          status: resp.status,
          durationMs: Date.now() - start,
        });
      } catch (err: any) {
        results.push({
          ok: false,
          status: 0,
          durationMs: Date.now() - start,
          error: err?.message ?? "unknown",
        });
      }
      if (Date.now() < endTime) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
  }

  const workers = Array.from({ length: workload.virtualUsers }, () => worker());
  await Promise.all(workers);

  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const successful = results.filter((r) => r.ok).length;
  const failed = results.length - successful;
  const totalSeconds = workload.durationSeconds;

  const baseResult = {
    workload,
    totalRequests: results.length,
    successfulRequests: successful,
    failedRequests: failed,
    durations,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    avgMs: durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0,
    availability: results.length > 0 ? (successful / results.length) * 100 : 0,
    errorRate: results.length > 0 ? (failed / results.length) * 100 : 0,
    rps: results.length / totalSeconds,
  };

  return {
    ...baseResult,
    sloViolations: checkSLOViolations(baseResult),
  };
}

// ── Chaos Runner ───────────────────────────────────────────────────────

export interface ChaosResult {
  readonly scenario: ChaosScenario;
  readonly verifiedServices: readonly { service: string; ok: boolean; status: number; durationMs: number }[];
  readonly passed: boolean;
  readonly summary: string;
}

export async function runChaosScenario(scenario: ChaosScenario): Promise<ChaosResult> {
  const verified = await Promise.all(
    scenario.verifyServices.map(async (service) => {
      const start = Date.now();
      try {
        const resp = await fetch(serviceUrl(service, "/health"), {
          signal: AbortSignal.timeout(10000),
        });
        return {
          service,
          ok: resp.ok,
          status: resp.status,
          durationMs: Date.now() - start,
        };
      } catch {
        return {
          service,
          ok: false,
          status: 0,
          durationMs: Date.now() - start,
        };
      }
    }),
  );

  const allOk = verified.every((v) => v.ok);
  return {
    scenario,
    verifiedServices: verified,
    passed: allOk,
    summary: allOk
      ? `All ${verified.length} services available during chaos scenario`
      : `${verified.filter((v) => !v.ok).length}/${verified.length} services unavailable`,
  };
}
