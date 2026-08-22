/**
 * Scoring and tie-break.
 *
 * Two properties matter more than any single number here:
 *  - every score is an INTEGER in [0, 10000] (no floating point anywhere), so the
 *    same inputs produce the same ranking on any machine and a stored decision
 *    can be recomputed years later,
 *  - the ordering is TOTAL: shuffling the input cannot change the output.
 */

import { describe, expect, it } from "vitest";

import { BP_SCALE } from "../domain/model.js";
import { RULESET_V1, RULESET_V1_WEIGHTS, weightsSum } from "../domain/ruleset.js";
import {
  ACCEPTANCE_NEUTRAL_BP,
  COMPLETION_SATURATION_ORDERS,
  ZONE_PROXIMITY_BP,
  acceptanceBp,
  compareScored,
  completionBp,
  fairnessBp,
  rankCandidates,
  scoreComponents,
  weightedScoreBp,
  zoneProximityBp,
  zoneProximityTier,
  type ScoredCandidate,
} from "../domain/scoring.js";
import {
  LINEAGES,
  NOW,
  ZONE_OTHER_COUNTRY,
  ZONE_PICKUP,
  ZONE_SAME_CITY,
  ZONE_SAME_COUNTRY,
  ZONE_SAME_DISTRICT,
  ZONE_SAME_REGION,
  candidacyFixture,
} from "./harness.js";

const lineage = (zoneId: string) => {
  const found = LINEAGES.find((item) => item.zoneId === zoneId);
  if (found === undefined) throw new Error(`missing lineage fixture for ${zoneId}`);
  return found;
};

const pickup = lineage(ZONE_PICKUP);

describe("zone proximity ladder", () => {
  it("names the deepest shared level of the hierarchy", () => {
    expect(zoneProximityTier(pickup, lineage(ZONE_PICKUP))).toBe("same_zone");
    expect(zoneProximityTier(pickup, lineage(ZONE_SAME_DISTRICT))).toBe("same_district");
    expect(zoneProximityTier(pickup, lineage(ZONE_SAME_CITY))).toBe("same_city");
    expect(zoneProximityTier(pickup, lineage(ZONE_SAME_REGION))).toBe("same_region");
    expect(zoneProximityTier(pickup, lineage(ZONE_SAME_COUNTRY))).toBe("same_country");
    expect(zoneProximityTier(pickup, lineage(ZONE_OTHER_COUNTRY))).toBeNull();
  });

  it("descends strictly: a shallower level never scores higher", () => {
    const ladder = [
      ZONE_PROXIMITY_BP.same_zone,
      ZONE_PROXIMITY_BP.same_district,
      ZONE_PROXIMITY_BP.same_city,
      ZONE_PROXIMITY_BP.same_region,
      ZONE_PROXIMITY_BP.same_country,
    ];
    expect(ladder).toEqual([...ladder].sort((left, right) => right - left));
    expect(ladder[0]).toBe(BP_SCALE);
  });

  it("takes the best zone a driver serves, not the first or the average", () => {
    const best = zoneProximityBp(pickup, [
      lineage(ZONE_SAME_COUNTRY),
      lineage(ZONE_PICKUP),
      lineage(ZONE_SAME_CITY),
    ]);
    expect(best).toBe(ZONE_PROXIMITY_BP.same_zone);
  });

  it("returns null — not zero — when nothing is shared, so stage 7 removes the row", () => {
    // Zero would leave an unreachable driver in the list, ranked low, and a wave
    // deep enough would eventually offer them the order.
    expect(zoneProximityBp(pickup, [lineage(ZONE_OTHER_COUNTRY)])).toBeNull();
    expect(zoneProximityBp(pickup, [])).toBeNull();
  });
});

describe("completion saturates instead of rewarding seniority forever", () => {
  it("scores zero for a driver who has completed nothing", () => {
    expect(completionBp(candidacyFixture({ ordersCompleted: 0 }))).toBe(0);
  });

  it("reaches full marks exactly at the declared ceiling", () => {
    expect(completionBp(candidacyFixture({ ordersCompleted: COMPLETION_SATURATION_ORDERS }))).toBe(
      BP_SCALE,
    );
  });

  it("does not keep growing past the ceiling", () => {
    expect(completionBp(candidacyFixture({ ordersCompleted: 5_000 }))).toBe(BP_SCALE);
  });

  it("scales linearly below the ceiling", () => {
    expect(completionBp(candidacyFixture({ ordersCompleted: 5 }))).toBe(2_500);
  });
});

