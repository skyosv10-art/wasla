/**
 * M4-06 Controlled Pilot and Feedback Triage harness.
 *
 * Defines pilot participant cohorts, feedback channels, triage categories,
 * success/stop metrics monitoring, and beta decision gate criteria.
 *
 * Reference: BETA_CHARTER.md — 40 participants (25 customers, 10 drivers, 5 partners)
 *            14-day staging pilot in Jeddah
 */

export type ParticipantRole = "customer" | "driver" | "partner";
export type PilotPhase = "onboarding" | "active" | "feedback" | "decision";

export interface PilotParticipant {
  readonly id: string;
  readonly role: ParticipantRole;
  readonly cohort: string;
  readonly onboardingDay: number;
  readonly active: boolean;
  readonly feedbackSubmitted: number;
}

export interface FeedbackItem {
  readonly id: string;
  readonly participantRole: ParticipantRole;
  readonly category: FeedbackCategory;
  readonly severity: "critical" | "major" | "minor" | "enhancement";
  readonly description: string;
  readonly status: "new" | "triaged" | "in_progress" | "resolved" | "wontfix";
  readonly createdAt: string;
  readonly resolvedAt?: string;
}

export type FeedbackCategory =
  | "bug"
  | "ux_issue"
  | "performance"
  | "missing_feature"
  | "integration_issue"
  | "safety_concern"
  | "compliance_concern"
  | "positive_feedback";

export interface PilotMetric {
  readonly name: string;
  readonly target: string;
  readonly actual: string;
  readonly status: "pass" | "fail" | "pending";
  readonly source: string;
}

export const PILOT_METRICS: readonly PilotMetric[] = [
  {
    name: "golden_journey_completion",
    target: ">=80%",
    actual: "pending",
    status: "pending",
    source: "golden-e2e package",
  },
  {
    name: "availability",
    target: ">=99%",
    actual: "pending",
    status: "pending",
    source: "observability metrics",
  },
  {
    name: "p95_latency",
    target: "<=500ms",
    actual: "pending",
    status: "pending",
    source: "load-testing SLOs",
  },
  {
    name: "error_rate",
    target: "<=5%",
    actual: "pending",
    status: "pending",
    source: "observability metrics",
  },
  {
    name: "bot_completion_rate",
    target: ">=70%",
    actual: "pending",
    status: "pending",
    source: "bot analytics",
  },
  {
    name: "audit_completeness",
    target: "100%",
    actual: "pending",
    status: "pending",
    source: "audit service",
  },
] as const;

export const STOP_CONDITIONS: readonly string[] = [
  "Security incident detected",
  "Data corruption detected",
  "Unauthorized access detected",
  "Service downtime > 30 minutes",
  "p95 latency > 2000ms sustained",
  "Error rate > 20% sustained",
  "Rollback procedure failure",
] as const;

export const FEEDBACK_CATEGORIES: readonly { category: FeedbackCategory; description: string }[] = [
  { category: "bug", description: "Functional defect or error in the system" },
  { category: "ux_issue", description: "User experience problem or friction point" },
  { category: "performance", description: "Latency, throughput, or resource issue" },
  { category: "missing_feature", description: "Feature gap identified during pilot" },
  { category: "integration_issue", description: "Service-to-service or third-party integration problem" },
  { category: "safety_concern", description: "Safety or security concern raised by participant" },
  { category: "compliance_concern", description: "Privacy or regulatory compliance concern" },
  { category: "positive_feedback", description: "Positive feedback or feature appreciation" },
] as const;

export function createParticipant(id: string, role: ParticipantRole, cohort: string): PilotParticipant {
  return {
    id,
    role,
    cohort,
    onboardingDay: 1,
    active: true,
    feedbackSubmitted: 0,
  };
}

export function createFeedback(
  id: string,
  participantRole: ParticipantRole,
  category: FeedbackCategory,
  severity: FeedbackItem["severity"],
  description: string,
): FeedbackItem {
  return {
    id,
    participantRole,
    category,
    severity,
    description,
    status: "new",
    createdAt: new Date().toISOString(),
  };
}

export function triageFeedback(
  feedback: FeedbackItem,
  severity: FeedbackItem["severity"],
  status: FeedbackItem["status"],
): FeedbackItem {
  return {
    ...feedback,
    severity,
    status,
    resolvedAt: status === "resolved" || status === "wontfix" ? new Date().toISOString() : feedback.resolvedAt,
  };
}

export function getCriticalFeedback(items: readonly FeedbackItem[]): readonly FeedbackItem[] {
  return items.filter((f) => f.severity === "critical" && f.status !== "resolved" && f.status !== "wontfix");
}

export function getUnresolvedFeedback(items: readonly FeedbackItem[]): readonly FeedbackItem[] {
  return items.filter((f) => f.status !== "resolved" && f.status !== "wontfix");
}

export function getResolvedCount(items: readonly FeedbackItem[]): number {
  return items.filter((f) => f.status === "resolved" || f.status === "wontfix").length;
}

export function getFeedbackByCategory(items: readonly FeedbackItem[], category: FeedbackCategory): readonly FeedbackItem[] {
  return items.filter((f) => f.category === category);
}

export function getFeedbackByRole(items: readonly FeedbackItem[], role: ParticipantRole): readonly FeedbackItem[] {
  return items.filter((f) => f.participantRole === role);
}

export interface BetaDecision {
  readonly decision: "go" | "no_go" | "conditional_go";
  readonly date: string;
  readonly conditions: readonly string[];
  readonly metricsPassed: number;
  readonly metricsTotal: number;
  readonly criticalIssuesOpen: number;
  readonly stopConditionsTriggered: string[];
}

export function evaluateBetaDecision(
  metrics: readonly PilotMetric[],
  feedback: readonly FeedbackItem[],
  stopConditions: readonly string[] = [],
): BetaDecision {
  const metricsPassed = metrics.filter((m) => m.status === "pass").length;
  const metricsTotal = metrics.length;
  const criticalOpen = getCriticalFeedback(feedback).length;
  const allMetricsPass = metricsPassed === metricsTotal;
  const noCritical = criticalOpen === 0;
  const noStop = stopConditions.length === 0;

  if (allMetricsPass && noCritical && noStop) {
    return {
      decision: "go",
      date: new Date().toISOString(),
      conditions: [],
      metricsPassed,
      metricsTotal,
      criticalIssuesOpen: criticalOpen,
      stopConditionsTriggered: stopConditions,
    };
  }

  if (!allMetricsPass || criticalOpen > 0) {
    const conditions: string[] = [];
    if (!allMetricsPass) conditions.push(`Resolve ${metricsTotal - metricsPassed} pending/failed metrics`);
    if (criticalOpen > 0) conditions.push(`Resolve ${criticalOpen} critical feedback items`);
    if (stopConditions.length > 0) conditions.push(`Address stop conditions: ${stopConditions.join(", ")}`);
    return {
      decision: "conditional_go",
      date: new Date().toISOString(),
      conditions,
      metricsPassed,
      metricsTotal,
      criticalIssuesOpen: criticalOpen,
      stopConditionsTriggered: stopConditions,
    };
  }

  return {
    decision: "no_go",
    date: new Date().toISOString(),
    conditions: ["Stop conditions triggered"],
    metricsPassed,
    metricsTotal,
    criticalIssuesOpen: criticalOpen,
    stopConditionsTriggered: stopConditions,
  };
}
