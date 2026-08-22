/**
 * `evaluateCandidates` end to end over the in-memory adapters.
 *
 * The behaviour being pinned down is the shape of the operation, not the numbers:
 * one audit row per evaluation, one aggregate-only event, an empty list that is a
 * 200 with a reason rather than an error, and a caller error that stays a caller
 * error instead of being disguised as a shortage of drivers.
 */

import { describe, expect, it } from "vitest";

import { isMatchingError } from "../domain/errors.js";
import { RULESET_V1 } from "../domain/ruleset.js";
import { evaluateCandidates } from "../use-cases/evaluate-candidates.js";
import {
  NOW,
  ORDER_PUBLIC_ID,
  ZONE_OTHER_COUNTRY,
  ZONE_PICKUP,
  ZONE_SAME_CITY,
  ZONE_SAME_DISTRICT,
  ZONE_UNKNOWN,
  candidacyFixture,
  createHarness,
  queryFixture,
  seedAll,
} from "./harness.js";
import type { InMemoryMatchingDependencies } from "../infrastructure/in-memory.js";

const evaluate = (deps: InMemoryMatchingDependencies, overrides: Record<string, unknown> = {}) =>
  evaluateCandidates(deps, queryFixture(overrides) as never);

describe("a successful evaluation", () => {
  it("returns candidates ranked, with a decision id and the ruleset version used", async () => {
    const deps = createHarness();
    seedAll(deps, [
      candidacyFixture({ driverPublicId: "WS-0000000001", zoneIds: [ZONE_PICKUP] }),
      candidacyFixture({ driverPublicId: "WS-0000000002", zoneIds: [ZONE_SAME_CITY] }),
    ]);

    const result = await evaluate(deps);

    expect(result.candidates.map((candidate) => candidate.driverPublicId)).toEqual([
      "WS-0000000001",
      "WS-0000000002",
    ]);
    expect(result.rulesetVersion).toBe(RULESET_V1.version);
    expect(result.decisionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.emptyReasonCode).toBeNull();
    expect(result.candidates.every((candidate) => Number.isInteger(candidate.scoreBp))).toBe(true);
  });

  it("prefers the nearer zone when nothing else separates two drivers", async () => {
    const deps = createHarness();
    seedAll(deps, [
      candidacyFixture({ driverPublicId: "WS-0000000010", zoneIds: [ZONE_SAME_CITY] }),
      candidacyFixture({ driverPublicId: "WS-0000000011", zoneIds: [ZONE_SAME_DISTRICT] }),
    ]);

    const result = await evaluate(deps);

    expect(result.candidates[0]!.driverPublicId).toBe("WS-0000000011");
    expect(result.candidates[0]!.components.zoneProximityBp).toBeGreaterThan(
      result.candidates[1]!.components.zoneProximityBp,
    );
  });

  it("counts what happened, not what was returned", async () => {
    const deps = createHarness();
    seedAll(deps, [
      candidacyFixture({ driverPublicId: "WS-0000000020" }),
      candidacyFixture({ driverPublicId: "WS-0000000021" }),
      candidacyFixture({ driverPublicId: "WS-0000000022", availabilityState: "busy" }),
      candidacyFixture({ driverPublicId: "WS-0000000023", zoneIds: [ZONE_OTHER_COUNTRY] }),
    ]);

    const result = await evaluate(deps, { excludedDriverIds: ["WS-0000000021"] });

    expect(result.counts).toEqual({ considered: 4, eligible: 1, returned: 1, excluded: 1 });
  });

  it("never returns more than the limit, and never more than the ruleset maximum", async () => {
    const deps = createHarness();
    seedAll(
      deps,
      Array.from({ length: 25 }, (_unused, index) =>
        candidacyFixture({ driverPublicId: `WS-00000006${index.toString().padStart(2, "0")}` }),
      ),
    );

    expect((await evaluate(deps, { limit: 3 })).candidates).toHaveLength(3);
    // No limit given: the frozen ruleset maximum applies rather than "everything".
    expect((await evaluate(deps)).candidates).toHaveLength(RULESET_V1.maxCandidates);
    // A limit above the maximum cannot raise the ceiling.
    expect((await evaluate(deps, { limit: 200 })).candidates).toHaveLength(
      RULESET_V1.maxCandidates,
    );
  });

  it("does not report a reason code when the limit truncated the list", async () => {
    const deps = createHarness();
    seedAll(deps, [
      candidacyFixture({ driverPublicId: "WS-0000000030" }),
      candidacyFixture({ driverPublicId: "WS-0000000031" }),
    ]);
    const result = await evaluate(deps, { limit: 1 });
    expect(result.emptyReasonCode).toBeNull();
    expect(result.counts.eligible).toBe(2);
    expect(result.counts.returned).toBe(1);
  });

  it("is a pure read: it changes no candidacy row", async () => {
    const deps = createHarness();
    seedAll(deps, [candidacyFixture({ driverPublicId: "WS-0000000040" })]);
    const before = await deps.candidacy.find("WS-0000000040");

    await evaluate(deps);

    expect(await deps.candidacy.find("WS-0000000040")).toEqual(before);
  });
});