describe("acceptance treats no history as neutral", () => {
  it("is neutral, not zero, for a driver never offered anything", () => {
    // Zero would punish the driver for a deficit the system created.
    expect(acceptanceBp(candidacyFixture({ offersReceived: 0, offersAccepted: 0 }))).toBe(
      ACCEPTANCE_NEUTRAL_BP,
    );
  });

  it("is the accepted ratio once there is history", () => {
    expect(acceptanceBp(candidacyFixture({ offersReceived: 4, offersAccepted: 3 }))).toBe(7_500);
    expect(acceptanceBp(candidacyFixture({ offersReceived: 4, offersAccepted: 0 }))).toBe(0);
  });

  it("floors instead of rounding up, so a ratio is never flattered", () => {
    expect(acceptanceBp(candidacyFixture({ offersReceived: 3, offersAccepted: 1 }))).toBe(3_333);
  });

  it("never exceeds full marks even if the counters disagree", () => {
    expect(acceptanceBp(candidacyFixture({ offersReceived: 2, offersAccepted: 9 }))).toBe(BP_SCALE);
  });
});

describe("fairness is capped by the horizon", () => {
  const horizon = RULESET_V1.fairnessHorizonSeconds;

  it("gives full marks to a driver never offered anything", () => {
    expect(fairnessBp(candidacyFixture(), NOW, horizon)).toBe(BP_SCALE);
  });

  it("gives zero to a driver offered at this very instant", () => {
    expect(fairnessBp(candidacyFixture({ lastOfferedAt: NOW }), NOW, horizon)).toBe(0);
  });

  it("reaches full marks at the horizon and stops there", () => {
    const atHorizon = candidacyFixture({ lastOfferedAt: "2026-08-21T23:00:00.000Z" });
    const wayPast = candidacyFixture({ lastOfferedAt: "2026-07-01T00:00:00.000Z" });
    expect(fairnessBp(atHorizon, NOW, horizon)).toBe(BP_SCALE);
    // Without the cap, a driver untouched for a month would outrank everyone
    // forever no matter what else is true about them.
    expect(fairnessBp(wayPast, NOW, horizon)).toBe(BP_SCALE);
  });

  it("uses the most recent of last offered and last assigned", () => {
    const row = candidacyFixture({
      lastOfferedAt: "2026-08-21T23:00:00.000Z",
      lastAssignedAt: "2026-08-21T23:59:00.000Z",
    });
    expect(fairnessBp(row, NOW, horizon)).toBe(Math.floor((60 * BP_SCALE) / horizon));
  });

  it("scales linearly inside the horizon", () => {
    const halfway = candidacyFixture({ lastOfferedAt: "2026-08-21T23:30:00.000Z" });
    expect(fairnessBp(halfway, NOW, horizon)).toBe(5_000);
  });
});

describe("the weighted score is integer arithmetic over declared weights", () => {
  it("keeps the ruleset weights summing to one hundred", () => {
    expect(weightsSum(RULESET_V1_WEIGHTS)).toBe(100);
  });

  it("computes the documented weighted sum", () => {
    const components = {
      zoneProximityBp: BP_SCALE,
      completionBp: 2_500,
      acceptanceBp: ACCEPTANCE_NEUTRAL_BP,
      fairnessBp: BP_SCALE,
    };
    // 40*10000 + 20*2500 + 20*5000 + 20*10000 = 750000 → /100 = 7500
    expect(weightedScoreBp(components, RULESET_V1_WEIGHTS)).toBe(7_500);
  });

  it("stays an integer inside [0, 10000] across the whole input space", () => {
    const values = [0, 1, 3_333, 5_000, 7_777, BP_SCALE];
    for (const zone of values) {
      for (const completion of values) {
        for (const acceptance of values) {
          for (const fairness of values) {
            const score = weightedScoreBp(
              {
                zoneProximityBp: zone,
                completionBp: completion,
                acceptanceBp: acceptance,
                fairnessBp: fairness,
              },
              RULESET_V1_WEIGHTS,
            );
            expect(Number.isInteger(score)).toBe(true);
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(BP_SCALE);
          }
        }
      }
    }
  });

  it("gives a perfect candidate exactly full marks", () => {
    const perfect = {
      zoneProximityBp: BP_SCALE,
      completionBp: BP_SCALE,
      acceptanceBp: BP_SCALE,
      fairnessBp: BP_SCALE,
    };
    expect(weightedScoreBp(perfect, RULESET_V1_WEIGHTS)).toBe(BP_SCALE);
  });

  it("ignores the inputs weighted at zero in version 1", () => {
    // ETA, distance and rating are declared with weight 0 — present in the formula
    // so the code matches the table, but unable to move a score.
    const components = scoreComponents(candidacyFixture(), BP_SCALE, NOW, 3_600);
    expect(Object.keys(components).sort()).toEqual([
      "acceptanceBp",
      "completionBp",
      "fairnessBp",
      "zoneProximityBp",
    ]);
  });
});

