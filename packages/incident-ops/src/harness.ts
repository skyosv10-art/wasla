/**
 * M4-04 Incident/On-Call/Rollback Operations harness.
 *
 * Defines:
 * - Incident severity levels and response procedures
 * - On-call rotation structure
 * - Rollback runbooks for each service
 * - Tabletop exercise scenarios
 * - Health check runner for rollback verification
 *
 * Environment:
 *   GOLDEN_STAGING_BASE — if set, can verify service health post-rollback
 */

export type Severity = "SEV-1" | "SEV-2" | "SEV-3" | "SEV-4";

export interface IncidentLevel {
  readonly severity: Severity;
  readonly description: string;
  readonly responseTimeMin: number;
  readonly escalation: string;
  readonly examples: readonly string[];
}

export const INCIDENT_LEVELS: readonly IncidentLevel[] = [
  {
    severity: "SEV-1",
    description: "Critical — system down, data loss risk",
    responseTimeMin: 15,
    escalation: "All hands — notify owner immediately",
    examples: [
      "All services down on staging",
      "Database corruption detected",
      "Security breach — unauthorized access",
      "Data loss in any service",
    ],
  },
  {
    severity: "SEV-2",
    description: "Major — significant degradation",
    responseTimeMin: 30,
    escalation: "On-call engineer + SRE lead",
    examples: [
      "Single service down affecting golden journeys",
      "p95 latency > 2000ms (stop metric)",
      "Error rate > 20% (stop metric)",
      "Observability collector down",
    ],
  },
  {
    severity: "SEV-3",
    description: "Minor — limited impact",
    responseTimeMin: 60,
    escalation: "On-call engineer",
    examples: [
      "Single non-critical service degraded",
      "Test failures in CI",
      "Alert noise from observability",
    ],
  },
  {
    severity: "SEV-4",
    description: "Low — informational",
    responseTimeMin: 240,
    escalation: "Next business day",
    examples: [
      "Documentation update needed",
      "Minor log warnings",
      "Capacity planning observations",
    ],
  },
] as const;

// ── On-Call Rotation ──────────────────────────────────────────────────

export interface OnCallRole {
  readonly role: string;
  readonly primary: string;
  readonly backup: string;
  readonly responsibilities: readonly string[];
}

export const ON_CALL_ROLES: readonly OnCallRole[] = [
  {
    role: "Incident Commander",
    primary: "@uxxxu",
    backup: "TBD",
    responsibilities: [
      "Declare incident severity",
      "Coordinate response across teams",
      "Approve rollback decisions",
      "Communicate status to stakeholders",
    ],
  },
  {
    role: "On-Call SRE",
    primary: "agent:perplexity-computer",
    backup: "TBD",
    responsibilities: [
      "Triage alerts from observability stack",
      "Execute rollback procedures",
      "Verify service health post-rollback",
      "Document incident timeline",
    ],
  },
  {
    role: "On-Call Developer",
    primary: "TBD",
    backup: "TBD",
    responsibilities: [
      "Investigate root cause in application code",
      "Prepare hotfix if needed",
      "Review logs and traces",
    ],
  },
] as const;

// ── Rollback Runbooks ─────────────────────────────────────────────────

export interface RollbackRunbook {
  readonly service: string;
  readonly renderServiceId?: string;
  readonly rollbackSteps: readonly string[];
  readonly verificationSteps: readonly string[];
  readonly estimatedTimeMin: number;
}

export const ROLLBACK_RUNBOOKS: readonly RollbackRunbook[] = [
  {
    service: "identity",
    rollbackSteps: [
      "1. Check current deployment in Render dashboard",
      "2. Navigate to service history",
      "3. Select previous stable deployment",
      "4. Click 'Rollback to this deploy'",
      "5. Wait for service to become live (2-5 min)",
    ],
    verificationSteps: [
      "1. GET https://wasla-identity.onrender.com/health — expect 200",
      "2. Verify /metrics endpoint returns Prometheus format",
      "3. Check observability dashboard for service health",
    ],
    estimatedTimeMin: 7,
  },
  {
    service: "customers",
    rollbackSteps: [
      "1. Check current deployment in Render dashboard",
      "2. Navigate to service history",
      "3. Select previous stable deployment",
      "4. Click 'Rollback to this deploy'",
      "5. Wait for service to become live (2-5 min)",
    ],
    verificationSteps: [
      "1. GET https://wasla-customers.onrender.com/health — expect 200",
      "2. Verify /metrics endpoint returns Prometheus format",
      "3. Check observability dashboard for service health",
    ],
    estimatedTimeMin: 7,
  },
  {
    service: "orders",
    rollbackSteps: [
      "1. Check current deployment in Render dashboard",
      "2. Navigate to service history",
      "3. Select previous stable deployment",
      "4. Click 'Rollback to this deploy'",
      "5. Wait for service to become live (2-5 min)",
    ],
    verificationSteps: [
      "1. GET https://wasla-orders.onrender.com/health — expect 200",
      "2. Verify /metrics endpoint returns Prometheus format",
      "3. Check observability dashboard for service health",
    ],
    estimatedTimeMin: 7,
  },
  {
    service: "search",
    rollbackSteps: [
      "1. Check current deployment in Render dashboard",
      "2. Navigate to service history",
      "3. Select previous stable deployment",
      "4. Click 'Rollback to this deploy'",
      "5. Wait for service to become live (2-5 min)",
    ],
    verificationSteps: [
      "1. GET https://wasla-search.onrender.com/health — expect 200",
      "2. Verify /metrics endpoint returns Prometheus format",
      "3. Check observability dashboard for service health",
    ],
    estimatedTimeMin: 7,
  },
  {
    service: "observability",
    rollbackSteps: [
      "1. Check wasla-observability service in Render dashboard",
      "2. Navigate to service history (srv-daqk61h42hec73a0koo0)",
      "3. Select previous stable deployment",
      "4. Click 'Rollback to this deploy'",
      "5. Wait for service to become live (2-5 min)",
    ],
    verificationSteps: [
      "1. GET https://wasla-observability.onrender.com/healthz — expect 200",
      "2. GET https://wasla-observability.onrender.com/metrics — expect Prometheus format",
      "3. Verify /api/v1/targets returns 14 targets",
      "4. Verify /api/v1/alerts returns SLI rules",
    ],
    estimatedTimeMin: 7,
  },
] as const;

