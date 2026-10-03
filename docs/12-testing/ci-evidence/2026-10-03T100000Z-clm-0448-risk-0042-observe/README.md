# CLM-0448 · RISK-0042 P3 — observe activation evidence

| File | What |
|---|---|
| `render-env-t0.json` | Render env fingerprint **before** activation: per service, per key `sha256(value)[:16]` — no value (`scripts/ops/render-env-fingerprint.py snapshot`). |
| `observe-pre-activation-24h.json` | `observe-report.py` over 2026-10-02T09:45Z → 2026-10-03T09:45Z: only uptime pings (`GET /`, `HEAD /`), no end-user request on any asserted route, no `user_assertion_*` event. |

The post-activation fingerprint (t1), its diff against t0, the boot lines and the
observe window are added by the evidence PR that follows the activation.
Plan, rollback and limits: [`docs/07-security/RISK-0042_OBSERVE_ACTIVATION.md`](../../../07-security/RISK-0042_OBSERVE_ACTIVATION.md).
RISK-0042 stays `open`.
