/**
 * The domain ⇄ contract boundary.
 *
 * These tests exist because the danger at this boundary is not a missing field — the type
 * checker catches that — but an *extra* one. The domain rows carry internal bookkeeping
 * (`payload_fingerprint`, `created_idempotency_key`) and the tick counts more than it
 * reports. A generic camelCase→snake_case transformer would forward all of it, and a
 * field that reaches one client is a field that can never be withdrawn.
 *
 * So each mapper is asserted against the exact key set the OpenAPI document declares,
 * read from `contracts/api.openapi.yml` on disk at runtime.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  offerDetailToWire,
  toApiJob,
  toApiOffer,
  toApiOfferList,
  toApiRules,
  toApiTickResult,
} from "../mappers.js";
import { createDispatchJob } from "../use-cases/create-job.js";
import { readDispatchOffer } from "../use-cases/read-job.js";
import { tick } from "../use-cases/tick.js";
import { TEST_RULES, ZONE_ID, createHarness, driverId, orderRef, type Harness } from "./harness.js";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OPENAPI = readFileSync(path.join(serviceRoot, "contracts", "api.openapi.yml"), "utf8");

/** The property names declared for one component schema, read from the contract. */
function schemaProperties(component: string): string[] {
  const start = OPENAPI.indexOf(`    ${component}:\n`);
  if (start < 0) throw new Error(`لم يُعثر على المخطط ${component} في api.openapi.yml`);
  const body = OPENAPI.slice(start).split(/\n    [A-Za-z]/u)[0] as string;
  const propertiesAt = body.indexOf("      properties:");
  if (propertiesAt < 0) throw new Error(`المخطط ${component} بلا properties`);
  return [
    ...(body.slice(propertiesAt) as string).matchAll(/\n        ([a-z_]+):/gu),
  ].map((entry) => entry[1] as string);
}

async function jobWithOffers(): Promise<Harness & { jobId: string }> {
  const harness = createHarness();
  harness.matching.setPool([driverId(1), driverId(2)]);
  const ref = orderRef(1);
  harness.orders.seedOrder(ref.orderId);
  const { job } = await createDispatchJob(harness.deps, {
    orderId: ref.orderId,
    orderPublicId: ref.orderPublicId,
    zoneId: ZONE_ID,
    orderType: "delivery",
    vehicleClass: "motorcycle",
    idempotencyKey: "create-key-0001",
  });
  await tick(harness.deps);
  return { ...harness, jobId: job.id };
}

describe("toApiJob", () => {
  it("returns exactly the fields the contract declares", async () => {
    const harness = await jobWithOffers();
    const job = await harness.jobs.find(harness.jobId);
    const api = toApiJob(job!);

    expect(Object.keys(api).sort()).toEqual(schemaProperties("DispatchJob").sort());
  });

  it("leaves the internal bookkeeping behind", async () => {
    const harness = await jobWithOffers();
    const job = await harness.jobs.find(harness.jobId);
    const api = toApiJob(job!) as Record<string, unknown>;

    // The fingerprint and the caller's own key tell a client nothing and hand an attacker
    // a way to probe our idempotency keys.
    expect(api.payload_fingerprint).toBeUndefined();
    expect(api.created_idempotency_key).toBeUndefined();
    // Present on the domain row, so the omission above is a real decision, not an
    // accident of a row that never had them.
    expect(job?.payloadFingerprint).toHaveLength(64);
    expect(job?.createdIdempotencyKey).toBe("create-key-0001");
  });

  it("publishes the stored deadlines, so a client never recomputes them", async () => {
    const harness = await jobWithOffers();
    const job = await harness.jobs.find(harness.jobId);
    const api = toApiJob(job!);

    expect(api.expires_at).toBe("2026-01-01T00:01:30.000Z");
    expect(api.escalation_expires_at).toBe("2026-01-01T00:03:30.000Z");
    // The snapshot travels with the job: an offer sent an hour ago stays explainable
    // after the live configuration changes.
    expect(api.rules).toEqual(toApiRules(TEST_RULES));
  });

  it("maps a null reason code to null, not to an empty string", async () => {
    const harness = await jobWithOffers();
    const job = await harness.jobs.find(harness.jobId);
    // `""` would pass a `required` check in a client and mean "no reason given" to nobody.
    expect(toApiJob(job!).status_reason_code).toBeNull();
  });
});

