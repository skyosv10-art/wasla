/**
 * The transaction boundary, proved by breaking it (Phase 05 · MR 3/6).
 *
 * `PostgresDriverUnitOfWork.run()` claims that one application operation commits as
 * one unit. A test that only ever runs successful operations cannot tell that claim
 * apart from nine independent auto-committing writes: both produce the same rows. The
 * difference is only observable when something fails in the MIDDLE — so this file makes
 * something fail there, on purpose, at a chosen point.
 *
 * The lever is `ExplodingOutbox`, a decorator that forwards every `append` to the real
 * adapter and throws on the Nth one. The outbox is the right place to break because it
 * is written LAST in every operation: everything else has already succeeded, so a
 * commit-anyway bug leaves the most convincing possible mess — a superseded document
 * with no replacement, or an eligibility change matching never hears about.
 *
 * The prefixes this file exists to make impossible:
 *  - a document `superseded` with no replacement row → a driver who lost a verified
 *    paper by submitting a new one,
 *  - a verified document with no eligibility log row → a state change with no
 *    explanation, the one failure this service was built to prevent,
 *  - an eligibility log row with no outbox event → matching never learns the driver
 *    became eligible, and he waits for orders that are never offered,
 *  - a remembered idempotency key with no rows behind it → the retry is answered
 *    "already done" and the work is lost forever. This is the worst of the four,
 *    because it is permanent: there is no later request that repairs it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { registerDriver } from "../use-cases/register-driver.js";
import { registerVehicle } from "../use-cases/manage-vehicles.js";
import { submitDocument } from "../use-cases/manage-documents.js";
import { setServiceZones } from "../use-cases/manage-profile.js";
import type { DriverDependencies, Outbox } from "../ports.js";
import type { DriverDomainEvent } from "../domain/events.js";
import { DRIVER, NOW, ZONE_A } from "./helpers.js";
import { createPgHarness, PG_ENABLED, resetData, setupPostgres, type PgFixture } from "./pg-harness.js";

/** A sentinel, so the test can tell its own explosion from a real failure. */
class OutboxExploded extends Error {
  constructor() {
    super("outbox exploded on purpose");
    this.name = "OutboxExploded";
  }
}

/**
 * Forwards to the real outbox and throws on the Nth append.
 *
 * `attempted` records the event types it saw, which is how a test can assert it broke
 * where it meant to rather than earlier — a decorator that exploded on append #1 when
 * the test wanted #2 would prove a different thing and look identical in the output.
 */
class ExplodingOutbox implements Outbox {
  readonly attempted: string[] = [];
  private calls = 0;

  constructor(
    private readonly inner: Outbox,
    private readonly explodeOn: number,
  ) {}

  async append(event: DriverDomainEvent): Promise<void> {
    this.calls += 1;
    this.attempted.push(event.event_type);
    if (this.calls === this.explodeOn) throw new OutboxExploded();
    await this.inner.append(event);
  }

  async unread(): Promise<DriverDomainEvent[]> {
    return this.inner.unread();
  }
}

