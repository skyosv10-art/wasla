/**
 * Port conformance: the in-memory and Postgres adapters must be
 * indistinguishable through the use cases (MR 3/6).
 *
 * The whole promise of MR 3/6 is that adding a database changed no behavior. A
 * test suite that only exercised the Postgres adapter could not prove that: it
 * would pass while the two adapters quietly disagreed about ordering, about
 * idempotent replays, or about what an absent field means — and the disagreement
 * would surface as a bug in the bot, months later, in production only.
 *
 * So each scenario here is written once and executed twice, once per adapter,
 * through the same use cases with the same deterministic clock, ids, identity and
 * geography. The snapshots must be equal.
 *
 * Two fields are normalized away before comparing, both for documented reasons:
 *
 *  - `updatedAt` — owned by the contract's `customer_set_updated_at` trigger, so
 *    Postgres uses server time on UPDATE while the in-memory adapter uses the
 *    injected clock. Monotonicity is asserted separately instead.
 *  - the event envelope's `trace_id` — `customer_outbox` has no column for it, so
 *    a rehydrated event cannot carry it. Declared as a gap in
 *    docs/02-architecture/CUSTOMER_PERSISTENCE.md §7 rather than papered over.
 *
 * Everything else — including which keys exist on a shipment object — must match
 * exactly.
 *
 * Run with:
 *   DATABASE_URL=postgres://... pnpm --filter @wasla/customers-service test:integration
 * Skipped entirely when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Pool } from "pg";

import {
  FixedClock,
  InMemoryCustomerRepository,
  InMemoryOutbox,
  RecordingOrderIntake,
} from "../infrastructure/in-memory.js";
import type { UseCaseDeps } from "../use-cases/deps.js";
import {
  getCustomerProfile,
  upsertCustomerProfile,
} from "../use-cases/customer-profile.js";
import {
  listSavedPlaces,
  removeSavedPlace,
  savePlace,
} from "../use-cases/saved-places.js";
import {
  getOrderRequest,
  listOrderRequests,
  previewOrderRequest,
  submitOrderRequest,
} from "../use-cases/order-requests.js";
import {
  CUSTOMER,
  OTHER_CUSTOMER,
  ZONE_A,
  ZONE_B,
  deliveryDraft,
  expectCustomerError,
  rideDraft,
} from "./helpers.js";
import { PG_ENABLED, makeDeps, setupPostgres, truncateAll } from "./pg-harness.js";

type Deps = UseCaseDeps & {
  clock: FixedClock;
  intake: RecordingOrderIntake;
};

/** Drop fields whose value is legitimately adapter-specific (see the header). */
function normalize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, inner) =>
      key === "updatedAt" || key === "updated_at" || key === "trace_id"
        ? undefined
        : inner,
    ),
  );
}

/** Everything a scenario is allowed to compare. */
interface Snapshot {
  readonly result: unknown;
  readonly events: readonly unknown[];
}

interface Scenario {
  readonly name: string;
  readonly run: (deps: Deps) => Promise<unknown>;
}

