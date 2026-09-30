/**
 * برهانُ ترقيةِ مخطَّطِ الفوترةِ على قاعدةٍ فيها بياناتٌ سابقة (M5-17P · CLM-0375 · M0-34).
 *
 * بالترتيب:
 *  1. تُطبَّقُ ترحيلاتُ الأساسِ (`idx = 0`) وحدَها في قاعدةٍ معزولةٍ (`<db>_mig_upgrade`) —
 *     لا مخطَّطٍ جانبيٍّ، لأنَّ الأساسَ يُشيرُ إلى `"public"."billing_invoices"` صراحةً.
 *  2. تُزرَعُ فاتورةٌ وتسويةٌ وصفُّ صادرٍ بقيمٍ معلومة.
 *  3. تُطبَّقُ الترحيلاتُ التالية (`idx ≥ 1`) من `drizzle/meta/_journal.json` على القاعدةِ المأهولة.
 *  4. الصفوفُ المزروعةُ باقيةٌ بقيمِها، والجداولُ الجديدةُ قائمةٌ وتقبلُ صفّاً يُشيرُ إلى
 *     التسويةِ المزروعة (المفتاحُ الأجنبيُّ حيّ).
 *  5. التراجعُ عن آخرِ ترحيلٍ يُزيلُ الجديدَ ولا يمسُّ المزروع.
 *
 * @wasla-upgrade-proof: all-non-baseline
 *
 * Local run:
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/wasla_billing_test \
 *     pnpm --filter @wasla/billing-service test:integration
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DATABASE_URL, PG_ENABLED } from "./pg-harness.js";

function upgradeDatabaseName(url: string): string {
  return `${new URL(url).pathname.replace(/^\//, "")}_mig_upgrade`;
}

function databaseUrlFor(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

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
  return journal.entries.map((e) => ({
    idx: e.idx,
    tag: e.tag,
    up: resolve(process.cwd(), "drizzle", `${e.tag}.sql`),
    down: resolve(process.cwd(), "drizzle", `${e.tag}.down.sql`),
  }));
}

async function applySqlFile(client: pg.Client, path: string): Promise<void> {
  const raw = await readFile(path, "utf8");
  const chunks = raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.split("\n").some((line) => line.trim() && !line.trimStart().startsWith("--")));
  for (const chunk of chunks) await client.query(chunk);
}

const SEED = {
  invoiceId: "a1a1a1a1-b2b2-4c3c-8d4d-e5e5e5e5e5e5",
  settlementId: "f6f6f6f6-a7a7-4b8b-9c9c-d0d0d0d0d0d0",
  outboxId: "c1c1c1c1-d2d2-4e3e-8f4f-a5a5a5a5a5a5",
} as const;

describe.skipIf(!PG_ENABLED)("billing migrations — upgrade with existing data", () => {
  let admin: pg.Client;
  let client: pg.Client;
  let migrations: MigrationFile[];
  const dbName = PG_ENABLED ? upgradeDatabaseName(DATABASE_URL!) : "";

  beforeAll(async () => {
    migrations = await readMigrations();
    admin = new pg.Client({ connectionString: DATABASE_URL! });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
    client = new pg.Client({ connectionString: databaseUrlFor(DATABASE_URL!, dbName) });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.end();
    }
  });

  it("the journal has a baseline and at least one later migration", () => {
    expect(migrations[0]?.idx).toBe(0);
    expect(migrations.length).toBeGreaterThanOrEqual(2);
  });

  it("upgrades a populated baseline, keeps every seeded row, and rolls back cleanly", async () => {
    // 1) ما قبلَ الترقية.
    for (const m of migrations.filter((m) => m.idx === 0)) await applySqlFile(client, m.up);

    // 2) بياناتٌ حيّة.
    await client.query(
      `INSERT INTO billing_invoices (invoice_id, store_public_id, period, state, fee_type, amount_cents)
       VALUES ($1, 'WS-0000000001', '2026-08', 'issued', 'store_variable', 250)`,
      [SEED.invoiceId],
    );
    await client.query(
      `INSERT INTO billing_settlements (settlement_id, invoice_id, fee_type, amount_cents, period, state)
       VALUES ($1, $2, 'store_variable', 250, '2026-08', 'settled')`,
      [SEED.settlementId, SEED.invoiceId],
    );
    await client.query(
      `INSERT INTO billing_outbox (event_id, event_type, aggregate_id, payload)
       VALUES ($1, 'billing.fee_settled', $2, '{"k":"v"}'::jsonb)`,
      [SEED.outboxId, SEED.settlementId],
    );

    // 3) الترقيةُ على المأهولة.
    // RISK-0012 (0003) is applied below, AFTER a checkpoint row exists, so its
    // column is proven against a populated cursor table, not an empty one.
    const R12 = "0003_relay_commit_sequence";
    const r12 = migrations.find((m) => m.tag === R12);
    expect(r12, `${R12} in the journal`).toBeDefined();
    for (const m of migrations.filter((m) => m.idx >= 1 && m.tag !== R12)) await applySqlFile(client, m.up);

    // 4) البقاءُ بالقيم.
    const inv = await client.query(`SELECT store_public_id, state, amount_cents::int AS a FROM billing_invoices`);
    expect(inv.rows).toEqual([{ store_public_id: "WS-0000000001", state: "issued", a: 250 }]);
    const stl = await client.query(`SELECT settlement_id::text AS id, invoice_id::text AS inv FROM billing_settlements`);
    expect(stl.rows).toEqual([{ id: SEED.settlementId, inv: SEED.invoiceId }]);
    const out = await client.query(`SELECT event_id::text AS id, payload FROM billing_outbox`);
    expect(out.rows).toEqual([{ id: SEED.outboxId, payload: { k: "v" } }]);

    await client.query(
      `INSERT INTO billing_relay_checkpoint (consumer_id, last_occurred_at, last_event_id)
       VALUES ('billing-relay', '2026-09-01T00:00:00Z', gen_random_uuid())`,
    );
    await applySqlFile(client, r12!.up);
    // The existing cursor is kept and starts at 0: one re-read, deduplicated by the ledger.
    expect(
      (await client.query(`SELECT consumer_id, last_commit_sequence::text AS s FROM billing_relay_checkpoint`)).rows,
    ).toEqual([{ consumer_id: "billing-relay", s: "0" }]);
    await client.query(
      `INSERT INTO billing_relay_consumed_events (consumer_id, event_id, status, settlement_id)
       VALUES ('billing-relay', gen_random_uuid(), 'settled', $1)`,
      [SEED.settlementId],
    );
    await expect(
      client.query(
        `INSERT INTO billing_relay_consumed_events (consumer_id, event_id, status, settlement_id)
         VALUES ('billing-relay', gen_random_uuid(), 'settled', gen_random_uuid())`,
      ),
    ).rejects.toThrow(/foreign key/);

    // M5-17Q (0002): لقطةُ طلبٍ مربوطةٌ بالتسويةِ وصفُّ دفترٍ بحالةِ `recorded`.
    await client.query(
      `INSERT INTO billing_store_order_snapshots
         (order_id, order_public_id, store_id, store_slug, currency_code,
          items_total_minor_units, delivery_fee_minor_units, source_event_id, settlement_id)
       VALUES (gen_random_uuid(), 'WS-3000000001', gen_random_uuid(), 'madinah-electronics', 'SAR',
               10000, 1500, gen_random_uuid(), $1)`,
      [SEED.settlementId],
    );
    await client.query(
      `INSERT INTO billing_relay_consumed_events (consumer_id, event_id, status)
       VALUES ('billing-relay', gen_random_uuid(), 'recorded')`,
    );
    await expect(
      client.query(
        `INSERT INTO billing_store_order_snapshots
           (order_id, order_public_id, store_id, store_slug, currency_code,
            items_total_minor_units, delivery_fee_minor_units, source_event_id, settlement_id)
         VALUES (gen_random_uuid(), 'WS-3000000002', gen_random_uuid(), 'madinah-electronics', 'SAR',
                 1, 0, gen_random_uuid(), $1)`,
        [SEED.settlementId],
      ),
    ).rejects.toThrow(/settlement_id_unique/);

    // 5) التراجعُ عن كلِّ ما بعدَ الأساسِ بترتيبٍ عكسيٍّ — كلُّ `.down.sql` يُنفَّذُ على بياناتٍ حيّة.
    const later = migrations.filter((m) => m.idx >= 1).sort((a, b) => b.idx - a.idx);
    expect(later[0]!.tag).toBe(R12);
    await applySqlFile(client, later[0]!.down);
    const cursorCols = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'billing_relay_checkpoint' AND column_name = 'last_commit_sequence'`,
    );
    expect(cursorCols.rowCount).toBe(0);
    expect((await client.query(`SELECT count(*)::int AS n FROM billing_relay_checkpoint`)).rows[0].n).toBe(1);
    await applySqlFile(client, later[1]!.down);
    const afterLast = await client.query<{ status: string }>(
      `SELECT status FROM billing_relay_consumed_events ORDER BY status`,
    );
    expect(afterLast.rows.map((r) => r.status)).toEqual(["settled"]);
    for (const m of later.slice(2)) await applySqlFile(client, m.down);
    const tables = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
      ["public"],
    );
    expect(tables.rows.map((r) => r.tablename)).toEqual(["billing_invoices", "billing_outbox", "billing_settlements"]);
    expect((await client.query(`SELECT count(*)::int AS n FROM billing_settlements`)).rows[0].n).toBe(1);
  });
});
