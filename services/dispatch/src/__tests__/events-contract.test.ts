/**
 * Every event this service can emit, checked against `contracts/events.json` on disk.
 *
 * Two failures are being prevented here, and neither is caught by the type checker:
 *
 * 1. **Privacy leaking into an event.** Privacy is a contract boundary (ADR-011,
 *    decision 8): a zone, never coordinates; reason codes, never free text; no channel
 *    id, no driver name, no score, no candidate list. An event is the one artefact that
 *    leaves this service, is stored by subscribers, and can never be recalled — so the
 *    check walks the real payloads a full lifecycle produces, not a sample.
 * 2. **A payload drifting from the schema.** The contract declares
 *    `additionalProperties: false` per event, so an extra key is a breaking change that
 *    a JSON-schema-validating subscriber will reject in production and nothing here
 *    would otherwise notice.
 *
 * The contract is read from disk at runtime, from a path resolved relative to this file
 * rather than the working directory, so the suite reads the same bytes whether it runs
 * from the service, the repo root, or CI.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DISPATCH_EVENT_PRODUCER,
  DISPATCH_EVENT_VERSION,
  FORBIDDEN_EVENT_FIELDS,
} from "../domain/events.js";
import { acceptOffer } from "../use-cases/accept-offer.js";
import { cancelDispatchJob } from "../use-cases/cancel-job.js";
import { createDispatchJob } from "../use-cases/create-job.js";
import { rejectOffer } from "../use-cases/reject-offer.js";
import { tick } from "../use-cases/tick.js";
import { ZONE_ID, createHarness, driverId, orderRef, type Harness } from "./harness.js";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const contract = JSON.parse(
  readFileSync(path.join(serviceRoot, "contracts", "events.json"), "utf8"),
) as EventsContract;

interface SchemaNode {
  readonly required?: readonly string[];
  readonly properties?: Record<string, SchemaNode>;
  readonly additionalProperties?: boolean;
  readonly const?: string;
}
interface EventsContract {
  readonly $defs: Record<string, SchemaNode>;
}

/** `event_type` → its declared definition, keyed off the `const` in the contract. */
const DEFINITIONS = new Map<string, SchemaNode>(
  Object.values(contract.$defs)
    .map((node) => [node.properties?.event_type?.const, node] as const)
    .filter((entry): entry is readonly [string, SchemaNode] => typeof entry[0] === "string")
    .map(([type, node]) => [type, node]),
);

const POOL = [driverId(1), driverId(2), driverId(3), driverId(4), driverId(5), driverId(6)];

async function seed(harness: Harness, index: number): Promise<string> {
  const ref = orderRef(index);
  harness.orders.seedOrder(ref.orderId);
  const { job } = await createDispatchJob(harness.deps, {
    orderId: ref.orderId,
    orderPublicId: ref.orderPublicId,
    zoneId: ZONE_ID,
    orderType: index === 2 ? "delivery" : "ride",
    vehicleClass: "sedan",
    idempotencyKey: `create-key-000${index}`,
  });
  return job.id;
}

/**
 * One run that exercises every branch that emits: an accepted job, a job that runs the
 * whole automatic window into escalation and then expires, and a cancelled job.
 */
async function emitEverything(): Promise<readonly Record<string, unknown>[]> {
  const harness = createHarness();
  harness.matching.setPool(POOL);

  const accepted = await seed(harness, 1);
  const doomed = await seed(harness, 2);
  const cancelled = await seed(harness, 3);

  await tick(harness.deps); // job_created ×3 already emitted; now wave_opened + offer_sent
  const acceptedOffers = await harness.offers.listForJob(accepted);
  await acceptOffer(harness.deps, {
    offerId: acceptedOffers[0].id,
    idempotencyKey: "accept-key-0001",
  });

  const doomedOffers = await harness.offers.listForJob(doomed);
  await rejectOffer(harness.deps, {
    offerId: doomedOffers[0].id,
    reasonCode: "DRIVER_DECLINED",
    idempotencyKey: "reject-key-0001",
  });

  await cancelDispatchJob(harness.deps, {
    jobId: cancelled,
    reasonCode: "DISPATCH_CANCELLED_BY_REQUESTER",
    idempotencyKey: "cancel-key-0001",
  });

  // Walk the doomed job through every wave, then past the escalation deadline.
  for (const at of ["00:00:30", "00:01:00", "00:01:30", "00:03:30"]) {
    harness.clock.set(`2026-01-01T${at}.000Z`);
    await tick(harness.deps);
  }

  const events = (await harness.outbox.unread()) as unknown as readonly Record<string, unknown>[];
  return events;
}

/** Every string key and value anywhere inside the payload, however deeply nested. */
function walk(value: unknown, keys: string[], strings: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, keys, strings);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      walk(child, keys, strings);
    }
    return;
  }
  if (typeof value === "string") strings.push(value);
}

