/**
 * Atomicity: a dispatch operation is all-or-nothing (Phase 07 · MR 5a/6).
 *
 * `contracts/schema.sql` §4 promises the event is written in the transaction of the
 * change itself. That promise is only worth something if a failure ANYWHERE in the
 * operation removes ALL of it, and no in-memory test can check that — the in-memory
 * store has no transaction to roll back, so it "passes" by having nothing to undo.
 *
 * The failure this file exists to prevent is specific and permanent. One tick writes a
 * wave row, then an offer row per candidate, then the job's status, then N+2 outbox
 * events. If the wave row committed and the offers did not, the job now has an `open`
 * wave with nothing in it to resolve — and `ux_dispatch_waves_one_open_job` refuses
 * every future wave for that job. The customer waits forever, and no retry fixes it:
 * only a human deleting a row does. That is worse than the original error.
 *
 * The method is to break the LAST step and check the FIRST one is gone. The outbox is
 * wrapped so that a chosen `append` throws after the wave and its offers have already
 * been written; if any adapter opened its own transaction, its write would survive and
 * the assertions below would find it.
 *
 * Skipped when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AnyDispatchEvent } from "../domain/events.js";
import { FixedClock, SequentialIdGenerator, StaticRulesProvider } from "../infrastructure/in-memory.js";
import type { Outbox } from "../ports.js";
import { createDispatchJob } from "../use-cases/create-job.js";
import { tick } from "../use-cases/tick.js";
import type { DispatchSharedDeps } from "../infrastructure/drizzle/transaction.js";
import { driverId, FakeMatching, FakeOrderEngine, orderRef, TEST_RULES, ZONE_ID } from "./harness.js";
import { PG_ENABLED, resetData, setupPostgres, type PgFixture } from "./pg-harness.js";

const POOL = [driverId(1), driverId(2), driverId(3), driverId(4)];

/** A sentinel that cannot be mistaken for a domain error the code might swallow. */
class OutboxExploded extends Error {
  constructor() {
    super("outbox write failed on purpose");
    this.name = "OutboxExploded";
  }
}

/**
 * An outbox that fails on the Nth append and records what it was asked to write.
 *
 * A decorator rather than a subclass: it must wrap whatever transaction-bound outbox
 * the unit of work built, without knowing how that one is constructed.
 */
class ExplodingOutbox implements Outbox {
  readonly attempted: string[] = [];
  private count = 0;

  constructor(
    private readonly inner: Outbox,
    private readonly failOnCall: number,
  ) {}

  async append(event: AnyDispatchEvent): Promise<void> {
    this.count += 1;
    this.attempted.push(event.event_type);
    if (this.count === this.failOnCall) throw new OutboxExploded();
    await this.inner.append(event);
  }

  unread(): Promise<AnyDispatchEvent[]> {
    return this.inner.unread();
  }
}