describe("tie-break is total and deterministic", () => {
  const scored = (
    driverPublicId: string,
    scoreBp: number,
    lastOfferedAt: string | null,
  ): ScoredCandidate => ({
    candidacy: candidacyFixture({ driverPublicId, lastOfferedAt }),
    scoreBp,
    components: {
      zoneProximityBp: BP_SCALE,
      completionBp: 0,
      acceptanceBp: ACCEPTANCE_NEUTRAL_BP,
      fairnessBp: 0,
    },
  });

  it("orders by score descending", () => {
    const ranked = rankCandidates([scored("WS-0000000002", 100, null), scored("WS-0000000001", 900, null)], 10);
    expect(ranked.map((item) => item.driverPublicId)).toEqual(["WS-0000000001", "WS-0000000002"]);
    expect(ranked.map((item) => item.rank)).toEqual([1, 2]);
    expect(ranked.every((item) => item.tiebreakBy === "score")).toBe(true);
  });

  it("breaks an equal score by the oldest offer, counting never-offered as oldest", () => {
    const ranked = rankCandidates(
      [
        scored("WS-0000000001", 500, "2026-08-21T23:59:00.000Z"),
        scored("WS-0000000002", 500, null),
        scored("WS-0000000003", 500, "2026-08-21T23:00:00.000Z"),
      ],
      10,
    );
    expect(ranked.map((item) => item.driverPublicId)).toEqual([
      "WS-0000000002",
      "WS-0000000003",
      "WS-0000000001",
    ]);
    expect(ranked.map((item) => item.tiebreakBy)).toEqual([
      "last_offered_at",
      "last_offered_at",
      "last_offered_at",
    ]);
  });

  it("falls back to the driver id when score and stamp both tie", () => {
    const ranked = rankCandidates(
      [scored("WS-0000000009", 500, null), scored("WS-0000000004", 500, null)],
      10,
    );
    expect(ranked.map((item) => item.driverPublicId)).toEqual(["WS-0000000004", "WS-0000000009"]);
    expect(ranked.map((item) => item.tiebreakBy)).toEqual([
      "driver_public_id",
      "driver_public_id",
    ]);
  });

  it("produces the same ranking for every permutation of the same set", () => {
    const items = [
      scored("WS-0000000011", 700, null),
      scored("WS-0000000012", 700, "2026-08-21T23:00:00.000Z"),
      scored("WS-0000000013", 900, null),
      scored("WS-0000000014", 700, null),
    ];
    const expected = rankCandidates(items, 10).map((item) => item.driverPublicId);
    const permutations = [
      [3, 2, 1, 0],
      [1, 3, 0, 2],
      [2, 0, 3, 1],
      [0, 2, 3, 1],
    ];
    for (const order of permutations) {
      const shuffled = order.map((index) => items[index]!);
      expect(rankCandidates(shuffled, 10).map((item) => item.driverPublicId)).toEqual(expected);
    }
  });

  it("is antisymmetric, so no two candidates can each outrank the other", () => {
    const left = scored("WS-0000000021", 700, null);
    const right = scored("WS-0000000022", 700, null);
    expect(compareScored(left, right)).toBeLessThan(0);
    expect(compareScored(right, left)).toBeGreaterThan(0);
    expect(compareScored(left, left)).toBeLessThanOrEqual(0);
  });

  it("truncates to the limit while keeping ranks contiguous from one", () => {
    const ranked = rankCandidates(
      [
        scored("WS-0000000031", 900, null),
        scored("WS-0000000032", 800, null),
        scored("WS-0000000033", 700, null),
      ],
      2,
    );
    expect(ranked.map((item) => item.rank)).toEqual([1, 2]);
    expect(ranked.map((item) => item.driverPublicId)).toEqual(["WS-0000000031", "WS-0000000032"]);
  });

  it("returns nothing for a zero or negative limit instead of throwing", () => {
    expect(rankCandidates([scored("WS-0000000041", 900, null)], 0)).toEqual([]);
    expect(rankCandidates([scored("WS-0000000041", 900, null)], -5)).toEqual([]);
  });
});
