/**
 * HTTP layer tests for createIdentityApp (MR 3).
 *
 * Uses Fastify's app.inject (no real port) with in-memory adapters. Verifies
 * routing, status-code mapping (per contracts/errors.md), the contract Error
 * body shape, and response-body shapes from @wasla/contracts-identity.
 *
 * Domain logic is already covered by the use-case unit tests; these tests
 * focus on the HTTP boundary.
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  createIdentityApp,
} from "../../http/app.js";
import type { UseCaseDeps } from "../../use-cases/resolve-telegram-identity.js";
import {
  SystemClock,
  CryptoIdGenerator,
  InMemoryIdentityRepository,
  InMemoryOutbox,
  InMemoryPublicIdSequence,
} from "../../index.js";

import { createIdentityHttpHarness } from "./support.js";

function buildDeps(): UseCaseDeps {
  return {
    repo: new InMemoryIdentityRepository(),
    outbox: new InMemoryOutbox(),
    publicIdSeq: new InMemoryPublicIdSequence(),
    clock: new SystemClock(),
    idGen: new CryptoIdGenerator(),
  };
}

/**
 * `M1-04`: الحدُّ يفرضُ هويّةَ الخدمةِ، فاختباراتُ العقدِ تُنادى **موقَّعةً**.
 * والتوقيعُ يُلَفُّ في `createIdentityHttpHarness` لا يُكرَّرُ في كلِّ نداءٍ —
 * وإثباتُ الفرضِ نفسِه في `service-identity.test.ts` بـ`rawInject` بلا توقيعٍ.
 */
function buildApp(deps: UseCaseDeps): ReturnType<typeof createIdentityApp> {
  return createIdentityHttpHarness(deps).app;
}