describe.skipIf(!PG_ENABLED)("dispatch unit of work — atomicity", () => {
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

  /** The non-transactional half of the dependencies, rebuilt per test. */
  function sharedDeps(): DispatchSharedDeps & { matching: FakeMatching; orders: FakeOrderEngine } {
    const matching = new FakeMatching();
    matching.setPool(POOL);
    return {
      matching,
      orders: new FakeOrderEngine(),
      rules: new StaticRulesProvider(TEST_RULES),
      clock: new FixedClock(),
      ids: new SequentialIdGenerator(),
    };
  }

  /** Event ids currently in the outbox, for before/after comparison. */
  async function eventIds(): Promise<string[]> {
    return (await pg.outbox.unread()).map((event) => event.event_id);
  }

  /** Create a job in its own committed transaction, so the tick has work to do. */
  async function seedJob(shared: DispatchSharedDeps & { orders: FakeOrderEngine }): Promise<string> {
    const ref = orderRef(1);
    shared.orders.seedOrder(ref.orderId);
    return pg.unitOfWork.run(shared, async ({ deps }) => {
      const { job } = await createDispatchJob(deps, {
        orderId: ref.orderId,
        orderPublicId: ref.orderPublicId,
        zoneId: ZONE_ID,
        orderType: "ride",
        vehicleClass: "sedan",
        idempotencyKey: "create-key-atomic-1",
      });
      return job.id;
    });
  }

  it("commits the wave, its offers, the status and the events together", async () => {
    // The control case. Without it, a rollback test passes trivially on an adapter
    // that never writes anything at all.
    const shared = sharedDeps();
    const jobId = await seedJob(shared);

    await pg.unitOfWork.run(shared, ({ deps }) => tick(deps));

    expect((await pg.jobs.find(jobId))?.status).toBe("dispatching");
    expect(await pg.waves.countForJob(jobId)).toBe(1);
    expect(await pg.offers.listForJob(jobId)).toHaveLength(TEST_RULES.waveSize);
    expect((await pg.outbox.unread()).length).toBeGreaterThan(TEST_RULES.waveSize);
  });

  it("rolls the whole tick back when the last event fails to append", async () => {
    // The wave row and both offer rows have already been written when the throw
    // happens. Every one of them must be gone.
    const shared = sharedDeps();
    const jobId = await seedJob(shared);
    const before = await pg.jobs.find(jobId);
    // The seed committed its own `dispatch.job_created` event, so "no events" is the
    // wrong assertion: the right one is "not one event MORE than before".
    const baseline = await eventIds();

    let attempted: string[] = [];
    await expect(
      pg.unitOfWork.run(shared, async ({ deps }) => {
        // Fail on the LAST append of the operation, so the maximum amount of work
        // has already succeeded by the time the transaction is doomed. Opening a wave
        // emits one `dispatch.offer_sent` per candidate and then one
        // `dispatch.wave_opened` — the wave event is last on purpose (it carries the
        // final `offer_count`), which makes it the right thing to break.
        const outbox = new ExplodingOutbox(deps.outbox, TEST_RULES.waveSize + 1);
        attempted = outbox.attempted;
        return tick({ ...deps, outbox });
      }),
    ).rejects.toThrow(OutboxExploded);

    // It really did get far enough to matter: both offers were written, and the
    // failure landed on the wave event. Asserting the sequence rather than just a
    // count means a future reordering of the tick's events fails HERE, loudly, instead
    // of silently making this test break an earlier step than intended.
    expect(attempted).toEqual([
      "dispatch.offer_sent",
      "dispatch.offer_sent",
      "dispatch.wave_opened",
    ]);

    expect(await pg.waves.countForJob(jobId)).toBe(0);
    expect(await pg.waves.findOpenForJob(jobId)).toBeNull();
    expect(await pg.offers.listForJob(jobId)).toEqual([]);
    expect(await eventIds()).toEqual(baseline);
    // And the job is untouched — including its status, which the tick had already
    // moved to `dispatching` inside the doomed transaction.
    expect((await pg.jobs.find(jobId))?.status).toBe(before?.status);
    expect((await pg.jobs.find(jobId))?.status).toBe("pending");
  });

  it("leaves no open wave behind — the permanent stall this guards against", async () => {
    // Stated as its own test because it is the actual consequence, not a restatement:
    // after the rollback the job must still be dispatchable. A surviving open wave
    // would make the NEXT tick fail forever with DISPATCH_WAVE_ALREADY_OPEN.
    const shared = sharedDeps();
    const jobId = await seedJob(shared);

    await expect(
      pg.unitOfWork.run(shared, async ({ deps }) =>
        tick({ ...deps, outbox: new ExplodingOutbox(deps.outbox, 2) }),
      ),
    ).rejects.toThrow(OutboxExploded);

    // The retry succeeds, which is the only acceptable outcome of a transient failure.
    const retryShared = sharedDeps();
    retryShared.orders.seedOrder(orderRef(1).orderId);
    const outcome = await pg.unitOfWork.run(retryShared, ({ deps }) => tick(deps));

    expect(outcome.openedWaves).toBe(1);
    expect(await pg.waves.countForJob(jobId)).toBe(1);
    expect((await pg.waves.findOpenForJob(jobId))?.waveNumber).toBe(1);
  });

  it("rolls back the very first write too", async () => {
    // Failing on append #1 leaves only the wave row written. Asserting this
    // separately proves the transaction covers the FIRST statement as well — an
    // adapter that committed eagerly and then joined the transaction would pass the
    // test above and fail this one.
    const shared = sharedDeps();
    const jobId = await seedJob(shared);
    const baseline = await eventIds();

    await expect(
      pg.unitOfWork.run(shared, async ({ deps }) =>
        tick({ ...deps, outbox: new ExplodingOutbox(deps.outbox, 1) }),
      ),
    ).rejects.toThrow(OutboxExploded);

    expect(await pg.waves.countForJob(jobId)).toBe(0);
    expect(await eventIds()).toEqual(baseline);
  });

  it("does not leak a job created inside a rolled-back transaction", async () => {
    // The idempotency memory is written in the same transaction as the job. If it
    // survived a rollback, the retry would be answered as a replay of a job that does
    // not exist — a 200 pointing at nothing.
    const shared = sharedDeps();
    const ref = orderRef(2);
    shared.orders.seedOrder(ref.orderId);

    await expect(
      pg.unitOfWork.run(shared, async ({ deps }) => {
        await createDispatchJob(deps, {
          orderId: ref.orderId,
          orderPublicId: ref.orderPublicId,
          zoneId: ZONE_ID,
          orderType: "ride",
          vehicleClass: "sedan",
          idempotencyKey: "create-key-atomic-2",
        });
        throw new OutboxExploded();
      }),
    ).rejects.toThrow(OutboxExploded);

    expect(await pg.jobs.findByOrderId(ref.orderId)).toBeNull();
    expect(await pg.idempotency.find("create-key-atomic-2")).toBeNull();
  });

  it("reads committed data without a transaction", async () => {
    // The read path exists so a GET does not hold a pooled connection for a
    // consistency guarantee its single JSON response cannot expose.
    const shared = sharedDeps();
    const jobId = await seedJob(shared);
    await pg.unitOfWork.run(shared, ({ deps }) => tick(deps));

    const read = await pg.unitOfWork.read(shared, async (deps) => ({
      job: await deps.jobs.find(jobId),
      offers: await deps.offers.listForJob(jobId),
    }));

    expect(read.job?.status).toBe("dispatching");
    expect(read.offers).toHaveLength(TEST_RULES.waveSize);
  });
});