describe("an empty result is an answer, not an error", () => {
  it("returns 200-shaped data with the first deficit code and no candidates", async () => {
    const deps = createHarness();
    seedAll(deps, [candidacyFixture({ availabilityState: "offline" })]);

    const result = await evaluate(deps);

    expect(result.candidates).toEqual([]);
    expect(result.emptyReasonCode).toBe("NO_AVAILABLE_DRIVERS");
  });

  it("reports NO_CANDIDACY_ROWS when the projection is empty", async () => {
    const result = await evaluate(createHarness());
    expect(result.emptyReasonCode).toBe("NO_CANDIDACY_ROWS");
    expect(result.counts.considered).toBe(0);
  });

  it("still writes the audit row: an empty answer is a decision too", async () => {
    const deps = createHarness();
    const result = await evaluate(deps);
    const stored = await deps.decisions.find(result.decisionId);
    expect(stored?.emptyReasonCode).toBe("NO_CANDIDACY_ROWS");
    expect(stored?.candidates).toEqual([]);
  });

  it("ignores a driver whose row is stale even though the row still exists", async () => {
    const deps = createHarness();
    seedAll(deps, [candidacyFixture({ updatedAt: "2026-08-21T20:00:00.000Z" })]);
    const result = await evaluate(deps);
    // Fail-closed: "available two hours ago" is not availability information.
    expect(result.emptyReasonCode).toBe("NO_FRESH_CANDIDACY");
  });
});

describe("a caller error stays a caller error", () => {
  it("refuses an unknown pickup zone with 422 instead of blaming zone coverage", async () => {
    const deps = createHarness();
    seedAll(deps, [candidacyFixture()]);

    const error = await evaluate(deps, { pickupZoneId: ZONE_UNKNOWN }).catch(
      (caught: unknown) => caught,
    );

    expect(isMatchingError(error)).toBe(true);
    expect(isMatchingError(error) && error.code).toBe("MATCHING_ZONE_UNKNOWN");
    expect(isMatchingError(error) && error.httpStatus).toBe(422);
  });

  it("writes no audit row when the query is refused", async () => {
    const deps = createHarness();
    await evaluate(deps, { pickupZoneId: ZONE_UNKNOWN }).catch(() => undefined);
    expect(await deps.decisions.count()).toBe(0);
    expect(await deps.outbox.unread()).toHaveLength(0);
  });

  it("refuses a service kind outside the closed list", async () => {
    const error = await evaluate(createHarness(), { orderType: "teleport" }).catch(
      (caught: unknown) => caught,
    );
    expect(isMatchingError(error) && error.code).toBe("MATCHING_SERVICE_KIND_UNKNOWN");
  });

  it("refuses a vehicle class outside the closed list", async () => {
    const error = await evaluate(createHarness(), { vehicleClass: "submarine" }).catch(
      (caught: unknown) => caught,
    );
    expect(isMatchingError(error) && error.code).toBe("MATCHING_VEHICLE_CLASS_UNKNOWN");
  });

  it("refuses a malformed order public id", async () => {
    const error = await evaluate(createHarness(), { orderPublicId: "ORD-1" }).catch(
      (caught: unknown) => caught,
    );
    expect(isMatchingError(error) && error.code).toBe("MATCHING_VALIDATION_FAILED");
  });

  it("refuses a ruleset version that does not exist", async () => {
    const error = await evaluate(createHarness(), { rulesetVersion: 99 }).catch(
      (caught: unknown) => caught,
    );
    expect(isMatchingError(error) && error.code).toBe("MATCHING_RULESET_NOT_FOUND");
  });

  it("refuses to rank with an unfrozen ruleset", async () => {
    const deps = createHarness();
    deps.rulesets.put({ ...RULESET_V1, version: 2, isFrozen: false, frozenAt: null });

    const error = await evaluate(deps, { rulesetVersion: 2 }).catch((caught: unknown) => caught);

    // An editable ruleset makes yesterday's decision unexplainable.
    expect(isMatchingError(error) && error.code).toBe("MATCHING_RULESET_NOT_FROZEN");
  });

  it("refuses to rank with weights that do not sum to one hundred", async () => {
    const deps = createHarness();
    deps.rulesets.put({
      ...RULESET_V1,
      version: 3,
      weights: { ...RULESET_V1.weights, fairness: 50 },
    });

    const error = await evaluate(deps, { rulesetVersion: 3 }).catch((caught: unknown) => caught);

    expect(isMatchingError(error) && error.code).toBe("MATCHING_RULESET_WEIGHTS_INVALID");
  });

  it("refuses a driver id in the exclusion list that is not in the contract shape", async () => {
    const error = await evaluate(createHarness(), { excludedDriverIds: ["driver-7"] }).catch(
      (caught: unknown) => caught,
    );
    expect(isMatchingError(error) && error.code).toBe("MATCHING_VALIDATION_FAILED");
  });
});

