/**
 * ADR-060 P2 (CLM-0463) — asserted ownership on the remaining identity
 * `:waslaPublicId` routes:
 *
 *   GET  /identity/users/:waslaPublicId
 *   POST /identity/users/:waslaPublicId/recovery
 *   GET  /identity/users/:waslaPublicId/history
 *
 * Each route's `:waslaPublicId` must match the end-user assertion's `sub`.
 * Mismatch → 404 (IDENTITY_NOT_FOUND) per ADR-060 §2.6.
 */
import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { InMemoryServiceTokenReplayGuard } from "@wasla/service-auth";
import { userAssertionSigningKey } from "@wasla/service-auth/user-assertion";

import { createIdentityApp } from "../../http/app.js";
import { IDENTITY_SCOPES } from "../../http/service-identity.js";
import { buildInMemoryDeps, createTestKeyRegistry, signFor } from "./support.js";

const NOW = new Date("2026-10-04T10:00:00.000Z");
const RESOLVE = "/identity/resolve";
const ASSERTIONS = "/identity/assertions";
const USER = (id: string) => `/identity/users/${id}`;
const RECOVERY = (id: string) => `/identity/users/${id}/recovery`;
const HISTORY = (id: string) => `/identity/users/${id}/history`;

const pair = generateKeyPairSync("ed25519");
const SIGNING_KEY = userAssertionSigningKey("ua-test-1", pair.privateKey);
const PUBLIC_KEYS = new Map([["ua-test-1", pair.publicKey]]);

const resolveScope = [IDENTITY_SCOPES.resolveWrite];
const issueScope = [IDENTITY_SCOPES.assertionIssue];
const userReadScope = [IDENTITY_SCOPES.userRead];
const recoveryWriteScope = [IDENTITY_SCOPES.recoveryWrite];
const historyReadScope = [IDENTITY_SCOPES.historyRead];

interface RouteCase {
  readonly label: string;
  readonly method: "GET" | "POST";
  readonly path: (id: string) => string;
  readonly scope: readonly string[];
  readonly payload?: Record<string, unknown>;
  readonly expectedStatus: number;
}

