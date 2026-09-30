// RISK-0056 · CLM-0411 — catalog snapshot of schema `public` (+ DB-wide facts).
//
// Usage: node scripts/ops/risk-0056/catalog-snapshot.mjs <out.json> [--read-only-required]
// Env:   SNAPSHOT_DB_URL (never printed)
//
// With --read-only-required (production): the session is put in read-only mode
// (`SET default_transaction_read_only = on`) and that is PROVEN before any
// catalog read: both settings must report `on`, and a canary
// `CREATE TEMP TABLE` inside a transaction must be rejected with SQLSTATE 25006
// (read_only_sql_transaction). If any proof fails the script exits 4 without
// reading anything. Every read then runs inside `BEGIN READ ONLY`.
// Reads only catalog views and `count(*)` of tables that already exist.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../services/delivery/package.json", import.meta.url));
const pg = require("pg");

const out = process.argv[2] ?? "snapshot.json";
const readOnlyRequired = process.argv.includes("--read-only-required");
const client = new pg.Client({ connectionString: process.env.SNAPSHOT_DB_URL, application_name: "risk0056-preflight-readonly" });
await client.connect();
const q = async (sql, params) => (await client.query(sql, params)).rows;

const proof = { required: readOnlyRequired };
if (readOnlyRequired) {
  await client.query("SET default_transaction_read_only = on");
  await client.query("SET statement_timeout = '15s'");
  await client.query("SET lock_timeout = '2s'");
  await client.query("SET idle_in_transaction_session_timeout = '30s'");
  proof.default_transaction_read_only = (await q("SHOW default_transaction_read_only"))[0].default_transaction_read_only;
  await client.query("BEGIN");
  proof.transaction_read_only = (await q("SHOW transaction_read_only"))[0].transaction_read_only;
  try {
    await client.query("CREATE TEMP TABLE risk0056_readonly_canary (x int)");
    proof.canary = "WRITE_ACCEPTED";
  } catch (error) {
    proof.canary = error.code === "25006" ? "rejected_25006" : `rejected_other_${error.code}`;
  }
  await client.query("ROLLBACK");
  const ok =
    proof.default_transaction_read_only === "on" &&
    proof.transaction_read_only === "on" &&
    proof.canary === "rejected_25006";
  proof.ok = ok;
  console.log(
    `read-only proof: default_transaction_read_only=${proof.default_transaction_read_only} ` +
      `transaction_read_only=${proof.transaction_read_only} canary=${proof.canary} → ${ok ? "PROVEN" : "NOT PROVEN"}`,
  );
  if (!ok) {
    await client.end();
    writeFileSync(out, JSON.stringify({ read_only_proof: proof }, null, 2));
    process.exit(4);
  }
}

await client.query(readOnlyRequired ? "BEGIN READ ONLY" : "BEGIN");
const snap = { generated_at: new Date().toISOString(), read_only_proof: proof };
snap.server_version = (await q("SHOW server_version"))[0].server_version;
snap.schemas = await q("SELECT schemaname AS schema, count(*)::int AS tables FROM pg_tables GROUP BY 1 ORDER BY 1");
snap.extensions = await q(
  `SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema
     FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace ORDER BY 1`,
);
snap.available = await q(
  "SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name IN ('pg_trgm') ORDER BY 1",
);
snap.can_create_in_public = (await q("SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS c"))[0].c;
snap.default_acl_public = await q(
  `SELECT pg_get_userbyid(d.defaclrole) AS owner_role, d.defaclobjtype AS objtype, d.defaclacl::text AS acl
     FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
    WHERE n.nspname = 'public' ORDER BY 1, 2`,
);
snap.event_triggers = await q("SELECT evtname AS name, evtevent AS event, evtenabled AS enabled, evtfoid::regproc::text AS function FROM pg_event_trigger ORDER BY 1");
snap.activity = await q(
  "SELECT coalesce(state, 'n/a') AS state, count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() GROUP BY 1 ORDER BY 1",
);
snap.functions = await q(
  `SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args, md5(p.prosrc) AS body_md5
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' ORDER BY 1, 2`,
);
snap.sequences = (await q(
  `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S' ORDER BY 1`,
)).map((r) => r.name);
snap.types = await q(
  `SELECT t.typname AS name, t.typtype AS kind FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype IN ('e','d','c') AND NOT EXISTS
      (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid) ORDER BY 1`,
);
snap.index_names = (await q(
  `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'i' ORDER BY 1`,
)).map((r) => r.name);

const tables = (await q(
  `SELECT c.oid, c.relname AS name, c.relrowsecurity AS rls, c.relacl::text AS acl, pg_get_userbyid(c.relowner) AS owner
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY c.relname`,
));
snap.tables = {};
for (const t of tables) {
  const columns = await q(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
            pg_get_expr(d.adbin, d.adrelid) AS default, a.attidentity AS identity, a.attgenerated AS generated
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
    [t.oid],
  );
  const constraints = await q(
    `SELECT conname AS name, contype AS type, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE conrelid = $1 ORDER BY conname`,
    [t.oid],
  );
  const indexes = await q(
    `SELECT c.relname AS name, pg_get_indexdef(i.indexrelid) AS def, i.indisunique AS unique, i.indisprimary AS primary
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE i.indrelid = $1 ORDER BY c.relname`,
    [t.oid],
  );
  const triggers = await q(
    `SELECT tgname AS name, pg_get_triggerdef(oid) AS def FROM pg_trigger
      WHERE tgrelid = $1 AND NOT tgisinternal ORDER BY tgname`,
    [t.oid],
  );
  const policies = await q("SELECT polname AS name FROM pg_policy WHERE polrelid = $1 ORDER BY 1", [t.oid]);
  const rows = (await q(`SELECT count(*)::bigint AS n FROM public."${t.name}"`))[0].n;
  snap.tables[t.name] = { rls: t.rls, policies: policies.map((p) => p.name), acl: t.acl, rows: Number(rows), columns, constraints, indexes, triggers };
}
await client.query("ROLLBACK");
await client.end();
writeFileSync(out, JSON.stringify(snap, null, 2));
console.log(`snapshot: server=${snap.server_version} public_tables=${tables.length} functions=${snap.functions.length} sequences=${snap.sequences.length}`);