async function seed(deps: Deps, waslaPublicId: string = CUSTOMER): Promise<void> {
  await upsertCustomerProfile(deps, {
    waslaPublicId,
    patch: { displayName: "أبو محمد", preferredLocale: "ar" },
  });
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: "creates a profile, then updates only what changed",
    run: async (deps) => {
      const created = await upsertCustomerProfile(deps, {
        waslaPublicId: CUSTOMER,
        patch: { displayName: "أبو محمد", preferredLocale: "ar" },
      });
      deps.clock.advance(60_000);
      const noop = await upsertCustomerProfile(deps, {
        waslaPublicId: CUSTOMER,
        patch: { displayName: "أبو محمد" },
      });
      deps.clock.advance(60_000);
      const changed = await upsertCustomerProfile(deps, {
        waslaPublicId: CUSTOMER,
        patch: { displayName: "أبو خالد", defaultZoneId: ZONE_A },
      });
      const read = await getCustomerProfile(deps, { waslaPublicId: CUSTOMER });
      return { created, noop, changed, read };
    },
  },
  {
    name: "reports an unknown profile as not found",
    run: async (deps) =>
      expectCustomerError(
        () => getCustomerProfile(deps, { waslaPublicId: OTHER_CUSTOMER }),
        "CUSTOMER_PROFILE_NOT_FOUND",
      ),
  },
  {
    name: "saves places and lists them most-recently-used first",
    run: async (deps) => {
      await seed(deps);
      const home = await savePlace(deps, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: "place-home-1",
        draft: { label: "المنزل", zoneId: ZONE_A, addressText: "حي العزيزية" },
      });
      deps.clock.advance(60_000);
      const work = await savePlace(deps, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: "place-work-1",
        draft: {
          label: "العمل",
          zoneId: ZONE_B,
          coordinates: { latitude: 24.4711, longitude: 39.6111 },
        },
      });
      const listed = await listSavedPlaces(deps, { waslaPublicId: CUSTOMER });
      return { home, work, listed: listed.map((place) => place.label), all: listed };
    },
  },
  {
    name: "replays a saved place for the same key and payload",
    run: async (deps) => {
      await seed(deps);
      const first = await savePlace(deps, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: "place-home-1",
        draft: { label: "المنزل", zoneId: ZONE_A },
      });
      deps.clock.advance(60_000);
      const replay = await savePlace(deps, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: "place-home-1",
        draft: { label: "المنزل", zoneId: ZONE_A },
      });
      // One row, one id, and the second call is flagged as a replay.
      const listed = await listSavedPlaces(deps, { waslaPublicId: CUSTOMER });
      return { first, replay, count: listed.length, sameId: first.place.id === replay.place.id };
    },
  },
  {
    name: "refuses a duplicate label regardless of case",
    run: async (deps) => {
      await seed(deps);
      await savePlace(deps, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: "place-home-1",
        draft: { label: "Home", zoneId: ZONE_A },
      });
      return expectCustomerError(
        () =>
          savePlace(deps, {
            waslaPublicId: CUSTOMER,
            idempotencyKey: "place-home-2",
            draft: { label: "HOME", zoneId: ZONE_A },
          }),
        "CUSTOMER_PLACE_LABEL_TAKEN",
      );
    },
  },
  {
    name: "removes a place and refuses to remove it twice",
    run: async (deps) => {
      await seed(deps);
      const saved = await savePlace(deps, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: "place-home-1",
        draft: { label: "المنزل", zoneId: ZONE_A },
      });
      await removeSavedPlace(deps, { waslaPublicId: CUSTOMER, placeId: saved.place.id });
      const afterRemoval = await listSavedPlaces(deps, { waslaPublicId: CUSTOMER });
      const secondAttempt = await expectCustomerError(
        () => removeSavedPlace(deps, { waslaPublicId: CUSTOMER, placeId: saved.place.id }),
        "CUSTOMER_PLACE_NOT_FOUND",
      );
      return { afterRemoval, secondAttempt };
    },
  },
  {
    name: "never exposes another customer's place",
    run: async (deps) => {
      await seed(deps);
      await seed(deps, OTHER_CUSTOMER);
      const mine = await savePlace(deps, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: "place-home-1",
        draft: { label: "المنزل", zoneId: ZONE_A },
      });
      const theirList = await listSavedPlaces(deps, { waslaPublicId: OTHER_CUSTOMER });
      const theirAttempt = await expectCustomerError(
        () => removeSavedPlace(deps, { waslaPublicId: OTHER_CUSTOMER, placeId: mine.place.id }),
        "CUSTOMER_PLACE_NOT_FOUND",
      );
      return { theirList, theirAttempt };
    },
  },
  {
    name: "previews a ride without storing anything",
    run: async (deps) => {
      await seed(deps);
      const preview = await previewOrderRequest(deps, {
        waslaPublicId: CUSTOMER,
        draft: rideDraft(),
      });
      const stored = await listOrderRequests(deps, { waslaPublicId: CUSTOMER });
      return { preview, stored };
    },
  },
  {
    name: "submits a ride and reads it back",
    run: async (deps) => {
      await seed(deps);
      const submitted = await submitOrderRequest(deps, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: "order-ride-01",
        draft: rideDraft(),
      });
      const read = await getOrderRequest(deps, {
        waslaPublicId: CUSTOMER,
        orderRequestId: submitted.orderRequest.id,
      });
      return { submitted, read, handedOver: deps.intake.received.length };
    },
  },
  {
    name: "submits a delivery keeping exactly the shipment fields sent",
    run: async (deps) => {
      await seed(deps);
      const withWeightOnly = await submitOrderRequest(deps, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: "order-del-01",
        draft: deliveryDraft(),
      });
      deps.clock.advance(60_000);
      const withDescription = await submitOrderRequest(deps, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: "order-del-02",
        draft: deliveryDraft({
          shipment: { shipmentType: "documents", description: "أوراق", weightKg: 1 },
        }),
      });
      return {
        withWeightOnly: withWeightOnly.orderRequest.shipment,
        withDescription: withDescription.orderRequest.shipment,
      };
    },
  },
  {
    name: "replays the same order for the same key and payload",
    run: async (deps) => {
      await seed(deps);
      const first = await submitOrderRequest(deps, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: "order-ride-01",
        draft: rideDraft(),
      });
      deps.clock.advance(60_000);
      const replay = await submitOrderRequest(deps, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: "order-ride-01",
        draft: rideDraft(),
      });
      const listed = await listOrderRequests(deps, { waslaPublicId: CUSTOMER });
      return {
        replayed: replay.replayed,
        sameId: first.orderRequest.id === replay.orderRequest.id,
        count: listed.length,
        // The engine must be called once: a replay is not a second order.
        handedOver: deps.intake.received.length,
      };
    },
  },
  {
    name: "rejects the same key with a different payload",
    run: async (deps) => {
      await seed(deps);
      await submitOrderRequest(deps, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: "order-ride-01",
        draft: rideDraft(),
      });
      return expectCustomerError(
        () =>
          submitOrderRequest(deps, {
            waslaPublicId: CUSTOMER,
            idempotencyKey: "order-ride-01",
            draft: rideDraft({ offeredPrice: { amountMinor: 9900, currency: "SAR" } }),
          }),
        "CUSTOMER_IDEMPOTENCY_KEY_REUSED",
      );
    },
  },
  {
    name: "records a failed handover, then succeeds on retry",
    run: async (deps) => {
      await seed(deps);
      deps.intake.failWith("CUSTOMER_ORDER_INTAKE_UNAVAILABLE");
      const failure = await expectCustomerError(
        () =>
          submitOrderRequest(deps, {
            waslaPublicId: CUSTOMER,
            idempotencyKey: "order-ride-01",
            draft: rideDraft(),
          }),
        "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
      );
      const afterFailure = await listOrderRequests(deps, { waslaPublicId: CUSTOMER });

      // Fail-closed: the row exists so the retry updates it instead of creating
      // a second order for one intent.
      deps.intake.failWith(null);
      deps.clock.advance(60_000);
      const retry = await submitOrderRequest(deps, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: "order-ride-01",
        draft: rideDraft(),
      });
      const afterRetry = await listOrderRequests(deps, { waslaPublicId: CUSTOMER });
      return {
        failure,
        failedStatus: afterFailure.map((r) => r.status),
        failedReason: afterFailure.map((r) => r.failureReasonCode),
        retriedStatus: retry.orderRequest.status,
        sameRow: afterFailure[0]?.id === retry.orderRequest.id,
        count: afterRetry.length,
      };
    },
  },
  {
    name: "lists orders newest first, filtered by status and limited",
    run: async (deps) => {
      await seed(deps);
      for (const [index, key] of ["order-a-001", "order-b-001", "order-c-001"].entries()) {
        if (index === 1) deps.intake.failWith("CUSTOMER_ORDER_INTAKE_UNAVAILABLE");
        try {
          await submitOrderRequest(deps, {
            waslaPublicId: CUSTOMER,
            idempotencyKey: key,
            // Distinct notes keep the fingerprints distinct per request.
            draft: rideDraft({ notes: `طلب ${index}` }),
          });
        } catch {
          // The failed handover is the point of the middle iteration.
        }
        deps.intake.failWith(null);
        deps.clock.advance(60_000);
      }
      const all = await listOrderRequests(deps, { waslaPublicId: CUSTOMER });
      const submitted = await listOrderRequests(deps, {
        waslaPublicId: CUSTOMER,
        status: "submitted",
      });
      const limited = await listOrderRequests(deps, { waslaPublicId: CUSTOMER, limit: 2 });
      return {
        all: all.map((r) => [r.notes, r.status]),
        submitted: submitted.map((r) => r.notes),
        limited: limited.map((r) => r.notes),
      };
    },
  },
  {
    name: "marks a used saved place so it rises in the next listing",
    run: async (deps) => {
      await seed(deps);
      const home = await savePlace(deps, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: "place-home-1",
        draft: { label: "المنزل", zoneId: ZONE_A },
      });
      deps.clock.advance(60_000);
      const work = await savePlace(deps, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: "place-work-1",
        draft: { label: "العمل", zoneId: ZONE_B },
      });
      deps.clock.advance(60_000);
      await submitOrderRequest(deps, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: "order-ride-01",
        draft: rideDraft({
          stops: [
            // The zone stays the anchor even when the stop came from a saved
            // place: the place is a shortcut, not a second source of truth.
            {
              kind: "pickup",
              zoneId: ZONE_A,
              source: "saved_place",
              savedPlaceId: home.place.id,
            },
            { kind: "dropoff", zoneId: ZONE_B, source: "text_search" },
          ],
        }),
      });
      const listed = await listSavedPlaces(deps, { waslaPublicId: CUSTOMER });
      return {
        order: listed.map((place) => place.label),
        usedWasTouched: listed[0]?.lastUsedAt !== null,
        otherUntouched: listed.find((p) => p.id === work.place.id)?.lastUsedAt ?? null,
      };
    },
  },
];

