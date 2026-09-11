/**
 * مُنادي المُكنسةِ — اختباراتُ تكامُلٍ **بعمليّةٍ حقيقيّةٍ** على PostgreSQL حقيقيّةٍ
 * (المراجعةُ 14/N · ADR-026 §4.16 · رفعُ دَينِ §4.15 أ).
 *
 * ولمَ تُشغَّلُ عمليّةٌ فرعيّةٌ ولا يُستدعى `main()` مباشرةً؟ لأنَّ الوعدَ الذي
 * تقطعُهُ هذهِ المراجعةُ **وعدُ عمليّةٍ لا وعدُ دالّةٍ**: جَدوَلُ التشغيلِ لا
 * يستوردُ وحدةً، بل يُشغِّلُ أمراً ويقرأُ ثلاثةَ أشياءَ — رمزَ الخروجِ، وسطرَ
 * stdout، وسطرَ stderr. واختبارٌ يستدعي الدالّةَ يُثبِتُ أنَّ المنطقَ صحيحٌ ولا
 * يُثبِتُ أنَّ الأمرَ **يعملُ**: يبقى `tsx` غيرَ موجودٍ، والمسارُ في
 * `package.json` مكتوباً خطأً، و`process.exit` غيرَ مُوصَّلٍ برمزِ التقريرِ —
 * وثلاثتُها تسقطُ هنا ولا يراها استدعاءُ دالّةٍ.
 *
 * تُتخطّى بلا `DATABASE_URL` — `docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md`.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildDeliveryHttpApp } from "../http/app.js";
import { StoreOrderStore } from "../infrastructure/store-order-store.js";
import { PG_ENABLED, resetData, setupPostgres } from "./pg-harness.js";
import {
  CUSTOMER_REF,
  FakeCatalog,
  FakeReservationPort,
  FakeReservationStore,
  PRODUCT_A,
  STORE_SLUG,
  uuidSequence,
} from "./store-order-fakes.js";

/** جِذعُ الحزمةِ — الأمرُ يُشغَّلُ من حيثُ يُشغِّلُهُ `pnpm --filter`. */
const SERVICE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const CLI_ENTRY = "src/ops/idempotency-sweep-cli.ts";

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * يُشغِّلُ الحدَّ كما يُشغِّلُهُ جَدوَلٌ: أمرٌ ببيئتِهِ، ثمّ رمزٌ ومخرَجانِ.
 *
 * البيئةُ تُبنى بالحذفِ لا بالإضافةِ (`undefined` يُسقِطُ المتغيّرَ) — لأنَّ
 * الحالةَ التي يجبُ أن تُقاسَ هيَ «مضيفٌ لا يعرفُ `DATABASE_URL`»، وتمريرُ
 * سلسلةٍ فارغةٍ ليسَ هوَ غيابَ المتغيّرِ.
 */
function runSweepCli(overrides: Record<string, string | undefined>): Promise<CliResult> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...overrides })) {
    if (value !== undefined) env[key] = value;
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["--import", "tsx", CLI_ENTRY], {
      cwd: SERVICE_ROOT,
      env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
  });
}