describe("the audit row and the event", () => {
  it("stores one decision per evaluation, keyed by a fresh id", async () => {
    const deps = createHarness();
    seedAll(deps, [candidacyFixture({ driverPublicId: "WS-0000000050" })]);

    const first = await evaluate(deps);
    const second = await evaluate(deps);

    expect(first.decisionId).not.toBe(second.decisionId);
    expect(await deps.decisions.count()).toBe(2);
  });

  it("stores the query facts needed to recompute the ranking later", async () => {
    const deps = createHarness();
    seedAll(deps, [candidacyFixture({ driverPublicId: "WS-0000000051" })]);

    const result = await evaluate(deps, { evaluatedAt: NOW, requestedAt: NOW });
    const stored = await deps.decisions.find(result.decisionId);

    expect(stored).toMatchObject({
      orderPublicId: ORDER_PUBLIC_ID,
      orderType: "ride",
      vehicleClass: "sedan",
      pickupZoneId: ZONE_PICKUP,
      rulesetVersion: RULESET_V1.version,
      evaluatedAt: NOW,
      requestedAt: NOW,
    });
    expect(stored?.candidates[0]!.components).toBeDefined();
  });

  it("keeps the dispatch job id for investigation without depending on it", async () => {
    const deps = createHarness();
    const jobId = "22222222-2222-4222-8222-222222222222";
    const result = await evaluate(deps, { dispatchJobId: jobId });
    expect((await deps.decisions.find(result.decisionId))?.dispatchJobId).toBe(jobId);
  });

  it("emits exactly one matching.evaluated event per evaluation", async () => {
    const deps = createHarness();
    await evaluate(deps);
    const events = await deps.outbox.unread();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("matching.evaluated");
  });

  it("emits counts only — never a candidate id or a score", async () => {
    const deps = createHarness();
    seedAll(deps, [candidacyFixture({ driverPublicId: "WS-0000000060" })]);

    await evaluate(deps);
    const payload = JSON.stringify((await deps.outbox.unread())[0]);

    // ADR-011 decision 8: the event says an evaluation happened and how many rows
    // took part. Whoever needs the ranking reads the decision through the audit
    // path — a broadcast ranking is a leak of who is being favoured, to consumers
    // that have no need for it.
    expect(payload).not.toContain("WS-0000000060");
    expect(payload).not.toContain("score_bp");
    expect(payload).not.toContain("candidates");
  });

  it("uses the explicit evaluation clock rather than the service clock", async () => {
    const deps = createHarness();
    const explicit = "2026-08-22T01:30:00.000Z";
    const result = await evaluate(deps, { evaluatedAt: explicit });
    // Fairness is measured as a time difference; a hidden `now()` would make the
    // stored decision impossible to reproduce.
    expect(result.evaluatedAt).toBe(explicit);
  });

  it("is reproducible: the same facts produce the same ranking and scores", async () => {
    const rows = [
      candidacyFixture({ driverPublicId: "WS-0000000070", ordersCompleted: 4 }),
      candidacyFixture({ driverPublicId: "WS-0000000071", zoneIds: [ZONE_SAME_CITY] }),
      candidacyFixture({ driverPublicId: "WS-0000000072", offersReceived: 10, offersAccepted: 9 }),
    ];
    const first = createHarness();
    const second = createHarness();
    seedAll(first, rows);
    seedAll(second, [...rows].reverse());

    const left = await evaluate(first);
    const right = await evaluate(second);

    expect(left.candidates.map((candidate) => [candidate.driverPublicId, candidate.scoreBp])).toEqual(
      right.candidates.map((candidate) => [candidate.driverPublicId, candidate.scoreBp]),
    );
  });
});
