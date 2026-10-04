# RISK-0060 · Render TLS activation, attempt 1 (CLM-0456) · **ROLLED BACK**

| | |
|---|---|
| **Code** | `main` `5d00b14` (CLM-0455, PR [#604](https://github.com/skyosv10-art/wasla/pull/604)); main CI and Render deploy green; 17/17 DB services live on `5d00b14` |
| **Tool** | `.github/workflows/risk-0060-render-tls.yml` → `scripts/ops/risk-0060/render-tls-activate.py` |
| **Verdict** | The activation itself PASSED its own gates, but an independent measurement found a readiness regression, so production was **rolled back to the previous state** (no TLS keys). RISK-0060 stays `mitigating`. |

## Runs

| Run | Mode | UTC | Result |
|---|---|---|---|
| [37165498573](https://github.com/skyosv10-art/wasla/actions/runs/37165498573) | plan | 00:37:11 → 00:37:31 | PASS — 17 targets, every DB variable on `ppixaauyqoykrogwdxtv`, all live on `5d00b14` |
| [37165603988](https://github.com/skyosv10-art/wasla/actions/runs/37165603988) | apply | 00:39:17 → 00:41:24 | PASS — 34 variables set on 17 services in 3.7 s; 17/17 deploys `live` pinned to `5d00b14`; 17/17 `/health` 200 and delivery readiness database ok after **106.4 s**; fingerprint: 34 keys changed, 0 unexpected, 0 missing |
| [37166240967](https://github.com/skyosv10-art/wasla/actions/runs/37166240967) | rollback | 00:51:44 → 00:53:43 | PASS — both keys removed from 17 services, 17/17 redeployed on `5d00b14`, healthy |

## Independent measurement after apply (operator sandbox, 00:41–00:50 UTC)

| Probe | Result |
|---|---|
| Render env, hash per key | 17/17 DB services carry `WASLA_PG_SSL_MODE`=`verify-full` and `WASLA_PG_SSL_CA`=the pinned CA (hash match); 0 non-DB services touched |
| `/health` on the 17 services | 17/17 200 |
| `/delivery/ready`, 20 calls 3 s apart | 20/20 200 |
| `/delivery/ready`, 12 calls **15 s apart** (longer than pg's 10 s idle timeout, so each call needs a new connection) | **12/12 503**, `database: probe_timeout` |

## Control after rollback (same probe, plaintext)

| Probe | Result |
|---|---|
| Render env | 24 services, 0 with a TLS key |
| `/delivery/ready`, 10 calls 15 s apart | **10/10 200** (2.28–2.46 s end to end from the sandbox) |

## Root cause

- Every idle-spaced probe opens a new connection. With TLS that is one SSLRequest and one handshake more, from Render (Oregon) to the production pooler (`aws-0-ap-south-1`, Mumbai).
- Sandbox measurement against the test pooler, cold connect + `SELECT 1`, 6 runs each: **median 954 ms in clear, 1293 ms with verify-full** (+~340 ms).
- Delivery's readiness race was **1.5 s** and the shared guard probe (ADR-059) **2 s**. Both are shorter than the pool's own connect bound (**5 s**), so a reachable database was reported "down". The guard probe's false "down" also counts against the circuit breaker (5 failures open it for 30 s), so the risk was not limited to dashboards.
- The workflow's own health gate ran right after deploys, on warm connections, so it could not see this. That is why the measurement was repeated with idle gaps.

## Fix (CLM-0456)

Probe bound = the pool's connect bound + the query bound, in both probes (`probeBoundMs` in `@wasla/resilience`, `connectBoundMs` in delivery). Both stay finite, so a hanging database is still reported "down" in bounded time. ADR-059 is amended by addition. Re-activation follows the merge, and the idle-gap probe becomes part of the acceptance.

تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE".
