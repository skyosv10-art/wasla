/**
 * M6-18B · CLM-0436: service-level check on the replacement project.
 *
 * After replacement-restore.sh has restored production's stored backup into the
 * replacement project, this script starts the unchanged billing service
 * (services/billing/src/http/server.ts) as a local child process, with
 * BILLING_DATABASE_URL pointing at the replacement. It then measures the time from
 * process start to the first DB-backed answer: GET /billing/invoices/<unknown id> must
 * return 404 BILLING_INVOICE_NOT_FOUND, which only a working query can produce.
 *
 * Render and production are not touched. The URL comes from DR_REPLACEMENT_DB_URL, is
 * passed to the child only, and is never printed.
 * Run: ./services/audit/node_modules/.bin/tsx scripts/ops/m6-18b-dr/service-on-replacement.mts
 */

import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

import { keyRegistryFromEnv, mintServiceToken, SERVICE_AUTH_HEADER } from "../../../packages/service-auth/src/index.ts";

const url = process.env.DR_REPLACEMENT_DB_URL;
if (!url) {
  process.stderr.write("DR_REPLACEMENT_DB_URL is required\n");
  process.exit(2);
}
// node-postgres treats sslmode=require as verify-full, and the Supavisor chain is not in
// Node's trust store; libpq semantics (encrypted, not CA-verified) match what psql and
// pg_restore used for the restore.
const serviceUrl = url.includes("uselibpqcompat=") ? url : url.replace("sslmode=require", "uselibpqcompat=true&sslmode=require");
const PORT = Number(process.env.DR_SERVICE_PORT ?? "18092");
const secret = randomBytes(32).toString("hex");
const env = { WASLA_SERVICE_AUTH_KEYS: `dr1:active:${secret}`, WASLA_SERVICE_AUTH_ACTIVE_KID: "dr1" };
const keys = keyRegistryFromEnv(env);

const t0 = performance.now();
const child = spawn("./services/audit/node_modules/.bin/tsx", ["services/billing/src/http/server.ts"], {
  env: {
    PATH: process.env.PATH ?? "",
    NODE_ENV: "development",
    PORT: String(PORT),
    BILLING_DATABASE_URL: serviceUrl,
    WASLA_SERVICE_TOKEN_REPLAY_MODE: "memory",
    ...env,
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let stderr = "";
child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));

let listeningMs: number | null = null;
let firstDbAnswerMs: number | null = null;
let last: { status: number | string; code?: string } = { status: "none" };
for (let i = 0; i < 120 && firstDbAnswerMs === null; i++) {
  if (child.exitCode !== null) break;
  try {
    if (listeningMs === null) {
      const h = await fetch(`http://127.0.0.1:${PORT}/billing/health`);
      if (h.ok) listeningMs = Math.round(performance.now() - t0);
    }
    if (listeningMs !== null) {
      const path = `/billing/invoices/${randomUUID()}`;
      const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
        headers: {
          [SERVICE_AUTH_HEADER]: mintServiceToken({
            serviceName: "orders",
            audience: "billing",
            scopes: ["billing:invoice:read"],
            method: "GET",
            path,
            keys,
            now: new Date(),
          }),
        },
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string }; code?: string };
      last = { status: res.status, code: body.error?.code ?? body.code };
      if (res.status === 404 && last.code === "BILLING_INVOICE_NOT_FOUND") {
        firstDbAnswerMs = Math.round(performance.now() - t0);
      }
    }
  } catch {
    /* not listening yet */
  }
  if (firstDbAnswerMs === null) await new Promise((r) => setTimeout(r, 250));
}
child.kill("SIGTERM");

const record = {
  check: "billing service on the replacement project",
  listening_ms: listeningMs,
  first_db_backed_answer_ms: firstDbAnswerMs,
  last_answer: last,
  result: firstDbAnswerMs !== null ? "PASS" : "FAIL",
  stderr_first_error: stderr
    .split("\n")
    .filter((l) => /Error/.test(l))
    .slice(0, 2)
    .map((l) => l.replace(/postgres(ql)?:\/\/\S+/g, "<url>").slice(0, 200)),
};
process.stdout.write(`${JSON.stringify(record)}\n`);
process.exit(firstDbAnswerMs !== null ? 0 : 1);
