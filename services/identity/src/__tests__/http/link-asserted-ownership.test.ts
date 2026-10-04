/**
 * ADR-060 P2 (CLM-0462) — `POST /identity/users/:waslaPublicId/links` with
 * `beneficiary: "asserted"`.
 *
 * The path's `:waslaPublicId` must match the end-user assertion's `sub`. A
 * mismatch means the caller is trying to link an external identity to a user
 * that is not their own — the highest-impact gap named in RISK-0042 wave 3.
 *
 * Mismatch → 404 (IDENTITY_NOT_FOUND) per ADR-060 §2.6.
 *
 * These tests use the assertion issued by the Identity service itself — no
 * hand-written assertion payloads — and verify it against the public key.
 */
import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { InMemoryServiceTokenReplayGuard } from "@wasla/service-auth";
import {
  userAssertionSigningKey,
} from "@wasla/service-auth/user-assertion";

import { createIdentityApp } from "../../http/app.js";
import { IDENTITY_SCOPES } from "../../http/service-identity.js";
import { buildInMemoryDeps, createTestKeyRegistry, signFor } from "./support.js";

const NOW = new Date("2026-10-04T10:00:00.000Z");
const RESOLVE = "/identity/resolve";
const ASSERTIONS = "/identity/assertions";
const LINKS = (id: string) => `/identity/users/${id}/links`;

const pair = generateKeyPairSync("ed25519");
const SIGNING_KEY = userAssertionSigningKey("ua-test-1", pair.privateKey);
const PUBLIC_KEYS = new Map([["ua-test-1", pair.publicKey]]);

const linkScope = [IDENTITY_SCOPES.linkWrite];
const issueScope = [IDENTITY_SCOPES.assertionIssue];
const resolveScope = [IDENTITY_SCOPES.resolveWrite];

/**
 * Build a harness with `enforce` mode so `endUser` is set on verified
 * assertions, and `endUserOwnershipDenied` returns true on mismatch.
 */
function enforceHarness() {
  const keys = createTestKeyRegistry();
  const deps = buildInMemoryDeps();
  const app = createIdentityApp({
    deps,
    logger: false,
    serviceIdentity: { keys, replayGuard: new InMemoryServiceTokenReplayGuard(), now: () => NOW },
    userAssertion: { signingKey: SIGNING_KEY, now: () => NOW },
    userAssertionVerify: { mode: "enforce", publicKeys: PUBLIC_KEYS },
  });

  /** Sign a request for the Identity service. */
  const sign = (
    method: string,
    url: string,
    opts: { serviceName?: string; scopes?: readonly string[] } = {},
  ) =>
    signFor(method, url, {
      keys,
      serviceName: opts.serviceName ?? "customer-bot",
      scopes: opts.scopes ?? linkScope,
      now: NOW,
    });

  /** Issue a user assertion for the given telegram user, then use it in a link request. */
  const callWithAssertion = async (
    url: string,
    payload: Record<string, unknown>,
    assertion: string,
    obo: string,
    opts: { serviceName?: string; scopes?: readonly string[] } = {},
  ) => {
    const headers = signFor("POST", url, {
      keys,
      serviceName: opts.serviceName ?? "customer-bot",
      scopes: opts.scopes ?? linkScope,
      now: NOW,
      onBehalfOfPublicId: obo,
    });
    return app.inject({
      method: "POST",
      url,
      payload,
      headers: {
        ...headers,
        "x-wasla-user-assertion": assertion,
      },
    });
  };

  return { app, deps, sign, callWithAssertion, keys };
}

