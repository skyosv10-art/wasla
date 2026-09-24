/**
 * M4-06 Controlled Pilot and Feedback Triage tests.
 */
import { describe, it, expect } from "vitest";
import {
  PILOT_METRICS,
  STOP_CONDITIONS,
  FEEDBACK_CATEGORIES,
  createParticipant,
  createFeedback,
  triageFeedback,
  getCriticalFeedback,
  getUnresolvedFeedback,
  getResolvedCount,
  getFeedbackByCategory,
  getFeedbackByRole,
  evaluateBetaDecision,
  type FeedbackItem,
} from "../harness.js";

describe("M4-06 Pilot Metrics", () => {
  it("should define 6 pilot metrics matching beta charter", () => {
    expect(PILOT_METRICS.length).toBe(6);
    const names = PILOT_METRICS.map((m) => m.name);
    expect(names).toContain("golden_journey_completion");
    expect(names).toContain("availability");
    expect(names).toContain("p95_latency");
    expect(names).toContain("error_rate");
    expect(names).toContain("bot_completion_rate");
    expect(names).toContain("audit_completeness");
  });

  it("should have targets for all metrics", () => {
    for (const metric of PILOT_METRICS) {
      expect(metric.target).toBeTruthy();
      expect(metric.status).toBe("pending");
    }
  });

  it("should define 7 stop conditions", () => {
    expect(STOP_CONDITIONS.length).toBe(7);
    expect(STOP_CONDITIONS).toContain("Security incident detected");
    expect(STOP_CONDITIONS).toContain("Service downtime > 30 minutes");
  });
});

describe("M4-06 Feedback Categories", () => {
  it("should define 8 feedback categories", () => {
    expect(FEEDBACK_CATEGORIES.length).toBe(8);
    const cats = FEEDBACK_CATEGORIES.map((c) => c.category);
    expect(cats).toContain("bug");
    expect(cats).toContain("ux_issue");
    expect(cats).toContain("safety_concern");
    expect(cats).toContain("compliance_concern");
    expect(cats).toContain("positive_feedback");
  });
});

describe("M4-06 Participant Management", () => {
  it("should create participants with correct role and cohort", () => {
    const customer = createParticipant("P001", "customer", "cohort-a");
    expect(customer.id).toBe("P001");
    expect(customer.role).toBe("customer");
    expect(customer.cohort).toBe("cohort-a");
    expect(customer.active).toBe(true);
    expect(customer.feedbackSubmitted).toBe(0);
  });

  it("should support driver and partner roles", () => {
    const driver = createParticipant("D001", "driver", "cohort-a");
    const partner = createParticipant("PT001", "partner", "cohort-b");
    expect(driver.role).toBe("driver");
    expect(partner.role).toBe("partner");
  });
});

describe("M4-06 Feedback Triage", () => {
  const feedback: FeedbackItem[] = [
    createFeedback("F001", "customer", "bug", "critical", "App crashes on order submission"),
    createFeedback("F002", "driver", "ux_issue", "major", "Navigation buttons too small"),
    createFeedback("F003", "customer", "positive_feedback", "minor", "Love the fast response time"),
    createFeedback("F004", "partner", "safety_concern", "critical", "Driver location not updating"),
    createFeedback("F005", "customer", "missing_feature", "enhancement", "Need order history export"),
  ];

  it("should create feedback items with correct defaults", () => {
    expect(feedback[0].status).toBe("new");
    expect(feedback[0].severity).toBe("critical");
    expect(feedback[0].createdAt).toBeTruthy();
  });

  it("should triage feedback by updating severity and status", () => {
    const triaged = triageFeedback(feedback[0], "major", "in_progress");
    expect(triaged.severity).toBe("major");
    expect(triaged.status).toBe("in_progress");
  });

  it("should set resolvedAt when status is resolved", () => {
    const resolved = triageFeedback(feedback[0], "major", "resolved");
    expect(resolved.resolvedAt).toBeTruthy();
  });

  it("should filter critical and unresolved feedback", () => {
    const critical = getCriticalFeedback(feedback);
    expect(critical.length).toBe(2);
    const ids = critical.map((f) => f.id);
    expect(ids).toContain("F001");
    expect(ids).toContain("F004");
  });

  it("should get unresolved feedback count", () => {
    const unresolved = getUnresolvedFeedback(feedback);
    expect(unresolved.length).toBe(5);
  });

  it("should count resolved items", () => {
    const resolved: FeedbackItem[] = [
      triageFeedback(feedback[0], "major", "resolved"),
      triageFeedback(feedback[1], "minor", "wontfix"),
    ];
    const count = getResolvedCount(resolved);
    expect(count).toBe(2);
  });

  it("should filter by category", () => {
    const bugs = getFeedbackByCategory(feedback, "bug");
    expect(bugs.length).toBe(1);
    expect(bugs[0].id).toBe("F001");
  });

  it("should filter by participant role", () => {
    const customerFeedback = getFeedbackByRole(feedback, "customer");
    expect(customerFeedback.length).toBe(3);
  });
});

describe("M4-06 Beta Decision Gate", () => {
  it("should return go when all metrics pass, no critical issues, no stop conditions", () => {
    const allPass = PILOT_METRICS.map((m) => ({ ...m, status: "pass" as const, actual: "target met" }));
    const decision = evaluateBetaDecision(allPass, [], []);
    expect(decision.decision).toBe("go");
    expect(decision.metricsPassed).toBe(6);
    expect(decision.conditions).toHaveLength(0);
  });

  it("should return conditional_go when metrics pending", () => {
    const decision = evaluateBetaDecision(PILOT_METRICS, [], []);
    expect(decision.decision).toBe("conditional_go");
    expect(decision.conditions.length).toBeGreaterThan(0);
  });

  it("should return conditional_go when critical issues open", () => {
    const allPass = PILOT_METRICS.map((m) => ({ ...m, status: "pass" as const, actual: "target met" }));
    const critical: FeedbackItem[] = [
      createFeedback("F001", "customer", "bug", "critical", "Critical issue"),
    ];
    const decision = evaluateBetaDecision(allPass, critical, []);
    expect(decision.decision).toBe("conditional_go");
    expect(decision.criticalIssuesOpen).toBe(1);
  });

  it("should include stop conditions in decision", () => {
    const decision = evaluateBetaDecision(PILOT_METRICS, [], ["Service downtime > 30 minutes"]);
    expect(decision.stopConditionsTriggered).toContain("Service downtime > 30 minutes");
  });
});
