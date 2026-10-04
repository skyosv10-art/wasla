/**
 * ADR-060 P2 (CLM-0466 · RISK-0042): user assertion ownership on the driver
 * routes of the dispatch boundary — `POST /dispatch/offers/:offer_id/accept`
 * and `POST /dispatch/offers/:offer_id/reject`.
 *
 * Before this claim both routes were `scoped()` and their inputs carried no
 * driver, so the holder of `dispatch:offer:accept` could accept an offer made
 * to another driver. The three modes:
 * - `off` (production default until P3): nothing verified, behaviour unchanged.
 * - `observe`: assertion verified, a mismatch is logged and passes (CLM-0448).
 * - `enforce`: assertion required; another driver's offer → 404, the same answer
 *   as an unknown offer.
 */

import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import type { FastifyInstance, InjectOptions } from "fastify";

import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  serviceAuthHeaders,
  userAssertionPublicKeysFromEnv,
  USER_ASSERTION_HEADER,
  type UserAssertionPublicKeys,
} from "@wasla/service-auth";
import {
  userAssertionSigningKey,
  mintUserAssertion,
  type UserAssertionSigningKey,
} from "@wasla/service-auth/user-assertion";

import { createDispatchApp } from "../http/app.js";
import { DISPATCH_SCOPES, DISPATCH_SERVICE_AUDIENCE } from "../http/service-identity.js";
import { runTick } from "../run-tick.js";
import { createDirectRunner } from "../runner.js";
import { createDispatchJob } from "../use-cases/create-job.js";
import { createHarness, driverId, orderRef, ZONE_ID } from "./harness.js";

const SECRET = "dispatch-test-secret-0123456789abcdef";
const KID = "test-active";
const OFFERED_DRIVER = driverId(1);
const OTHER_DRIVER = driverId(99);
const DRIVER_SCOPES = [DISPATCH_SCOPES.offerAccept, DISPATCH_SCOPES.offerReject];

type Mode = "off" | "observe" | "enforce";

interface Fixture {
  readonly app: FastifyInstance;
  readonly keys: ServiceAuthKeyRegistry;
  readonly signingKey: UserAssertionSigningKey;
  readonly offerId: string;
  readonly offerState: () => Promise<string | undefined>;
}

function testKeys(): { signingKey: UserAssertionSigningKey; publicKeys: UserAssertionPublicKeys } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signingKey = userAssertionSigningKey("ua-test", privateKey);
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const publicKeys = userAssertionPublicKeysFromEnv({
    WASLA_USER_ASSERTION_PUBLIC_KEYS: JSON.stringify({ "ua-test": spki }),
  });
  return { signingKey, publicKeys };
}

async function fixture(mode: Mode): Promise<Fixture> {
  const harness = createHarness();
  const order = orderRef(1);
  harness.orders.seedOrder(order.orderId);
  const runner = createDirectRunner(harness.deps);
  const job = await createDispatchJob(harness.deps, {
    ...order,
    zoneId: ZONE_ID,
    orderType: "ride",
    vehicleClass: "sedan",
    idempotencyKey: "ua-create-key",
  });
  harness.matching.setPool([OFFERED_DRIVER]);
  await runTick(runner, { traceId: "ua-tick" });
  const offer = (await harness.offers.listForJob(job.job.id))[0];
  if (offer === undefined) throw new Error("the tick made no offer");
  expect(offer.driverPublicId).toBe(OFFERED_DRIVER);

  const keys = new ServiceAuthKeyRegistry({
    keys: [{ kid: KID, secret: SECRET, status: "active" }],
    activeKid: KID,
  });
  const { signingKey, publicKeys } = testKeys();
  const app = createDispatchApp({
    runner,
    serviceIdentity: {
      keys,
      replayGuard: new InMemoryServiceTokenReplayGuard(),
      userAssertion: { mode, publicKeys },
    },
  });
  return {
    app,
    keys,
    signingKey,
    offerId: offer.id,
    offerState: async () => (await harness.offers.listForJob(job.job.id))[0]?.status,
  };
}

function assertionFor(f: Fixture, sub: string): string {
  return mintUserAssertion({
    key: f.signingKey,
    sub,
    act: "driver",
    chn: "telegram",
    via: "driver-bot",
    aud: ["dispatch"],
    now: new Date(),
  }).assertion;
}

