/**
 * برهانُ الترقيةِ على قاعدةٍ **فيها بياناتٌ سابقةٌ** (M0-34 · ADR-024 · RISK-0020).
 *
 * ## ما يقيسُهُ هذا الاختبارُ
 *
 *  ترحيلُ `0001_outbox_sequence_number` يُضيفُ عمودَ `sequence_number` (GENERATED
 *  ALWAYS AS IDENTITY) إلى جدولِ `subscription_outbox`. وهذا الاختبارُ يُثبِتُ أنَّ الترقيةَ
 *  تمرُّ على قاعدةٍ فيها صفٌّ واحدٌ على الأقلُّ — فالعمودُ مُولَّدٌ لا `NOT NULL`
 *  بلا افتراضٍ، فلا `23502` متوقَّعةٌ، لكنَّ البرهانَ مقيسٌ لا مُفترَضٌ.
 *
 * ## العلامةُ الآليّةُ
 *
 * @wasla-upgrade-proof: all-non-baseline
 *
 * Local run:
 *   DATABASE_URL=postgres://wasla:wasla@127.0.0.1:5432/wasla_subscriptions_test \\
 *     pnpm --filter @wasla/subscriptions-service test:integration
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

const SEEDED_EVENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SEEDED_AGGREGATE_ID = "WS-0000000001";

describe.skipIf(!PG_ENABLED)("برهانُ الترقيةِ على قاعدةٍ مأهولةٍ (M0-34 · ADR-037)", () => {
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
      `INSERT INTO subscription_outbox
         (event_id, event_type, event_version, aggregate_type, aggregate_id,
          payload, occurred_at, attempts, last_error, trace_id)
       VALUES ($1, $2, 'v1', $3, $4, $5::jsonb, NOW(), 0, NULL, 'trace-upgrade-proof')`,
      [
        SEEDED_EVENT_ID,
        "subscription.created",
        "subscription",
        SEEDED_AGGREGATE_ID,
        JSON.stringify({ type: "subscription.created" }),
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

  it("الصفُّ المزروعُ موجودٌ قبلَ الترقيةِ — وإلّا فالبرهانُ على فراغٍ", async () => {
    const result = await db.query(`SELECT count(*)::int AS n FROM subscription_outbox`);
    expect(result.rows[0].n).toBe(1);
  });

  it("الترقيةُ تمرُّ على قاعدةٍ مأهولةٍ — لا `23502`", async () => {
    for (const m of upgrades) {
      await applySqlFile(db, m.up);
    }
    expect(upgrades.length, "لا ترحيلَ فوقَ الأساسِ").toBeGreaterThan(0);
  });

  it("الصفُّ نجا بقيمِهِ وعمودُ `sequence_number` مُعبَّأٌ", async () => {
    const { rows } = await db.query(
      `SELECT event_id::text AS event_id, event_type, aggregate_type, aggregate_id,
              sequence_number
       FROM subscription_outbox`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].event_id).toBe(SEEDED_EVENT_ID);
    expect(rows[0].event_type).toBe("subscription.created");
    expect(rows[0].sequence_number).toBeGreaterThan(0);
  });

  it("التراجعُ لا يُبيدُ البياناتِ — والعمودُ يُحذَفُ", async () => {
    for (const m of [...upgrades].reverse()) {
      await applySqlFile(db, m.down);
    }
    const { rows } = await db.query(`SELECT event_id::text AS event_id FROM subscription_outbox`);
    expect(rows).toHaveLength(1);
    expect(rows[0].event_id).toBe(SEEDED_EVENT_ID);

    // sequence_number column should be gone
    const cols = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'subscription_outbox' AND column_name = 'sequence_number'`,
    );
    expect(cols.rows).toHaveLength(0);
  });
});
