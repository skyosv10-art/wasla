/**
 * Port conformance: the in-memory store and the Postgres adapters must be
 * indistinguishable to a use case (Phase 07 · MR 5a/6).
 *
 * The criterion published before this MR was written (HANDOFF §11): *the same
 * use-case tests must pass against the Postgres adapter, and no logic under
 * `src/use-cases/` may change to make them pass.* This file is how that is checked
 * without copying 142 assertions.
 *
 * The method matters. Each scenario below runs TWICE — once with the in-memory
 * harness, once with the Postgres one — and the two results are compared **to each
 * other**, never to a hand-written expectation. That difference is the whole point:
 * an expectation can be quietly edited until it matches whichever adapter is
 * misbehaving, whereas a mutual comparison has nothing to edit. If the two disagree,
 * one of them is wrong and the diff says exactly where.
 *
 * Everything except storage is held identical: the same `FixedClock`, the same
 * `SequentialIdGenerator`, the same `StaticRulesProvider`, the same two fake ports
 * (`createPgHarness` in pg-harness.ts). A suite that also swapped the clock would
 * report differences it had created itself.
 *
 * ONE field is excluded, deliberately and narrowly: `updatedAt`. Postgres owns it
 * through `trg_*_updated_at` (schema.sql §6), so it holds the database's wall clock,
 * while the in-memory store holds the injected 2026-01-01 instant. The trigger is the
 * right design — it makes `updated_at` true even for a hand-written UPDATE during an
 * incident, which is precisely when a row's audit trail is read — and the same choice
 * was made in orders (`setActiveAssignment(_updatedAt)` ignores its argument). The
 * consequence is documented in DISPATCH_PERSISTENCE.md §4. `createdAt`, `expiresAt`,
 * `openedAt`, `offeredAt`, `respondedAt`, `resolvedAt` and `completedAt` are NOT
 * excluded: those are domain time, they come from the injected clock in both
 * adapters, and they must match exactly.
 *
 * Skipped when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { isDispatchError } from "../domain/errors.js";
import type { DispatchJob, DispatchOffer, DispatchWave } from "../domain/model.js";
import type { DispatchDependencies } from "../ports.js";
import { acceptOffer } from "../use-cases/accept-offer.js";
import { cancelDispatchJob } from "../use-cases/cancel-job.js";
import { createDispatchJob } from "../use-cases/create-job.js";
import { rejectOffer } from "../use-cases/reject-offer.js";
import { tick } from "../use-cases/tick.js";
import { createHarness, driverId, orderRef, ZONE_ID, type FakeMatching, type FakeOrderEngine } from "./harness.js";
import type { FixedClock } from "../infrastructure/in-memory.js";
import { createPgHarness, PG_ENABLED, resetData, setupPostgres, type PgFixture } from "./pg-harness.js";

const POOL = [driverId(1), driverId(2), driverId(3), driverId(4), driverId(5), driverId(6)];

/** The parts of a harness a scenario is allowed to touch. */
interface ScenarioHarness {
  readonly deps: DispatchDependencies;
  readonly clock: FixedClock;
  readonly orders: FakeOrderEngine;
  readonly matching: FakeMatching;
}

/**
 * What a scenario reports.
 *
 * Deliberately the whole rows rather than a few chosen fields: a summary would only
 * compare what its author already suspected, and the interesting drift is always in
 * the field nobody thought to include.
 */
interface Trace {
  readonly job: DispatchJob | null;
  readonly waves: readonly DispatchWave[];
  readonly offers: readonly DispatchOffer[];
  readonly events: readonly string[];
  readonly errors: readonly string[];
  readonly extra: Record<string, unknown>;
}

type Scenario = (harness: ScenarioHarness) => Promise<Record<string, unknown>>;

/** Seed an order and create its dispatch job, exactly as the pure suite does. */
async function seed(harness: ScenarioHarness, index = 1): Promise<string> {
  const ref = orderRef(index);
  harness.orders.seedOrder(ref.orderId);
  const { job } = await createDispatchJob(harness.deps, {
    orderId: ref.orderId,
    orderPublicId: ref.orderPublicId,
    zoneId: ZONE_ID,
    orderType: "ride",
    vehicleClass: "sedan",
    idempotencyKey: `create-key-${index}0000`,
  });
  return job.id;
}

