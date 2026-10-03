# RISK-0060 · TLS probe before the Render activation (CLM-0454) · **PASS**

| | |
|---|---|
| **When** | 2026-10-03 ~14:45 UTC, from the operator sandbox |
| **Code** | `main` `1ba2124` (CLM-0453, PR [#602](https://github.com/skyosv10-art/wasla/pull/602)): `withPgPoolDefaults` reads `WASLA_PG_SSL_MODE` / `WASLA_PG_SSL_CA` |
| **Target of the live probe** | the **test** project `snlpxywskyqrjattbpgn` (pooler `aws-0-ap-northeast-2.pooler.supabase.com:5432`). Not production. |
| **Status** | Pre-activation measurement. Production is **not** changed by this probe; RISK-0060 stays `mitigating`. |

## 1. The CA

| | |
|---|---|
| Source | Supabase-published `prod-ca-2021.crt` (`https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`), the file the dashboard's *SSL Configuration → Download certificate* serves ([Supabase docs](https://supabase.com/docs/guides/platform/ssl-enforcement)) |
| Subject = Issuer | `C=US, ST=Delware, L=New Castle, O=Supabase Inc, CN=Supabase Root 2021 CA` (self-signed root) |
| Validity | 2021-04-28 → **2031-04-26** |
| SHA-256 (DER) | `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa` |
| Stored | `infra/tls/supabase-root-2021-ca.pem` (public certificate, no secret). `render-tls-activate.py` refuses a file with any other hash. |

## 2. The chain the poolers serve (openssl, `-starttls postgres`)

| Pooler | Chain | `-CAfile` = the CA above |
|---|---|---|
| `aws-0-ap-northeast-2` (test) | `*.pooler.supabase.com` ← `Supabase Intermediate 2021 CA` ← `Supabase Root 2021 CA` | `Verify return code: 0 (ok)` |
| `aws-0-ap-south-1` (**production's pooler**, handshake only, no login) | leaf `*.pooler.supabase.com` | `Verify return code: 0 (ok)` |

## 3. node-postgres through `withPgPoolDefaults` (script: [`tlsprobe.mts`](tlsprobe.mts))

The client socket is read after connect (`connection.stream`), because `pg_stat_ssl` on
the server reports the Supavisor → Postgres leg, not ours.

| Env | Result |
|---|---|
| `WASLA_PG_SSL_MODE=off` (today's production behaviour) | connected, `encrypted: false` — **plaintext**, which is RISK-0060 |
| `verify-full` + the pinned CA | connected, `encrypted: true`, `TLSv1.3`, `authorized: true`, peer `*.pooler.supabase.com` |
| `verify-full` + a CA that did not sign the chain | **refused**: `SELF_SIGNED_CERT_IN_CHAIN` — verification is real, not decorative |

## 4. What this does not show

- Production Render services still run `off`. Activation is `risk-0060-render-tls.yml` (CLM-0454).
- Supabase "Enforce SSL" is still off on production; plaintext is still accepted by the server.

تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE".
