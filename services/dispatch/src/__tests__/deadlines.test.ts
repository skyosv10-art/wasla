/**
 * Time arithmetic.
 *
 * Small functions, tested closely, because every timeout in the service is one
 * comparison against a value one of these produced. The boundary is tested from both
 * sides: "off by one millisecond" here is the difference between a driver's countdown
 * reaching zero and their offer being honoured, and being told they were too late.
 */
import { describe, expect, it } from "vitest";

import { addSeconds, computeJobDeadlines, computeOfferDeadline, isDue } from "../domain/deadlines.js";
import type { DispatchRules } from "../domain/model.js";

const RULES: DispatchRules = {
  rulesetVersion: 1,
  waveSize: 2,
  offerTimeoutSeconds: 30,
  maxWaves: 3,
  escalationTimeoutSeconds: 120,
};

const T0 = "2026-01-01T00:00:00.000Z";

describe("addSeconds", () => {
  it("returns canonical UTC regardless of the input offset", () => {
    expect(addSeconds("2026-01-01T03:00:00+03:00", 0)).toBe(T0);
  });

  it("crosses a minute, an hour and a day boundary", () => {
    expect(addSeconds(T0, 90)).toBe("2026-01-01T00:01:30.000Z");
    expect(addSeconds(T0, 3600)).toBe("2026-01-01T01:00:00.000Z");
    expect(addSeconds("2026-01-01T23:59:30.000Z", 60)).toBe("2026-01-02T00:00:30.000Z");
  });
});

describe("computeJobDeadlines", () => {
  it("spends the whole wave budget before the automatic window closes", () => {
    // 3 waves × 30s: if the window were shorter than the budget, the last wave could
    // never be opened and `maxWaves` would be a lie told by configuration.
    const deadlines = computeJobDeadlines(T0, RULES);
    expect(deadlines.expiresAt).toBe("2026-01-01T00:01:30.000Z");
  });

  it("puts the escalation deadline after the automatic one, by construction", () => {
    const deadlines = computeJobDeadlines(T0, RULES);
    // ck_dispatch_jobs_deadline_order — satisfied by how it is computed, so no caller
    // can produce a row Postgres would refuse.
    expect(deadlines.escalationExpiresAt).toBe("2026-01-01T00:03:30.000Z");
    expect(Date.parse(deadlines.escalationExpiresAt)).toBeGreaterThan(
      Date.parse(deadlines.expiresAt),
    );
  });

  it("keeps the deadlines ordered even with the smallest legal rules", () => {
    const minimal: DispatchRules = {
      rulesetVersion: 1,
      waveSize: 1,
      offerTimeoutSeconds: 1,
      maxWaves: 1,
      escalationTimeoutSeconds: 1,
    };
    const deadlines = computeJobDeadlines(T0, minimal);
    expect(Date.parse(deadlines.escalationExpiresAt)).toBeGreaterThan(
      Date.parse(deadlines.expiresAt),
    );
  });
});

describe("computeOfferDeadline", () => {
  it("uses the snapshot timeout, so a config change cannot move a live countdown", () => {
    expect(computeOfferDeadline(T0, RULES)).toBe("2026-01-01T00:00:30.000Z");
    const slower: DispatchRules = { ...RULES, offerTimeoutSeconds: 45 };
    expect(computeOfferDeadline(T0, slower)).toBe("2026-01-01T00:00:45.000Z");
  });
});

describe("isDue", () => {
  const deadline = "2026-01-01T00:00:30.000Z";

  it("is not due one millisecond early", () => {
    expect(isDue(deadline, "2026-01-01T00:00:29.999Z")).toBe(false);
  });

  it("is due at exactly the deadline", () => {
    expect(isDue(deadline, deadline)).toBe(true);
  });

  it("is due one millisecond late", () => {
    expect(isDue(deadline, "2026-01-01T00:00:30.001Z")).toBe(true);
  });

  it("compares instants, not strings", () => {
    // Same instant written with an offset. A string comparison would say "not due".
    expect(isDue(deadline, "2026-01-01T03:00:30.000+03:00")).toBe(true);
  });
});