/** Run a scenario against one harness and collect everything it produced. */
async function traceOf(harness: ScenarioHarness, scenario: Scenario): Promise<Trace> {
  const errors: string[] = [];
  let extra: Record<string, unknown> = {};
  try {
    extra = await scenario(harness);
  } catch (error) {
    errors.push(isDispatchError(error) ? error.code : `UNTRANSLATED: ${String(error)}`);
  }

  const jobs = await harness.deps.jobs.listActive();
  const jobId = (extra.jobId as string | undefined) ?? jobs[0]?.id;
  const job = jobId === undefined ? null : await harness.deps.jobs.find(jobId);
  const waves = jobId === undefined ? [] : await harness.deps.waves.listForJob(jobId);
  const offers = jobId === undefined ? [] : await harness.deps.offers.listForJob(jobId);
  const events = (await harness.deps.outbox.unread()).map((event) => event.event_type);

  return { job, waves, offers, events, errors, extra };
}

/**
 * Strip only `updated_at`, at every depth, and keep everything else.
 *
 * Written as a recursive key filter rather than `delete row.updatedAt` so a field
 * added to a row later is compared by default. The excluded set must stay exactly one
 * name: every addition to it is a promise the two adapters no longer keep.
 */
const EXCLUDED_KEYS = new Set(["updatedAt"]);

function withoutVolatile<T>(value: T): unknown {
  if (Array.isArray(value)) return value.map((entry) => withoutVolatile(entry));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !EXCLUDED_KEYS.has(key))
        .map(([key, entry]) => [key, withoutVolatile(entry)]),
    );
  }
  return value;
}

