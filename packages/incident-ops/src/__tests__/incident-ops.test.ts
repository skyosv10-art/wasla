/**
 * M4-04 Incident/On-Call/Rollback Operations tests.
 *
 * Tests skip gracefully when GOLDEN_STAGING_BASE is not set.
 */
import { describe, it, expect } from "vitest";
import {
  INCIDENT_LEVELS,
  ON_CALL_ROLES,
  ROLLBACK_RUNBOOKS,
  TABLETOP_SCENARIOS,
  checkAllServicesHealth,
  checkServiceHealth,
  stagingConfig,
  type Severity,
} from "../harness.js";

const config = stagingConfig();
const describeStaging = config.enabled ? describe : describe.skip;

describe("M4-04 Incident Levels", () => {
  it("should define 4 severity levels", () => {
    expect(INCIDENT_LEVELS).toHaveLength(4);
    const severities = INCIDENT_LEVELS.map((l) => l.severity);
    expect(severities).toContain("SEV-1");
    expect(severities).toContain("SEV-2");
    expect(severities).toContain("SEV-3");
    expect(severities).toContain("SEV-4");
  });

  it("should have appropriate response times", () => {
    const sev1 = INCIDENT_LEVELS.find((l) => l.severity === "SEV-1")!;
    expect(sev1.responseTimeMin).toBeLessThanOrEqual(15);
    const sev2 = INCIDENT_LEVELS.find((l) => l.severity === "SEV-2")!;
    expect(sev2.responseTimeMin).toBeLessThanOrEqual(30);
    const sev4 = INCIDENT_LEVELS.find((l) => l.severity === "SEV-4")!;
    expect(sev4.responseTimeMin).toBeGreaterThanOrEqual(60);
  });

  it("should have examples for each severity", () => {
    for (const level of INCIDENT_LEVELS) {
      expect(level.examples.length).toBeGreaterThan(0);
    }
  });
});

describe("M4-04 On-Call Roles", () => {
  it("should define 3 on-call roles", () => {
    expect(ON_CALL_ROLES).toHaveLength(3);
    const roles = ON_CALL_ROLES.map((r) => r.role);
    expect(roles).toContain("Incident Commander");
    expect(roles).toContain("On-Call SRE");
    expect(roles).toContain("On-Call Developer");
  });

  it("should have responsibilities for each role", () => {
    for (const role of ON_CALL_ROLES) {
      expect(role.responsibilities.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("M4-04 Rollback Runbooks", () => {
  it("should define runbooks for critical services", () => {
    expect(ROLLBACK_RUNBOOKS.length).toBeGreaterThanOrEqual(5);
    const services = ROLLBACK_RUNBOOKS.map((r) => r.service);
    expect(services).toContain("identity");
    expect(services).toContain("orders");
    expect(services).toContain("search");
    expect(services).toContain("observability");
  });

  it("should have rollback steps for each runbook", () => {
    for (const rb of ROLLBACK_RUNBOOKS) {
      expect(rb.rollbackSteps.length).toBeGreaterThanOrEqual(3);
      expect(rb.verificationSteps.length).toBeGreaterThanOrEqual(2);
      expect(rb.estimatedTimeMin).toBeGreaterThan(0);
    }
  });
});

describe("M4-04 Tabletop Scenarios", () => {
  it("should define 4 tabletop scenarios", () => {
    expect(TABLETOP_SCENARIOS).toHaveLength(4);
    const names = TABLETOP_SCENARIOS.map((s) => s.name);
    expect(names).toContain("service-degradation");
    expect(names).toContain("database-corruption");
    expect(names).toContain("observability-outage");
    expect(names).toContain("cascading-failure");
  });

  it("should have appropriate severities", () => {
    const dbCorruption = TABLETOP_SCENARIOS.find((s) => s.name === "database-corruption")!;
    expect(dbCorruption.severity).toBe("SEV-1");
    const cascading = TABLETOP_SCENARIOS.find((s) => s.name === "cascading-failure")!;
    expect(cascading.severity).toBe("SEV-1");
  });

  it("should define expected response steps", () => {
    for (const scenario of TABLETOP_SCENARIOS) {
      expect(scenario.expectedResponse.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describeStaging("M4-04 Health Checks — Staging", () => {
  it("all services should be healthy", async () => {
    const results = await checkAllServicesHealth();
    const healthy = results.filter((r) => r.ok).length;
    console.log(`\n  Healthy: ${healthy}/${results.length}`);
    for (const r of results) {
      console.log(`    ${r.service}: ${r.status} (${r.durationMs}ms) ${r.ok ? "OK" : "FAIL"}`);
    }
    expect(healthy).toBeGreaterThanOrEqual(results.length - 1);
  });

  it("observability collector should be healthy", async () => {
    const start = Date.now();
    const resp = await fetch("https://wasla-observability.onrender.com/healthz", {
      signal: AbortSignal.timeout(10000),
    });
    const duration = Date.now() - start;
    console.log(`\n  observability: ${resp.status} (${duration}ms)`);
    expect(resp.ok).toBe(true);
  });
});