describe("toApiOffer", () => {
  it("returns exactly the fields the contract declares", async () => {
    const harness = await jobWithOffers();
    const offers = await harness.offers.listForJob(harness.jobId);
    const api = toApiOffer(offers[0]);

    expect(Object.keys(api).sort()).toEqual(schemaProperties("DispatchOffer").sort());
  });

  it("does not publish the order engine's assignment id", async () => {
    const harness = await jobWithOffers();
    const offers = await harness.offers.listForJob(harness.jobId);
    const api = toApiOffer(offers[0]) as Record<string, unknown>;

    // It is another service's primary key. Publishing it invites a client to call
    // `orders` directly and to build a dependency the contract never promised.
    expect(api.order_assignment_id).toBeUndefined();
    expect(offers[0].orderAssignmentId).not.toBeNull();
  });

  it("wraps a list in the declared envelope", async () => {
    const harness = await jobWithOffers();
    const offers = await harness.offers.listForJob(harness.jobId);
    const api = toApiOfferList(offers);

    // `{ items: [...] }`, never a bare array: an envelope leaves room for pagination
    // without a breaking change.
    expect(Object.keys(api)).toEqual(["items"]);
    expect(api.items).toHaveLength(2);
  });
});

describe("offerDetailToWire", () => {
  it("keeps DispatchOfferDetail keys aligned with the contract in both directions", async () => {
    const harness = await jobWithOffers();
    const offer = (await harness.offers.listForJob(harness.jobId))[0]!;
    const detail = await readDispatchOffer(harness.deps, { offerId: offer.id });
    const wire = offerDetailToWire(detail!);
    const contractKeys = schemaProperties("DispatchOfferDetail");
    const outputKeys = Object.keys(wire);

    // One direction catches a field the mapper forgot; the other catches an internal
    // field it accidentally exposed. Both read the canonical OpenAPI file above.
    expect(outputKeys).toEqual(expect.arrayContaining(contractKeys));
    expect(contractKeys).toEqual(expect.arrayContaining(outputKeys));
  });
});

describe("toApiTickResult", () => {
  it("reports exactly the five counters the contract declares", async () => {
    const harness = createHarness();
    harness.matching.setPool([driverId(1), driverId(2)]);
    const outcome = await tick(harness.deps);
    const api = toApiTickResult(outcome);

    expect(Object.keys(api).sort()).toEqual(schemaProperties("TickResult").sort());
    expect(api.tick_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("drops the deferred jobs, which are operational truth and not an API", async () => {
    const harness = createHarness();
    harness.matching.setPool([driverId(1), driverId(2)]);
    const ref = orderRef(1);
    harness.orders.seedOrder(ref.orderId);
    await createDispatchJob(harness.deps, {
      orderId: ref.orderId,
      orderPublicId: ref.orderPublicId,
      zoneId: ZONE_ID,
      orderType: "ride",
      vehicleClass: "sedan",
      idempotencyKey: "create-key-0001",
    });
    harness.matching.failWith("unavailable");

    const outcome = await tick(harness.deps);
    const api = toApiTickResult(outcome) as Record<string, unknown>;

    // The domain must count what it skipped — that is how an operator learns a
    // dependency is failing — and the API must not, because `deferred_jobs` is not in the
    // contract and a caller cannot act on it.
    expect(outcome.deferredJobs).toBe(1);
    expect(api.deferred_jobs).toBeUndefined();
    expect(api.deferredJobs).toBeUndefined();
  });
});
