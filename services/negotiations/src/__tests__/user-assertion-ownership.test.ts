/**
 * ADR-060 P2 (CLM-0441): user assertion ownership on negotiations routes.
 *
 * Tests the three modes:
 * - `off` (default): no assertion verification, behavior unchanged (compatibility).
 * - `observe`: assertion is verified and `endUser` is set, but no request is rejected.
 * - `enforce`: assertion is required; mismatched roles return 404 (not 403).
 *
 * `/negotiations/tick` stays system-only and never requires an assertion.
 */

import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";

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

import { createNegotiationApp } from "../http/app.js";
import { NEGOTIATIONS_SCOPES, NEGOTIATIONS_SERVICE_AUDIENCE } from "../http/service-identity.js";
import { createDirectNegotiationRunner } from "../runner.js";
import { makeDeps, CUSTOMER_ID, DRIVER_ID, openInput } from "./helpers.js";

const TEST_SERVICE_SECRET = "negotiations-test-secret-0123456789";
const TEST_ACTIVE_KID = "test-active";
const ALL_SCOPES = Object.values(NEGOTIATIONS_SCOPES);

function createTestKeyRegistry(): ServiceAuthKeyRegistry {
  return new ServiceAuthKeyRegistry({
    keys: [{ kid: TEST_ACTIVE_KID, secret: TEST_SERVICE_SECRET, status: "active" }],
    activeKid: TEST_ACTIVE_KID,
  });
}

function generateTestKeys(): { signingKey: UserAssertionSigningKey; publicKeys: UserAssertionPublicKeys } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signingKey = userAssertionSigningKey("ua-test", privateKey);
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const publicKeys = userAssertionPublicKeysFromEnv({
    WASLA_USER_ASSERTION_PUBLIC_KEYS: JSON.stringify({ "ua-test": spki }),
  });
  return { signingKey, publicKeys };
}

interface AssertedHarness {
  readonly app: FastifyInstance;
  readonly keys: ServiceAuthKeyRegistry;
  readonly signingKey: UserAssertionSigningKey;
  readonly rawInject: (options: InjectOptions) => Promise<LightMyRequestResponse>;
}

function buildAssertedApp(mode: "off" | "observe" | "enforce"): AssertedHarness {
  const deps = makeDeps();
  const keys = createTestKeyRegistry();
  const replayGuard = new InMemoryServiceTokenReplayGuard();
  const { signingKey, publicKeys } = generateTestKeys();

  const app = createNegotiationApp({
    runner: createDirectNegotiationRunner(deps),
    serviceIdentity: { keys, replayGuard },
    userAssertion: { mode, publicKeys },
  });

  const rawInject = app.inject.bind(app);
  return { app, keys, signingKey, rawInject };
}

