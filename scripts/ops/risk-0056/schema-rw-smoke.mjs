// RISK-0056 · CLM-0410 — schema presence + transactional read/write smoke.
//
// Usage: node scripts/ops/risk-0056/schema-rw-smoke.mjs <out.json>
// Env:   RISK0056_DB_URL      target (TEST) database — never printed
//        RISK0056_REF_DB_URL  optional reference database where the same
//                             contracts/schema.sql files were applied to a
//                             vanilla Postgres; when set, every table's column
//                             list (name, type, nullability) is compared.
//
// Write smoke: for each service one table (its outbox / audit log) receives a
// row whose text columns carry the marker `risk0056-smoke`, the row is read
// back by primary key inside the SAME transaction, and the transaction is
// ROLLED BACK. A post-check proves zero marker rows remain. Nothing persists.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../services/delivery/package.json", import.meta.url));
const pg = require("pg");

const SERVICES = {
  audit: "audit_events",
  customers: "customer_outbox",
  delivery: "delivery_outbox",
  dispatch: "dispatch_outbox",
  drivers: "driver_outbox",
  geography: "geo_outbox",
  identity: "identity_outbox",
  marketplace: "marketplace_outbox",
  matching: "matching_outbox",
  negotiations: "negotiation_outbox",
  orders: "order_outbox",
  reputation: "reputation_outbox",
  search: "search_outbox",
  subscriptions: "subscription_outbox",
};
const MARKER = "risk0056-smoke";
// Values that satisfy per-table CHECK constraints (copied from contracts/schema.sql).
// Enumerated text columns (CHECK ... IN (...)) take the first allowed literal,
// read from the live constraint definition — never hard-coded here.
// Tables whose event_type CHECK is a namespaced regex get an explicit value.
const OVERRIDES = {
  marketplace_outbox: { event_type: "'marketplace.risk_smoke'" },
  subscription_outbox: { event_type: "'subscription.risk_smoke'" },
};
const COMMON = { event_version: "'v1'", event_type: "'risk0056.smoke'" };