async function seedUser(h: ReturnType<typeof enforceHarness>, telegramUserId: number): Promise<string> {
  const res = await h.app.inject({
    method: "POST",
    url: RESOLVE,
    payload: { telegram_user_id: telegramUserId, source: "customer_bot" },
    headers: signFor("POST", RESOLVE, { keys: h.keys, serviceName: "customer-bot", scopes: resolveScope, now: NOW }),
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { wasla_public_id: string }).wasla_public_id;
}

async function issueAssertion(
  h: ReturnType<typeof enforceHarness>,
  telegramUserId: number,
  audience: readonly string[],
  serviceName: string,
): Promise<{ assertion: string; publicId: string }> {
  const publicId = await seedUser(h, telegramUserId);
  const res = await h.app.inject({
    method: "POST",
    url: ASSERTIONS,
    payload: { telegram_user_id: telegramUserId, actor_type: "customer", audience },
    headers: signFor("POST", ASSERTIONS, { keys: h.keys, serviceName, scopes: issueScope, now: NOW }),
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { assertion: string; wasla_public_id: string };
  return { assertion: body.assertion, publicId };
}

describe("ADR-060 P2 (CLM-0462) — POST /identity/users/:waslaPublicId/links asserted ownership", () => {
  it("enforce: the owner can link their own account (200)", async () => {
    const h = enforceHarness();
    const { assertion, publicId } = await issueAssertion(h, 77001, ["identity"], "customer-bot");

    const res = await h.callWithAssertion(
      LINKS(publicId),
      { provider: "phone", external_id: "+966500000001", verified: false },
      assertion,
      publicId,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json<{ provider: string; external_id: string }>())
      .toMatchObject({ provider: "phone", external_id: "+966500000001" });
    await h.app.close();
  });

  it("enforce: linking to another user's wasla_public_id → 404 (IDENTITY_NOT_FOUND)", async () => {
    const h = enforceHarness();
    // User A gets an assertion.
    const { assertion, publicId: aId } = await issueAssertion(h, 77002, ["identity"], "customer-bot");
    // User B exists.
    const bId = await seedUser(h, 77003);

    // A tries to link an external account to B.
    const res = await h.callWithAssertion(
      LINKS(bId),
      { provider: "phone", external_id: "+966500000002", verified: false },
      assertion,
      aId, // obo is A, path is B
    );
    expect(res.statusCode).toBe(404);
    expect(res.json<{ code: string }>().code).toBe("IDENTITY_NOT_FOUND");
    await h.app.close();
  });

  it("enforce: no user assertion → 401 (AUTHN_USER_ASSERTION_REQUIRED)", async () => {
    const h = enforceHarness();
    const publicId = await seedUser(h, 77004);

    // Signed service token but no user assertion header.
    const res = await h.app.inject({
      method: "POST",
      url: LINKS(publicId),
      payload: { provider: "phone", external_id: "+966500000003", verified: false },
      headers: h.sign("POST", LINKS(publicId)),
    });
    expect(res.statusCode).toBe(401);
    await h.app.close();
  });

  it("off (default): backward compatible — no assertion needed, links work as before", async () => {
    const keys = createTestKeyRegistry();
    const deps = buildInMemoryDeps();
    const app = createIdentityApp({
      deps,
      logger: false,
      serviceIdentity: { keys, replayGuard: new InMemoryServiceTokenReplayGuard() },
      // No userAssertionVerify → mode defaults to "off"
    });

    const created = await app.inject({
      method: "POST",
      url: RESOLVE,
      payload: { telegram_user_id: 77005, source: "customer_bot" },
      headers: signFor("POST", RESOLVE, { keys, serviceName: "customer-bot", scopes: resolveScope }),
    });
    const publicId = (created.json() as { wasla_public_id: string }).wasla_public_id;

    const res = await app.inject({
      method: "POST",
      url: LINKS(publicId),
      payload: { provider: "phone", external_id: "+966500000004", verified: false },
      headers: signFor("POST", LINKS(publicId), { keys, serviceName: "customer-bot", scopes: linkScope }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ provider: string }>().provider).toBe("phone");
    await app.close();
  });

  it("enforce: a tampered assertion is rejected (401)", async () => {
    const h = enforceHarness();
    const { publicId } = await issueAssertion(h, 77006, ["identity"], "customer-bot");

    // Issue a valid assertion, then tamper with the payload.
    const issueRes = await h.app.inject({
      method: "POST",
      url: ASSERTIONS,
      payload: { telegram_user_id: 77006, actor_type: "customer", audience: ["identity"] },
      headers: signFor("POST", ASSERTIONS, { keys: h.keys, serviceName: "customer-bot", scopes: issueScope, now: NOW }),
    });
    expect(issueRes.statusCode).toBe(200);
    const { assertion } = issueRes.json() as { assertion: string };

    // Tamper: change sub to a different user.
    const [header, payload, sig] = assertion.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    decoded.sub = "WS-0000000099";
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    const tampered = `${header}.${tamperedPayload}.${sig}`;

    const res = await h.callWithAssertion(
      LINKS(publicId),
      { provider: "phone", external_id: "+966500000005", verified: false },
      tampered,
      publicId,
    );
    expect(res.statusCode).toBe(401);
    await h.app.close();
  });
});
