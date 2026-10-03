/**
 * ADR-060 P2 (CLM-0442): user assertion ownership on matching candidacy routes.
 *
 * Tests the three modes:
 * - `off` (default): no assertion verification, behavior unchanged (compatibility).
 * - `observe`: assertion is verified and `endUser` is set, but no request is rejected.
 * - `enforce`: assertion is required; mismatched driver returns 404 (not 403).
 *
 * System-only routes (`POST /matching/candidates`, `GET /matching/rulesets`,
 * `GET /matching/decisions/:decisionId`) stay `scoped()` and never require an assertion.
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

import { createMatchingApp } from "../http/app.js";
import { MATCHING_SCOPES, MATCHING_SERVICE_AUDIENCE } from "../http/service-identity.js";
import { createDirectRunner } from "../runner.js";
import { createHarness, ORDER_ID, ORDER_PUBLIC_ID, ZONE_PICKUP } from "./harness.js";
import { DRIVER_ID, IDEMPOTENCY_KEY } from "./http-support.js";

const TEST_SERVICE_SECRET = "matching-test-secret-0123456789abcdef";
const TEST_ACTIVE_KID = "test-active";
const ALL_SCOPES = Object.values(MATCHING_SCOPES);
const OTHER_DRIVER = "WS-0000000099";

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
  const deps = createHarness();
  const keys = createTestKeyRegistry();
  const replayGuard = new InMemoryServiceTokenReplayGuard();
  const { signingKey, publicKeys } = generateTestKeys();

  const app = createMatchingApp({
    runner: createDirectRunner(deps),
    serviceIdentity: {
      keys,
      replayGuard,
      userAssertion: { mode, publicKeys },
    },
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
    serviceName: options.serviceName ?? "drivers",
    audience: MATCHING_SERVICE_AUDIENCE,
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

function mintDriverAssertion(harness: AssertedHarness, publicId: string = DRIVER_ID): string {
  return mintUserAssertion({
    key: harness.signingKey,
    sub: publicId,
    act: "driver",
    chn: "telegram",
    via: "driver-bot",
    aud: ["matching"],
    now: new Date(),
  }).assertion;
}

function candidacyPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    availability_state: "available",
    eligibility_state: "eligible",
    service_kinds: ["ride"],
    vehicle_class: "sedan",
    zone_ids: [ZONE_PICKUP],
    ...overrides,
  };
}

function candidatePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: ORDER_ID,
    order_public_id: ORDER_PUBLIC_ID,
    order_type: "ride",
    vehicle_class: "sedan",
    pickup_zone_id: ZONE_PICKUP,
    ...overrides,
  };
}

// ── off mode: compatibility ──────────────────────────────────────────

describe("CLM-0442 · off mode (compatibility)", () => {
  it("PUT /candidacy/:driverPublicId succeeds without assertion (off mode)", async () => {
    const harness = buildAssertedApp("off");
    const response = await harness.rawInject(
      signedRequest(harness, "PUT", `/candidacy/${DRIVER_ID}`, {
        obo: DRIVER_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        body: candidacyPayload(),
      }),
    );
    expect(response.statusCode).toBe(200);
    await harness.app.close();
  });

  it("GET /candidacy/:driverPublicId succeeds without assertion (off mode)", async () => {
    const harness = buildAssertedApp("off");
    // First upsert
    await harness.rawInject(
      signedRequest(harness, "PUT", `/candidacy/${DRIVER_ID}`, {
        obo: DRIVER_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        body: candidacyPayload(),
      }),
    );
    const response = await harness.rawInject(
      signedRequest(harness, "GET", `/candidacy/${DRIVER_ID}`, { obo: DRIVER_ID }),
    );
    expect(response.statusCode).toBe(200);
    await harness.app.close();
  });

  it("POST /candidacy/:driverPublicId/availability succeeds without assertion (off mode)", async () => {
    const harness = buildAssertedApp("off");
    // First upsert
    await harness.rawInject(
      signedRequest(harness, "PUT", `/candidacy/${DRIVER_ID}`, {
        obo: DRIVER_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        body: candidacyPayload(),
      }),
    );
    const response = await harness.rawInject(
      signedRequest(harness, "POST", `/candidacy/${DRIVER_ID}/availability`, {
        obo: DRIVER_ID,
        idempotencyKey: `${IDEMPOTENCY_KEY}-2`,
        body: { availability_state: "busy" },
      }),
    );
    expect(response.statusCode).toBe(200);
    await harness.app.close();
  });
});

// ── enforce mode: ownership enforcement ─────────────────────────────

describe("CLM-0442 · enforce mode (ownership)", () => {
  it("PUT /candidacy/:driverPublicId with matching assertion → 200", async () => {
    const harness = buildAssertedApp("enforce");
    const assertion = mintDriverAssertion(harness, DRIVER_ID);
    const response = await harness.rawInject(
      signedRequest(harness, "PUT", `/candidacy/${DRIVER_ID}`, {
        obo: DRIVER_ID,
        assertion,
        idempotencyKey: IDEMPOTENCY_KEY,
        body: candidacyPayload(),
      }),
    );
    expect(response.statusCode).toBe(200);
    await harness.app.close();
  });

  it("PUT /candidacy/:driverPublicId with mismatched assertion → 404", async () => {
    const harness = buildAssertedApp("enforce");
    const assertion = mintDriverAssertion(harness, OTHER_DRIVER);
    const response = await harness.rawInject(
      signedRequest(harness, "PUT", `/candidacy/${DRIVER_ID}`, {
        obo: OTHER_DRIVER,
        assertion,
        idempotencyKey: IDEMPOTENCY_KEY,
        body: candidacyPayload(),
      }),
    );
    expect(response.statusCode).toBe(404);
    await harness.app.close();
  });

  it("GET /candidacy/:driverPublicId with matching assertion → 200", async () => {
    const harness = buildAssertedApp("enforce");
    const assertion = mintDriverAssertion(harness, DRIVER_ID);
    // First upsert with matching assertion
    await harness.rawInject(
      signedRequest(harness, "PUT", `/candidacy/${DRIVER_ID}`, {
        obo: DRIVER_ID,
        assertion,
        idempotencyKey: IDEMPOTENCY_KEY,
        body: candidacyPayload(),
      }),
    );
    const response = await harness.rawInject(
      signedRequest(harness, "GET", `/candidacy/${DRIVER_ID}`, {
        obo: DRIVER_ID,
        assertion,
      }),
    );
    expect(response.statusCode).toBe(200);
    await harness.app.close();
  });

  it("GET /candidacy/:driverPublicId with mismatched assertion → 404", async () => {
    const harness = buildAssertedApp("enforce");
    const assertion = mintDriverAssertion(harness, DRIVER_ID);
    // First upsert with matching assertion
    await harness.rawInject(
      signedRequest(harness, "PUT", `/candidacy/${DRIVER_ID}`, {
        obo: DRIVER_ID,
        assertion,
        idempotencyKey: IDEMPOTENCY_KEY,
        body: candidacyPayload(),
      }),
    );
    const otherAssertion = mintDriverAssertion(harness, OTHER_DRIVER);
    const response = await harness.rawInject(
      signedRequest(harness, "GET", `/candidacy/${DRIVER_ID}`, {
        obo: OTHER_DRIVER,
        assertion: otherAssertion,
      }),
    );
    expect(response.statusCode).toBe(404);
    await harness.app.close();
  });

  it("POST /candidacy/:driverPublicId/availability with matching assertion → 200", async () => {
    const harness = buildAssertedApp("enforce");
    const assertion = mintDriverAssertion(harness, DRIVER_ID);
    // First upsert
    await harness.rawInject(
      signedRequest(harness, "PUT", `/candidacy/${DRIVER_ID}`, {
        obo: DRIVER_ID,
        assertion,
        idempotencyKey: IDEMPOTENCY_KEY,
        body: candidacyPayload(),
      }),
    );
    const response = await harness.rawInject(
      signedRequest(harness, "POST", `/candidacy/${DRIVER_ID}/availability`, {
        obo: DRIVER_ID,
        assertion,
        idempotencyKey: `${IDEMPOTENCY_KEY}-2`,
        body: { availability_state: "busy" },
      }),
    );
    expect(response.statusCode).toBe(200);
    await harness.app.close();
  });

  it("POST /candidacy/:driverPublicId/availability with mismatched assertion → 404", async () => {
    const harness = buildAssertedApp("enforce");
    const assertion = mintDriverAssertion(harness, DRIVER_ID);
    // First upsert with matching assertion
    await harness.rawInject(
      signedRequest(harness, "PUT", `/candidacy/${DRIVER_ID}`, {
        obo: DRIVER_ID,
        assertion,
        idempotencyKey: IDEMPOTENCY_KEY,
        body: candidacyPayload(),
      }),
    );
    const otherAssertion = mintDriverAssertion(harness, OTHER_DRIVER);
    const response = await harness.rawInject(
      signedRequest(harness, "POST", `/candidacy/${DRIVER_ID}/availability`, {
        obo: OTHER_DRIVER,
        assertion: otherAssertion,
        idempotencyKey: `${IDEMPOTENCY_KEY}-2`,
        body: { availability_state: "busy" },
      }),
    );
    expect(response.statusCode).toBe(404);
    await harness.app.close();
  });

  it("POST /matching/candidates (system route) ignores assertion and works", async () => {
    const harness = buildAssertedApp("enforce");
    const assertion = mintDriverAssertion(harness, DRIVER_ID);
    const response = await harness.rawInject(
      signedRequest(harness, "POST", "/matching/candidates", {
        obo: DRIVER_ID,
        assertion,
        idempotencyKey: IDEMPOTENCY_KEY,
        body: candidatePayload(),
      }),
    );
    expect(response.statusCode).toBe(200);
    await harness.app.close();
  });

  it("GET /matching/rulesets (system route) ignores assertion and works", async () => {
    const harness = buildAssertedApp("enforce");
    const assertion = mintDriverAssertion(harness, DRIVER_ID);
    const response = await harness.rawInject(
      signedRequest(harness, "GET", "/matching/rulesets", {
        obo: DRIVER_ID,
        assertion,
      }),
    );
    expect(response.statusCode).toBe(200);
    await harness.app.close();
  });
});

// ── observe mode: no rejection, endUser is set ──────────────────────

describe("CLM-0442 · observe mode (no rejection)", () => {
  it("PUT /candidacy/:driverPublicId without assertion → 200 (observe does not require assertion)", async () => {
    const harness = buildAssertedApp("observe");
    const response = await harness.rawInject(
      signedRequest(harness, "PUT", `/candidacy/${DRIVER_ID}`, {
        obo: DRIVER_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        body: candidacyPayload(),
      }),
    );
    expect(response.statusCode).toBe(200);
    await harness.app.close();
  });

  it("GET /candidacy/:driverPublicId without assertion → 200 (observe does not require assertion)", async () => {
    const harness = buildAssertedApp("observe");
    // First upsert
    await harness.rawInject(
      signedRequest(harness, "PUT", `/candidacy/${DRIVER_ID}`, {
        obo: DRIVER_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        body: candidacyPayload(),
      }),
    );
    const response = await harness.rawInject(
      signedRequest(harness, "GET", `/candidacy/${DRIVER_ID}`, { obo: DRIVER_ID }),
    );
    expect(response.statusCode).toBe(200);
    await harness.app.close();
  });
});
