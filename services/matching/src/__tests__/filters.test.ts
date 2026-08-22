/**
 * The hard filters: order, fail-closed behaviour, and first-cause reporting.
 *
 * These tests are written against the DOCUMENTED order (MATCHING_DISPATCH §4),
 * not against the current code, so reordering the stages breaks them. That is the
 * point: the order decides which deficit an operator is told about, and being
 * told the wrong deficit sends the wrong team to the wrong problem.
 */

import { describe, expect, it } from "vitest";

import { HARD_FILTER_STAGES, applyHardFilters, isFresh } from "../domain/filters.js";
import { RULESET_V1 } from "../domain/ruleset.js";
import {
  NOW,
  ZONE_OTHER_COUNTRY,
  ZONE_PICKUP,
  candidacyFixture,
} from "./harness.js";
import type { Candidacy } from "../domain/model.js";

const baseRequest = {
  orderType: "ride" as const,
  vehicleClass: "sedan" as const,
  excludedDriverIds: [] as readonly string[],
  evaluatedAt: NOW,
  candidacyFreshnessSeconds: RULESET_V1.candidacyFreshnessSeconds,
  servesPickupZone: (candidacy: Candidacy) => candidacy.zoneIds.includes(ZONE_PICKUP),
};

const run = (rows: readonly Candidacy[], overrides: Partial<typeof baseRequest> = {}) =>
  applyHardFilters(rows, { ...baseRequest, ...overrides });

