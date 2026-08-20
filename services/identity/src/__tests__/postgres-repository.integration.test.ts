/**
 * Postgres integration test for the Identity persistence layer.
 *
 * Verifies the Phase 01 Exit Gate behavior against a real Postgres:
 * create a user from Telegram, idempotent resolve, identity stable across a
 * username change, history recorded, outbox events emitted — using the
 * PostgresIdentityRepository / PostgresOutbox / PostgresPublicIdSequence
 * adapters wired into the resolveTelegramIdentity use case.
 *
 * Excluded from the default `pnpm -r test` (see vitest.config.ts). Run with:
 *   DATABASE_URL=postgres://... pnpm --filter @wasla/identity-service test:integration
 *
 * Skipped entirely when DATABASE_URL is unset (no DB available, e.g. CI before
 * MR 4 wires a GitLab postgres service).
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
  resolveTelegramIdentity,
  type Db,
} from "../index.js";

const DATABASE_URL = process.env.DATABASE_URL;
const SCHEMA_SQL_PATH = resolve(
  __dirname,
  "../../../../contracts/schema.sql",
);

const ENABLED = Boolean(DATABASE_URL);

describe.skipIf(!ENABLED)("Identity Postgres integration", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const { pool, db: d } = createDb({
      connectionString: DATABASE_URL!,
    });
    db = d;
    close = () => pool.end();

    // Clean slate + apply the canonical DDL + the public-id sequence.
    await pool.query(
      "DROP TABLE IF EXISTS identity_outbox, identity_recovery_requests, identity_history, identity_links, identity_users CASCADE",
    );
    const schemaSql = await readFile(SCHEMA_SQL_PATH, "utf-8");
    await pool.query(schemaSql);
    await ensurePublicIdSequence(db);
  });

  afterAll(async () => {
    await close();
  });

  it("creates a user from Telegram and is idempotent", async () => {
    const repo = new PostgresIdentityRepository(db);
    const outbox = new PostgresOutbox(db);
    const publicIdSeq = new PostgresPublicIdSequence(db);
    const clock = new SystemClock();
    const idGen = new CryptoIdGenerator();

    const deps = { repo, outbox, publicIdSeq, clock, idGen };

    const first = await resolveTelegramIdentity(deps, {
      telegram_user_id: 500111222,
      telegram_username: "ali_initial",
      source: "customer_bot",
    });

    expect(first.wasla_public_id).toMatch(/^WS-[0-9]{10}$/);
    expect(first.created).toBe(true);

    // Same Telegram id + same username -> resolves to the same user, not new.
    const again = await resolveTelegramIdentity(deps, {
      telegram_user_id: 500111222,
      telegram_username: "ali_initial",
      source: "customer_bot",
    });
    expect(again.wasla_public_id).toBe(first.wasla_public_id);
    expect(again.created).toBe(false);
  });

  it("keeps the identity stable across a Telegram username change", async () => {
    const repo = new PostgresIdentityRepository(db);
    const outbox = new PostgresOutbox(db);
    const publicIdSeq = new PostgresPublicIdSequence(db);
    const clock = new SystemClock();
    const idGen = new CryptoIdGenerator();
    const deps = { repo, outbox, publicIdSeq, clock, idGen };

    const created = await resolveTelegramIdentity(deps, {
      telegram_user_id: 600333444,
      telegram_username: "sami_v1",
      source: "customer_bot",
    });

    const changed = await resolveTelegramIdentity(deps, {
      telegram_user_id: 600333444,
      telegram_username: "sami_v2",
      source: "customer_bot",
    });

    // Same Public ID + internal user — no new user created.
    expect(changed.wasla_public_id).toBe(created.wasla_public_id);
    expect(changed.created).toBe(false);

    // History records both usernames.
    const history = await repo.listHistory(
      changed.internal_uuid,
      "telegram_username",
    );
    expect(history.map((h) => h.newValue)).toEqual([
      "sami_v1",
      "sami_v2",
    ]);

    // A username-change event was emitted to the outbox.
    const events = await outbox.unread();
    expect(
      events.some(
        (e) => e.event_type === "identity.telegram_username.changed",
      ),
    ).toBe(true);
  });

  it("rejects linking a Telegram id already owned by another user", async () => {
    const repo = new PostgresIdentityRepository(db);
    const outbox = new PostgresOutbox(db);
    const publicIdSeq = new PostgresPublicIdSequence(db);
    const clock = new SystemClock();
    const idGen = new CryptoIdGenerator();
    const deps = { repo, outbox, publicIdSeq, clock, idGen };

    // First user owns telegram id 700555666.
    await resolveTelegramIdentity(deps, {
      telegram_user_id: 700555666,
      telegram_username: "owner_user",
      source: "customer_bot",
    });

    // A second user is created with a different telegram id...
    const other = await resolveTelegramIdentity(deps, {
      telegram_user_id: 800777888,
      telegram_username: "other_user",
      source: "customer_bot",
    });

    // ...then attempting to add the first user's telegram id to them throws.
    await expect(
      repo.addLink({
        userInternalUuid: other.internal_uuid,
        provider: "telegram",
        externalId: "700555666",
        verified: true,
        linkedAt: clock.now(),
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_LINK_ALREADY_LINKED" });
  });
});
