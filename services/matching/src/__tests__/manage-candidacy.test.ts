/**
 * Candidacy writes: replacement semantics, idempotency, and the freshness stamp.
 *
 * The three rules being defended are the ones whose absence is invisible until it
 * has already caused damage: a merged projection (a row nobody declared), a
 * reused idempotency key (a silent overwrite of someone else's row), and a
 * caller-supplied `updated_at` (a stale driver looking fresh and winning offers).
 */

import { describe, expect, it } from "vitest";

import { isMatchingError } from "../domain/errors.js";
import { RULESET_V1 } from "../domain/ruleset.js";
import {
  changeAvailability,
  readCandidacy,
  upsertCandidacy,
} from "../use-cases/manage-candidacy.js";
import { listRulesets, readDecision } from "../use-cases/read-audit.js";
import {
  ZONE_PICKUP,
  ZONE_SAME_CITY,
  ZONE_UNKNOWN,
  createHarness,
} from "./harness.js";

const DRIVER = "WS-0000000777";

const upsertRequest = (overrides: Record<string, unknown> = {}) => ({
  driverPublicId: DRIVER,
  availabilityState: "available",
  eligibilityState: "eligible",
  eligibilitySource: "claimed",
  serviceKinds: ["ride"],
  vehicleClass: "sedan",
  zoneIds: [ZONE_PICKUP],
  actorType: "driver_bot",
  idempotencyKey: "idem-upsert-0001",
  ...overrides,
});

describe("upserting a candidacy replaces the row", () => {
  it("creates the row and stamps updated_at from the service clock", async () => {
    const deps = createHarness();
    const stored = await upsertCandidacy(deps, upsertRequest() as never);

    expect(stored.driverPublicId).toBe(DRIVER);
    expect(stored.updatedAt).toBe(deps.clock.now());
    expect(stored.updatedBy).toBe("driver_bot");
  });

  it("replaces the declared fields wholesale rather than merging them", async () => {
    const deps = createHarness();
    await upsertCandidacy(deps, upsertRequest() as never);

    const replaced = await upsertCandidacy(
      deps,
      upsertRequest({
        serviceKinds: ["delivery"],
        zoneIds: [ZONE_SAME_CITY],
        idempotencyKey: "idem-upsert-0002",
      }) as never,
    );

    // A merge would leave `ride` and the old zone in place — a combination nobody
    // declared, indistinguishable afterwards from a row somebody meant.
    expect(replaced.serviceKinds).toEqual(["delivery"]);
    expect(replaced.zoneIds).toEqual([ZONE_SAME_CITY]);
  });

  it("keeps the matching history the writer does not own", async () => {
    const deps = createHarness();
    await upsertCandidacy(deps, upsertRequest() as never);
    deps.candidacy.seed({
      ...(await deps.candidacy.find(DRIVER))!,
      offersReceived: 7,
      offersAccepted: 5,
      ordersCompleted: 3,
      lastOfferedAt: "2026-08-21T23:00:00.000Z",
    });

    const replaced = await upsertCandidacy(
      deps,
      upsertRequest({ idempotencyKey: "idem-upsert-0003" }) as never,
    );

    // The bot declares availability and coverage; it does not get to reset the
    // driver's record by sending a routine heartbeat.
    expect(replaced.offersReceived).toBe(7);
    expect(replaced.offersAccepted).toBe(5);
    expect(replaced.ordersCompleted).toBe(3);
    expect(replaced.lastOfferedAt).toBe("2026-08-21T23:00:00.000Z");
  });

  it("emits one candidacy_updated event per accepted write", async () => {
    const deps = createHarness();
    await upsertCandidacy(deps, upsertRequest() as never);
    const events = await deps.outbox.unread();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("matching.candidacy_updated");
  });

  it("refuses a zone the hierarchy does not know", async () => {
    const deps = createHarness();
    const error = await upsertCandidacy(deps, upsertRequest({ zoneIds: [ZONE_UNKNOWN] }) as never).catch(
      (caught: unknown) => caught,
    );
    // A row claiming coverage nobody can resolve would silently match nothing, and
    // the driver would never learn why no offer ever arrives.
    expect(isMatchingError(error) && error.code).toBe("MATCHING_ZONE_UNKNOWN");
    expect(await deps.candidacy.find(DRIVER)).toBeNull();
  });

  it("refuses an empty service kind list", async () => {
    const error = await upsertCandidacy(
      createHarness(),
      upsertRequest({ serviceKinds: [] }) as never,
    ).catch((caught: unknown) => caught);
    expect(isMatchingError(error) && error.code).toBe("MATCHING_VALIDATION_FAILED");
  });

  it("refuses a driver id outside the contract shape", async () => {
    const error = await upsertCandidacy(
      createHarness(),
      upsertRequest({ driverPublicId: "WS-123" }) as never,
    ).catch((caught: unknown) => caught);
    expect(isMatchingError(error) && error.code).toBe("MATCHING_VALIDATION_FAILED");
  });

  it("records who wrote the row from the actor, not from the caller's claim", async () => {
    const deps = createHarness();
    const stored = await upsertCandidacy(deps, upsertRequest({ actorType: "admin" }) as never);
    expect(stored.updatedBy).toBe("admin");
  });
});

