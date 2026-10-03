import pg from "pg";
import { readFileSync } from "node:fs";
import { withPgPoolDefaults } from "@wasla/resilience";
const url = process.env.TEST_URL!;
const ca = readFileSync("infra/tls/supabase-root-2021-ca.pem", "utf8");
async function run(label: string, env: Record<string, string>) {
  const pool = new pg.Pool(withPgPoolDefaults({ connectionString: url, max: 1 }, env));
  try {
    const c: any = await pool.connect();
    const s: any = c.connection.stream;
    await c.query("select 1");
    console.log(label, "OK", JSON.stringify({ encrypted: !!s.encrypted, protocol: s.getProtocol?.() ?? null, authorized: s.authorized ?? null, peerCN: s.getPeerCertificate?.()?.subject?.CN ?? null }));
    c.release();
  } catch (e: any) { console.log(label, "FAIL", e.code ?? "", String(e.message).slice(0, 120)); }
  await pool.end();
}
await run("off        ", { WASLA_PG_SSL_MODE: "off" });
await run("verify-full", { WASLA_PG_SSL_MODE: "verify-full", WASLA_PG_SSL_CA: ca });
// negative: a CA that did not sign the server chain must be refused
const wrong = readFileSync("/etc/ssl/certs/ca-certificates.crt", "utf8").split("-----END CERTIFICATE-----")[0] + "-----END CERTIFICATE-----";
await run("wrong-ca   ", { WASLA_PG_SSL_MODE: "verify-full", WASLA_PG_SSL_CA: wrong });