describe.skipIf(!PG_ENABLED)("مُنادي مُكنسةِ مفاتيحِ التماثُلِ — عمليّةٌ حقيقيّةٌ", () => {
  let pool: Pool;
  let close: () => Promise<void>;
  let orderId: string;

  beforeAll(async () => {
    const fixture = await setupPostgres();
    pool = fixture.pool;
    close = fixture.close;
  });

  afterAll(async () => {
    await close();
  });

  /**
   * كلُّ اختبارٍ يبدأُ بطلبٍ واحدٍ (المفتاحُ يملكُ مفتاحاً أجنبيّاً إليهِ) ثمّ
   * **يُفرَّغُ جدولُ المفاتيحِ** — فما يُقاسُ بعدَ ذلكَ مبذورٌ بيدِ الاختبارِ
   * وحدَهُ، لا مفتاحُ الطلبِ الذي أنشأَهُ الحدُّ ضمناً.
   */
  beforeEach(async () => {
    await resetData(pool);

    const store = new StoreOrderStore(pool);
    const app = buildDeliveryHttpApp({
      readPort: store,
      writePort: store,
      catalogPort: new FakeCatalog(),
      reservationPort: new FakeReservationPort(),
      reservationStore: new FakeReservationStore(),
      idempotencySweepPort: store,
      newUuid: uuidSequence("5eeb0000"),
      now: () => "2026-09-12T00:00:00.000Z",
    });
    const res = await app.fastify.inject({
      method: "POST",
      url: "/store-orders",
      headers: { "idempotency-key": "sweep-cli-seed-key-000001" },
      payload: {
        customer_ref: CUSTOMER_REF,
        store_slug: STORE_SLUG,
        items: [{ product_id: PRODUCT_A, quantity: 1 }],
        delivery_fee_minor_units: 500,
      },
    });
    expect(res.statusCode).toBe(201);
    await app.close();

    const seeded = await pool.query<{ order_id: string }>(
      "SELECT order_id FROM store_orders LIMIT 1",
    );
    orderId = seeded.rows[0].order_id;

    await pool.query("DELETE FROM delivery_idempotency_keys");
  });

  /** يبذرُ مفتاحاً بعمرٍ مُعطىً بساعةِ القاعدةِ (سالبٌ ⇒ منتهٍ). */
  const seedKey = async (key: string, expiresInSeconds: number): Promise<void> => {
    await pool.query(
      `INSERT INTO delivery_idempotency_keys (
         idempotency_key, route, request_fingerprint, response_status,
         response_body, order_id, created_at, expires_at
       ) VALUES ($1, 'POST /store-orders', repeat('c', 64), 201, '{}'::jsonb, $2,
                 now() - interval '30 hours',
                 now() + make_interval(secs => $3::double precision))`,
      [key, orderId, expiresInSeconds],
    );
  };

  const countKeys = async (): Promise<number> => {
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM delivery_idempotency_keys",
    );
    return Number(rows[0].n);
  };

  it("جَولةٌ نظيفةٌ: تحذفُ المنتهيَ وتُبقي الحيَّ وتخرجُ بصفرٍ بتقريرٍ مقروءٍ آليّاً", async () => {
    await seedKey("cli-expired-key-000001", -60);
    await seedKey("cli-expired-key-000002", -30);
    await seedKey("cli-expired-key-000003", -1);
    await seedKey("cli-alive-key-0000001", 3_600);

    const result = await runSweepCli({});

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);

    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      service: "delivery",
      runner: "idempotency-sweep",
      batch_size: 500,
      max_batches: 20,
      batches: 1,
      deleted: 3,
      remaining: 0,
      stopped_because: "drained",
      exit_code: 0,
    });
    expect(typeof report.duration_ms).toBe("number");
    expect(Date.parse(report.started_at)).not.toBeNaN();

    expect(await countKeys()).toBe(1);
    const { rows } = await pool.query("SELECT idempotency_key FROM delivery_idempotency_keys");
    expect(rows[0].idempotency_key).toBe("cli-alive-key-0000001");
  });

  it("جدولٌ نظيفٌ أصلاً: دفعةٌ واحدةٌ بلا محذوفٍ ورمزٌ صفريٌّ (لا ضجيجَ في بريدِ الجَدوَلِ)", async () => {
    const result = await runSweepCli({});

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      batches: 1,
      deleted: 0,
      remaining: 0,
      stopped_because: "drained",
    });
  });

  it("بلوغُ السقفِ يخرجُ بـ3 ويطبعُ الباقيَ — التراكُمُ يُقرأُ لا يُستنتَجُ", async () => {
    for (let index = 0; index < 5; index += 1) {
      await seedKey(`cli-capped-key-00000${index}`, -10);
    }

    const result = await runSweepCli({
      IDEMPOTENCY_SWEEP_BATCH_SIZE: "1",
      IDEMPOTENCY_SWEEP_MAX_BATCHES: "2",
    });

    expect(result.code).toBe(3);
    expect(JSON.parse(result.stdout)).toMatchObject({
      batch_size: 1,
      max_batches: 2,
      batches: 2,
      deleted: 2,
      remaining: 3,
      stopped_because: "max_batches",
      exit_code: 3,
    });
    expect(await countKeys()).toBe(3);

    // والجَولةُ التاليةُ تُكمِلُ من حيثُ تقفُ القاعدةُ لا من حيثُ توقَّفَت ذاكرةٌ.
    const second = await runSweepCli({});
    expect(second.code).toBe(0);
    expect(JSON.parse(second.stdout)).toMatchObject({ deleted: 3, remaining: 0 });
    expect(await countKeys()).toBe(0);
  });

  it("غيابُ DATABASE_URL: رمزُ 1 وعلّةٌ في stderr ولا سطرَ تقريرٍ", async () => {
    const result = await runSweepCli({ DATABASE_URL: undefined });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("DATABASE_URL");
  });

  it("إعدادٌ غيرُ مقروءٍ: رمزُ 1 يُسمّي المتغيّرَ وقيمتَهُ ولا يحذفُ صفّاً واحداً", async () => {
    await seedKey("cli-badconf-key-000001", -10);

    const result = await runSweepCli({ IDEMPOTENCY_SWEEP_BATCH_SIZE: "5oo" });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("IDEMPOTENCY_SWEEP_BATCH_SIZE");
    expect(result.stderr).toContain("5oo");
    // الرفضُ قبلَ أوّلِ اتّصالٍ: المفتاحُ المنتهي باقٍ كما هوَ.
    expect(await countKeys()).toBe(1);
  });

  it("قاعدةٌ لا تُجيبُ: رمزُ 1 بعلّةٍ صريحةٍ لا صمتٌ بصفرٍ", async () => {
    const result = await runSweepCli({
      DATABASE_URL: "postgresql://nobody:nothing@127.0.0.1:1/postgres",
    });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("أخفقَت جَولةُ المُكنسةِ");
  });
});