describe("idempotency on writes", () => {
  it("returns the stored row for a retry with the same key and payload", async () => {
    const deps = createHarness();
    const first = await upsertCandidacy(deps, upsertRequest() as never);
    const retry = await upsertCandidacy(deps, upsertRequest() as never);

    expect(retry).toEqual(first);
    // A retry is one write, so it is also one event.
    expect(await deps.outbox.unread()).toHaveLength(1);
  });

  it("refuses the same key with a different payload", async () => {
    const deps = createHarness();
    await upsertCandidacy(deps, upsertRequest() as never);

    const error = await upsertCandidacy(
      deps,
      upsertRequest({ availabilityState: "offline" }) as never,
    ).catch((caught: unknown) => caught);

    // Accepting it would overwrite one driver's row with another request's meaning.
    expect(isMatchingError(error) && error.code).toBe("MATCHING_IDEMPOTENCY_KEY_REUSED");
    expect(isMatchingError(error) && error.httpStatus).toBe(409);
  });

  it("treats an absent or blank key as a missing key", async () => {
    const deps = createHarness();
    for (const key of ["", " ".repeat(10), undefined]) {
      const error = await upsertCandidacy(deps, upsertRequest({ idempotencyKey: key }) as never).catch(
        (caught: unknown) => caught,
      );
      // Ten spaces is not an identity: accepting it would make every such request
      // a retry of the first one, whatever it actually asked for.
      expect(isMatchingError(error) && error.code).toBe("MATCHING_IDEMPOTENCY_KEY_REQUIRED");
    }
  });

  it("refuses a key too short to be unique", async () => {
    const error = await upsertCandidacy(
      createHarness(),
      upsertRequest({ idempotencyKey: "short" }) as never,
    ).catch((caught: unknown) => caught);
    expect(isMatchingError(error) && error.code).toBe("MATCHING_VALIDATION_FAILED");
  });

  it("does not confuse the same key across the two write paths", async () => {
    const deps = createHarness();
    await upsertCandidacy(deps, upsertRequest() as never);
    const error = await changeAvailability(deps, {
      driverPublicId: DRIVER,
      availabilityState: "busy",
      idempotencyKey: "idem-upsert-0001",
    } as never).catch((caught: unknown) => caught);
    // Same key, different meaning: refused rather than silently treated as a retry.
    expect(isMatchingError(error) && error.code).toBe("MATCHING_IDEMPOTENCY_KEY_REUSED");
  });
});

