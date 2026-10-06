// RISK-0056 · CLM-0413 — backup stage 1: pg_dump and the row counts it is
// checked against, taken from ONE snapshot.
//
// Usage: node scripts/ops/risk-0056/snapshot-dump.mjs <dump_file> <counts.json>
// Env:   BACKUP_SOURCE_DB_URL  source database — never printed
//        WASLA_PG_SSL_MODE     off|require|verify-full (default: off)
//        WASLA_PG_SSL_CA       PEM body (required for verify-full)
//
// RISK-0060 (CLM-0482): SSL support added for the backup workflow. When the
// Supabase project enforces SSL, the Node.js client and pg_dump must both
// use SSL. This reuses the same WASLA_PG_SSL_MODE pattern as pg-guard.ts.
//
// db-backup.yml (bc5de79) compares restored row counts with counts read from
// the live database AFTER the dump; on a database taking writes those can
// differ legitimately, which is one reason it only warns. Here the counting
// transaction exports its snapshot (REPEATABLE READ, READ ONLY) and pg_dump
// runs with --snapshot=<that id>, so dump and counts describe the same instant
// and any mismatch after restore is a real defect → the guard fails.
//
// Scope: schema `public` — the only schema the 14 domain services write.
// Extensions installed in `public` are listed so the restore stage can
// pre-create them in the scratch Postgres. Nothing is written to the source.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve("services/delivery/package.json"));
const pg = require("pg");
const url = process.env.BACKUP_SOURCE_DB_URL;
const [dumpFile, countsFile] = process.argv.slice(2);
if (!url || !dumpFile || !countsFile) {
  console.error("usage: BACKUP_SOURCE_DB_URL=… snapshot-dump.mjs <dump_file> <counts.json>");
  process.exit(2);
}

// RISK-0060: build SSL config from WASLA_PG_SSL_MODE, same pattern as pg-guard.ts
function buildSslConfig(env) {
  const raw = env["WASLA_PG_SSL_MODE"];
  if (!raw || raw === "off") return {};
  if (raw !== "require" && raw !== "verify-full") {
    console.error(`WASLA_PG_SSL_MODE must be one of "off", "require", "verify-full", got ${JSON.stringify(raw)}`);
    process.exit(2);
  }
  if (raw === "require") return { ssl: { rejectUnauthorized: false } };
  const ca = env["WASLA_PG_SSL_CA"];
  if (!ca) {
    console.error("WASLA_PG_SSL_MODE=verify-full requires WASLA_PG_SSL_CA to be set to the PEM certificate body");
    process.exit(2);
  }
  return { ssl: { ca: ca.trim(), rejectUnauthorized: true } };
}

// Map WASLA_PG_SSL_MODE to PGSSLMODE for pg_dump (libpq)
function pgSslMode(env) {
  const raw = env["WASLA_PG_SSL_MODE"];
  if (!raw || raw === "off") return undefined;
  if (raw === "require") return "require";
  if (raw === "verify-full") return "verify-full";
  return undefined;
}

const sslConfig = buildSslConfig(process.env);
const pgSslModeVal = pgSslMode(process.env);

const client = new pg.Client({ connectionString: url, ...sslConfig });
await client.connect();
let failed = false;
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const snapshot = (await client.query("SELECT pg_export_snapshot() AS id")).rows[0].id;
  const tables = (
    await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
    )
  ).rows.map((r) => r.table_name);
  const counts = {};
  for (const t of tables) {
    counts[t] = (await client.query(`SELECT count(*)::bigint AS n FROM public."${t.replaceAll('"', '""')}"`)).rows[0].n;
  }
  const extensions = (
    await client.query(
      "SELECT e.extname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE n.nspname = 'public' ORDER BY 1",
    )
  ).rows.map((r) => r.extname);
  const code = await new Promise((done) => {
    const pgDumpEnv = { ...process.env };
    if (pgSslModeVal) pgDumpEnv["PGSSLMODE"] = pgSslModeVal;
    const p = spawn(
      "pg_dump",
      ["--format=custom", "--no-owner", "--no-privileges", `--snapshot=${snapshot}`, `--file=${dumpFile}`, "--dbname", url],
      { stdio: ["ignore", "ignore", "pipe"], env: pgDumpEnv },
    );
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("exit", (c) => {
      if (c !== 0) console.error(`pg_dump exit=${c} (stderr suppressed: may contain connection details; ${err.length} bytes)`);
      done(c);
    });
  });
  if (code !== 0) failed = true;
  writeFileSync(countsFile, `${JSON.stringify({ schema: "public", tables: counts, public_extensions: extensions }, null, 2)}\n`);
  console.log(`stage 1 snapshot-dump: ${code === 0 ? "ok" : "FAILED"} · public tables=${tables.length} · public extensions=${extensions.length} · ssl=${pgSslModeVal || "off"}`);
} finally {
  await client.query("COMMIT").catch(() => undefined);
  await client.end();
}
if (failed) process.exit(1);
