// RISK-0056 · CLM-0412 — B1 (pg_trgm) resolution probe. READ ONLY.
//
// Usage: node scripts/ops/risk-0056/pgtrgm-probe.mjs <label> <out.json>
// Env:   SNAPSHOT_DB_URL (never printed)
//
// Before any read the session is put in read-only mode and that is PROVEN:
// `SET default_transaction_read_only = on`; `SHOW default_transaction_read_only`
// = on; inside BEGIN `SHOW transaction_read_only` = on; canary
// `CREATE TEMP TABLE` rejected with SQLSTATE 25006. Any failed proof ⇒ exit 4
// without reading. All reads then run in `BEGIN READ ONLY … ROLLBACK`.
// No CREATE EXTENSION, no DDL, no DML — catalog/settings reads only.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../services/delivery/package.json", import.meta.url));
const pg = require("pg");

const label = process.argv[2] ?? "db";
const out = process.argv[3] ?? `pgtrgm-${label}.json`;
const client = new pg.Client({ connectionString: process.env.SNAPSHOT_DB_URL, application_name: "risk0056-pgtrgm-readonly" });
await client.connect();
const q = async (sql, params) => (await client.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

// ── read-only proof (before any read) ──
const proof = {};
await client.query("SET default_transaction_read_only = on");
await client.query("SET statement_timeout = '15s'");
await client.query("SET lock_timeout = '2s'");
await client.query("SET idle_in_transaction_session_timeout = '30s'");
proof.default_transaction_read_only = (await one("SHOW default_transaction_read_only")).default_transaction_read_only;
await client.query("BEGIN");
proof.transaction_read_only = (await one("SHOW transaction_read_only")).transaction_read_only;
try {
  await client.query("CREATE TEMP TABLE risk0056_readonly_canary (x int)");
  proof.canary = "WRITE_ACCEPTED";
} catch (error) {
  proof.canary = error.code === "25006" ? "rejected_25006" : `rejected_other_${error.code}`;
}
await client.query("ROLLBACK");
proof.ok = proof.default_transaction_read_only === "on" && proof.transaction_read_only === "on" && proof.canary === "rejected_25006";
console.log(`[${label}] read-only proof: default_transaction_read_only=${proof.default_transaction_read_only} transaction_read_only=${proof.transaction_read_only} canary=${proof.canary} → ${proof.ok ? "PROVEN" : "NOT PROVEN"}`);
if (!proof.ok) {
  await client.end();
  writeFileSync(out, JSON.stringify({ label, read_only_proof: proof }, null, 2));
  process.exit(4);
}

await client.query("BEGIN READ ONLY");
const setting = async (name) => (await one("SELECT current_setting($1, true) AS v", [name])).v;
const r = { label, read_only_proof: proof };
r.server_version = await setting("server_version");
r.identity = await one("SELECT current_user AS current_user, session_user AS session_user, current_database() AS database");
r.search_path = (await one("SHOW search_path")).search_path;
r.current_schema = (await one("SELECT current_schema() AS s")).s;
r.current_schemas_implicit = (await one("SELECT current_schemas(true)::text AS s")).s;
r.current_schemas_explicit = (await one("SELECT current_schemas(false)::text AS s")).s;
r.user_named_schema_exists = (await one("SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = current_user) AS e")).e;
r.role_db_settings = await q(
  `SELECT coalesce(pg_get_userbyid(s.setrole), '(all roles)') AS role,
          coalesce((SELECT datname FROM pg_database d WHERE d.oid = s.setdatabase), '(all databases)') AS database,
          array_to_string(s.setconfig, ' ; ') AS config
     FROM pg_db_role_setting s
    WHERE (s.setrole IN (0, (SELECT oid FROM pg_roles WHERE rolname = current_user)))
      AND (s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database())))
    ORDER BY 1, 2`,
);
r.extensions_schema = await one(
  `SELECT n.nspname AS name, pg_get_userbyid(n.nspowner) AS owner, n.nspacl::text AS acl,
          obj_description(n.oid, 'pg_namespace') AS comment
     FROM pg_namespace n WHERE n.nspname = 'extensions'`,
) ?? null;
r.extensions_in_extensions_schema = (await q(
  `SELECT e.extname AS name FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE n.nspname = 'extensions' ORDER BY 1`,
)).map((x) => x.name);
r.installed_extensions = await q(
  `SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema, pg_get_userbyid(e.extowner) AS owner
     FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace ORDER BY 1`,
);
r.pg_trgm_available = await q("SELECT name, default_version, installed_version, comment FROM pg_available_extensions WHERE name = 'pg_trgm'");
r.pg_trgm_versions = await q(
  `SELECT version, installed, superuser, trusted, relocatable, schema, requires::text AS requires
     FROM pg_available_extension_versions WHERE name = 'pg_trgm' ORDER BY version`,
);
r.pg_trgm_installed = await one(
  `SELECT e.extversion AS version, n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm'`,
) ?? null;
r.role = await one(
  `SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls, rolreplication
     FROM pg_roles WHERE rolname = current_user`,
);
r.role_memberships = (await q(
  `SELECT pg_get_userbyid(m.roleid) AS role FROM pg_auth_members m
    WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user) ORDER BY 1`,
)).map((x) => x.role);
r.privileges = await one(
  `SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS db_create,
          has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage,
          has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
          CASE WHEN to_regnamespace('extensions') IS NULL THEN NULL
               ELSE has_schema_privilege(current_user, 'extensions', 'USAGE') END AS extensions_usage,
          CASE WHEN to_regnamespace('extensions') IS NULL THEN NULL
               ELSE has_schema_privilege(current_user, 'extensions', 'CREATE') END AS extensions_create`,
);
r.supautils = {};
for (const name of [
  "supautils.privileged_extensions",
  "supautils.privileged_extensions_superuser",
  "supautils.superuser",
  "supautils.privileged_role",
  "supautils.extension_custom_scripts_path",
  "supautils.reserved_roles",
]) r.supautils[name] = await setting(name);
r.preload = {
  shared_preload_libraries: await setting("shared_preload_libraries"),
  session_preload_libraries: await setting("session_preload_libraries"),
};
// pg_trgm objects actually used: schema.sql → opclass gin_trgm_ops; runtime (search-index-reader.ts) → operator % (text, text)
r.trgm_objects = {
  gin_trgm_ops: await q(
    `SELECT n.nspname AS schema, am.amname AS am FROM pg_opclass c JOIN pg_namespace n ON n.oid = c.opcnamespace
       JOIN pg_am am ON am.oid = c.opcmethod WHERE c.opcname = 'gin_trgm_ops'`,
  ),
  operator_percent_text_text: await q(
    `SELECT n.nspname AS schema, o.oprcode::text AS function FROM pg_operator o JOIN pg_namespace n ON n.oid = o.oprnamespace
      WHERE o.oprname = '%' AND o.oprleft = 'text'::regtype AND o.oprright = 'text'::regtype`,
  ),
  similarity_functions: await q(
    `SELECT n.nspname AS schema, p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname IN ('similarity', 'similarity_op', 'show_trgm', 'gin_extract_value_trgm') ORDER BY 1, 2`,
  ),
};
await client.query("ROLLBACK");
await client.end();
writeFileSync(out, JSON.stringify(r, null, 2));

const p = (k, v) => console.log(`[${label}] ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
p("server_version", r.server_version);
p("current_user / session_user / database", `${r.identity.current_user} / ${r.identity.session_user} / ${r.identity.database}`);
p("SHOW search_path", r.search_path);
p("current_schema()", r.current_schema);
p("current_schemas(true)", r.current_schemas_implicit);
p("current_schemas(false)", r.current_schemas_explicit);
p("schema named after current_user exists", r.user_named_schema_exists);
p("pg_db_role_setting (this role/db)", r.role_db_settings);
p("schema extensions", r.extensions_schema);
p("extensions installed in schema extensions", r.extensions_in_extensions_schema);
p("pg_trgm available", r.pg_trgm_available);
p("pg_trgm versions (control)", r.pg_trgm_versions);
p("pg_trgm installed", r.pg_trgm_installed);
p("role attributes", r.role);
p("role memberships", r.role_memberships);
p("privileges", r.privileges);
p("supautils settings", r.supautils);
p("preload libraries", r.preload);
p("gin_trgm_ops opclass", r.trgm_objects.gin_trgm_ops);
p("operator % (text,text)", r.trgm_objects.operator_percent_text_text);
p("similarity/show_trgm functions", r.trgm_objects.similarity_functions);
p("all installed extensions", r.installed_extensions.map((e) => `${e.name}@${e.version}:${e.schema}`).join(", "));