describe.skipIf(!PG_ENABLED)("atomicity of one driver operation", () => {
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

  /** Count rows without going through any adapter — the adapters are under test. */
  async function count(table: string): Promise<number> {
    const result = await pg.pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
    return Number(result.rows[0]?.n ?? "0");
  }

  async function counts(): Promise<Record<string, number>> {
    return {
      profiles: await count("driver_profiles"),
      zones: await count("driver_service_zones"),
      vehicles: await count("driver_vehicles"),
      documents: await count("driver_documents"),
      log: await count("driver_eligibility_log"),
      outbox: await count("driver_outbox"),
      idempotency: await count("driver_idempotency"),
    };
  }

  /** A dependency set whose outbox explodes on the Nth append. */
  function withExplodingOutbox(
    deps: DriverDependencies,
    explodeOn: number,
  ): { deps: DriverDependencies; outbox: ExplodingOutbox } {
    const outbox = new ExplodingOutbox(deps.outbox, explodeOn);
    return { deps: { ...deps, outbox }, outbox };
  }

  it("commits a whole registration together (the control)", async () => {
    // Without this case a passing suite could mean "nothing is ever written".
    const { shared } = createPgHarness(pg, NOW);
    await pg.unitOfWork.run(shared, async ({ deps }) => {
      await registerDriver(deps, {
        waslaPublicId: DRIVER,
        displayName: "سائق تجربة",
        serviceKinds: ["ride"],
      });
    });
    const after = await counts();
    expect(after.profiles).toBe(1);
    expect(after.log).toBeGreaterThan(0);
    expect(after.outbox).toBeGreaterThan(0);
  });

  it("rolls the profile back when the outbox fails", async () => {
    // The prefix this prevents: a driver row with no `driver_registered` event, so no
    // downstream service ever learns he exists.
    const { shared } = createPgHarness(pg, NOW);
    const before = await counts();

    const holder: { outbox: ExplodingOutbox | null } = { outbox: null };
    await expect(
      pg.unitOfWork.run(shared, async ({ deps }) => {
        const wrapped = withExplodingOutbox(deps, 1);
        holder.outbox = wrapped.outbox;
        await registerDriver(wrapped.deps, {
          waslaPublicId: DRIVER,
          displayName: "سائق تجربة",
          serviceKinds: ["ride"],
        });
      }),
    ).rejects.toThrow(OutboxExploded);

    expect(holder.outbox?.attempted.length).toBe(1);
    expect(await counts()).toEqual(before);
  });

  it("rolls back the supersede when the LAST append fails", async () => {
    // The worst prefix of all: `submitDocument` supersedes the live copy BEFORE it
    // inserts the replacement (the write order that `ux_driver_documents_one_live_per_type`
    // forces). A commit of the prefix leaves the driver with a superseded paper, no
    // replacement, and no way to tell what happened.
    const { shared } = createPgHarness(pg, NOW);

    await pg.unitOfWork.run(shared, async ({ deps }) => {
      await registerDriver(deps, {
        waslaPublicId: DRIVER,
        displayName: "سائق تجربة",
        serviceKinds: ["ride"],
      });
    });
    const before = await counts();

    // Explode on a high append number so everything before it has run.
    const holder: { outbox: ExplodingOutbox | null } = { outbox: null };
    await expect(
      pg.unitOfWork.run(shared, async ({ deps }) => {
        const wrapped = withExplodingOutbox(deps, 2);
        holder.outbox = wrapped.outbox;
        await submitDocument(wrapped.deps, DRIVER, {
          documentType: "national_id",
          storageRef: "s3://wasla-docs/national_id.pdf",
          idempotencyKey: "doc-atomic-0001",
        });
      }),
    ).rejects.toThrow(OutboxExploded);

    // It broke where it meant to: the document event went through, the recompute's
    // did not.
    expect(holder.outbox?.attempted[0]).toBe("drivers.document_submitted");
    expect(await counts()).toEqual(before);
  });

  it("leaves no idempotency row behind when the operation fails", async () => {
    // The permanent failure. If the key survived a rolled-back operation, the retry
    // would be recognised as a repeat, answered from a row that does not exist, and
    // the vehicle would never be registered — with no later request able to fix it.
    const { shared } = createPgHarness(pg, NOW);

    await pg.unitOfWork.run(shared, async ({ deps }) => {
      await registerDriver(deps, {
        waslaPublicId: DRIVER,
        displayName: "سائق تجربة",
        serviceKinds: ["ride"],
      });
    });

    await expect(
      pg.unitOfWork.run(shared, async ({ deps }) => {
        const wrapped = withExplodingOutbox(deps, 2);
        await registerVehicle(wrapped.deps, DRIVER, {
          vehicleClass: "sedan",
          idempotencyKey: "veh-atomic-0001",
          plateNumber: "ABC-1234",
        });
      }),
    ).rejects.toThrow(OutboxExploded);

    expect(await count("driver_vehicles")).toBe(0);
    expect(await count("driver_idempotency")).toBe(0);
  });

  it("succeeds on the retry after a rolled-back attempt", async () => {
    // Roll-back is only useful if the SAME request can then be replayed. A leftover
    // unique-key row, a half-written vehicle or a stale idempotency entry would all
    // turn the retry into a conflict, and the caller would be stuck.
    const { shared } = createPgHarness(pg, NOW);

    await pg.unitOfWork.run(shared, async ({ deps }) => {
      await registerDriver(deps, {
        waslaPublicId: DRIVER,
        displayName: "سائق تجربة",
        serviceKinds: ["ride"],
      });
      await setServiceZones(deps, DRIVER, { zones: [{ zoneId: ZONE_A, preferenceRank: 1 }] });
    });

    await expect(
      pg.unitOfWork.run(shared, async ({ deps }) => {
        const wrapped = withExplodingOutbox(deps, 1);
        await registerVehicle(wrapped.deps, DRIVER, {
          vehicleClass: "sedan",
          idempotencyKey: "veh-atomic-0001",
          plateNumber: "ABC-1234",
        });
      }),
    ).rejects.toThrow(OutboxExploded);

    const vehicle = await pg.unitOfWork.run(shared, async ({ deps }) =>
      registerVehicle(deps, DRIVER, {
        vehicleClass: "sedan",
        idempotencyKey: "veh-atomic-0001",
        plateNumber: "ABC-1234",
      }),
    );
    expect(vehicle.isPrimary).toBe(true);
    expect(await count("driver_vehicles")).toBe(1);
    expect(await count("driver_idempotency")).toBe(1);
  });

  it("reads committed data through read() with no transaction", async () => {
    // `read()` is the counterpart of `run()`: wrapping a GET in BEGIN/COMMIT costs a
    // round trip and holds a snapshot for no reader's benefit. It must still see
    // everything a committed write left.
    const { shared } = createPgHarness(pg, NOW);

    await pg.unitOfWork.run(shared, async ({ deps }) => {
      await registerDriver(deps, {
        waslaPublicId: DRIVER,
        displayName: "سائق تجربة",
        serviceKinds: ["ride"],
      });
    });

    const profile = await pg.unitOfWork.read(shared, async ({ deps }) =>
      deps.profiles.find(DRIVER),
    );
    expect(profile?.waslaPublicId).toBe(DRIVER);
  });
});