function signedRequest(
  harness: AssertedHarness,
  method: string,
  url: string,
  options: {
    obo?: string;
    assertion?: string;
    scopes?: readonly string[];
    body?: unknown;
    idempotencyKey?: string;
    serviceName?: string;
  } = {},
): InjectOptions {
  const headers = serviceAuthHeaders({
    serviceName: options.serviceName ?? "customer-bot",
    audience: NEGOTIATIONS_SERVICE_AUDIENCE,
    method: method.toUpperCase(),
    path: url,
    keys: harness.keys,
    now: new Date(),
    scopes: options.scopes ?? ALL_SCOPES,
    ...(options.obo !== undefined ? { onBehalfOfPublicId: options.obo } : {}),
  });

  const result: InjectOptions = {
    method: method as InjectOptions["method"],
    url,
    headers: {
      ...headers,
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
      ...(options.assertion ? { [USER_ASSERTION_HEADER]: options.assertion } : {}),
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    },
  };

  if (options.body !== undefined) {
    result.payload = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  return result;
}

function mintCustomerAssertion(harness: AssertedHarness, publicId: string = CUSTOMER_ID): string {
  return mintUserAssertion({
    key: harness.signingKey,
    sub: publicId,
    act: "customer",
    chn: "telegram",
    via: "customer-bot",
    aud: ["negotiations"],
    now: new Date(),
  }).assertion;
}

function mintDriverAssertion(harness: AssertedHarness, publicId: string = DRIVER_ID): string {
  return mintUserAssertion({
    key: harness.signingKey,
    sub: publicId,
    act: "driver",
    chn: "telegram",
    via: "driver-bot",
    aud: ["negotiations"],
    now: new Date(),
  }).assertion;
}

async function openThread(harness: AssertedHarness, assertion?: string): Promise<Record<string, unknown>> {
  const response = await harness.app.inject(
    signedRequest(harness, "POST", "/negotiations", {
      obo: CUSTOMER_ID,
      assertion,
      body: openInput(),
      idempotencyKey: "open-assert-001",
    }),
  );
  expect(response.statusCode).toBe(201);
  return response.json() as Record<string, unknown>;
}

// ── Compatibility: `off` mode (no assertion config at all) ──────────────

describe("ADR-060 P2 · off mode (compatibility)", () => {
  it("opens a thread without any assertion header", async () => {
    const harness = buildAssertedApp("off");
    const response = await harness.app.inject(
      signedRequest(harness, "POST", "/negotiations", {
        body: openInput(),
        idempotencyKey: "off-open-0001",
      }),
    );
    expect(response.statusCode).toBe(201);
  });

  it("reads a thread without any assertion header", async () => {
    const harness = buildAssertedApp("off");
    const thread = await openThread(harness);
    const threadId = thread.id as string;
    const response = await harness.app.inject(
      signedRequest(harness, "GET", `/negotiations/${threadId}`),
    );
    expect(response.statusCode).toBe(200);
  });

  it("runs /tick without any assertion (system-only)", async () => {
    const harness = buildAssertedApp("off");
    const response = await harness.app.inject(
      signedRequest(harness, "POST", "/negotiations/tick", {
        idempotencyKey: "tick-off-00001",
      }),
    );
    expect(response.statusCode).toBe(200);
  });
});

// ── Observe mode: assertion verified but never rejected ─────────────────

describe("ADR-060 P2 · observe mode", () => {
  it("opens a thread with a valid customer assertion", async () => {
    const harness = buildAssertedApp("observe");
    const assertion = mintCustomerAssertion(harness);
    const response = await harness.app.inject(
      signedRequest(harness, "POST", "/negotiations", {
        obo: CUSTOMER_ID,
        assertion,
        body: { ...openInput(), opened_by: "customer" },
        idempotencyKey: "obs-open-0001",
      }),
    );
    expect(response.statusCode).toBe(201);
  });

  it("opens a thread without assertion (observe does not reject)", async () => {
    const harness = buildAssertedApp("observe");
    const response = await harness.app.inject(
      signedRequest(harness, "POST", "/negotiations", {
        body: openInput(),
        idempotencyKey: "obs-open-no-as01",
      }),
    );
    expect(response.statusCode).toBe(201);
  });

  it("runs /tick without assertion in observe mode", async () => {
    const harness = buildAssertedApp("observe");
    const response = await harness.app.inject(
      signedRequest(harness, "POST", "/negotiations/tick", {
        idempotencyKey: "tick-obs-00001",
      }),
    );
    expect(response.statusCode).toBe(200);
  });
});

// ── Enforce mode: assertion required, mismatch → 404 ────────────────────

// ── CLM-0448: observe never rejects, even on an ownership mismatch ─────
// Measured before the fix: with a VALID assertion, observe set `endUser` and the
// ownership helpers answered 404 on a mismatch — observe rejected production
// requests. These are the same mismatches the enforce block rejects below.

describe("CLM-0448 · observe mode — ownership mismatch is logged, not rejected", () => {
  it("opened_by mismatch with a valid assertion → 201 in observe", async () => {
    const harness = buildAssertedApp("observe");
    const assertion = mintCustomerAssertion(harness);
    const response = await harness.app.inject(
      signedRequest(harness, "POST", "/negotiations", {
        obo: CUSTOMER_ID,
        assertion,
        body: { ...openInput(), opened_by: "driver" },
        idempotencyKey: "obs-open-mis01",
      }),
    );
    expect(response.statusCode).toBe(201);
  });

  it("reading a thread as a non-party with a valid assertion → 200 in observe", async () => {
    const harness = buildAssertedApp("observe");
    const assertion = mintCustomerAssertion(harness);
    const thread = await openThread(harness, assertion);
    const otherAssertion = mintCustomerAssertion(harness, "WS-9999999999");
    const response = await harness.app.inject(
      signedRequest(harness, "GET", `/negotiations/${thread.id as string}`, {
        obo: "WS-9999999999",
        assertion: otherAssertion,
      }),
    );
    expect(response.statusCode).toBe(200);
  });
});

describe("ADR-060 P2 · enforce mode", () => {
  it("opens a thread with a valid customer assertion and matching opened_by", async () => {
    const harness = buildAssertedApp("enforce");
    const assertion = mintCustomerAssertion(harness);
    const response = await harness.app.inject(
      signedRequest(harness, "POST", "/negotiations", {
        obo: CUSTOMER_ID,
        assertion,
        body: { ...openInput(), opened_by: "customer" },
        idempotencyKey: "enf-open-00001",
      }),
    );
    expect(response.statusCode).toBe(201);
  });

  it("rejects opening a thread without assertion (401)", async () => {
    const harness = buildAssertedApp("enforce");
    const response = await harness.app.inject(
      signedRequest(harness, "POST", "/negotiations", {
        body: openInput(),
        idempotencyKey: "enf-open-no-as01",
      }),
    );
    expect(response.statusCode).toBe(401);
  });

  it("rejects opened_by mismatch with 404 (not 403)", async () => {
    const harness = buildAssertedApp("enforce");
    const assertion = mintCustomerAssertion(harness);
    const response = await harness.app.inject(
      signedRequest(harness, "POST", "/negotiations", {
        obo: CUSTOMER_ID,
        assertion,
        body: { ...openInput(), opened_by: "driver" },
        idempotencyKey: "enf-open-mis01",
      }),
    );
    expect(response.statusCode).toBe(404);
  });

  it("reads a thread with a valid customer assertion (party member)", async () => {
    const harness = buildAssertedApp("enforce");
    const assertion = mintCustomerAssertion(harness);
    const thread = await openThread(harness, assertion);
    const threadId = thread.id as string;
    const response = await harness.app.inject(
      signedRequest(harness, "GET", `/negotiations/${threadId}`, {
        obo: CUSTOMER_ID,
        assertion,
      }),
    );
    expect(response.statusCode).toBe(200);
  });

  it("rejects reading a thread as a non-party (404)", async () => {
    const harness = buildAssertedApp("enforce");
    const assertion = mintCustomerAssertion(harness);
    const thread = await openThread(harness, assertion);
    const threadId = thread.id as string;
    const otherAssertion = mintCustomerAssertion(harness, "WS-9999999999");
    const response = await harness.app.inject(
      signedRequest(harness, "GET", `/negotiations/${threadId}`, {
        obo: "WS-9999999999",
        assertion: otherAssertion,
      }),
    );
    expect(response.statusCode).toBe(404);
  });

  it("runs /tick without assertion in enforce mode (system-only)", async () => {
    const harness = buildAssertedApp("enforce");
    const response = await harness.app.inject(
      signedRequest(harness, "POST", "/negotiations/tick", {
        idempotencyKey: "tick-enf-00001",
      }),
    );
    expect(response.statusCode).toBe(200);
  });

  it("accepts a round with a valid customer assertion", async () => {
    const harness = buildAssertedApp("enforce");
    const assertion = mintCustomerAssertion(harness);
    const thread = await openThread(harness, assertion);
    const threadId = thread.id as string;

    const driverAssertion = mintDriverAssertion(harness);
    const proposeResponse = await harness.app.inject(
      signedRequest(harness, "POST", `/negotiations/${threadId}/rounds`, {
        obo: DRIVER_ID,
        assertion: driverAssertion,
        serviceName: "driver-bot",
        body: {
          proposed_by: "driver",
          amount_minor: 2900,
          currency: "SAR",
          expected_round_no: 0,
          note: "counter",
          source_locale: "ar",
        },
        idempotencyKey: "enf-propose-01",
      }),
    );
    expect(proposeResponse.statusCode).toBe(201);

    const acceptResponse = await harness.app.inject(
      signedRequest(harness, "POST", `/negotiations/${threadId}/rounds/1/accept`, {
        obo: CUSTOMER_ID,
        assertion,
        body: { acting_party: "customer", note: "accepted", source_locale: "ar" },
        idempotencyKey: "enf-accept-001",
      }),
    );
    expect(acceptResponse.statusCode).toBe(201);
  });

  it("rejects accept with wrong acting_party (404)", async () => {
    const harness = buildAssertedApp("enforce");
    const assertion = mintCustomerAssertion(harness);
    const thread = await openThread(harness, assertion);
    const threadId = thread.id as string;

    const driverAssertion = mintDriverAssertion(harness);
    await harness.app.inject(
      signedRequest(harness, "POST", `/negotiations/${threadId}/rounds`, {
        obo: DRIVER_ID,
        assertion: driverAssertion,
        serviceName: "driver-bot",
        body: {
          proposed_by: "driver",
          amount_minor: 2900,
          currency: "SAR",
          expected_round_no: 0,
          note: "counter",
          source_locale: "ar",
        },
        idempotencyKey: "enf-propose-02",
      }),
    );

    const acceptResponse = await harness.app.inject(
      signedRequest(harness, "POST", `/negotiations/${threadId}/rounds/1/accept`, {
        obo: CUSTOMER_ID,
        assertion,
        body: { acting_party: "driver", note: "wrong", source_locale: "ar" },
        idempotencyKey: "enf-accept-w01",
      }),
    );
    expect(acceptResponse.statusCode).toBe(404);
  });
});
