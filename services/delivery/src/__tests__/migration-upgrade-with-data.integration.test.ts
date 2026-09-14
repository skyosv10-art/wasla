/**
 * برهانُ الترقيةِ على قاعدةٍ **فيها بياناتٌ سابقةٌ** (M0-34 · ADR-024 · RISK-0020).
 *
 * ## لماذا لا يكفي اختبارُ الدورةِ القائمُ
 *
 * `migrations.integration.test.ts` يقيسُ دورةً كاملةً على قاعدةٍ **فارغةٍ**: يُطبِّقُ
 * كلَّ الترحيلاتِ دفعةً واحدةً، ثمَّ يترجعُ، ثمَّ يُعيدُ. وهو برهانُ **تكافؤٍ وعكسيّةٍ**
 * لا برهانُ **ترقيةٍ**. والفرقُ ليسَ نظريّاً: عبارةٌ مثلُ
 *
 *     ALTER TABLE t ADD COLUMN c timestamptz NOT NULL;
 *
 * تنجحُ في قاعدةٍ فارغةٍ وتسقطُ بـ`23502` في قاعدةٍ فيها **صفٌّ واحدٌ**. وهذا مقيسٌ
 * مكتوبٌ في رأسِ [`0001_idempotency_key_lifetime.sql`](../../drizzle/0001_idempotency_key_lifetime.sql):
 * المولِّدُ أصدرَ تلكَ العبارةَ بعينِها، ونجا المستودعُ **بمراجعةٍ يدويّةٍ وحدَها**.
 * فما لم يُقَسْ على صفوفٍ قائمةٍ، لم يُقَسْ.
 *
 * ## ما يقيسُهُ هذا الاختبارُ — بالترتيبِ
 *
 *  1. **حالةُ ما قبلَ الترقيةِ:** تُطبَّقُ ترحيلاتُ الأساسِ (`idx = 0`) وحدَها،
 *     فتكونُ القاعدةُ نسخةَ الإنتاجِ القديمةَ لا الجديدةَ.
 *  2. **بياناتٌ حيّةٌ:** تُزرَعُ صفوفٌ **بقيمٍ معلومةٍ** في جدولٍ يمسُّهُ ترحيلٌ لاحقٌ
 *     (`delivery_idempotency_keys`) وفي جدولٍ **لا يمسُّهُ** أيُّ ترحيلٍ لاحقٍ
 *     (`delivery_inventory_observations`) — فالبقاءُ يُقاسُ في الحالَينِ.
 *  3. **الترقيةُ:** تُطبَّقُ الترحيلاتُ التاليةُ (`idx ≥ 1`) **على القاعدةِ المأهولةِ**.
 *     سقوطُ أيِّ عبارةٍ هنا هوَ العطبُ الذي يُراد منعُهُ.
 *  4. **البقاءُ والتعبئةُ الرجعيّةُ:** كلُّ صفٍّ مزروعٍ ما يزالُ موجوداً بقيمِهِ،
 *     والعمودُ الجديدُ `expires_at` مُعبَّأٌ رجعيّاً بـ`created_at + 24h` **بالضبطِ**
 *     كما يُعلِنُ رأسُ الترحيلِ — لا «غيرَ فارغٍ» فحسب.
 *  5. **التراجعُ لا يُبيدُ البياناتِ:** يُترجَعُ الترحيلُ الأخيرُ فقط، فتبقى الصفوفُ
 *     المزروعةُ كما هيَ. فالترجعُ طريقُ خروجٍ من ترقيةٍ، لا مِحرقةُ بياناتٍ.
 *
 * ## الحدُّ المُعلَنُ
 *
 * هذا الاختبارُ لا يقيسُ الأداءَ ولا القفلَ (`ACCESS EXCLUSIVE`) ولا زمنَ الترقيةِ على
 * جدولٍ ضخمٍ. يقيسُ **الصحّةَ** وحدَها: أنَّ الترقيةَ تمرُّ وأنَّ البياناتِ تنجو.
 * وقياسُ الأداءِ عنصرُ عملٍ منفصلٌ لا يُدَّعى هنا.
 *
 * ويُتخطّى كلُّهُ حينَ لا تكونُ `DATABASE_URL` مضبوطةً، كإخوتِهِ في هذا المجلَّدِ،
 * ويعملُ في وظيفةِ `delivery · db-integration` القائمةِ (لا وظيفةَ جديدةَ — ADR-024 §2.3).
 *
 * ## العلامةُ الآليّةُ
 *
 * السطرُ التالي عقدٌ يقرؤُهُ البابُ الرابعُ في `scripts/checks/validate-migrations.sh`:
 * حذفُهُ يُسقِطُ الحارسَ فوراً، فالبرهانُ يُعلِنُ تغطيتَهُ بنفسِهِ ولا تُستنتَجُ عنه.
 *
 * @wasla-upgrade-proof: all-non-baseline
 *
 * Local run:
 *   DATABASE_URL=postgres://wasla:wasla@127.0.0.1:5432/wasla_delivery_test \
 *     pnpm --filter @wasla/delivery-service test:integration
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const PG_ENABLED = Boolean(DATABASE_URL);

interface MigrationFile {
  readonly idx: number;
  readonly tag: string;
  readonly up: string;
  readonly down: string;
}

/** قراءةُ الـjournal بترتيبِهِ ومعَ رقمِ الدفعةِ — لا بافتراضِ أسماءِ الملفاتِ أبجديّاً. */
async function readMigrations(): Promise<MigrationFile[]> {
  const journalPath = resolve(process.cwd(), "drizzle/meta/_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  return journal.entries.map((entry) => ({
    idx: entry.idx,
    tag: entry.tag,
    up: resolve(process.cwd(), "drizzle", `${entry.tag}.sql`),
    down: resolve(process.cwd(), "drizzle", `${entry.tag}.down.sql`),
  }));
}