describe("Identity HTTP app — /identity/resolve", () => {
  let deps: UseCaseDeps;
  beforeEach(() => {
    deps = buildDeps();
  });

  it("creates a new user (201) and is idempotent (200)", async () => {
    const app = buildApp(deps);

    const created = await app.inject({
      method: "POST",
      url: "/identity/resolve",
      payload: {
        telegram_user_id: 111222333,
        telegram_username: "ali",
        source: "customer_bot",
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json<{
      wasla_public_id: string;
      created: boolean;
    }>();
    expect(createdBody.wasla_public_id).toMatch(/^WS-[0-9]{10}$/);
    expect(createdBody.created).toBe(true);

    const again = await app.inject({
      method: "POST",
      url: "/identity/resolve",
      payload: {
        telegram_user_id: 111222333,
        telegram_username: "ali",
        source: "customer_bot",
      },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json<{ created: boolean }>().created).toBe(false);
    expect(again.json<{ wasla_public_id: string }>().wasla_public_id).toBe(
      createdBody.wasla_public_id,
    );

    await app.close();
  });

  it("returns 400 IDENTITY_MISSING_TELEGRAM_ID when telegram_user_id is missing", async () => {
    const app = buildApp(deps);
    const res = await app.inject({
      method: "POST",
      url: "/identity/resolve",
      payload: { telegram_username: "no_id" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string }>().code).toBe(
      "IDENTITY_MISSING_TELEGRAM_ID",
    );
    await app.close();
  });
});

describe("Identity HTTP app — /identity/users/:waslaPublicId", () => {
  let deps: UseCaseDeps;
  beforeEach(() => {
    deps = buildDeps();
  });

  it("returns 200 the user when found", async () => {
    const app = buildApp(deps);
    const created = await app.inject({
      method: "POST",
      url: "/identity/resolve",
      payload: { telegram_user_id: 1, telegram_username: "u1" },
    });
    const { wasla_public_id } = created.json<{
      wasla_public_id: string;
    }>();

    const got = await app.inject({
      method: "GET",
      url: `/identity/users/${wasla_public_id}`,
    });
    expect(got.statusCode).toBe(200);
    expect(got.json<{ wasla_public_id: string }>().wasla_public_id).toBe(
      wasla_public_id,
    );
    await app.close();
  });

  it("returns 404 IDENTITY_NOT_FOUND for a nonexistent user", async () => {
    const app = buildApp(deps);
    const res = await app.inject({
      method: "GET",
      url: "/identity/users/WS-0000000099",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ code: string }>().code).toBe("IDENTITY_NOT_FOUND");
    await app.close();
  });

  it("returns 400 IDENTITY_INVALID_PUBLIC_ID for a malformed id", async () => {
    const app = buildApp(deps);
    const res = await app.inject({
      method: "GET",
      url: "/identity/users/not-a-valid-id",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string }>().code).toBe(
      "IDENTITY_INVALID_PUBLIC_ID",
    );
    await app.close();
  });
});

describe("Identity HTTP app — /identity/users/:waslaPublicId/links", () => {
  let deps: UseCaseDeps;
  beforeEach(() => {
    deps = buildDeps();
  });

  it("adds a phone link (200) and rejects a bad provider (422)", async () => {
    const app = buildApp(deps);
    const created = await app.inject({
      method: "POST",
      url: "/identity/resolve",
      payload: { telegram_user_id: 2, telegram_username: "u2" },
    });
    const { wasla_public_id } = created.json<{
      wasla_public_id: string;
    }>();

    const added = await app.inject({
      method: "POST",
      url: `/identity/users/${wasla_public_id}/links`,
      payload: { provider: "phone", external_id: "+966500000000", verified: false },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json<{ provider: string; external_id: string }>())
      .toMatchObject({ provider: "phone", external_id: "+966500000000" });

    const bad = await app.inject({
      method: "POST",
      url: `/identity/users/${wasla_public_id}/links`,
      payload: { provider: "wechat", external_id: "x" },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json<{ code: string }>().code).toBe(
      "IDENTITY_LINK_INVALID_PROVIDER",
    );
    await app.close();
  });

  it("returns 409 IDENTITY_LINK_ALREADY_LINKED when the link belongs to another user", async () => {
    const app = buildApp(deps);
    // User A owns telegram id 10.
    await app.inject({
      method: "POST",
      url: "/identity/resolve",
      payload: { telegram_user_id: 10, telegram_username: "owner" },
    });
    // User B.
    const b = await app.inject({
      method: "POST",
      url: "/identity/resolve",
      payload: { telegram_user_id: 20, telegram_username: "other" },
    });
    const bId = b.json<{ wasla_public_id: string }>().wasla_public_id;

    const conflict = await app.inject({
      method: "POST",
      url: `/identity/users/${bId}/links`,
      payload: { provider: "telegram", external_id: "10" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<{ code: string }>().code).toBe(
      "IDENTITY_LINK_ALREADY_LINKED",
    );
    await app.close();
  });
});

describe("Identity HTTP app — /identity/users/:waslaPublicId/recovery", () => {
  let deps: UseCaseDeps;
  beforeEach(() => {
    deps = buildDeps();
  });

  it("starts recovery (202) and rejects an invalid method (422)", async () => {
    const app = buildApp(deps);
    const created = await app.inject({
      method: "POST",
      url: "/identity/resolve",
      payload: { telegram_user_id: 30, telegram_username: "u30" },
    });
    const { wasla_public_id } = created.json<{
      wasla_public_id: string;
    }>();

    const ok = await app.inject({
      method: "POST",
      url: `/identity/users/${wasla_public_id}/recovery`,
      payload: { verification_method: "phone_otp" },
    });
    expect(ok.statusCode).toBe(202);
    expect(ok.json<{ recovery_id: string; status: string }>().status).toBe(
      "verification_pending",
    );

    const bad = await app.inject({
      method: "POST",
      url: `/identity/users/${wasla_public_id}/recovery`,
      payload: { verification_method: "telegram_only" },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json<{ code: string }>().code).toBe(
      "IDENTITY_RECOVERY_METHOD_INVALID",
    );
    await app.close();
  });
});

describe("Identity HTTP app — /identity/users/:waslaPublicId/history", () => {
  it("returns 200 the history array", async () => {
    const deps = buildDeps();
    const app = buildApp(deps);
    const created = await app.inject({
      method: "POST",
      url: "/identity/resolve",
      payload: { telegram_user_id: 40, telegram_username: "v1" },
    });
    const { wasla_public_id } = created.json<{
      wasla_public_id: string;
    }>();

    const res = await app.inject({
      method: "GET",
      url: `/identity/users/${wasla_public_id}/history`,
    });
    expect(res.statusCode).toBe(200);
    const history = res.json<
      Array<{ field: string; new_value: string }>
    >();
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history.some((h) => h.field === "telegram_username")).toBe(true);
    await app.close();
  });
});