describe.skipIf(!PG_ENABLED)("Port conformance: in-memory ↔ Postgres", () => {
  let pool: Pool;
  let makePostgresDeps: () => Deps;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const fixture = await setupPostgres();
    pool = fixture.pool;
    close = fixture.close;
    makePostgresDeps = () =>
      makeDeps({ repo: fixture.repo, outbox: fixture.outbox }) as Deps;
  });

  afterAll(async () => {
    await close();
  });

  it.each(SCENARIOS)("$name behaves identically on both adapters", async ({ run }) => {
    const memoryOutbox = new InMemoryOutbox();
    const memoryDeps = makeDeps({
      repo: new InMemoryCustomerRepository(),
      outbox: memoryOutbox,
    }) as Deps;
    const memory: Snapshot = {
      result: await run(memoryDeps),
      events: await memoryOutbox.unread(),
    };

    await truncateAll(pool);
    const pgDeps = makePostgresDeps();
    const postgres: Snapshot = {
      result: await run(pgDeps),
      events: await pgDeps.outbox.unread(),
    };

    expect(normalize(postgres.result)).toEqual(normalize(memory.result));
    expect(normalize(postgres.events)).toEqual(normalize(memory.events));
    // A scenario that produced no observable effect would pass vacuously.
    expect(
      JSON.stringify(memory.result) !== "{}" || memory.events.length > 0,
    ).toBe(true);
  });

  it("keeps updated_at at or after created_at on the Postgres side", async () => {
    // The one field the adapters may legitimately disagree on: the contract's
    // trigger owns it, so only its monotonicity can be asserted.
    await truncateAll(pool);
    const deps = makePostgresDeps();
    const created = await upsertCustomerProfile(deps, {
      waslaPublicId: CUSTOMER,
      patch: { displayName: "أبو محمد", preferredLocale: "ar" },
    });
    expect(created.profile.updatedAt).toBe(created.profile.createdAt);

    deps.clock.advance(60_000);
    const updated = await upsertCustomerProfile(deps, {
      waslaPublicId: CUSTOMER,
      patch: { displayName: "أبو خالد" },
    });
    expect(new Date(updated.profile.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(updated.profile.createdAt).getTime(),
    );
  });
});
