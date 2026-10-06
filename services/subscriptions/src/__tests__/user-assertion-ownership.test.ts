/**
 * ADR-060 P2 (CLM-0476): user assertion ownership on subscriptions route — Batch 3.
 *
 * Tests the three modes for U1:
 * - `off` (default): no assertion verification, behavior unchanged (compatibility).
 * - `observe`: assertion is verified and `endUser` is set, but no request is rejected.
 * - `enforce`: assertion is required; mismatched ownership returns 404.
 *
 * U1: `GET /referrals` — filter `referrerPublicId` or `refereePublicId` must match `endUser.publicId`.
 */

import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import type { InjectOptions } from "fastify";

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

import { createSubscriptionApp, type SubscriptionAppServices } from "../http/app.js";
import { SUBSCRIPTIONS_SCOPES, SUBSCRIPTIONS_SERVICE_AUDIENCE } from "../http/service-identity.js";
import type { ReferralFilter, ReferralRecord } from "../db/referrals.js";
import {
  createTestKeyRegistry,
  ALL_SUBSCRIPTIONS_SCOPES,
} from "./service-identity-support.js";

const REPORTER = "WS-0000000100";
const OTHER_USER = "WS-0000000099";

/** Fake ReferralService that returns empty results without a database. */
class FakeReferralService {
  async list(_filter: ReferralFilter): Promise<ReadonlyArray<ReferralRecord>> {
    return [];
  }
  async getCode(_owner: string): Promise<never> {
    throw new Error("not implemented in test");
  }
  async claim(_input: unknown): Promise<never> {
    throw new Error("not implemented in test");
  }
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
  readonly app: ReturnType<typeof createSubscriptionApp>;
  readonly keys: ServiceAuthKeyRegistry;
  readonly signingKey: UserAssertionSigningKey;
}

function buildAssertedApp(mode: "off" | "observe" | "enforce"): AssertedHarness {
  const keys = createTestKeyRegistry();
  const replayGuard = new InMemoryServiceTokenReplayGuard();
  const { signingKey, publicKeys } = generateTestKeys();

  const services = {
    subscriptions: {} as never,
    referrals: new FakeReferralService() as unknown as never,
  } as SubscriptionAppServices;

  const app = createSubscriptionApp({
    services,
    mode: "postgres",
    logger: false,
    serviceIdentity: { keys, replayGuard },
    userAssertion: { mode, publicKeys },
  });

  return { app, keys, signingKey };
}

function signedRequest(
  harness: AssertedHarness,
  method: string,
  url: string,
  options: {
    obo?: string;
    assertion?: string;
  } = {},
): InjectOptions {
  const headers = serviceAuthHeaders({
    serviceName: "customer-bot",
    audience: SUBSCRIPTIONS_SERVICE_AUDIENCE,
    method: method.toUpperCase(),
    path: url,
    keys: harness.keys,
    now: new Date(),
    scopes: ALL_SUBSCRIPTIONS_SCOPES,
    ...(options.obo !== undefined ? { onBehalfOfPublicId: options.obo } : {}),
  });

  return {
    method: method as InjectOptions["method"],
    url,
    headers: {
      ...headers,
      ...(options.assertion ? { [USER_ASSERTION_HEADER]: options.assertion } : {}),
    },
  };
}

function mintAssertion(harness: AssertedHarness, publicId: string): string {
  return mintUserAssertion({
    key: harness.signingKey,
    sub: publicId,
    act: "customer",
    chn: "telegram",
    via: "customer-bot",
    aud: ["subscriptions"],
    now: new Date(),
  }).assertion;
}

describe("Subscriptions ADR-060 P2 (CLM-0476): user assertion ownership > U1 — GET /referrals", () => {
  it("off mode: no assertion needed, behavior unchanged", async () => {
    const h = buildAssertedApp("off");
    const res = await h.app.inject(
      signedRequest(h, "GET", "/referrals?referrer_public_id=" + REPORTER),
    );
    expect(res.statusCode).toBe(200);
    await h.app.close();
  });

  it("enforce mode: matching referrer reads referrals", async () => {
    const h = buildAssertedApp("enforce");
    const res = await h.app.inject(
      signedRequest(h, "GET", "/referrals?referrer_public_id=" + REPORTER, {
        obo: REPORTER,
        assertion: mintAssertion(h, REPORTER),
      }),
    );
    expect(res.statusCode).toBe(200);
    await h.app.close();
  });

  it("enforce mode: matching referee reads referrals", async () => {
    const h = buildAssertedApp("enforce");
    const res = await h.app.inject(
      signedRequest(h, "GET", "/referrals?referee_public_id=" + REPORTER, {
        obo: REPORTER,
        assertion: mintAssertion(h, REPORTER),
      }),
    );
    expect(res.statusCode).toBe(200);
    await h.app.close();
  });

  it("enforce mode: mismatched referrer returns 404", async () => {
    const h = buildAssertedApp("enforce");
    const res = await h.app.inject(
      signedRequest(h, "GET", "/referrals?referrer_public_id=" + OTHER_USER, {
        obo: REPORTER,
        assertion: mintAssertion(h, REPORTER),
      }),
    );
    expect(res.statusCode).toBe(404);
    await h.app.close();
  });

  it("enforce mode: mismatched referee returns 404", async () => {
    const h = buildAssertedApp("enforce");
    const res = await h.app.inject(
      signedRequest(h, "GET", "/referrals?referee_public_id=" + OTHER_USER, {
        obo: REPORTER,
        assertion: mintAssertion(h, REPORTER),
      }),
    );
    expect(res.statusCode).toBe(404);
    await h.app.close();
  });

  it("observe mode: mismatched referrer does not reject", async () => {
    const h = buildAssertedApp("observe");
    const res = await h.app.inject(
      signedRequest(h, "GET", "/referrals?referrer_public_id=" + OTHER_USER, {
        obo: REPORTER,
        assertion: mintAssertion(h, REPORTER),
      }),
    );
    expect(res.statusCode).toBe(200);
    await h.app.close();
  });

  it("enforce mode: no assertion returns 401", async () => {
    const h = buildAssertedApp("enforce");
    const res = await h.app.inject(
      signedRequest(h, "GET", "/referrals?referrer_public_id=" + REPORTER, {
        obo: REPORTER,
      }),
    );
    expect(res.statusCode).toBe(401);
    await h.app.close();
  });
});
