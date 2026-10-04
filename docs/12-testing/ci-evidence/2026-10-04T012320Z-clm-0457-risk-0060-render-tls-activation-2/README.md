# RISK-0060 · Render TLS activation, attempt 2 (CLM-0457) · **PASS — live**

| | |
|---|---|
| **Code** | `main` `0eec83e` (CLM-0456, PR [#605](https://github.com/skyosv10-art/wasla/pull/605): probe bounds cover connection acquisition). Main CI run 37167287300 and Render deploy run 37167287291 both green |
| **Run** | [37167859053](https://github.com/skyosv10-art/wasla/actions/runs/37167859053), `risk-0060-render-tls.yml` mode=apply, 01:23:20 → 01:25:29 UTC |
| **Attempt 1** | [`…-activation-1/`](../2026-10-04T003917Z-clm-0456-risk-0060-render-tls-activation-1/README.md): rolled back after idle-spaced readiness went 12/12 503 |
| **Status** | Render → Supabase traffic now uses **verified TLS** on all 17 DB-backed services. RISK-0060 stays `mitigating`: the server still accepts plaintext because Enforce SSL is not on. |

## Workflow gates

| Stage | Measured |
|---|---|
| Set | 34 variables (`WASLA_PG_SSL_MODE=verify-full`, `WASLA_PG_SSL_CA`=pinned Supabase Root 2021 CA) on 17 services in 3.6 s |
| Deploy | 17/17 `live`, pinned to `0eec83e` |
| Health | 17/17 `/health` 200 + delivery `/delivery/ready` database ok after **108.2 s** |
| Fingerprint | 34 keys changed, **0 unexpected, 0 missing** |

## Independent acceptance (operator sandbox, after the run)

| Probe | Attempt 1 (old bounds, TLS) | Control (clear) | **Attempt 2 (new bounds, TLS)** |
|---|---|---|---|
| `/delivery/ready`, calls 15 s apart (each needs a new connection) | 12/12 503 `probe_timeout` | 10/10 200, 2.28–2.46 s | **14/14 200**, database ok, 2.76–2.94 s |
| `/health` on all 17 DB services, 2 rounds 20 s apart (each runs the guarded `SELECT 1` probe) | — | — | **34/34 200** |
| Render env hashes | — | 0 TLS keys | **17/17** carry verify-full + the pinned CA; 0 non-DB services touched |

End-to-end cost of TLS on a cold connect, as seen from the sandbox: about +0.45 s on readiness (2.35 s → 2.83 s median). Warm requests are unaffected.

Why "healthy" here means "TLS-verified": with `ssl` set, node-postgres sends an SSLRequest first and fails if the server declines it. With `rejectUnauthorized: true` it also fails on any chain the pinned CA did not sign, as the probe in [`…-tls-probe/`](../2026-10-03T150000Z-clm-0454-risk-0060-tls-probe/README.md) showed with a wrong CA (`SELF_SIGNED_CERT_IN_CHAIN`). A service that answers a guarded `SELECT 1` is therefore on a verified TLS connection.

## Remaining for RISK-0060

- Supabase "Enforce SSL" on `ppixaauyqoykrogwdxtv`, then a measurement that plaintext is refused. This needs a token with `database_ssl_config_write` on production, or the owner's dashboard toggle. The available token sees only the test project.
- Rollback, if ever needed: `risk-0060-render-tls.yml` mode=rollback (measured PASS in attempt 1, run 37166240967).

تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE".
