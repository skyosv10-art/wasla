// RISK-0056 · CLM-0413 — lock_timeout inside the SAME session that runs the DDL.
//
// Loaded with `node --import <this file> --import tsx src/db/migrate-cli.ts`
// from a service directory. It does not change any service code and does not
// change any schema.sql: it replaces `pg.Pool` (the one pg@8.23.0 instance every
// service resolves) with a subclass that
//   1. forces max = 1 and idleTimeoutMillis = 0 — the migration's pool can hold
//      exactly one physical session and never silently reconnects while idle;
//   2. on EVERY client it hands out for the first time, runs
//        SET lock_timeout = '<RISK0056_LOCK_TIMEOUT>'
//      and then reads back current_setting('lock_timeout') and pg_backend_pid()
//      ON THAT SAME CLIENT; if the value read back differs, the client is
//      destroyed and connect() rejects — so no DDL can ever run on a session
//      whose lock_timeout was not verified (fail closed);
//   3. before pool.end(), re-reads (pid, lock_timeout) through the pool, so the
//      evidence shows whether the whole migration stayed on one session.
//
// Why not PGOPTIONS / libpq `options=-c lock_timeout=…`: those are startup
// parameters and the Supabase pooler is not proven to forward them (owner
// rejected relying on them). A plain `SET` on the already-open session is an
// ordinary SQL statement — it cannot be stripped by the pooler — and in the
// Supabase session pooler (port 5432) the session is pinned to one backend.
// The proof run rejects the transaction pooler (port 6543).
//
// Evidence: one JSON line per event appended to $RISK0056_LT_EVIDENCE.
// It contains ONLY: event, service, pid, lock_timeout, ms. Never a URL, user,
// password, or SQL text.
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const WANT = process.env.RISK0056_LOCK_TIMEOUT ?? "";
const EVIDENCE = process.env.RISK0056_LT_EVIDENCE ?? "";
const SERVICE = process.env.RISK0056_SERVICE ?? "unknown";
if (!/^[1-9][0-9]{0,4}(ms|s)$/.test(WANT)) {
  console.error("lock-timeout-preload: RISK0056_LOCK_TIMEOUT must look like 2s or 2000ms — refusing to run");
  process.exit(3);
}
if (!EVIDENCE) {
  console.error("lock-timeout-preload: RISK0056_LT_EVIDENCE is required — refusing to run");
  process.exit(3);
}
// Postgres normalises what SHOW returns: '2000ms' → '2s'. Compare normalised.
const normalise = (v) => {
  const m = /^([0-9]+)(ms|s|min)?$/.exec(String(v));
  if (!m) return String(v);
  const ms = Number(m[1]) * (m[2] === "s" ? 1000 : m[2] === "min" ? 60000 : 1);
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;
};
const WANT_NORMALISED = normalise(WANT);

const record = (event) => {
  appendFileSync(EVIDENCE, `${JSON.stringify({ service: SERVICE, t: Date.now(), ...event })}\n`);
};

const require = createRequire(join(process.cwd(), "package.json"));
const pg = require("pg");
const BasePool = pg.Pool;
const READY = Symbol("risk0056.lockTimeoutVerified");

class LockTimeoutPool extends BasePool {
  constructor(config = {}) {
    super({ ...config, max: 1, idleTimeoutMillis: 0 });
    record({ event: "pool_created", pool_max: 1, requested_max: config.max ?? null });
  }

  async #verified() {
    const client = await BasePool.prototype.connect.call(this);
    if (client[READY]) return client;
    try {
      await client.query(`SET lock_timeout = '${WANT}'`);
      const { rows } = await client.query(
        "SELECT current_setting('lock_timeout') AS lock_timeout, pg_backend_pid() AS pid",
      );
      const got = rows[0]?.lock_timeout;
      if (normalise(got) !== WANT_NORMALISED) {
        record({ event: "session_rejected", pid: rows[0]?.pid ?? null, lock_timeout: got ?? null });
        throw new Error(`lock_timeout read back as ${got}, wanted ${WANT_NORMALISED} — refusing to hand out session`);
      }
      client[READY] = true;
      record({ event: "session_ready", pid: rows[0].pid, lock_timeout: got });
      return client;
    } catch (error) {
      client.release(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  connect(cb) {
    const p = this.#verified();
    if (typeof cb === "function") {
      p.then(
        (client) => cb(undefined, client, client.release),
        (error) => cb(error, undefined, () => undefined),
      );
      return undefined;
    }
    return p;
  }

  async end(...args) {
    try {
      const { rows } = await BasePool.prototype.query.call(
        this,
        "SELECT current_setting('lock_timeout') AS lock_timeout, pg_backend_pid() AS pid",
      );
      record({ event: "session_final", pid: rows[0].pid, lock_timeout: rows[0].lock_timeout });
    } catch (error) {
      record({ event: "session_final_unavailable", code: error?.code ?? null });
    }
    return super.end(...args);
  }
}

pg.Pool = LockTimeoutPool;
record({ event: "preload_active", want: WANT_NORMALISED });