describe("hard filter stage table", () => {
  it("declares exactly eight stages, numbered in order", () => {
    expect(HARD_FILTER_STAGES.map((stage) => stage.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("keeps the documented order of the stages", () => {
    expect(HARD_FILTER_STAGES.map((stage) => stage.name)).toEqual([
      "candidacy_rows_exist",
      "availability_available",
      "eligibility_eligible",
      "candidacy_fresh",
      "service_kind_accepted",
      "vehicle_class_matches",
      "zone_served_by_hierarchy",
      "not_excluded_by_caller",
    ]);
  });

  it("gives every stage a distinct deficit code", () => {
    const codes = HARD_FILTER_STAGES.map((stage) => stage.emptyReasonCode);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("each stage reports its own deficit code", () => {
  it("no rows at all", () => {
    const outcome = run([]);
    expect(outcome.emptyReasonCode).toBe("NO_CANDIDACY_ROWS");
    expect(outcome.consideredCount).toBe(0);
  });

  it("rows exist but nobody is available", () => {
    expect(run([candidacyFixture({ availabilityState: "busy" })]).emptyReasonCode).toBe(
      "NO_AVAILABLE_DRIVERS",
    );
  });

  it("available but not eligible", () => {
    expect(run([candidacyFixture({ eligibilityState: "suspended" })]).emptyReasonCode).toBe(
      "NO_ELIGIBLE_DRIVERS",
    );
  });

  it("eligible but stale", () => {
    const stale = candidacyFixture({ updatedAt: "2026-08-21T23:00:00.000Z" });
    expect(run([stale]).emptyReasonCode).toBe("NO_FRESH_CANDIDACY");
  });

  it("fresh but does not accept the service kind", () => {
    expect(run([candidacyFixture({ serviceKinds: ["delivery"] })]).emptyReasonCode).toBe(
      "NO_SERVICE_MATCH",
    );
  });

  it("accepts the service but has the wrong vehicle class", () => {
    expect(run([candidacyFixture({ vehicleClass: "motorcycle" })]).emptyReasonCode).toBe(
      "NO_VEHICLE_MATCH",
    );
  });

  it("right vehicle but serves no zone near the pickup", () => {
    expect(run([candidacyFixture({ zoneIds: [ZONE_OTHER_COUNTRY] })]).emptyReasonCode).toBe(
      "NO_ZONE_MATCH",
    );
  });

  it("passes everything but is excluded by the caller", () => {
    const row = candidacyFixture();
    const outcome = run([row], { excludedDriverIds: [row.driverPublicId] });
    expect(outcome.emptyReasonCode).toBe("ALL_CANDIDATES_EXCLUDED");
    expect(outcome.excludedCount).toBe(1);
  });

  it("reports no code at all when someone survives", () => {
    const outcome = run([candidacyFixture()]);
    expect(outcome.emptyReasonCode).toBeNull();
    expect(outcome.survivors).toHaveLength(1);
    expect(outcome.eligibleCount).toBe(1);
  });
});

describe("first cause, not last", () => {
  it("blames availability when the same driver is also stale and out of zone", () => {
    const row = candidacyFixture({
      availabilityState: "offline",
      updatedAt: "2026-08-20T00:00:00.000Z",
      zoneIds: [ZONE_OTHER_COUNTRY],
    });
    // Reporting NO_ZONE_MATCH here would send someone to fix driver coverage for a
    // city whose actual problem is that nobody has come online.
    expect(run([row]).emptyReasonCode).toBe("NO_AVAILABLE_DRIVERS");
  });

  it("stops walking the stages once the set is empty", () => {
    const outcome = run([candidacyFixture({ availabilityState: "busy" })]);
    expect(outcome.stageSurvivors.availability_available).toBe(0);
    expect(outcome.stageSurvivors.not_excluded_by_caller).toBe(0);
  });

  it("still reports the deficit of the last non-empty stage in a mixed set", () => {
    // Two rows, each failing a different late stage: the set empties at the first
    // stage that removes the remaining one — vehicle class here, not zone.
    const rows = [
      candidacyFixture({ vehicleClass: "motorcycle" }),
      candidacyFixture({ vehicleClass: "van" }),
    ];
    expect(run(rows).emptyReasonCode).toBe("NO_VEHICLE_MATCH");
  });
});

describe("freshness is fail-closed", () => {
  const freshness = RULESET_V1.candidacyFreshnessSeconds;

  it("accepts a row stamped exactly at the window edge", () => {
    const row = candidacyFixture({ updatedAt: "2026-08-21T23:58:00.000Z" });
    expect(isFresh(row, NOW, freshness)).toBe(true);
  });

  it("rejects a row one second past the window", () => {
    const row = candidacyFixture({ updatedAt: "2026-08-21T23:57:59.000Z" });
    expect(isFresh(row, NOW, freshness)).toBe(false);
  });

  it("treats a future stamp as fresh rather than punishing clock skew", () => {
    const row = candidacyFixture({ updatedAt: "2026-08-22T00:05:00.000Z" });
    expect(isFresh(row, NOW, freshness)).toBe(true);
  });

  it("treats an unparsable stamp as stale", () => {
    const row = candidacyFixture({ updatedAt: "not-a-timestamp" });
    expect(isFresh(row, NOW, freshness)).toBe(false);
  });
});

describe("counters describe the set, not the survivors", () => {
  it("counts every examined row as considered", () => {
    const rows = [
      candidacyFixture(),
      candidacyFixture({ availabilityState: "busy" }),
      candidacyFixture({ zoneIds: [ZONE_OTHER_COUNTRY] }),
    ];
    const outcome = run(rows);
    expect(outcome.consideredCount).toBe(3);
    expect(outcome.eligibleCount).toBe(1);
  });

  it("counts only rows the exclusion list actually removed", () => {
    const kept = candidacyFixture();
    const outcome = run([kept], { excludedDriverIds: ["WS-9999999999", "WS-9999999998"] });
    expect(outcome.excludedCount).toBe(0);
    expect(outcome.survivors).toHaveLength(1);
  });

  it("preserves input order among survivors so ranking alone decides position", () => {
    const first = candidacyFixture({ driverPublicId: "WS-0000000501" });
    const second = candidacyFixture({ driverPublicId: "WS-0000000502" });
    expect(run([second, first]).survivors.map((row) => row.driverPublicId)).toEqual([
      "WS-0000000502",
      "WS-0000000501",
    ]);
  });
});
