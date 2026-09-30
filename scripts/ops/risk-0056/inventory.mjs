// RISK-0056 · CLM-0410 — read-only inventory of the target database.
// Usage: node scripts/ops/risk-0056/inventory.mjs <out.json>
// Env:   RISK0056_DB_URL (never printed)
// Records: server version, schemas with table counts, public table names with
// row estimates, installed extensions. Reads catalog views only.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../services/delivery/package.json", import.meta.url));
const pg = require("pg");

const client = new pg.Client({ connectionString: process.env.RISK0056_DB_URL });
await client.connect();
await client.query("SET default_transaction_read_only = on");
const q = async (sql) => (await client.query(sql)).rows;
const report = {
  generated_at: new Date().toISOString(),
  server_version: (await q("SHOW server_version"))[0].server_version,
  current_database: (await q("SELECT current_database() AS d"))[0].d,
  schemas: await q(
    "SELECT schemaname AS schema, count(*)::int AS tables FROM pg_tables GROUP BY 1 ORDER BY 1",
  ),
  public_tables: await q(
    `SELECT c.relname AS table, GREATEST(c.reltuples, 0)::bigint AS row_estimate
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY 1`,
  ),
  extensions: await q("SELECT extname AS name, extversion AS version FROM pg_extension ORDER BY 1"),
};
await client.end();
writeFileSync(process.argv[2] ?? "inventory.json", JSON.stringify(report, null, 2));
console.log(
  `server=${report.server_version} public_tables=${report.public_tables.length} ` +
    `schemas=${report.schemas.map((s) => `${s.schema}:${s.tables}`).join(",")}`,
);
