/**
 * Port conformance: the SAME scenarios, twice, once per adapter.
 *
 * This file is the proof of the binding criterion of MR 3/6, inherited from
 * Phase 06 (ORDER_PERSISTENCE.md): **the Postgres adapters make the use cases
 * behave identically to the in-memory ones, with no change to `src/use-cases/`.**
 * Nothing under `src/use-cases/` was touched by this MR, and this suite is what
 * makes that claim checkable instead of decorative.
 *
 * The method matters: each scenario is written ONCE and executed against both
 * adapter sets, and the two results are compared TO EACH OTHER — not to a
 * hand-written expectation. A hand-written expectation drifts to whatever the
 * newer adapter does; comparing the two adapters cannot, because the day they
 * disagree the comparison is what fails.
 *
 * Two dependencies stay in memory in both runs, on purpose:
 *  - `zones` is a port onto the geography SERVICE (ADR-006). Its production
 *    adapter is an HTTP client and arrives in MR 5/6; putting a database behind
 *    it here would test a coupling the architecture forbids.
 *  - `clock` and `ids` are fixed, because a scenario whose output contains
 *    `Date.now()` cannot be compared with anything, including itself.
 *
 * Driver ids are literal constants rather than the shared counter of harness.ts:
 * a counter would give the second run different ids and the comparison would
 * fail on the ids instead of on the behavior.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { MatchingError } from "../domain/errors.js";
import type { Candidacy } from "../domain/model.js";
import {
  FixedClock,
  InMemoryZoneHierarchy,
  SequentialIdGenerator,
  createInMemoryDependencies,
} from "../infrastructure/in-memory.js";
import { bindMatchingAdapters } from "../infrastructure/drizzle/transaction.js";
import type { MatchingDependencies } from "../ports.js";
import {
  changeAvailability,
  readCandidacy,
  upsertCandidacy,
} from "../use-cases/manage-candidacy.js";
import { evaluateCandidates } from "../use-cases/evaluate-candidates.js";
import { listRulesets, readDecision } from "../use-cases/read-audit.js";
import {
  LINEAGES,
  NOW,
  ORDER_ID,
  ORDER_PUBLIC_ID,
  ZONE_OTHER_COUNTRY,
  ZONE_PICKUP,
  ZONE_SAME_CITY,
  candidacyFixture,
} from "./harness.js";
import { PG_ENABLED, resetData, setupPostgres, type PgFixture } from "./pg-harness.js";

const DRIVER_A = "WS-9000000001";
const DRIVER_B = "WS-9000000002";
const DRIVER_C = "WS-9000000003";

/** Everything a scenario may do to the world, whichever adapter is underneath. */
interface Bench {
  readonly deps: MatchingDependencies;
  /** Seed the history columns the service owns — outside the port in both adapters. */
  seed(rows: readonly Candidacy[]): Promise<void>;
  /** Unpublished events, in append order. */
  events(): Promise<unknown[]>;
  advanceSeconds(seconds: number): void;
}

type Scenario = (bench: Bench) => Promise<unknown>;

/** The error code a scenario failed with — never the Arabic message copy. */
async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "NO_ERROR";
  } catch (error) {
    return error instanceof MatchingError ? error.code : `UNEXPECTED:${String(error)}`;
  }
}

// --------------------------------------------------------------------------- //
// The scenarios — written once, run twice                                    //
// --------------------------------------------------------------------------- //