const ROUTES: readonly RouteCase[] = [
  { label: "GET /identity/users/:waslaPublicId", method: "GET", path: USER, scope: userReadScope, expectedStatus: 200 },
  { label: "POST /identity/users/:waslaPublicId/recovery", method: "POST", path: RECOVERY, scope: recoveryWriteScope, payload: { verification_method: "phone_otp" }, expectedStatus: 202 },
  { label: "GET /identity/users/:waslaPublicId/history", method: "GET", path: HISTORY, scope: historyReadScope, expectedStatus: 200 },
];

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

  const sign = (method: string, url: string, opts: { scopes?: readonly string[]; onBehalfOfPublicId?: string } = {}) =>
    signFor(method, url, {
      keys,
      serviceName: "customer-bot",
      scopes: opts.scopes ?? userReadScope,
      now: NOW,
      ...(opts.onBehalfOfPublicId === undefined ? {} : { onBehalfOfPublicId: opts.onBehalfOfPublicId }),
    });

  return { app, deps, sign, keys };
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
): Promise<{ assertion: string; publicId: string }> {
  const publicId = await seedUser(h, telegramUserId);
  const res = await h.app.inject({
    method: "POST",
    url: ASSERTIONS,
    payload: { telegram_user_id: telegramUserId, actor_type: "customer", audience: ["identity"] },
    headers: signFor("POST", ASSERTIONS, { keys: h.keys, serviceName: "customer-bot", scopes: issueScope, now: NOW }),
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { assertion: string };
  return { assertion: body.assertion, publicId };
}

describe("ADR-060 P2 (CLM-0463) — identity user/recovery/history asserted ownership", () => {
  for (const route of ROUTES) {
    describe(route.label, () => {
      it("enforce: owner can access their own data", async () => {
        const h = enforceHarness();
        const { assertion, publicId } = await issueAssertion(h, 78001);

        const headers = h.sign(route.method, route.path(publicId), {
          scopes: route.scope,
          onBehalfOfPublicId: publicId,
        });
        const res = await h.app.inject({
          method: route.method,
          url: route.path(publicId),
          ...(route.payload ? { payload: route.payload } : {}),
          headers: { ...headers, "x-wasla-user-assertion": assertion },
        });
        expect(res.statusCode).toBe(route.expectedStatus);
        await h.app.close();
      });

      it("enforce: accessing another user's data → 404 (IDENTITY_NOT_FOUND)", async () => {
        const h = enforceHarness();
        const { assertion, publicId: aId } = await issueAssertion(h, 78002);
        const bId = await seedUser(h, 78003);

        const headers = h.sign(route.method, route.path(bId), {
          scopes: route.scope,
          onBehalfOfPublicId: aId,
        });
        const res = await h.app.inject({
          method: route.method,
          url: route.path(bId),
          ...(route.payload ? { payload: route.payload } : {}),
          headers: { ...headers, "x-wasla-user-assertion": assertion },
        });
        expect(res.statusCode).toBe(404);
        expect(res.json<{ code: string }>().code).toBe("IDENTITY_NOT_FOUND");
        await h.app.close();
      });
    });
  }

  it("enforce: no user assertion on any of the three routes → 401", async () => {
    const h = enforceHarness();
    const publicId = await seedUser(h, 78004);

    for (const route of ROUTES) {
      const res = await h.app.inject({
        method: route.method,
        url: route.path(publicId),
        ...(route.payload ? { payload: route.payload } : {}),
        headers: h.sign(route.method, route.path(publicId), { scopes: route.scope }),
      });
      expect(res.statusCode).toBe(401);
    }
    await h.app.close();
  });

  it("off (default): backward compatible — no assertion needed, routes work as before", async () => {
    const keys = createTestKeyRegistry();
    const deps = buildInMemoryDeps();
    const app = createIdentityApp({
      deps,
      logger: false,
      serviceIdentity: { keys, replayGuard: new InMemoryServiceTokenReplayGuard() },
    });

    const created = await app.inject({
      method: "POST",
      url: RESOLVE,
      payload: { telegram_user_id: 78005, source: "customer_bot" },
      headers: signFor("POST", RESOLVE, { keys, serviceName: "customer-bot", scopes: resolveScope }),
    });
    const publicId = (created.json() as { wasla_public_id: string }).wasla_public_id;

    // GET user
    const userRes = await app.inject({
      method: "GET",
      url: USER(publicId),
      headers: signFor("GET", USER(publicId), { keys, serviceName: "customer-bot", scopes: userReadScope }),
    });
    expect(userRes.statusCode).toBe(200);

    // POST recovery
    const recRes = await app.inject({
      method: "POST",
      url: RECOVERY(publicId),
      payload: { verification_method: "phone_otp" },
      headers: signFor("POST", RECOVERY(publicId), { keys, serviceName: "customer-bot", scopes: recoveryWriteScope }),
    });
    expect(recRes.statusCode).toBe(202);

    // GET history
    const histRes = await app.inject({
      method: "GET",
      url: HISTORY(publicId),
      headers: signFor("GET", HISTORY(publicId), { keys, serviceName: "customer-bot", scopes: historyReadScope }),
    });
    expect(histRes.statusCode).toBe(200);

    await app.close();
  });

  it("enforce: tampered assertion is rejected (401)", async () => {
    const h = enforceHarness();
    const { publicId } = await issueAssertion(h, 78006);

    const issueRes = await h.app.inject({
      method: "POST",
      url: ASSERTIONS,
      payload: { telegram_user_id: 78006, actor_type: "customer", audience: ["identity"] },
      headers: signFor("POST", ASSERTIONS, { keys: h.keys, serviceName: "customer-bot", scopes: issueScope, now: NOW }),
    });
    const { assertion } = issueRes.json() as { assertion: string };

    const [header, payload, sig] = assertion.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    decoded.sub = "WS-0000000099";
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    const tampered = `${header}.${tamperedPayload}.${sig}`;

    const headers = h.sign("GET", USER(publicId), {
      scopes: userReadScope,
      onBehalfOfPublicId: publicId,
    });
    const res = await h.app.inject({
      method: "GET",
      url: USER(publicId),
      headers: { ...headers, "x-wasla-user-assertion": tampered },
    });
    expect(res.statusCode).toBe(401);
    await h.app.close();
  });
});