// ── Tabletop Exercise Scenarios ────────────────────────────────────────

export interface TabletopScenario {
  readonly name: string;
  readonly description: string;
  readonly severity: Severity;
  readonly trigger: string;
  readonly expectedResponse: readonly string[];
  readonly rollbackRequired: boolean;
  readonly servicesAffected: readonly string[];
}

export const TABLETOP_SCENARIOS: readonly TabletopScenario[] = [
  {
    name: "service-degradation",
    description: "Identity service starts returning 500 errors — users cannot authenticate",
    severity: "SEV-2",
    trigger: "Observability alert: error_rate > 5% on identity service",
    expectedResponse: [
      "On-call SRE acknowledges alert within 30 min",
      "Investigate logs and traces via observability collector",
      "If root cause is deployment-related, execute rollback runbook for identity",
      "Verify service health post-rollback",
      "Document incident and create postmortem",
    ],
    rollbackRequired: true,
    servicesAffected: ["identity", "customers", "orders"],
  },
  {
    name: "database-corruption",
    description: "Orders database shows inconsistency — orders missing or duplicated",
    severity: "SEV-1",
    trigger: "Data integrity check fails or user reports missing orders",
    expectedResponse: [
      "Incident Commander declares SEV-1",
      "Immediate investigation of database state",
      "If corruption confirmed, isolate affected service",
      "Restore from last known good backup",
      "Verify data integrity post-restore",
      "Full postmortem and preventive measures",
    ],
    rollbackRequired: false,
    servicesAffected: ["orders", "delivery", "dispatch"],
  },
  {
    name: "observability-outage",
    description: "Observability collector goes down — no metrics, alerts, or traces",
    severity: "SEV-2",
    trigger: "Observability health check fails or no metrics being scraped",
    expectedResponse: [
      "On-call SRE acknowledges within 30 min",
      "Check wasla-observability service status on Render",
      "If deployment issue, execute rollback runbook for observability",
      "Verify metrics, targets, and alerts are restored",
      "Document gap in observability coverage",
    ],
    rollbackRequired: true,
    servicesAffected: ["observability"],
  },
  {
    name: "cascading-failure",
    description: "Marketplace service fails, causing search and orders to degrade",
    severity: "SEV-1",
    trigger: "Multiple service alerts fire simultaneously",
    expectedResponse: [
      "Incident Commander declares SEV-1",
      "Identify root cause service (marketplace)",
      "Execute rollback for marketplace service",
      "Verify downstream services recover (search, orders)",
      "Check observability for full system health",
      "Full postmortem with dependency analysis",
    ],
    rollbackRequired: true,
    servicesAffected: ["marketplace", "search", "orders"],
  },
] as const;

// ── Health Check Runner ────────────────────────────────────────────────

export interface HealthCheckResult {
  readonly service: string;
  readonly ok: boolean;
  readonly status: number;
  readonly durationMs: number;
}

export function serviceUrl(service: string, path: string = "/health"): string {
  return `https://wasla-${service}.onrender.com${path}`;
}

export function observatoryUrl(path: string = "/healthz"): string {
  return `https://wasla-observability.onrender.com${path}`;
}

export async function checkServiceHealth(service: string): Promise<HealthCheckResult> {
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
}

export async function checkAllServicesHealth(): Promise<HealthCheckResult[]> {
  const services = [
    "identity", "customers", "drivers", "geography", "orders",
    "delivery", "dispatch", "matching", "negotiations", "marketplace",
    "search", "subscriptions", "reputation", "audit",
  ];
  return Promise.all(services.map(checkServiceHealth));
}

export function stagingConfig(): { enabled: boolean } {
  return { enabled: !!process.env.GOLDEN_STAGING_BASE };
}