function tablesOf(service) {
  const sql = readFileSync(`services/${service}/contracts/schema.sql`, "utf8").replace(/--[^\n]*/g, "");
  return [...sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?(?:public"?\.)?"?(\w+)"?/gi)].map((m) => m[1]);
}

async function columns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default, is_identity, is_generated
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return rows;
}

function valueFor(col) {
  const t = col.udt_name;
  if (t === "uuid") return "gen_random_uuid()";
  if (["text", "varchar", "bpchar", "citext"].includes(t)) return `'${MARKER}'`;
  if (["int2", "int4", "int8"].includes(t)) return "1";
  if (t === "numeric" || t === "float4" || t === "float8") return "0";
  if (t === "bool") return "false";
  if (t === "timestamptz" || t === "timestamp") return "now()";
  if (t === "date") return "current_date";
  if (t === "jsonb" || t === "json") return `'{"${MARKER}":true}'::${t}`;
  if (t === "bytea") return "'\\x00'::bytea";
  return null;
}

async function enumLiterals(client, table) {
  const { rows } = await client.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = ('public."' || $1 || '"')::regclass AND contype = 'c'`,
    [table],
  );
  const found = {};
  for (const { def } of rows) {
    const m = def.match(/\(\(?(\w+)\)?(?:::text)?\s*=\s*ANY\s*\(\(?ARRAY\['([^']+)'/);
    if (m && !(m[1] in found)) found[m[1]] = `'${m[2]}'`;
  }
  return found;
}

async function writeSmoke(client, table) {
  const cols = await columns(client, table);
  OVERRIDES[table] = { ...(await enumLiterals(client, table)), ...(OVERRIDES[table] ?? {}) };
  const required = cols.filter(
    (c) => c.is_nullable === "NO" && c.column_default === null && c.is_identity !== "YES" && c.is_generated !== "ALWAYS",
  );
  const names = [];
  const values = [];
  for (const c of required) {
    const v = OVERRIDES[table]?.[c.column_name] ?? COMMON[c.column_name] ?? valueFor(c);
    if (v === null) return { ok: false, reason: `no generator for type ${c.udt_name} (${c.column_name})` };
    names.push(`"${c.column_name}"`);
    values.push(v);
  }
  const textCols = cols.filter((c) => ["text", "varchar"].includes(c.udt_name)).map((c) => c.column_name);
  const markerCol = required.find(
    (c) => ["text", "varchar"].includes(c.udt_name) && !(OVERRIDES[table]?.[c.column_name] ?? COMMON[c.column_name]),
  )?.column_name;
  const pk = (
    await client.query(
      `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = ('public."' || $1 || '"')::regclass AND i.indisprimary`,
      [table],
    )
  ).rows.map((r) => r.attname);
  if (pk.length === 0) return { ok: false, reason: "no primary key" };
  const where = pk.map((c, i) => `"${c}" = $${i + 1}`).join(" AND ");
  await client.query("BEGIN");
  try {
    const ins = await client.query(
      `INSERT INTO public."${table}" (${names.join(",")}) VALUES (${values.join(",")}) RETURNING *`,
    );
    const key = pk.map((c) => ins.rows[0][c]);
    const readBack = await client.query(`SELECT count(*)::int AS n FROM public."${table}" WHERE ${where}`, key);
    const marker = markerCol
      ? (await client.query(`SELECT "${markerCol}" AS m FROM public."${table}" WHERE ${where}`, key)).rows[0].m
      : null;
    await client.query("ROLLBACK");
    const after = await client.query(`SELECT count(*)::int AS n FROM public."${table}" WHERE ${where}`, key);
    return {
      ok: ins.rowCount === 1 && readBack.rows[0].n === 1 && after.rows[0].n === 0 && (markerCol ? marker === MARKER : true),
      inserted_columns: names.length,
      primary_key: pk,
      marker_column: markerCol ?? null,
      marker_read_back: marker,
      read_back_in_tx: readBack.rows[0].n,
      rows_after_rollback: after.rows[0].n,
      text_columns: textCols.length,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return { ok: false, reason: `pg_${error.code ?? "error"}`, constraint: error.constraint ?? null, column: error.column ?? null };
  }
}

const out = process.argv[2] ?? "schema-rw-smoke.json";
const target = new pg.Client({ connectionString: process.env.RISK0056_DB_URL });
await target.connect();
let ref = null;
if (process.env.RISK0056_REF_DB_URL) {
  ref = new pg.Client({ connectionString: process.env.RISK0056_REF_DB_URL });
  await ref.connect();
}

const report = { generated_at: new Date().toISOString(), marker: MARKER, services: {} };
let allOk = true;
for (const [service, writeTable] of Object.entries(SERVICES)) {
  const tables = tablesOf(service);
  const presence = {};
  let schemaOk = true;
  for (const table of tables) {
    const cols = await columns(target, table);
    const entry = { exists: cols.length > 0, columns: cols.length };
    if (ref) {
      const refCols = await columns(ref, table);
      const sig = (c) => `${c.column_name}:${c.udt_name}:${c.is_nullable}`;
      const a = cols.map(sig).join("|");
      const b = refCols.map(sig).join("|");
      entry.matches_reference = a === b;
      if (a !== b) {
        entry.missing = refCols.map(sig).filter((s) => !cols.map(sig).includes(s));
        entry.extra = cols.map(sig).filter((s) => !refCols.map(sig).includes(s));
      }
    }
    if (!entry.exists || entry.matches_reference === false) schemaOk = false;
    presence[table] = entry;
  }
  // read smoke: every table is selectable by this role
  let readOk = true;
  for (const table of tables) {
    try { await target.query(`SELECT 1 FROM public."${table}" LIMIT 1`); }
    catch { readOk = false; presence[table].readable = false; }
  }
  const write = await writeSmoke(target, writeTable);
  const ok = schemaOk && readOk && write.ok;
  if (!ok) allOk = false;
  report.services[service] = { ok, tables: tables.length, schema_ok: schemaOk, read_ok: readOk, write_table: writeTable, write, presence };
  console.log(`[${service}] tables=${tables.length} schema_ok=${schemaOk} read_ok=${readOk} write_ok=${write.ok}${write.reason ? " (" + write.reason + ")" : ""}`);
}
report.all_ok = allOk;
writeFileSync(out, JSON.stringify(report, null, 2));
await target.end();
if (ref) await ref.end();
process.exit(allOk ? 0 : 1);
