// RISK-0056 · CLM-0413 — behavioural proof that lock_timeout is live INSIDE the
// migration session (TEST database only; guard-test-db.py runs first).
//
// Usage: node scripts/ops/risk-0056/lock-timeout-proof.mjs <out.json>
// Env:   RISK0056_DB_URL  TEST database — never printed
//
// 1. Baseline: a fresh session's lock_timeout (expected the server default '0'
//    = wait forever) and how many role/database settings mention lock_timeout.
// 2. Holder session: BEGIN; LOCK TABLE public.search_product_index IN ACCESS
//    EXCLUSIVE MODE (the table exists on the TEST DB since CLM-0410).
// 3. The REAL search migration (`src/db/migrate-cli.ts`, unchanged) is started
//    with the preload. Its schema.sql reaches `CREATE INDEX IF NOT EXISTS … ON
//    search_product_index`, which needs a SHARE lock → blocks on the holder.
// 4. An observer reads pg_stat_activity for the pid the preload recorded as the
//    migration session: it must be waiting on a Lock.
// 5. Expected: the migration fails with SQLSTATE 55P03 (lock_not_available)
//    ≈2 s after blocking — not hang. Its BEGIN…COMMIT is rolled back by
//    Postgres; the holder then rolls back too. Nothing persists.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve("services/search/package.json"));
const pg = require("pg");
const url = process.env.RISK0056_DB_URL;
if (!url) throw new Error("RISK0056_DB_URL is required");
const out = process.argv[2] ?? "lock-timeout-proof.json";
const evidence = resolve("out/lt-negative.jsonl");
rmSync(evidence, { force: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const result = { stage: "negative-lock-test", table: "public.search_product_index" };

const baseline = new pg.Client({ connectionString: url });
await baseline.connect();
result.baseline_fresh_session_lock_timeout = (await baseline.query("SELECT current_setting('lock_timeout') AS v")).rows[0].v;
result.role_or_db_settings_mentioning_lock_timeout = (
  await baseline.query(
    "SELECT count(*)::int AS n FROM pg_db_role_setting WHERE array_to_string(setconfig, ',') ILIKE '%lock_timeout%'",
  )
).rows[0].n;
const indexesBefore = (
  await baseline.query("SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='public' AND tablename='search_product_index'")
).rows[0].n;

const holder = new pg.Client({ connectionString: url });
await holder.connect();
await holder.query("SET idle_in_transaction_session_timeout = '120s'");
await holder.query("BEGIN");
await holder.query("LOCK TABLE public.search_product_index IN ACCESS EXCLUSIVE MODE");
result.holder_pid = (await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;

const started = Date.now();
const child = spawn(
  "pnpm",
  [
    "--silent", "--filter", "@wasla/search-service", "exec",
    "node", "--import", resolve("scripts/ops/risk-0056/lock-timeout-preload.mjs"), "--import", "tsx", "src/db/migrate-cli.ts",
  ],
  {
    env: {
      ...process.env,
      DATABASE_URL: url,
      RISK0056_LOCK_TIMEOUT: "2s",
      RISK0056_LT_EVIDENCE: evidence,
      RISK0056_SERVICE: "search",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let stderr = "";
child.stderr.on("data", (d) => { stderr += d; });
child.stdout.on("data", () => undefined);
const exited = new Promise((r) => child.on("exit", (code) => r(code)));

// Observe the migration session while it is blocked.
let migrationPid = null;
let observed = null;
for (let i = 0; i < 200 && observed === null; i += 1) {
  if (migrationPid === null && existsSync(evidence)) {
    const ready = readFileSync(evidence, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.event === "session_ready");
    if (ready) migrationPid = ready.pid;
  }
  if (migrationPid !== null) {
    const { rows } = await baseline.query(
      "SELECT wait_event_type, state FROM pg_stat_activity WHERE pid = $1",
      [migrationPid],
    );
    if (rows[0]?.wait_event_type === "Lock") observed = { wait_event_type: "Lock", state: rows[0].state, after_ms: Date.now() - started };
  }
  await sleep(50);
}
const killer = setTimeout(() => child.kill("SIGKILL"), 60000);
const code = await exited;
clearTimeout(killer);
result.migration_elapsed_ms = Date.now() - started;
await holder.query("ROLLBACK");
await holder.end();

const events = existsSync(evidence) ? readFileSync(evidence, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
const ready = events.find((e) => e.event === "session_ready");
result.migration_exit_code = code;
result.migration_session_pid = ready?.pid ?? null;
result.migration_session_lock_timeout = ready?.lock_timeout ?? null;
result.observed_while_blocked = observed;
result.sqlstate_55P03_reported = /55P03|lock timeout/i.test(stderr);
result.indexes_before = indexesBefore;
result.indexes_after = (
  await baseline.query("SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='public' AND tablename='search_product_index'")
).rows[0].n;
await baseline.end();

result.pass =
  result.baseline_fresh_session_lock_timeout === "0" &&
  result.migration_session_lock_timeout === "2s" &&
  result.observed_while_blocked?.wait_event_type === "Lock" &&
  result.migration_exit_code !== 0 &&
  result.sqlstate_55P03_reported === true &&
  result.migration_session_pid !== result.holder_pid &&
  result.indexes_before === result.indexes_after;

writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
if (!result.pass) process.exit(1);