const SCENARIOS: ReadonlyArray<{ name: string; run: Scenario }> = [
  {
    name: "a full replacement stores the row and appends exactly one event",
    run: async ({ deps, events }) => {
      const stored = await upsertCandidacy(deps, {
        driverPublicId: DRIVER_A,
        availabilityState: "available",
        eligibilityState: "eligible",
        serviceKinds: ["ride", "delivery"],
        vehicleClass: "sedan",
        zoneIds: [ZONE_PICKUP, ZONE_SAME_CITY],
        idempotencyKey: "key-upsert-0001",
      });
      return { stored, events: await events() };
    },
  },
  {
    name: "the same key with the same payload is a retry: same row, no second event",
    run: async ({ deps, events }) => {
      const request = {
        driverPublicId: DRIVER_A,
        availabilityState: "available",
        eligibilityState: "eligible",
        serviceKinds: ["ride"] as const,
        vehicleClass: "sedan",
        zoneIds: [ZONE_PICKUP],
        idempotencyKey: "key-retry-0001",
      };
      const first = await upsertCandidacy(deps, request);
      const second = await upsertCandidacy(deps, request);
      return { first, second, events: await events() };
    },
  },
  {
    name: "the same key with a different payload is refused with 409",
    run: async ({ deps, events }) => {
      await upsertCandidacy(deps, {
        driverPublicId: DRIVER_A,
        availabilityState: "available",
        eligibilityState: "eligible",
        serviceKinds: ["ride"],
        vehicleClass: "sedan",
        zoneIds: [ZONE_PICKUP],
        idempotencyKey: "key-conflict-001",
      });
      const code = await codeOf(() =>
        upsertCandidacy(deps, {
          driverPublicId: DRIVER_A,
          availabilityState: "offline",
          eligibilityState: "eligible",
          serviceKinds: ["ride"],
          vehicleClass: "sedan",
          zoneIds: [ZONE_PICKUP],
          idempotencyKey: "key-conflict-001",
        }),
      );
      return { code, events: (await events()).length };
    },
  },
  {
    name: "a replacement keeps created_at and the matching history the writer does not own",
    run: async ({ deps, seed }) => {
      await seed([
        candidacyFixture({
          driverPublicId: DRIVER_B,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          lastOfferedAt: "2026-08-10T00:00:00.000Z",
          lastAssignedAt: "2026-08-11T00:00:00.000Z",
          offersReceived: 10,
          offersAccepted: 7,
          ordersCompleted: 5,
        }),
      ]);
      const replaced = await upsertCandidacy(deps, {
        driverPublicId: DRIVER_B,
        availabilityState: "busy",
        eligibilityState: "eligible",
        serviceKinds: ["delivery"],
        vehicleClass: "van",
        zoneIds: [ZONE_SAME_CITY],
        idempotencyKey: "key-replace-001",
      });
      return replaced;
    },
  },
  {
    name: "availability on a missing row is 404, never an implicit create",
    run: async ({ deps }) => {
      const code = await codeOf(() =>
        changeAvailability(deps, {
          driverPublicId: DRIVER_C,
          availabilityState: "available",
          idempotencyKey: "key-avail-0001",
        }),
      );
      const found = await deps.candidacy.find(DRIVER_C);
      return { code, found };
    },
  },
  {
    name: "a real availability change emits both states; a repeated one emits nothing",
    run: async ({ deps, seed, events }) => {
      await seed([candidacyFixture({ driverPublicId: DRIVER_A, availabilityState: "available" })]);
      const changed = await changeAvailability(deps, {
        driverPublicId: DRIVER_A,
        availabilityState: "busy",
        reasonCode: "OFFER_ACCEPTED",
        idempotencyKey: "key-avail-0002",
      });
      const repeated = await changeAvailability(deps, {
        driverPublicId: DRIVER_A,
        availabilityState: "busy",
        reasonCode: "OFFER_ACCEPTED",
        idempotencyKey: "key-avail-0003",
      });
      return { changed, repeated, events: await events() };
    },
  },
  {
    name: "freshness is computed from the clock, never stored",
    run: async ({ deps, seed, advanceSeconds }) => {
      await seed([candidacyFixture({ driverPublicId: DRIVER_A })]);
      const fresh = await readCandidacy(deps, DRIVER_A);
      advanceSeconds(601);
      const stale = await readCandidacy(deps, DRIVER_A);
      return { fresh: fresh.isFresh, stale: stale.isFresh, updatedAt: stale.updatedAt };
    },
  },
  {
    name: "an evaluation ranks, writes one audit row and appends one counts-only event",
    run: async ({ deps, seed, events }) => {
      await seed([
        candidacyFixture({
          driverPublicId: DRIVER_A,
          zoneIds: [ZONE_PICKUP],
          offersReceived: 10,
          offersAccepted: 9,
          ordersCompleted: 20,
        }),
        candidacyFixture({
          driverPublicId: DRIVER_B,
          zoneIds: [ZONE_SAME_CITY],
          offersReceived: 10,
          offersAccepted: 5,
          ordersCompleted: 4,
        }),
        candidacyFixture({
          driverPublicId: DRIVER_C,
          zoneIds: [ZONE_OTHER_COUNTRY],
        }),
      ]);
      const result = await evaluateCandidates(deps, {
        orderId: ORDER_ID,
        orderPublicId: ORDER_PUBLIC_ID,
        orderType: "ride",
        vehicleClass: "sedan",
        pickupZoneId: ZONE_PICKUP,
      });
      const readBack = await readDecision(deps, result.decisionId);
      return {
        candidates: result.candidates,
        counts: result.counts,
        emptyReasonCode: result.emptyReasonCode,
        readBack,
        events: await events(),
      };
    },
  },
  {
    name: "an empty result is a decision with a reason code, not an error",
    run: async ({ deps, events }) => {
      const result = await evaluateCandidates(deps, {
        orderId: ORDER_ID,
        orderPublicId: ORDER_PUBLIC_ID,
        orderType: "ride",
        vehicleClass: "sedan",
        pickupZoneId: ZONE_PICKUP,
      });
      const readBack = await readDecision(deps, result.decisionId);
      return {
        counts: result.counts,
        emptyReasonCode: result.emptyReasonCode,
        candidates: readBack.candidates,
        events: await events(),
      };
    },
  },
  {
    name: "an unknown decision id is 404, because decisions are never deleted",
    run: async ({ deps }) => ({
      code: await codeOf(() =>
        readDecision(deps, "11111111-2222-4333-8444-555555555555"),
      ),
    }),
  },
  {
    name: "the ruleset catalogue reports version 1 frozen, with its weights",
    run: async ({ deps }) => {
      const rulesets = await listRulesets(deps);
      // Timestamps are deliberately excluded: the seeded row gets its real
      // `created_at`/`frozen_at` from now() in the database, while the domain copy
      // carries an epoch sentinel. The NUMBERS are what change a ranking.
      return rulesets.map((ruleset) => ({
        version: ruleset.version,
        label: ruleset.label,
        weights: ruleset.weights,
        candidacyFreshnessSeconds: ruleset.candidacyFreshnessSeconds,
        maxCandidates: ruleset.maxCandidates,
        fairnessHorizonSeconds: ruleset.fairnessHorizonSeconds,
        isFrozen: ruleset.isFrozen,
      }));
    },
  },
];

