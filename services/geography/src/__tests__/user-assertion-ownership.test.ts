/**
 * ADR-060 P2 (CLM-0474): user assertion ownership on geography routes.
 *
 * Tests the three modes for G1, G2, G3:
 * - `off` (default): no assertion verification, behavior unchanged (compatibility).
 * - `observe`: assertion is verified and `endUser` is set, but no request is rejected.
 * - `enforce`: assertion is required; mismatched `:waslaPublicId` returns 404.
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

import { createGeographyApp } from "../http/app.js";
import { GEO_SCOPES, GEOGRAPHY_SERVICE_AUDIENCE } from "../http/service-identity.js";
import type { UseCaseDeps } from "../use-cases/deps.js";
import {
  SAUDI_FIXTURE_IDS,
  InMemoryGeographyRepository,
  InMemoryOutbox,
  InMemoryIdentityLookupPort,
  SystemClock,
  CryptoIdGenerator,
} from "../infrastructure/in-memory.js";

const TEST_SERVICE_SECRET = "geography-test-secret-0123456789ab";
const TEST_ACTIVE_KID = "test-active";
const ALL_SCOPES = Object.values(GEO_SCOPES);
const USER = "WS-0000000001";
const OTHER_USER = "WS-0000000002";

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

function buildDeps(): UseCaseDeps {
  return {
    repo: new InMemoryGeographyRepository(),
    outbox: new InMemoryOutbox(),
    clock: new SystemClock(),
    idGen: new CryptoIdGenerator(),
    identityLookup: new InMemoryIdentityLookupPort([USER, OTHER_USER]),
  };
}

interface AssertedHarness {
  readonly app: FastifyInstance;
  readonly keys: ServiceAuthKeyRegistry;
  readonly signingKey: UserAssertionSigningKey;
  readonly rawInject: (options: InjectOptions) => Promise<LightMyRequestResponse>;
}

function buildAssertedApp(mode: "off" | "observe" | "enforce"): AssertedHarness {
  const keys = createTestKeyRegistry();
  const replayGuard = new InMemoryServiceTokenReplayGuard();
  const { signingKey, publicKeys } = generateTestKeys();

  const app = createGeographyApp({
    deps: buildDeps(),
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
    serviceName?: string;
  } = {},
): InjectOptions {
  const headers = serviceAuthHeaders({
    serviceName: options.serviceName ?? "customer-bot",
    audience: GEOGRAPHY_SERVICE_AUDIENCE,
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
      ...(options.assertion ? { [USER_ASSERTION_HEADER]: options.assertion } : {}),
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    },
  };

  if (options.body !== undefined) {
    result.payload = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  return result;
}

function mintAssertion(harness: AssertedHarness, publicId: string, act: "customer" | "driver" = "customer"): string {
  return mintUserAssertion({
    key: harness.signingKey,
    sub: publicId,
    act,
    chn: "telegram",
    via: "customer-bot",
    aud: ["geography"],
    now: new Date(),
  }).assertion;
}

const ZONE_ID = SAUDI_FIXTURE_IDS.zoneHaraEast;

describe("Geography ADR-060 P2 (CLM-0474): user assertion ownership", () => {
  describe("G1 — GET /geo/users/:waslaPublicId/location", () => {
    it("off mode: no assertion needed, behavior unchanged", async () => {
      const h = buildAssertedApp("off");
      // Seed a location first
      await h.app.inject(signedRequest(h, "PUT", `/geo/users/${USER}/location`, {
        body: { zone_id: ZONE_ID, source: "customer_bot" },
      }));
      const res = await h.app.inject(signedRequest(h, "GET", `/geo/users/${USER}/location`));
      expect(res.statusCode).toBe(200);
    });

    it("enforce mode: matching user reads own location", async () => {
      const h = buildAssertedApp("enforce");
      // Seed
      await h.app.inject(signedRequest(h, "PUT", `/geo/users/${USER}/location`, {
        body: { zone_id: ZONE_ID, source: "customer_bot" },
        obo: USER,
        assertion: mintAssertion(h, USER),
      }));
      const res = await h.app.inject(signedRequest(h, "GET", `/geo/users/${USER}/location`, {
        obo: USER,
        assertion: mintAssertion(h, USER),
      }));
      expect(res.statusCode).toBe(200);
    });

    it("enforce mode: mismatched user gets 404", async () => {
      const h = buildAssertedApp("enforce");
      // Seed for USER
      await h.app.inject(signedRequest(h, "PUT", `/geo/users/${USER}/location`, {
        body: { zone_id: ZONE_ID, source: "customer_bot" },
        obo: USER,
        assertion: mintAssertion(h, USER),
      }));
      // OTHER_USER tries to read USER's location
      const res = await h.app.inject(signedRequest(h, "GET", `/geo/users/${USER}/location`, {
        obo: OTHER_USER,
        assertion: mintAssertion(h, OTHER_USER),
      }));
      expect(res.statusCode).toBe(404);
    });

    it("observe mode: mismatched user still succeeds (would_reject logged)", async () => {
      const h = buildAssertedApp("observe");
      await h.app.inject(signedRequest(h, "PUT", `/geo/users/${USER}/location`, {
        body: { zone_id: ZONE_ID, source: "customer_bot" },
        obo: USER,
        assertion: mintAssertion(h, USER),
      }));
      const res = await h.app.inject(signedRequest(h, "GET", `/geo/users/${USER}/location`, {
        obo: OTHER_USER,
        assertion: mintAssertion(h, OTHER_USER),
      }));
      expect(res.statusCode).toBe(200);
    });
  });

  describe("G2 — PUT /geo/users/:waslaPublicId/location", () => {
    it("enforce mode: matching user writes own location", async () => {
      const h = buildAssertedApp("enforce");
      const res = await h.app.inject(signedRequest(h, "PUT", `/geo/users/${USER}/location`, {
        body: { zone_id: ZONE_ID, source: "customer_bot" },
        obo: USER,
        assertion: mintAssertion(h, USER),
      }));
      expect(res.statusCode).toBe(201);
    });

    it("enforce mode: mismatched user gets 404", async () => {
      const h = buildAssertedApp("enforce");
      const res = await h.app.inject(signedRequest(h, "PUT", `/geo/users/${USER}/location`, {
        body: { zone_id: ZONE_ID, source: "customer_bot" },
        obo: OTHER_USER,
        assertion: mintAssertion(h, OTHER_USER),
      }));
      expect(res.statusCode).toBe(404);
    });
  });

  describe("G3 — GET /geo/users/:waslaPublicId/location/history", () => {
    it("enforce mode: matching user reads own history", async () => {
      const h = buildAssertedApp("enforce");
      // Seed a location to create history
      await h.app.inject(signedRequest(h, "PUT", `/geo/users/${USER}/location`, {
        body: { zone_id: ZONE_ID, source: "customer_bot" },
        obo: USER,
        assertion: mintAssertion(h, USER),
      }));
      const res = await h.app.inject(signedRequest(h, "GET", `/geo/users/${USER}/location/history`, {
        obo: USER,
        assertion: mintAssertion(h, USER),
      }));
      expect(res.statusCode).toBe(200);
    });

    it("enforce mode: mismatched user gets 404", async () => {
      const h = buildAssertedApp("enforce");
      // Seed for USER
      await h.app.inject(signedRequest(h, "PUT", `/geo/users/${USER}/location`, {
        body: { zone_id: ZONE_ID, source: "customer_bot" },
        obo: USER,
        assertion: mintAssertion(h, USER),
      }));
      // OTHER_USER tries to read USER's history
      const res = await h.app.inject(signedRequest(h, "GET", `/geo/users/${USER}/location/history`, {
        obo: OTHER_USER,
        assertion: mintAssertion(h, OTHER_USER),
      }));
      expect(res.statusCode).toBe(404);
    });
  });
});