describe("changing availability", () => {
  it("moves the state and emits both states", async () => {
    const deps = createHarness();
    await upsertCandidacy(deps, upsertRequest() as never);

    const changed = await changeAvailability(deps, {
      driverPublicId: DRIVER,
      availabilityState: "busy",
      actorType: "driver_bot",
      reasonCode: "DRIVER_MANUAL",
      idempotencyKey: "idem-avail-0001",
    } as never);

    expect(changed.availabilityState).toBe("busy");
    const event = (await deps.outbox.unread()).at(-1)!;
    expect(event.event_type).toBe("matching.availability_changed");
    expect(event.data).toMatchObject({ from_state: "available", to_state: "busy" });
  });

  it("refuses a driver with no candidacy row instead of creating one", async () => {
    const deps = createHarness();
    const error = await changeAvailability(deps, {
      driverPublicId: DRIVER,
      availabilityState: "available",
      idempotencyKey: "idem-avail-0002",
    } as never).catch((caught: unknown) => caught);

    // An implicit create would produce a candidate with no eligibility and no
    // zones — the "unknown is a candidate" failure the whole model forbids.
    expect(isMatchingError(error) && error.code).toBe("MATCHING_CANDIDACY_NOT_FOUND");
    expect(isMatchingError(error) && error.httpStatus).toBe(404);
  });

  it("accepts a no-op change without emitting a second event", async () => {
    const deps = createHarness();
    await upsertCandidacy(deps, upsertRequest() as never);

    const same = await changeAvailability(deps, {
      driverPublicId: DRIVER,
      availabilityState: "available",
      idempotencyKey: "idem-avail-0003",
    } as never);

    expect(same.availabilityState).toBe("available");
    expect((await deps.outbox.unread()).filter((event) =>
      event.event_type === "matching.availability_changed",
    )).toHaveLength(0);
  });

  it("refreshes the freshness stamp, because a declaration is also a heartbeat", async () => {
    const deps = createHarness();
    await upsertCandidacy(deps, upsertRequest() as never);
    deps.clock.advanceSeconds(60);

    const changed = await changeAvailability(deps, {
      driverPublicId: DRIVER,
      availabilityState: "busy",
      idempotencyKey: "idem-avail-0004",
    } as never);

    expect(changed.updatedAt).toBe(deps.clock.now());
  });

  it("refuses a state outside the closed list", async () => {
    const deps = createHarness();
    await upsertCandidacy(deps, upsertRequest() as never);
    const error = await changeAvailability(deps, {
      driverPublicId: DRIVER,
      availabilityState: "napping",
      idempotencyKey: "idem-avail-0005",
    } as never).catch((caught: unknown) => caught);
    expect(isMatchingError(error) && error.code).toBe("MATCHING_VALIDATION_FAILED");
  });
});

describe("reading a candidacy", () => {
  it("computes is_fresh instead of storing it", async () => {
    const deps = createHarness();
    await upsertCandidacy(deps, upsertRequest() as never);

    expect((await readCandidacy(deps, DRIVER)).isFresh).toBe(true);
    deps.clock.advanceSeconds(RULESET_V1.candidacyFreshnessSeconds + 1);
    // Nothing was written between the two reads: a stored flag would now be lying
    // all by itself, with nobody having touched the row.
    expect((await readCandidacy(deps, DRIVER)).isFresh).toBe(false);
  });

  it("refuses an unknown driver with 404", async () => {
    const error = await readCandidacy(createHarness(), DRIVER).catch((caught: unknown) => caught);
    expect(isMatchingError(error) && error.code).toBe("MATCHING_CANDIDACY_NOT_FOUND");
  });
});

describe("audit reads", () => {
  it("refuses an unknown decision id with 404", async () => {
    const error = await readDecision(
      createHarness(),
      "33333333-3333-4333-8333-333333333333",
    ).catch((caught: unknown) => caught);
    expect(isMatchingError(error) && error.code).toBe("MATCHING_DECISION_NOT_FOUND");
  });

  it("refuses a decision id that is not a uuid", async () => {
    const error = await readDecision(createHarness(), "decision-7").catch(
      (caught: unknown) => caught,
    );
    expect(isMatchingError(error) && error.code).toBe("MATCHING_VALIDATION_FAILED");
  });

  it("lists the seeded rulesets so a ranking can be explained without reading code", async () => {
    const rulesets = await listRulesets(createHarness());
    expect(rulesets.map((ruleset) => ruleset.version)).toEqual([RULESET_V1.version]);
    expect(rulesets[0]!.isFrozen).toBe(true);
  });
});