/** تطبيقُ ملفِّ SQL واحدٍ: تُفصَمُ العباراتُ عندَ فاصلِ drizzle لا عندَ حدسٍ. */
async function applySqlFile(client: pg.Client, path: string): Promise<void> {
  const raw = await readFile(path, "utf8");
  const chunks = raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => {
      const withoutComments = s
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim();
      return withoutComments.length > 0;
    });
  for (const chunk of chunks) {
    await client.query(chunk);
  }
}

function upgradeDatabaseName(url: string): string {
  const name = new URL(url).pathname.replace(/^\//, "");
  return `${name}_mig_upgrade`;
}

function maintenanceUrl(url: string): string {
  const u = new URL(url);
  u.pathname = "/postgres";
  return u.toString();
}

function databaseUrlFor(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/**
 * الصفُّ المزروعُ في الجدولِ الذي يمسُّهُ الترحيلُ `0001`.
 * القيمُ ثابتةٌ معلومةٌ لأنَّ البرهانَ مقارنةٌ لا «وُجدَ شيءٌ».
 */
const SEEDED_KEY = {
  idempotencyKey: "m0-34-upgrade-proof-key-0001",
  route: "POST /store-orders",
  fingerprint: "a".repeat(64),
  responseStatus: 201,
  orderId: "11111111-1111-4111-8111-111111111111",
  traceId: "m0-34-trace",
  /** وقتٌ ماضٍ صريحٌ: التعبئةُ الرجعيّةُ تُقاسُ عليهِ لا على `now()` المتحرِّكِ. */
  createdAt: "2026-01-02T03:04:05.000Z",
} as const;

/** صفٌّ في جدولٍ لا يمسُّهُ ترحيلٌ لاحقٌ — شاهدُ أنَّ الترقيةَ لا تُتلِفُ الجوارَ. */
const SEEDED_OBSERVATION = {
  storeId: "22222222-2222-4222-8222-222222222222",
  productId: "33333333-3333-4333-8333-333333333333",
  lastAdjustmentId: "44444444-4444-4444-8444-444444444444",
  lastMarketplaceEventId: "55555555-5555-4555-8555-555555555555",
  lastAdjustmentSequence: 7,
  observedQuantityAfter: 12,
  lastQuantityDelta: -3,
  lastReasonCode: "correction",
  occurredFor: "2026-01-02T03:04:05.000Z",
} as const;

describe.skipIf(!PG_ENABLED)("برهانُ الترقيةِ على قاعدةٍ فيها بياناتٌ سابقةٌ (M0-34)", () => {
  let db: pg.Client;
  let migrations: MigrationFile[];
  let baseline: MigrationFile[];
  let upgrades: MigrationFile[];
  const dbName = DATABASE_URL ? upgradeDatabaseName(DATABASE_URL) : "";

  beforeAll(async () => {
    migrations = await readMigrations();
    baseline = migrations.filter((m) => m.idx === 0);
    upgrades = migrations.filter((m) => m.idx > 0);
    expect(baseline.length, "لا ترحيلَ أساسٍ في الـjournal").toBeGreaterThan(0);

    const admin = new pg.Client({ connectionString: maintenanceUrl(DATABASE_URL!) });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();

    db = new pg.Client({ connectionString: databaseUrlFor(DATABASE_URL!, dbName) });
    await db.connect();

    // 1) حالةُ ما قبلَ الترقيةِ: الأساسُ وحدَهُ.
    for (const m of baseline) {
      await applySqlFile(db, m.up);
    }

    // 2) بياناتٌ حيّةٌ بقيمٍ معلومةٍ — قبلَ أيِّ ترحيلٍ لاحقٍ.
    await db.query(
      `INSERT INTO store_orders
         (order_id, public_id, customer_ref, store_id, store_slug,
          fulfillment_state, payment_state, inventory_state, currency_code,
          items_total_minor_units, delivery_fee_minor_units, total_minor_units)
       VALUES ($1, 'WS-0000000034', 'WS-0000000035', $2, 'm0-34-store',
               'placed', 'pending', 'none', 'SAR', 1000, 500, 1500)`,
      [SEEDED_KEY.orderId, SEEDED_OBSERVATION.storeId],
    );
    await db.query(
      `INSERT INTO delivery_idempotency_keys
         (idempotency_key, route, request_fingerprint, response_status,
          response_body, order_id, trace_id, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        SEEDED_KEY.idempotencyKey,
        SEEDED_KEY.route,
        SEEDED_KEY.fingerprint,
        SEEDED_KEY.responseStatus,
        JSON.stringify({ orderPublicId: "SO-M0-34" }),
        SEEDED_KEY.orderId,
        SEEDED_KEY.traceId,
        SEEDED_KEY.createdAt,
      ],
    );
    await db.query(
      `INSERT INTO delivery_inventory_observations
         (store_id, product_id, last_adjustment_id, last_marketplace_event_id,
          last_adjustment_sequence, observed_quantity_after, last_quantity_delta,
          last_reason_code, occurred_for)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        SEEDED_OBSERVATION.storeId,
        SEEDED_OBSERVATION.productId,
        SEEDED_OBSERVATION.lastAdjustmentId,
        SEEDED_OBSERVATION.lastMarketplaceEventId,
        SEEDED_OBSERVATION.lastAdjustmentSequence,
        SEEDED_OBSERVATION.observedQuantityAfter,
        SEEDED_OBSERVATION.lastQuantityDelta,
        SEEDED_OBSERVATION.lastReasonCode,
        SEEDED_OBSERVATION.occurredFor,
      ],
    );
  });

  afterAll(async () => {
    await db?.end().catch(() => undefined);
    if (!DATABASE_URL) return;
    const admin = new pg.Client({ connectionString: maintenanceUrl(DATABASE_URL) });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  it("الصفوفُ المزروعةُ موجودةٌ قبلَ الترقيةِ — وإلّا فالبرهانُ على فراغٍ", async () => {
    const keys = await db.query("SELECT count(*)::int AS n FROM delivery_idempotency_keys");
    const observations = await db.query(
      "SELECT count(*)::int AS n FROM delivery_inventory_observations",
    );
    expect(keys.rows[0].n).toBe(1);
    expect(observations.rows[0].n).toBe(1);
  });

  it("الترقيةُ تمرُّ على قاعدةٍ مأهولةٍ — لا `23502` ولا قيدٌ يسقطُ على صفٍّ قائمٍ", async () => {
    // لا `expect().rejects` هنا: السقوطُ يُفشِلُ الحالةَ برسالةِ Postgres نفسِها،
    // وهيَ أنفعُ للقارئِ من تأكيدٍ مُلخَّصٍ.
    for (const m of upgrades) {
      await applySqlFile(db, m.up);
    }
    expect(upgrades.length, "لا ترحيلَ فوقَ الأساسِ — البرهانُ خاوٍ").toBeGreaterThan(0);
  });

  it("الصفُّ في الجدولِ المُرقَّى نجا بقيمِهِ كلِّها", async () => {
    const { rows } = await db.query(
      `SELECT idempotency_key, route, request_fingerprint, response_status,
              order_id::text AS order_id, trace_id,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at
       FROM delivery_idempotency_keys`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      idempotency_key: SEEDED_KEY.idempotencyKey,
      route: SEEDED_KEY.route,
      request_fingerprint: SEEDED_KEY.fingerprint,
      response_status: SEEDED_KEY.responseStatus,
      order_id: SEEDED_KEY.orderId,
      trace_id: SEEDED_KEY.traceId,
      created_at: "2026-01-02T03:04:05",
    });
  });

  it("التعبئةُ الرجعيّةُ بالقيمةِ المُعلَنةِ بالضبطِ: `created_at + 24h` لا «غيرُ فارغٍ»", async () => {
    const { rows } = await db.query(
      `SELECT (expires_at = created_at + interval '24 hours') AS exact,
              expires_at IS NOT NULL AS filled
       FROM delivery_idempotency_keys`,
    );
    expect(rows[0].filled).toBe(true);
    expect(rows[0].exact, "التعبئةُ الرجعيّةُ خالفت ما يُعلِنُهُ رأسُ الترحيلِ").toBe(true);
  });

  it("الجدولُ الذي لم يمسَّهُ ترحيلٌ لم يُمَسَّ فعلاً", async () => {
    const { rows } = await db.query(
      `SELECT store_id::text AS store_id, product_id::text AS product_id,
              last_adjustment_sequence, observed_quantity_after,
              last_quantity_delta, last_reason_code
       FROM delivery_inventory_observations`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      store_id: SEEDED_OBSERVATION.storeId,
      product_id: SEEDED_OBSERVATION.productId,
      last_adjustment_sequence: SEEDED_OBSERVATION.lastAdjustmentSequence,
      observed_quantity_after: SEEDED_OBSERVATION.observedQuantityAfter,
      last_quantity_delta: SEEDED_OBSERVATION.lastQuantityDelta,
      last_reason_code: SEEDED_OBSERVATION.lastReasonCode,
    });
  });

  it("الترجعُ طريقُ خروجٍ لا مِحرقةُ بياناتٍ: الصفوفُ تنجو بعدَ التراجعِ خطوةً", async () => {
    const last = upgrades[upgrades.length - 1];
    await applySqlFile(db, last.down);

    const keys = await db.query(
      "SELECT idempotency_key FROM delivery_idempotency_keys",
    );
    const observations = await db.query(
      "SELECT store_id::text AS store_id FROM delivery_inventory_observations",
    );
    expect(keys.rows.map((r) => r.idempotency_key)).toEqual([SEEDED_KEY.idempotencyKey]);
    expect(observations.rows.map((r) => r.store_id)).toEqual([SEEDED_OBSERVATION.storeId]);

    // وإعادةُ التطبيقِ بعدَ التراجعِ تمرُّ أيضاً على القاعدةِ المأهولةِ.
    await applySqlFile(db, last.up);
    const after = await db.query("SELECT count(*)::int AS n FROM delivery_idempotency_keys");
    expect(after.rows[0].n).toBe(1);
  });
});
