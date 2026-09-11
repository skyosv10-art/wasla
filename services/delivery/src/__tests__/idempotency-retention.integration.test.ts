/**
 * حياةُ مفاتيحِ التماثُلِ ومُكنستُها — اختباراتُ تكامُلٍ على PostgreSQL حقيقيّةٍ
 * (المراجعةُ 13/N · ADR-026 §4.15 · رفعُ دَينِ §4.10).
 *
 * ولمَ لا تكفي اختباراتُ الوحدةِ هنا؟ لأنَّ كلَّ وعدٍ في هذهِ المراجعةِ وعدٌ
 * تقطعُهُ **القاعدةُ** لا الشفرةُ:
 *
 *  - «مفتاحٌ منتهٍ كأنّهُ غيرُ موجودٍ» شرطُهُ `expires_at > now()` بساعةِ القاعدةِ،
 *    وساعةٌ مزيّفةٌ في اختبارِ وحدةٍ تُثبِتُ صحّةَ المزيّفِ لا صحّةَ الشرطِ.
 *  - «الاستيلاءُ على صفٍّ ميّتٍ» ذرّيّةُ `ON CONFLICT … DO UPDATE … WHERE`، ولا
 *    معنى لذرّيّةٍ بلا معاملةٍ حقيقيّةٍ.
 *  - «المُكنسةُ لا تُعطِّلُ كاتباً» شرطُهُ `FOR UPDATE SKIP LOCKED` — ويُقاسُ هنا
 *    بقفلٍ حقيقيٍّ في معاملةٍ ثانيةٍ.
 *  - «الترقيةُ على قاعدةٍ فيها بياناتٌ» لا تُقاسُ إلّا بصفوفٍ قائمةٍ يُطبَّقُ
 *    عليها الترحيلُ (وهيَ الثغرةُ التي `RISK-0020` مفتوحٌ عليها؛ هذا الاختبارُ
 *    يُغلِقُها **لهذا الترحيلِ** لا للمنظومةِ كلِّها).
 *
 * تُتخطّى بلا `DATABASE_URL` — `docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md`.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildDeliveryHttpApp } from "../http/app.js";
import { IDEMPOTENCY_KEY_TTL_SECONDS } from "../domain/idempotency.js";
import { StoreOrderStore } from "../infrastructure/store-order-store.js";
import { sweepExpiredIdempotencyKeys } from "../use-cases/sweep-expired-idempotency-keys.js";
import { PG_ENABLED, resetData, setupPostgres } from "./pg-harness.js";
import {
  CUSTOMER_REF,
  FakeCatalog,
  FakeReservationPort,
  FakeReservationStore,
  PRODUCT_A,
  PRODUCT_B,
  STORE_SLUG,
  uuidSequence,
} from "./store-order-fakes.js";

const NOW = "2026-09-11T10:00:00.000Z";

/** بذرُ مفتاحٍ خامٍ بمدّةٍ مُعطاةٍ — يحتاجُ طلباً قائماً (المفتاحُ يملكُ FK). */
async function seedKey(
  pool: Pool,
  key: string,
  orderId: string,
  expiresInSeconds: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO delivery_idempotency_keys (
       idempotency_key, route, request_fingerprint, response_status,
       response_body, order_id, created_at, expires_at
     ) VALUES ($1, 'POST /store-orders', repeat('b', 64), 201, '{}'::jsonb, $2,
               now() - interval '1 hour',
               now() + make_interval(secs => $3::double precision))`,
    [key, orderId, expiresInSeconds],
  );
}

describe.skipIf(!PG_ENABLED)("حياةُ مفاتيحِ التماثُلِ ومُكنستُها — PostgreSQL", () => {
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

  const buildApp = (ttlStore: StoreOrderStore = store) =>
    buildDeliveryHttpApp({
      readPort: ttlStore,
      writePort: ttlStore,
      catalogPort: new FakeCatalog(),
      reservationPort: new FakeReservationPort(),
      reservationStore: new FakeReservationStore(),
      idempotencySweepPort: ttlStore,
      newUuid: uuidSequence(
        `${Math.floor(Math.random() * 0xfffffff)
          .toString(16)
          .padStart(8, "0")}`,
      ),
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
    key: string,
    payload: Record<string, unknown>,
  ) =>
    await app.fastify.inject({
      method: "POST",
      url: "/store-orders",
      headers: { "idempotency-key": key },
      payload,
    });

  /** إماتةُ مفتاحٍ بأثرٍ رجعيٍّ — بساعةِ القاعدةِ لا بساعةِ الاختبارِ. */
  const expireKey = async (key: string): Promise<void> => {
    const { rowCount } = await pool.query(
      `UPDATE delivery_idempotency_keys
          SET created_at = now() - interval '25 hours',
              expires_at = now() - interval '1 second'
        WHERE idempotency_key = $1`,
      [key],
    );
    expect(rowCount).toBe(1);
  };

  /* ── الكتابةُ تُسجّلُ مدّةً ── */

  it("كلُّ مفتاحٍ يُكتَبُ بمدّةٍ = يومٌ بساعةِ القاعدةِ", async () => {
    const app = buildApp();
    const res = await post(app, "ttl-default-key-00000001", placement);
    expect(res.statusCode).toBe(201);

    const { rows } = await pool.query(
      `SELECT expires_at > now() AS alive,
              extract(epoch FROM (expires_at - created_at))::int AS ttl_seconds
         FROM delivery_idempotency_keys
        WHERE idempotency_key = $1`,
      ["ttl-default-key-00000001"],
    );
    expect(rows[0].alive).toBe(true);
    expect(rows[0].ttl_seconds).toBe(IDEMPOTENCY_KEY_TTL_SECONDS);
    await app.close();
  });

  it("مدّةٌ مُركَّبةٌ في جِذعِ التركيبِ تُطبَّقُ على الصفِّ", async () => {
    const shortStore = new StoreOrderStore(pool, 3_600);
    const app = buildApp(shortStore);
    const res = await post(app, "ttl-injected-key-00000001", placement);
    expect(res.statusCode).toBe(201);

    const { rows } = await pool.query(
      `SELECT extract(epoch FROM (expires_at - created_at))::int AS ttl_seconds
         FROM delivery_idempotency_keys WHERE idempotency_key = $1`,
      ["ttl-injected-key-00000001"],
    );
    expect(rows[0].ttl_seconds).toBe(3_600);
    await app.close();
  });

  /* ── القراءةُ: منتهٍ = غيرُ موجودٍ ── */

  it("مفتاحٌ منتهٍ لا يُعادُ جوابُهُ — الطلبُ يُنفَّذُ من جديدٍ بلا ترويسةِ إعادةٍ", async () => {
    const app = buildApp();
    const key = "expired-replay-key-000001";

    const first = await post(app, key, placement);
    expect(first.statusCode).toBe(201);
    await expireKey(key);

    const second = await post(app, key, placement);
    expect(second.statusCode).toBe(201);
    expect(second.headers["idempotent-replay"]).toBeUndefined();
    // طلبٌ ثانٍ حقيقيٌّ: المدّةُ انقضتْ فالحمايةُ انقضتْ معَها — وهذا هوَ
    // معنى المدّةِ لا عيبٌ فيها.
    expect(second.json().public_id).not.toBe(first.json().public_id);

    const orders = await pool.query(`SELECT count(*)::int AS n FROM store_orders`);
    expect(orders.rows[0].n).toBe(2);
    await app.close();
  });

  it("المفتاحُ الحيُّ ما زالَ يُعيدُ الجوابَ الأوّلَ حرفاً (لا انحدارَ)", async () => {
    const app = buildApp();
    const key = "alive-replay-key-00000001";
    const first = await post(app, key, placement);
    const retry = await post(app, key, placement);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers["idempotent-replay"]).toBe("true");
    expect(retry.json()).toEqual(first.json());
    expect((await pool.query(`SELECT count(*)::int AS n FROM store_orders`)).rows[0].n).toBe(1);
    await app.close();
  });

  /* ── الكتابةُ: استيلاءٌ على الميّتِ ورفضٌ للحيِّ ── */

  it("مفتاحٌ منتهٍ يُعادُ استعمالُهُ لطلبٍ مختلفٍ بلا 409", async () => {
    const app = buildApp();
    const key = "expired-reuse-key-000001";
    const first = await post(app, key, placement);
    expect(first.statusCode).toBe(201);
    await expireKey(key);

    // جسمٌ مختلفٌ = بصمةٌ مختلفةٌ. على المفتاحِ الحيِّ هذا 409 إعادةُ استعمالٍ،
    // وعلى الميّتِ يجبُ أن يكونَ مفتاحاً حُرّاً: القارئُ رآهُ غيرَ موجودٍ فمضى،
    // فرفضُ الكاتبِ بعدَهُ كانَ سيكونُ 409 على منادٍ بريءٍ سببُهُ صفٌّ لم يُمسَح.
    const different = await post(app, key, { ...placement, delivery_fee_minor_units: 900 });
    expect(different.statusCode).toBe(201);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n,
              bool_or(expires_at > now()) AS alive,
              max(extract(epoch FROM (expires_at - created_at))::int) AS ttl_seconds
         FROM delivery_idempotency_keys WHERE idempotency_key = $1`,
      [key],
    );
    // صفٌّ واحدٌ لا صفّانِ: المفتاحُ مفتاحٌ أساسيٌّ، والاستيلاءُ تحديثٌ لا إدراجٌ.
    expect(rows[0].n).toBe(1);
    expect(rows[0].alive).toBe(true);
    // والمدّةُ تُجدَّدُ من لحظةِ الاستيلاءِ لا من كتابةٍ قديمةٍ.
    expect(rows[0].ttl_seconds).toBe(IDEMPOTENCY_KEY_TTL_SECONDS);

    const owner = await pool.query(
      `SELECT o.public_id FROM delivery_idempotency_keys k
         JOIN store_orders o ON o.order_id = k.order_id
        WHERE k.idempotency_key = $1`,
      [key],
    );
    expect(owner.rows[0].public_id).toBe(different.json().public_id);
    await app.close();
  });

  it("مفتاحٌ حيٌّ بجسمٍ مختلفٍ ما زالَ يُرفَضُ بـ409 إعادةِ استعمالٍ", async () => {
    const app = buildApp();
    const key = "alive-reuse-key-00000001";
    expect((await post(app, key, placement)).statusCode).toBe(201);
    const different = await post(app, key, { ...placement, delivery_fee_minor_units: 900 });
    expect(different.statusCode).toBe(409);
    expect(different.json().error_code).toBe("DELIVERY_IDEMPOTENCY_KEY_REUSED");
    await app.close();
  });

  it("قيدُ القاعدةِ يرفضُ مفتاحاً ميّتاً عندَ كتابتِهِ", async () => {
    const app = buildApp();
    const seed = await post(app, "constraint-seed-key-00001", placement);
    expect(seed.statusCode).toBe(201);
    const { rows } = await pool.query(
      `SELECT order_id FROM delivery_idempotency_keys WHERE idempotency_key = $1`,
      ["constraint-seed-key-00001"],
    );
    // مدّةٌ سالبةٌ = مفتاحٌ يُكتَبُ ميّتاً قبلَ أن يُقرأَ = حمايةٌ مُلغاةٌ صامتةً.
    // والقيدُ في القاعدةِ آخرُ حائلٍ لو تسلّلَ إعدادٌ خاطئٌ من فوقِ الحدِّ الأدنى
    // أو كتابةٌ مباشرةٌ من يدٍ في الإنتاجِ.
    await expect(
      pool.query(
        `INSERT INTO delivery_idempotency_keys (
           idempotency_key, route, request_fingerprint, response_status,
           response_body, order_id, created_at, expires_at
         ) VALUES ('constraint-dead-key-00001', 'POST /store-orders', repeat('c', 64), 201,
                   '{}'::jsonb, $1, now(), now() - interval '1 second')`,
        [rows[0].order_id],
      ),
    ).rejects.toThrow(/delivery_idempotency_keys_check/u);
    await app.close();
  });

  /* ── المُكنسةُ ── */

  it("المُكنسةُ تحذفُ المنتهيَ وتُبقي الحيَّ", async () => {
    const app = buildApp();
    expect((await post(app, "sweep-live-key-00000001", placement)).statusCode).toBe(201);
    const { rows } = await pool.query(`SELECT order_id FROM store_orders LIMIT 1`);
    const orderId = rows[0].order_id as string;
    for (let i = 0; i < 5; i += 1) {
      await seedKey(pool, `sweep-dead-key-0000000${i}`, orderId, -60);
    }
    await seedKey(pool, "sweep-other-live-key-001", orderId, 600);

    const result = await sweepExpiredIdempotencyKeys({ sweepPort: store });
    expect(result).toEqual({ batches: 1, deleted: 5, remaining: 0, stoppedBecause: "drained" });

    const left = await pool.query(
      `SELECT idempotency_key FROM delivery_idempotency_keys ORDER BY 1`,
    );
    expect(left.rows.map((r) => r.idempotency_key)).toEqual([
      "sweep-live-key-00000001",
      "sweep-other-live-key-001",
    ]);
    await app.close();
  });

  it("الدفعاتُ محدودةٌ: حجمٌ صغيرٌ ⇒ دفعاتٌ متعدّدةٌ لا معاملةٌ واحدةٌ ضخمةٌ", async () => {
    const app = buildApp();
    expect((await post(app, "batch-live-key-00000001", placement)).statusCode).toBe(201);
    const { rows } = await pool.query(`SELECT order_id FROM store_orders LIMIT 1`);
    const orderId = rows[0].order_id as string;
    for (let i = 0; i < 7; i += 1) {
      await seedKey(pool, `batch-dead-key-000000${i}`, orderId, -60);
    }

    const capped = await sweepExpiredIdempotencyKeys({
      sweepPort: store,
      batchSize: 2,
      maxBatches: 2,
    });
    expect(capped.batches).toBe(2);
    expect(capped.deleted).toBe(4);
    expect(capped.remaining).toBe(3);
    expect(capped.stoppedBecause).toBe("max_batches");

    const rest = await sweepExpiredIdempotencyKeys({ sweepPort: store, batchSize: 2 });
    expect(rest.deleted).toBe(3);
    expect(rest.remaining).toBe(0);
    expect(rest.stoppedBecause).toBe("drained");
    expect(
      (await pool.query(`SELECT count(*)::int AS n FROM delivery_idempotency_keys`)).rows[0].n,
    ).toBe(1);
    await app.close();
  });

  it("صفٌّ منتهٍ مقفولٌ لكاتبٍ يُتخطّى ولا تنتظرُهُ المُكنسةُ", async () => {
    const app = buildApp();
    expect((await post(app, "lock-live-key-00000001", placement)).statusCode).toBe(201);
    const { rows } = await pool.query(`SELECT order_id FROM store_orders LIMIT 1`);
    const orderId = rows[0].order_id as string;
    await seedKey(pool, "lock-dead-key-00000001", orderId, -60);

    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(
        `SELECT idempotency_key FROM delivery_idempotency_keys
          WHERE idempotency_key = $1 FOR UPDATE`,
        ["lock-dead-key-00000001"],
      );

      // لولا `SKIP LOCKED` لعلَّقَ هذا النداءُ حتّى تنتهيَ المعاملةُ القابضةُ —
      // أي أنَّ صيانةً في الخلفيّةِ تنتظرُ كاتباً في المقدّمةِ.
      const result = await sweepExpiredIdempotencyKeys({ sweepPort: store, maxBatches: 3 });
      expect(result.deleted).toBe(0);
      expect(result.remaining).toBe(1);
      expect(result.stoppedBecause).toBe("empty_batch");
      // ودفعةٌ واحدةٌ لا ثلاثٌ: لا حلقةَ مشغولةً على قفلٍ قائمٍ.
      expect(result.batches).toBe(1);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }

    // وبعدَ إطلاقِ القفلِ يُمسَحُ الصفُّ في الجَولةِ التاليةِ.
    const after = await sweepExpiredIdempotencyKeys({ sweepPort: store });
    expect(after.deleted).toBe(1);
    expect(after.remaining).toBe(0);
    await app.close();
  });

  it("المسارُ التشغيليُّ يُعيدُ الأرقامَ نفسَها التي تُقاسُ في القاعدةِ", async () => {
    const app = buildApp();
    expect((await post(app, "route-live-key-00000001", placement)).statusCode).toBe(201);
    const { rows } = await pool.query(`SELECT order_id FROM store_orders LIMIT 1`);
    for (let i = 0; i < 3; i += 1) {
      await seedKey(pool, `route-dead-key-000000${i}`, rows[0].order_id as string, -60);
    }
    const res = await app.fastify.inject({
      method: "POST",
      url: "/delivery/idempotency-keys/sweep",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      batches: 1,
      deleted: 3,
      remaining: 0,
      stopped_because: "drained",
    });
    await app.close();
  });

  /* ── الترقيةُ على قاعدةٍ فيها بياناتٌ ── */

  it("الترقيةُ على جدولٍ فيهِ صفوفٌ: 0001 يُطبَّقُ ويُعبّئُ ولا يفقدُ صفّاً", async () => {
    // في مخطَّطٍ معزولٍ لا في `public`: الترحيلُ يُطبَّقُ على جدولٍ فيهِ بياناتٌ
    // بينَما تبقى قاعدةُ الاختباراتِ الأخرى كما هيَ. والمخطَّطُ (لا قاعدةٌ ثانيةٌ)
    // ليعملَ الاختبارُ في كلِّ بيئةٍ بلا حقِّ `CREATEDB`.
    const schema = `retention_upgrade_${Math.floor(Math.random() * 1e6)}`;
    const client = await pool.connect();
    const runFile = async (name: string): Promise<void> => {
      const raw = (await readFile(resolve(process.cwd(), "drizzle", name), "utf8")).replaceAll(
        '"public".',
        `"${schema}".`,
      );
      for (const chunk of raw.split("--> statement-breakpoint")) {
        const withoutComments = chunk
          .split("\n")
          .filter((line) => !line.trimStart().startsWith("--"))
          .join("\n")
          .trim();
        if (withoutComments.length > 0) await client.query(chunk.trim());
      }
    };

    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path = ${schema}`);
      await runFile("0000_whole_triathlon.sql");

      // قاعدةٌ «قبلَ الترقيةِ»: طلبٌ ومفتاحٌ كُتِبَ ولا عمودَ مدّةٍ لهُ بعدُ.
      const seeded = await client.query(
        `INSERT INTO store_orders (order_id, public_id, customer_ref, store_id, store_slug,
                                   fulfillment_state, payment_state, inventory_state, currency_code,
                                   items_total_minor_units, delivery_fee_minor_units, total_minor_units)
         VALUES (gen_random_uuid(),
                 'WS-' || lpad(nextval('${schema}.store_order_public_id_seq')::text, 10, '0'),
                 'WS-0000000001', gen_random_uuid(), 'matjar-alfawakih',
                 'placed', 'pending', 'none', 'SAR', 1000, 500, 1500)
         RETURNING order_id`,
      );
      await client.query(
        `INSERT INTO delivery_idempotency_keys (
           idempotency_key, route, request_fingerprint, response_status,
           response_body, order_id, created_at
         ) VALUES ('legacy-upgrade-key-00001', 'POST /store-orders', repeat('a', 64), 201,
                   '{"public_id":"WS-0000000001"}'::jsonb, $1, now() - interval '2 hours')`,
        [seeded.rows[0].order_id],
      );

      await runFile("0001_idempotency_key_lifetime.sql");

      const after = await client.query(
        `SELECT idempotency_key, response_body,
                extract(epoch FROM (expires_at - created_at))::int AS ttl_seconds,
                expires_at > now() AS alive
           FROM delivery_idempotency_keys`,
      );
      // الصفُّ القديمُ باقٍ بجسمِ جوابِهِ، ومدّتُهُ = الافتراضُ من زمنِ كتابتِهِ.
      expect(after.rowCount).toBe(1);
      expect(after.rows[0].idempotency_key).toBe("legacy-upgrade-key-00001");
      expect(after.rows[0].response_body).toEqual({ public_id: "WS-0000000001" });
      expect(after.rows[0].ttl_seconds).toBe(IDEMPOTENCY_KEY_TTL_SECONDS);
      // وكُتِبَ قبلَ ساعتَينِ فمدّتُهُ لم تنقضِ — ترقيةٌ لا تُميتُ مفتاحاً حيّاً.
      expect(after.rows[0].alive).toBe(true);
      expect(
        (await client.query(`SELECT count(*)::int AS n FROM store_orders`)).rows[0].n,
      ).toBe(1);

      // والقيدُ والفهرسُ صاروا في مكانِهما بعدَ الترقيةِ لا قبلَها فقط.
      const guards = await client.query(
        `SELECT (SELECT count(*)::int FROM pg_constraint c
                   JOIN pg_class t ON t.oid = c.conrelid
                   JOIN pg_namespace n ON n.oid = t.relnamespace
                  WHERE n.nspname = $1 AND c.conname = 'delivery_idempotency_keys_check') AS checks,
                (SELECT count(*)::int FROM pg_indexes
                  WHERE schemaname = $1
                    AND indexname = 'ix_delivery_idempotency_keys_expiry') AS indexes`,
        [schema],
      );
      expect(guards.rows[0].checks).toBe(1);
      expect(guards.rows[0].indexes).toBe(1);
    } finally {
      await client.query("RESET search_path");
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
    }
  });
});
