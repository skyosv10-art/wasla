# CLM-0448 · RISK-0042 P3 — observe activation evidence

| File | What |
|---|---|
| `render-env-t0.json` | Render env fingerprint **before** activation: per service, per key `sha256(value)[:16]` — no value (`scripts/ops/render-env-fingerprint.py snapshot`). |
| `observe-pre-activation-24h.json` | `observe-report.py` over 2026-10-02T09:45Z → 2026-10-03T09:45Z: only uptime pings (`GET /`, `HEAD /`), no end-user request on any asserted route, no `user_assertion_*` event. |

## Activation (2026-10-03, CLM-0451 records it)

| File | What |
|---|---|
| `render-env-t0b-pre-activation.json` | Fingerprint right before activation; diff against `render-env-t0.json`: **0 changes** |
| `render-env-t1-post-activation.json` · `render-env-diff-t0b-t1.txt` | After activation: **exactly 7 keys added, none changed or removed**: identity `WASLA_USER_ASSERTION_SIGNING_KEY`; negotiations, matching, marketplace `WASLA_USER_ASSERTION_PUBLIC_KEYS` + `WASLA_USER_ASSERTION_MODE` |
| `boot-lines.json` | 10:24:01–10:24:05Z on `e29619f`: identity `user_assertion_signer enabled=true kid=ua-2026-10`; the three receivers `user_assertion_config mode=observe kids=[ua-2026-10]` |
| `render-env-t2-after-dr-runs.json` | After the two M6-18B DR runs (12:32Z): diff against t1 **0 changes**, so observe stays configured |
| `observe-window-1.json` | `observe-report.py` 10:23:23Z → 12:32:34Z (2 h 9 min) |

- **Key:** Ed25519, kid `ua-2026-10`. Generated in the operator sandbox with
  `umask 077`, set through the Render API, then `shred -u`. It was never printed,
  committed or logged. Render is the only store. Rotation without downtime is
  lifecycle §5.
- **Deploys:** the four services were redeployed pinned to the live commit
  `e29619f`. All `live`, `/health` 200, delivery readiness database ok.
- **Rollback:** delete the 7 keys (or set `WASLA_USER_ASSERTION_MODE=off`), redeploy.
- **enforce:** not set anywhere.

## Observe result (window 1)

| Service | Non-health traffic | valid | invalid | would_reject (ownership) | issued |
|---|---|---|---|---|---|
| negotiations | 14 (uptime pings `GET /`, `HEAD /`) | 0 | 0 | 0 | — |
| matching | 14 (same) | 0 | 0 | 0 | — |
| marketplace | 14 (same) | 0 | 0 | 0 | — |
| identity | 12 (same) | — | — | — | 0 |

**No request was rejected** (observe cannot reject, and none would have been).
**No operation is identified as failing**, because **no end-user request reached any
asserted route**: the platform has no users on it yet. The silence measures the
absence of traffic, not enforce readiness. Before enforce can be considered, each
asserted route needs real (or owner-approved synthetic) end-user traffic with
`invalid = 0` and `would_reject = 0`. RISK-0042 stays `open`.
Plan, rollback and limits: [`docs/07-security/RISK-0042_OBSERVE_ACTIVATION.md`](../../../07-security/RISK-0042_OBSERVE_ACTIVATION.md).
RISK-0042 stays `open`.