// --------------------------------------------------------------------------- //
// The two benches                                                            //
// --------------------------------------------------------------------------- //

function memoryBench(): Bench {
  const deps = createInMemoryDependencies({ now: NOW, lineages: LINEAGES });
  return {
    deps,
    seed: async (rows) => {
      for (const row of rows) deps.candidacy.seed(row);
    },
    events: () => deps.outbox.unread() as Promise<unknown[]>,
    advanceSeconds: (seconds) => deps.clock.advanceSeconds(seconds),
  };
}

function postgresBench(fixture: PgFixture): Bench {
  const clock = new FixedClock(NOW);
  const deps = bindMatchingAdapters(fixture.db, {
    zones: new InMemoryZoneHierarchy(LINEAGES),
    clock,
    ids: new SequentialIdGenerator(),
  });
  return {
    deps,
    seed: async (rows) => {
      for (const row of rows) await deps.candidacy.seed(row);
    },
    events: () => deps.outbox.unread() as Promise<unknown[]>,
    advanceSeconds: (seconds) => clock.advanceSeconds(seconds),
  };
}

describe.skipIf(!PG_ENABLED)("port conformance: in-memory ↔ Postgres", () => {
  let fixture: PgFixture;

  beforeEach(async () => {
    fixture ??= await setupPostgres();
    await resetData(fixture.pool);
  });

  afterAll(async () => {
    await fixture?.close();
  });

  it.each(SCENARIOS)("$name", async ({ run }) => {
    const fromMemory = await run(memoryBench());
    const fromPostgres = await run(postgresBench(fixture));
    expect(fromPostgres).toEqual(fromMemory);
  });
});