function signed(
  f: Fixture,
  action: "accept" | "reject",
  options: { obo?: string; assertion?: string; key: string },
): InjectOptions {
  const url = `/dispatch/offers/${f.offerId}/${action}`;
  const headers = serviceAuthHeaders({
    serviceName: "driver-bot",
    audience: DISPATCH_SERVICE_AUDIENCE,
    method: "POST",
    path: url,
    keys: f.keys,
    now: new Date(),
    scopes: DRIVER_SCOPES,
    ...(options.obo === undefined ? {} : { onBehalfOfPublicId: options.obo }),
  });
  return {
    method: "POST",
    url,
    headers: {
      ...headers,
      "idempotency-key": options.key,
      ...(options.assertion === undefined ? {} : { [USER_ASSERTION_HEADER]: options.assertion }),
      ...(action === "reject" ? { "content-type": "application/json" } : {}),
    },
    ...(action === "reject" ? { payload: JSON.stringify({ reason_code: "DRIVER_DECLINED" }) } : {}),
  };
}

describe("CLM-0466 · off mode (compatibility)", () => {
  it("accept passes without an assertion, exactly as before", async () => {
    const f = await fixture("off");
    const response = await f.app.inject(signed(f, "accept", { key: "off-accept" }));
    expect(response.statusCode).toBe(200);
    await f.app.close();
  });

  it("reject passes without an assertion, exactly as before", async () => {
    const f = await fixture("off");
    const response = await f.app.inject(signed(f, "reject", { key: "off-reject" }));
    expect(response.statusCode).toBe(200);
    await f.app.close();
  });
});

describe("CLM-0466 · enforce mode (ownership)", () => {
  it("the driver the offer was made to accepts it → 200", async () => {
    const f = await fixture("enforce");
    const response = await f.app.inject(
      signed(f, "accept", { obo: OFFERED_DRIVER, assertion: assertionFor(f, OFFERED_DRIVER), key: "enf-accept" }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("accepted");
    await f.app.close();
  });

  it("another driver accepting it → 404, and the offer is untouched", async () => {
    const f = await fixture("enforce");
    const before = await f.offerState();
    expect(before).toBe("offered");
    const response = await f.app.inject(
      signed(f, "accept", { obo: OTHER_DRIVER, assertion: assertionFor(f, OTHER_DRIVER), key: "enf-steal" }),
    );
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("DISPATCH_OFFER_NOT_FOUND");
    expect(await f.offerState()).toBe(before);
    await f.app.close();
  });

  it("another driver rejecting it → 404, and the offer is untouched", async () => {
    const f = await fixture("enforce");
    const before = await f.offerState();
    expect(before).toBe("offered");
    const response = await f.app.inject(
      signed(f, "reject", { obo: OTHER_DRIVER, assertion: assertionFor(f, OTHER_DRIVER), key: "enf-reject-other" }),
    );
    expect(response.statusCode).toBe(404);
    expect(await f.offerState()).toBe(before);
    await f.app.close();
  });

  it("the offered driver rejects it → 200", async () => {
    const f = await fixture("enforce");
    const response = await f.app.inject(
      signed(f, "reject", { obo: OFFERED_DRIVER, assertion: assertionFor(f, OFFERED_DRIVER), key: "enf-reject" }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("rejected");
    await f.app.close();
  });

  it("no assertion at all → 401, nothing changes", async () => {
    const f = await fixture("enforce");
    const before = await f.offerState();
    expect(before).toBe("offered");
    const response = await f.app.inject(signed(f, "accept", { obo: OFFERED_DRIVER, key: "enf-none" }));
    expect(response.statusCode).toBe(401);
    expect(await f.offerState()).toBe(before);
    await f.app.close();
  });
});

describe("CLM-0466 · observe mode (logs, never rejects)", () => {
  it("a mismatched driver is logged and passes", async () => {
    const f = await fixture("observe");
    const response = await f.app.inject(
      signed(f, "accept", { obo: OTHER_DRIVER, assertion: assertionFor(f, OTHER_DRIVER), key: "obs-accept" }),
    );
    expect(response.statusCode).toBe(200);
    await f.app.close();
  });
});
