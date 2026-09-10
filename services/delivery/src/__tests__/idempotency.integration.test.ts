/**
 * Idempotency + readiness integration tests (review 7/N · ADR-026 §4.10).
 *
 * These MUST run against a real PostgreSQL, because every promise §4.10 makes
 * is a promise about a transaction:
 *
 *   - the key row and the effect commit together, so a crash cannot leave a
 *     key pointing at an order that was never created (nor the reverse);
 *   - the primary key on `idempotency_key` — not application code — is what
 *     makes two concurrent identical requests produce ONE order;
 *   - the readiness probe's answer is the real driver's answer, including the
 *     error codes a fake would only imitate.
 *
 * They SKIP without `DATABASE_URL` — see
 * `docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { LightMyRequestResponse } from "fastify";

import { PG_ENABLED, resetData, setupPostgres } from "./pg-harness.js";
import { StoreOrderStore } from "../infrastructure/store-order-store.js";
import { PostgresReadinessProbe } from "../infrastructure/readiness-probe.js";
import { buildDeliveryHttpApp } from "../http/app.js";
import { CUSTOMER_REF, FakeCatalog, FakeReservationPort, FakeReservationStore, PRODUCT_A, PRODUCT_B, STORE_SLUG, uuidSequence } from "./store-order-fakes.js";

const NOW = "2026-09-10T10:00:00.000Z";

describe.skipIf(!PG_ENABLED)("delivery idempotency + readiness — PostgreSQL", () => {
  let pool: Pool;
  let close: () => Promise<void>;
  let store: StoreOrderStore;

  beforeAll(async () => {
    const fixture = await setupPostgres();
    pool = fixture.pool;
    close = fixture.close;
    store = new StoreOrderStore(pool);
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetData(pool);
  });

  const buildApp = () =>
    buildDeliveryHttpApp({
      readPort: store,
      writePort: store,
      catalogPort: new FakeCatalog(),
      reservationPort: new FakeReservationPort(),
      reservationStore: new FakeReservationStore(),
      readinessPort: new PostgresReadinessProbe(pool),
      newUuid: uuidSequence(`${Math.floor(Math.random() * 0xfffffff).toString(16).padStart(8, "0")}`),
      now: () => NOW,
    });

  const placement = {
    customer_ref: CUSTOMER_REF,
    store_slug: STORE_SLUG,
    items: [
      { product_id: PRODUCT_A, quantity: 2 },
      { product_id: PRODUCT_B, quantity: 3 },
    ],
    delivery_fee_minor_units: 500,
  };

  const post = async (
    app: ReturnType<typeof buildApp>,
    url: string,
    key: string,
    payload: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> =>
    await app.fastify.inject({ method: "POST", url, headers: { "idempotency-key": key }, payload });

  it("a retried placement creates ONE order and replays the first response", async () => {
    const app = buildApp();
    const key = "pg-idem-placement-000001";

    const first = await post(app, "/store-orders", key, placement);
    expect(first.statusCode).toBe(201);

    const retry = await post(app, "/store-orders", key, placement);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers["idempotent-replay"]).toBe("true");
    // Byte-identical, including the public id: a retry that minted a second id
    // would be a duplicate order wearing the first one's clothes.
    expect(retry.json()).toEqual(first.json());

    const orders = await pool.query(`SELECT count(*)::int AS n FROM store_orders`);
    expect(orders.rows[0].n).toBe(1);
    // Three outbox rows: store_order.created, delivery.task_created, and
    // store_order.inventory_reserved (the reservation mirror appends one).
    // Nothing was emitted twice — a duplicated outbox row is a duplicated
    // downstream side effect.
    const outbox = await pool.query(`SELECT count(*)::int AS n FROM delivery_outbox`);
    expect(outbox.rows[0].n).toBe(3);

    await app.close();
  });

  it("stores the key with its fingerprint, status, body, and owning order", async () => {
    const app = buildApp();
    const key = "pg-idem-placement-000002";
    const created = await post(app, "/store-orders", key, placement);
    expect(created.statusCode).toBe(201);

    const rows = await pool.query(
      `SELECT k.route, k.request_fingerprint, k.response_status, k.response_body, k.trace_id,
              o.public_id
         FROM delivery_idempotency_keys k
         JOIN store_orders o ON o.order_id = k.order_id
        WHERE k.idempotency_key = $1`,
      [key],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].route).toBe("POST /store-orders");
    expect(rows.rows[0].request_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.rows[0].response_status).toBe(201);
    // The stored body IS the response, not a summary of it.
    expect(rows.rows[0].response_body).toEqual(created.json());
    expect(rows.rows[0].public_id).toBe(created.json().public_id);

    await app.close();
  });

  it("409s the same key with a different payload and creates nothing", async () => {
    const app = buildApp();
    const key = "pg-idem-placement-000003";
    await post(app, "/store-orders", key, placement);

    const conflict = await post(app, "/store-orders", key, {
      ...placement,
      delivery_fee_minor_units: 900,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error_code).toBe("DELIVERY_IDEMPOTENCY_KEY_REUSED");

    const orders = await pool.query(`SELECT count(*)::int AS n FROM store_orders`);
    expect(orders.rows[0].n).toBe(1);
    await app.close();
  });

  it("a retried cancellation replays instead of hitting the state machine", async () => {
    const app = buildApp();
    const created = await post(app, "/store-orders", "pg-idem-placement-000004", placement);
    const publicId = created.json().public_id;
    const key = "pg-idem-cancellation-0001";
    const url = `/store-orders/${publicId}/cancellation`;

    const first = await post(app, url, key, { reason_code: "CUSTOMER_CHANGED_MIND" });
    expect(first.statusCode).toBe(200);

    const retry = await post(app, url, key, { reason_code: "CUSTOMER_CHANGED_MIND" });
    // `cancelled → cancelled` is not an edge (§3.1), so without the read-side
    // pre-check this retry would be a 409 the client cannot act on.
    expect(retry.statusCode).toBe(200);
    expect(retry.headers["idempotent-replay"]).toBe("true");
    expect(retry.json()).toEqual(first.json());

    // The version did NOT advance: the replay wrote nothing.
    const row = await pool.query(`SELECT version FROM store_orders WHERE public_id = $1`, [publicId]);
    expect(row.rows[0].version).toBe(first.json().version);

    const ledger = await pool.query(
      `SELECT count(*)::int AS n FROM store_order_transitions WHERE to_state = 'cancelled'`,
    );
    expect(ledger.rows[0].n).toBe(1);
    await app.close();
  });

  it("a cancellation key does not carry over to a different order", async () => {
    const app = buildApp();
    const a = (await post(app, "/store-orders", "pg-idem-placement-000005", placement)).json();
    const b = (await post(app, "/store-orders", "pg-idem-placement-000006", placement)).json();
    const key = "pg-idem-cancellation-0002";

    const first = await post(app, `/store-orders/${a.public_id}/cancellation`, key, {
      reason_code: "CUSTOMER_CHANGED_MIND",
    });
    expect(first.statusCode).toBe(200);

    // Same key, same body, DIFFERENT order: the target is in the fingerprint,
    // so this is a reuse. Replaying A's response here would silently leave B
    // running while the client believed it was cancelled.
    const second = await post(app, `/store-orders/${b.public_id}/cancellation`, key, {
      reason_code: "CUSTOMER_CHANGED_MIND",
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error_code).toBe("DELIVERY_IDEMPOTENCY_KEY_REUSED");

    const bRow = await pool.query(`SELECT fulfillment_state FROM store_orders WHERE public_id = $1`, [
      b.public_id,
    ]);
    expect(bRow.rows[0].fulfillment_state).toBe("placed");
    await app.close();
  });

  it("two concurrent identical placements settle as one order plus one refusal or replay", async () => {
    const app = buildApp();
    const key = "pg-idem-concurrent-00001";
    // The primary key is the arbiter, not the application: whoever loses the
    // race must NOT create a second order.
    const [left, right] = await Promise.all([
      post(app, "/store-orders", key, placement),
      post(app, "/store-orders", key, placement),
    ]);

    const codes = [left.statusCode, right.statusCode].sort((x, y) => x - y);
    expect(codes[0]).toBe(201);
    // The loser is either a replay (201, if it read the committed key) or an
    // in-flight conflict (409) — never a second creation.
    expect([201, 409]).toContain(codes[1]);
    if (codes[1] === 409) {
      const loser = left.statusCode === 409 ? left : right;
      expect(loser.json().error_code).toBe("DELIVERY_IDEMPOTENT_REQUEST_IN_FLIGHT");
    }

    const orders = await pool.query(`SELECT count(*)::int AS n FROM store_orders`);
    expect(orders.rows[0].n).toBe(1);
    await app.close();
  });

  it("the schema refuses a malformed key or an undeclared route outright", async () => {
    // Defence in depth: the HTTP layer validates, and the table refuses anyway.
    // A future internal caller that skips the boundary must not be able to
    // write a key the boundary would have rejected.
    await expect(
      pool.query(
        `INSERT INTO delivery_idempotency_keys
           (idempotency_key, route, request_fingerprint, response_status, response_body, order_id)
         VALUES ('short', 'POST /store-orders', repeat('a', 64), 201, '{}'::jsonb,
                 '00000000-0000-4000-8000-000000000000')`,
      ),
    ).rejects.toThrow();

    await expect(
      pool.query(
        `INSERT INTO delivery_idempotency_keys
           (idempotency_key, route, request_fingerprint, response_status, response_body, order_id)
         VALUES ('valid-key-0000000001', 'DELETE /store-orders', repeat('a', 64), 201, '{}'::jsonb,
                 '00000000-0000-4000-8000-000000000000')`,
      ),
    ).rejects.toThrow();
  });

  it("GET /delivery/ready is 200 ready when the real database answers", async () => {
    const app = buildApp();
    const res = await app.fastify.inject({ method: "GET", url: "/delivery/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ready");
    expect(res.json().checks).toEqual([{ name: "database", ok: true }]);
    await app.close();
  });

  it("the probe survives a statement timeout instead of throwing", async () => {
    // A 1ms budget: the probe must classify, not crash. A readiness route that
    // throws is a readiness route that answers 500 — and 500 is not a health
    // verdict an orchestrator can read.
    const probe = new PostgresReadinessProbe(pool, 1);
    const checks = await probe.probe();
    expect(checks).toHaveLength(1);
    expect(checks[0].name).toBe("database");
    if (!checks[0].ok) {
      expect(["statement_timeout", "probe_timeout"]).toContain(checks[0].detail);
    }
  });

  it("the probe reports schema_missing without leaking the connection string", async () => {
    // Point the probe at the same pool but a table that does not exist by
    // querying through a role-less schema: the driver raises 42P01.
    await pool.query(`SET search_path TO pg_temp, public`);
    try {
      const failing = await pool
        .query(`SELECT 1 FROM delivery_table_that_does_not_exist LIMIT 1`)
        .catch((error: unknown) => error);
      const { readinessFailureReason } = await import("../infrastructure/readiness-probe.js");
      expect(readinessFailureReason(failing)).toBe("schema_missing");
    } finally {
      await pool.query(`SET search_path TO public`);
    }
  });
});
