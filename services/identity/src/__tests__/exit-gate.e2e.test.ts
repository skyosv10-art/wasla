/**
 * Phase 01 Exit Gate E2E test (MR 5).
 *
 * The Phase 01 Exit Gate is: "create a user from Telegram and identity stays
 * stable across Username change." This test exercises the full stack end to
 * end — Fastify HTTP routes → use cases → Drizzle/Postgres — against a real
 * Postgres, using app.inject (no listening port).
 *
 * Gated by DATABASE_URL; runs in CI via the `db-integration` job. Excluded
 * from the default `pnpm -r test` run (see vitest.config.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createDb,
  ensurePublicIdSequence,
  PostgresIdentityRepository,
  PostgresOutbox,
  PostgresPublicIdSequence,
  SystemClock,
  CryptoIdGenerator,
  createIdentityApp,
} from "../index.js";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = Boolean(DATABASE_URL);
const SCHEMA_SQL_PATH = resolve(process.cwd(), "contracts/schema.sql");

describe.skipIf(!ENABLED)("Phase 01 Exit Gate E2E (HTTP → Postgres)", () => {
  let pool: import("pg").Pool;
  let app: import("fastify").FastifyInstance;
  let outbox: PostgresOutbox;

  beforeAll(async () => {
    const created = createDb({ connectionString: DATABASE_URL! });
    pool = created.pool;
    const db = created.db;

    // Clean slate + canonical DDL + public-id sequence.
    await pool.query(
      "DROP TABLE IF EXISTS identity_outbox, identity_recovery_requests, identity_history, identity_links, identity_users CASCADE",
    );
    await pool.query(await readFile(SCHEMA_SQL_PATH, "utf-8"));
    await ensurePublicIdSequence(db);

    const deps = {
      repo: new PostgresIdentityRepository(db),
      outbox: new PostgresOutbox(db),
      publicIdSeq: new PostgresPublicIdSequence(db),
      clock: new SystemClock(),
      idGen: new CryptoIdGenerator(),
    };
    outbox = deps.outbox;
    app = createIdentityApp({ deps });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("Exit Gate: create from Telegram, identity stable across username change", async () => {
    // 1. Create a new Wasla user from a Telegram identity.
    const created = await app.inject({
      method: "POST",
      url: "/identity/resolve",
      payload: {
        telegram_user_id: 900111222,
        telegram_username: "exit_gate_v1",
        source: "customer_bot",
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json<{
      wasla_public_id: string;
      internal_uuid: string;
      created: boolean;
    }>();
    expect(createdBody.wasla_public_id).toMatch(/^WS-[0-9]{10}$/);
    expect(createdBody.created).toBe(true);

    const publicId = createdBody.wasla_public_id;
    const internalUuid = createdBody.internal_uuid;

    // 2. Idempotent: same Telegram id + same username -> same user, not new.
    const again = await app.inject({
      method: "POST",
      url: "/identity/resolve",
      payload: {
        telegram_user_id: 900111222,
        telegram_username: "exit_gate_v1",
        source: "customer_bot",
      },
    });
    expect(again.statusCode).toBe(200);
    const againBody = again.json<{
      wasla_public_id: string;
      internal_uuid: string;
      created: boolean;
    }>();
    expect(againBody.wasla_public_id).toBe(publicId);
    expect(againBody.internal_uuid).toBe(internalUuid);
    expect(againBody.created).toBe(false);

    // 3. Username change -> identity (Public ID + internal_uuid) is stable.
    const changed = await app.inject({
      method: "POST",
      url: "/identity/resolve",
      payload: {
        telegram_user_id: 900111222,
        telegram_username: "exit_gate_v2",
        source: "customer_bot",
      },
    });
    expect(changed.statusCode).toBe(200);
    const changedBody = changed.json<{
      wasla_public_id: string;
      internal_uuid: string;
      created: boolean;
    }>();
    expect(changedBody.wasla_public_id).toBe(publicId);
    expect(changedBody.internal_uuid).toBe(internalUuid);
    expect(changedBody.created).toBe(false);

    // 4. History records both usernames, with old -> new values.
    const history = await app.inject({
      method: "GET",
      url: `/identity/users/${publicId}/history`,
    });
    expect(history.statusCode).toBe(200);
    const entries = history.json() as Array<{
      field: string;
      old_value: string | null;
      new_value: string;
    }>;
    const usernameEntries = entries.filter(
      (e) => e.field === "telegram_username",
    );
    expect(usernameEntries.map((e) => e.new_value)).toEqual([
      "exit_gate_v1",
      "exit_gate_v2",
    ]);
    expect(usernameEntries[1]?.old_value).toBe("exit_gate_v1");

    // 5. Outbox carries the expected domain events (created, link added,
    //    username changed). The idempotent same-username resolve emits nothing.
    const events = await outbox.unread();
    const types = events.map((e) => e.event_type);
    expect(types).toContain("identity.created");
    expect(types).toContain("identity.link.added");
    expect(types).toContain("identity.telegram_username.changed");
  });

  it("Exit Gate: rejects linking a Telegram id owned by another user (409)", async () => {
    // Owner of telegram id 900333444.
    const owner = await app.inject({
      method: "POST",
      url: "/identity/resolve",
      payload: {
        telegram_user_id: 900333444,
        telegram_username: "owner_user",
        source: "customer_bot",
      },
    });
    const ownerBody = owner.json<{ wasla_public_id: string }>();

    // A second user.
    const other = await app.inject({
      method: "POST",
      url: "/identity/resolve",
      payload: {
        telegram_user_id: 900555666,
        telegram_username: "other_user",
        source: "customer_bot",
      },
    });
    const otherBody = other.json<{ wasla_public_id: string }>();

    // Attempting to add the owner's telegram id to the other user -> 409.
    const conflict = await app.inject({
      method: "POST",
      url: `/identity/users/${otherBody.wasla_public_id}/links`,
      payload: { provider: "telegram", external_id: "900333444" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<{ code: string }>().code).toBe(
      "IDENTITY_LINK_ALREADY_LINKED",
    );
    // Ensure the owner's identity was not corrupted.
    const ownerAgain = await app.inject({
      method: "GET",
      url: `/identity/users/${ownerBody.wasla_public_id}`,
    });
    expect(ownerAgain.statusCode).toBe(200);
    expect(
      ownerAgain.json<{ wasla_public_id: string }>().wasla_public_id,
    ).toBe(ownerBody.wasla_public_id);
  });
});