describe("dispatch events — contract shape", () => {
  it("emits all nine declared event types and nothing else", async () => {
    const events = await emitEverything();
    const emitted = new Set(events.map((event) => event.event_type as string));

    // Nine in the contract, nine here. A tenth event would be an undeclared addition to
    // a public surface; a missing one is a branch nobody can observe.
    expect(DEFINITIONS.size).toBe(9);
    expect([...emitted].sort()).toEqual([...DEFINITIONS.keys()].sort());
  });

  it("stamps every envelope the way the contract requires", async () => {
    const events = await emitEverything();
    for (const event of events) {
      expect(event.producer).toBe(DISPATCH_EVENT_PRODUCER);
      expect(event.event_version).toBe(DISPATCH_EVENT_VERSION);
      expect(event.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/u);
      expect(event.occurred_at).toMatch(/^2026-01-01T/u);
      const aggregate = event.aggregate as { type: string; id: string };
      expect(["dispatch_job", "dispatch_offer"]).toContain(aggregate.type);
      expect(aggregate.id).not.toBe("");
    }
  });

  it("matches each payload against its declared properties", async () => {
    const events = await emitEverything();
    for (const event of events) {
      const definition = DEFINITIONS.get(event.event_type as string);
      const dataSchema = definition?.properties?.data;
      const declared = Object.keys(dataSchema?.properties ?? {});
      const actual = Object.keys(event.data as Record<string, unknown>);

      // `additionalProperties: false` in the contract means an extra key is a breaking
      // change a validating subscriber will reject.
      expect(dataSchema?.additionalProperties).toBe(false);
      expect(actual.filter((key) => !declared.includes(key))).toEqual([]);
      for (const required of dataSchema?.required ?? []) {
        expect(actual).toContain(required);
      }
    }
  });
});

describe("dispatch events — privacy", () => {
  it("carries none of the forbidden fields, at any depth", async () => {
    const events = await emitEverything();
    const keys: string[] = [];
    const strings: string[] = [];
    for (const event of events) walk(event.data, keys, strings);

    expect(keys.length).toBeGreaterThan(0);
    // Asserted against the whole set at once so a failure names every offender rather
    // than the first one.
    expect(keys.filter((key) => FORBIDDEN_EVENT_FIELDS.includes(key))).toEqual([]);
  });

  it("never carries a coordinate, only a zone", async () => {
    const events = await emitEverything();
    const zoneCarrying = events.filter((event) =>
      Object.keys(event.data as Record<string, unknown>).includes("zone_id"),
    );
    // A geographic claim about a person is the one field that cannot be un-published, so
    // the coarsest unit that still routes the order is the only one we emit.
    expect(zoneCarrying.length).toBeGreaterThan(0);
    for (const event of zoneCarrying) {
      expect((event.data as { zone_id: string }).zone_id).toBe(ZONE_ID);
    }
  });

  it("explains every outcome with a reason code, never free text", async () => {
    const events = await emitEverything();
    const reasoned = events.filter((event) =>
      Object.keys(event.data as Record<string, unknown>).includes("reason_code"),
    );
    expect(reasoned.length).toBeGreaterThan(0);
    for (const event of reasoned) {
      const code = (event.data as { reason_code: string }).reason_code;
      // SCREAMING_SNAKE_CASE is what makes an outcome countable a year later; a sentence
      // is not, and a sentence about a named driver is worse than not countable.
      expect(code).toMatch(/^[A-Z][A-Z_]{2,63}$/u);
    }
  });

  it("identifies drivers only by their public id", async () => {
    const events = await emitEverything();
    const driverEvents = events.filter((event) =>
      Object.keys(event.data as Record<string, unknown>).includes("driver_public_id"),
    );
    expect(driverEvents.length).toBeGreaterThan(0);
    for (const event of driverEvents) {
      // The public id is the only driver identifier that may cross a service boundary;
      // an internal id would let a subscriber join against tables it has no right to.
      expect((event.data as { driver_public_id: string }).driver_public_id).toMatch(
        /^WS-[0-9]{10}$/u,
      );
    }
  });

  it("keeps internal bookkeeping out of the payloads", async () => {
    const events = await emitEverything();
    const keys: string[] = [];
    const strings: string[] = [];
    for (const event of events) walk(event.data, keys, strings);

    // The fingerprint and the caller's idempotency key are ours: publishing them hands a
    // subscriber — or an attacker reading a subscriber's logs — a way to probe our keys.
    expect(keys).not.toContain("payload_fingerprint");
    expect(keys).not.toContain("created_idempotency_key");
    expect(keys).not.toContain("idempotency_key");
  });
});