describe.skipIf(!PG_ENABLED)("in-memory ports ↔ Postgres ports", () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(async () => {
    await resetData(pg.pool);
  });

  /**
   * The comparison itself.
   *
   * Both traces are asserted non-empty first: two adapters that both did nothing
   * would otherwise "agree" and the test would pass while proving nothing.
   */
  async function expectSameBehaviour(scenario: Scenario): Promise<void> {
    const memory = await traceOf(createHarness(), scenario);
    const postgres = await traceOf(createPgHarness(pg), scenario);

    expect(memory.job).not.toBeNull();
    expect(withoutVolatile(postgres.job)).toEqual(withoutVolatile(memory.job));
    expect(withoutVolatile(postgres.waves)).toEqual(withoutVolatile(memory.waves));
    expect(withoutVolatile(postgres.offers)).toEqual(withoutVolatile(memory.offers));
    expect(postgres.events).toEqual(memory.events);
    expect(postgres.errors).toEqual(memory.errors);
    expect(withoutVolatile(postgres.extra)).toEqual(withoutVolatile(memory.extra));
  }

  it("creates a job identically", async () => {
    await expectSameBehaviour(async (harness) => {
      const jobId = await seed(harness);
      return { jobId };
    });
  });

  it("replays a repeated create with the same key identically", async () => {
    // The idempotency path crosses BOTH stores: the fingerprint memory and the job's
    // own `created_idempotency_key`. If either disagreed, a retry would create a
    // second job on one adapter and not the other.
    await expectSameBehaviour(async (harness) => {
      const ref = orderRef(1);
      harness.orders.seedOrder(ref.orderId);
      const request = {
        orderId: ref.orderId,
        orderPublicId: ref.orderPublicId,
        zoneId: ZONE_ID,
        orderType: "ride" as const,
        vehicleClass: "sedan" as const,
        idempotencyKey: "create-key-replay-1",
      };
      const first = await createDispatchJob(harness.deps, request);
      const second = await createDispatchJob(harness.deps, request);
      return {
        jobId: first.job.id,
        sameJob: first.job.id === second.job.id,
        firstReplayed: first.replayed,
        secondReplayed: second.replayed,
      };
    });
  });

  it("opens wave 1 identically", async () => {
    await expectSameBehaviour(async (harness) => {
      harness.matching.setPool(POOL);
      const jobId = await seed(harness);
      const outcome = await tick(harness.deps);
      return { jobId, outcome };
    });
  });

  it("does nothing on a second tick at the same instant", async () => {
    // The idempotent tick. On Postgres the "do nothing" is partly enforced by
    // `ux_dispatch_waves_one_open_job`; in memory it is an `if`. Both must produce
    // the same counts, or a retried scheduler would double-offer on one of them.
    await expectSameBehaviour(async (harness) => {
      harness.matching.setPool(POOL);
      const jobId = await seed(harness);
      const first = await tick(harness.deps);
      const second = await tick(harness.deps);
      return { jobId, first, second };
    });
  });

  it("times out a wave and opens the next one identically", async () => {
    await expectSameBehaviour(async (harness) => {
      harness.matching.setPool(POOL);
      const jobId = await seed(harness);
      await tick(harness.deps);
      harness.clock.advanceSeconds(31);
      const outcome = await tick(harness.deps);
      return { jobId, outcome };
    });
  });

  it("exhausts the wave budget and escalates identically", async () => {
    // Three waves, then escalation, then exhaustion — the full life of a job nobody
    // accepts. The longest path in the service, and the one where a repository
    // ordering difference would show up as a different wave number.
    await expectSameBehaviour(async (harness) => {
      harness.matching.setPool(POOL);
      const jobId = await seed(harness);
      for (let round = 0; round < 5; round += 1) {
        await tick(harness.deps);
        harness.clock.advanceSeconds(31);
      }
      harness.clock.advanceSeconds(120);
      const outcome = await tick(harness.deps);
      return { jobId, outcome };
    });
  });

  it("accepts an offer identically, including the losers", async () => {
    // `ux_dispatch_offers_one_accepted_job` on one side, a scan on the other. The
    // sibling offers must end `superseded` on both, or one adapter leaves a second
    // driver believing the order is theirs.
    await expectSameBehaviour(async (harness) => {
      harness.matching.setPool(POOL);
      const jobId = await seed(harness);
      await tick(harness.deps);
      const offers = await harness.deps.offers.listForJob(jobId);
      const result = await acceptOffer(harness.deps, {
        offerId: offers[0]!.id,
        idempotencyKey: "accept-key-000001",
      });
      return {
        jobId,
        jobStatus: result.job.status,
        availabilitySynced: result.availabilitySynced,
        replayed: result.replayed,
      };
    });
  });

  it("replays a repeated accept with the same key identically", async () => {
    await expectSameBehaviour(async (harness) => {
      harness.matching.setPool(POOL);
      const jobId = await seed(harness);
      await tick(harness.deps);
      const offers = await harness.deps.offers.listForJob(jobId);
      const input = { offerId: offers[0]!.id, idempotencyKey: "accept-key-000002" };
      const first = await acceptOffer(harness.deps, input);
      const second = await acceptOffer(harness.deps, input);
      return { jobId, firstReplayed: first.replayed, secondReplayed: second.replayed };
    });
  });

  it("rejects an offer identically", async () => {
    await expectSameBehaviour(async (harness) => {
      harness.matching.setPool(POOL);
      const jobId = await seed(harness);
      await tick(harness.deps);
      const offers = await harness.deps.offers.listForJob(jobId);
      const result = await rejectOffer(harness.deps, {
        offerId: offers[0]!.id,
        reasonCode: "DRIVER_DECLINED",
        idempotencyKey: "reject-key-000001",
      });
      return { jobId, offerStatus: result.offer.status, jobStatus: result.job.status };
    });
  });

  it("cancels a job with live offers identically", async () => {
    await expectSameBehaviour(async (harness) => {
      harness.matching.setPool(POOL);
      const jobId = await seed(harness);
      await tick(harness.deps);
      const result = await cancelDispatchJob(harness.deps, {
        jobId,
        reasonCode: "ORDER_CANCELLED",
        idempotencyKey: "cancel-key-000001",
      });
      return { jobId, cancelledOffers: result.cancelledOffers, jobStatus: result.job.status };
    });
  });

  it("refuses an accept on an already-rejected offer identically", async () => {
    // A failure path, compared on the ERROR CODE. Two adapters that both refuse but
    // with different codes would give the driver app two different screens for one
    // situation, and only one of them would be handled.
    await expectSameBehaviour(async (harness) => {
      harness.matching.setPool(POOL);
      const jobId = await seed(harness);
      await tick(harness.deps);
      const offers = await harness.deps.offers.listForJob(jobId);
      await rejectOffer(harness.deps, {
        offerId: offers[0]!.id,
        reasonCode: "DRIVER_DECLINED",
        idempotencyKey: "reject-key-000002",
      });
      await acceptOffer(harness.deps, {
        offerId: offers[0]!.id,
        idempotencyKey: "accept-key-000003",
      });
      return { jobId };
    });
  });

  it("refuses a driver matching already offered, identically", async () => {
    // The exclusion list is built from `listOfferedDriverIds`. If the two adapters
    // ordered or filtered it differently, matching would be asked a different
    // question on each — and `ux_dispatch_offers_job_driver` would answer with a 500
    // on exactly one of them.
    await expectSameBehaviour(async (harness) => {
      harness.matching.setPool([driverId(1), driverId(2)]);
      const jobId = await seed(harness);
      await tick(harness.deps);
      harness.clock.advanceSeconds(31);
      // The pool is exhausted, so the second wave has nobody new to offer.
      const outcome = await tick(harness.deps);
      const excluded = await harness.deps.offers.listOfferedDriverIds(jobId);
      return { jobId, outcome, excluded, requests: harness.matching.requests.length };
    });
  });
});
