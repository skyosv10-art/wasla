/**
 * Atomicity: the reason the unit of work exists.
 *
 * Every write use case performs THREE writes — the row, the idempotency key, the
 * event — and all three are separate `await`s. Without one transaction around
 * them, a crash between the second and the third leaves a candidacy that was
 * changed, a key that says "already handled", and no event: the retry is refused
 * as a duplicate and the change is never published. That is silent, permanent
 * divergence between this service and every consumer, and it is invisible in
 * unit tests because in-memory adapters cannot fail halfway.
 *
 * These tests force the failure. The last write is made to throw, and then the
 * database is inspected DIRECTLY (raw SQL, not the repositories) to assert that
 * nothing at all survived — because a repository read inside a rolled-back
 * transaction could otherwise be fooled by its own snapshot.
 *
 * Skipped when DATABASE_URL is unset.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  FixedClock,
  InMemoryZoneHierarchy,
  SequentialIdGenerator,
} from "../infrastructure/in-memory.js";
import { PostgresMatchingUnitOfWork } from "../infrastructure/drizzle/transaction.js";
import type { MatchingSharedDeps } from "../infrastructure/drizzle/transaction.js";
import { changeAvailability, upsertCandidacy } from "../use-cases/manage-candidacy.js";
import { candidacyFixture, LINEAGES, NOW, ZONE_PICKUP } from "./harness.js";
import { PG_ENABLED, resetData, setupPostgres, type PgFixture } from "./pg-harness.js";

const DRIVER = "WS-7000000001";
const KEY = "key-atomicity-01";

const BOOM = new Error("simulated outbox failure");

describe.skipIf(!PG_ENABLED)("unit-of-work atomicity", () => {
  let pg: PgFixture;
  let shared: MatchingSharedDeps;
  let unitOfWork: PostgresMatchingUnitOfWork;

  beforeEach(async () => {
    pg ??= await setupPostgres();
    await resetData(pg.pool);
    shared = {
      zones: new InMemoryZoneHierarchy(LINEAGES),
      clock: new FixedClock(NOW),
      ids: new SequentialIdGenerator(),
    };
    unitOfWork = new PostgresMatchingUnitOfWork(pg.db);
  });

  afterAll(async () => {
    await pg?.close();
  });

  /** Rows the three writes of a use case would have produced. */
  async function survivors(): Promise<{
    candidacy: number;
    keys: number;
    events: number;
  }> {
    const [candidacy, keys, events] = await Promise.all([
      pg.pool.query("SELECT 1 FROM driver_candidacy WHERE driver_public_id = $1", [DRIVER]),
      pg.pool.query("SELECT 1 FROM matching_idempotency WHERE idempotency_key = $1", [KEY]),
      pg.pool.query("SELECT 1 FROM matching_outbox"),
    ]);
    return {
      candidacy: candidacy.rowCount ?? 0,
      keys: keys.rowCount ?? 0,
      events: events.rowCount ?? 0,
    };
  }

  it("commits the row, the key and the event together", async () => {
    await unitOfWork.run(shared, ({ deps }) =>
      upsertCandidacy(deps, {
        driverPublicId: DRIVER,
        availabilityState: "available",
        eligibilityState: "eligible",
        serviceKinds: ["ride"],
        vehicleClass: "sedan",
        zoneIds: [ZONE_PICKUP],
        idempotencyKey: KEY,
      }),
    );
    expect(await survivors()).toEqual({ candidacy: 1, keys: 1, events: 1 });
  });

  it("rolls back the row and the key when the event append fails", async () => {
    await expect(
      unitOfWork.run(shared, async ({ deps }) => {
        // The event is appended last, so failing it is the exact crash window the
        // transaction is meant to close.
        deps.outbox.append = () => Promise.reject(BOOM);
        return upsertCandidacy(deps, {
          driverPublicId: DRIVER,
          availabilityState: "available",
          eligibilityState: "eligible",
          serviceKinds: ["ride"],
          vehicleClass: "sedan",
          zoneIds: [ZONE_PICKUP],
          idempotencyKey: KEY,
        });
      }),
    ).rejects.toThrow(BOOM);

    // Nothing at all: no half-applied change, and above all no leftover key that
    // would make the client's retry look like a duplicate.
    expect(await survivors()).toEqual({ candidacy: 0, keys: 0, events: 0 });
  });

  it("leaves an existing row exactly as it was when a later write fails", async () => {
    const original = candidacyFixture({
      driverPublicId: DRIVER,
      availabilityState: "available",
      offersReceived: 4,
      offersAccepted: 2,
      ordersCompleted: 1,
    });
    await pg.candidacy.seed(original);

    await expect(
      unitOfWork.run(shared, async ({ deps }) => {
        deps.outbox.append = () => Promise.reject(BOOM);
        return changeAvailability(deps, {
          driverPublicId: DRIVER,
          availabilityState: "busy",
          reasonCode: "OFFER_ACCEPTED",
          idempotencyKey: KEY,
        });
      }),
    ).rejects.toThrow(BOOM);

    expect(await pg.candidacy.find(DRIVER)).toEqual(original);
    expect((await survivors()).keys).toBe(0);
  });

  it("keeps a failed transaction from affecting a later successful one", async () => {
    // A pool connection that stayed inside an aborted transaction would fail every
    // subsequent statement with "current transaction is aborted"; this asserts the
    // connection is released clean.
    await expect(
      unitOfWork.run(shared, async ({ deps }) => {
        deps.outbox.append = () => Promise.reject(BOOM);
        return upsertCandidacy(deps, {
          driverPublicId: DRIVER,
          availabilityState: "available",
          eligibilityState: "eligible",
          serviceKinds: ["ride"],
          vehicleClass: "sedan",
          zoneIds: [ZONE_PICKUP],
          idempotencyKey: KEY,
        });
      }),
    ).rejects.toThrow(BOOM);

    const stored = await unitOfWork.run(shared, ({ deps }) =>
      upsertCandidacy(deps, {
        driverPublicId: DRIVER,
        availabilityState: "available",
        eligibilityState: "eligible",
        serviceKinds: ["ride"],
        vehicleClass: "sedan",
        zoneIds: [ZONE_PICKUP],
        idempotencyKey: KEY,
      }),
    );
    expect(stored.driverPublicId).toBe(DRIVER);
    expect(await survivors()).toEqual({ candidacy: 1, keys: 1, events: 1 });
  });

  it("does not hold a transaction open for a read", async () => {
    // `read()` runs on the root connection precisely so a long-running audit query
    // cannot pin a transaction and block writers.
    await pg.candidacy.seed(candidacyFixture({ driverPublicId: DRIVER }));
    const found = await unitOfWork.read(shared, (deps) => deps.candidacy.find(DRIVER));
    expect(found?.driverPublicId).toBe(DRIVER);

    const idle = await pg.pool.query<{ state: string }>(
      "SELECT state FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'",
    );
    expect(idle.rowCount).toBe(0);
  });
});
