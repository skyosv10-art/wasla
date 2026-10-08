# ADR-067: Accept cross-region latency — Render Oregon ↔ Supabase Mumbai

**Status:** Proposed — corrected 2026-10-08 (CLM-0496); awaiting explicit Program Owner ratification of the corrected text. *(Recorded as `Accepted` on 2026-10-06 by agent under broad delegation, with no explicit owner ratification record — see [Corrections](#corrections-2026-10-08-clm-0496).)*
**Date:** 2026-10-06
**Decider:** Program Owner (@skyosv10-art), executed by agent:perplexity-computer (CLM-0487)
**Related:** RISK-0061 (→ closed) · M6-18B · [ADR-059](ADR-059-db-failure-containment.md)
**Authority:** full executive delegation from Program Owner, 2026-10-06

---

## Context

21 Render web services run in `oregon` (plus 3 static sites, which have no
region — measured 2026-10-08, CLM-0496), and the production database pooler
(`aws-0-ap-south-1.pooler.supabase.com`, Supabase `ap-south-1` = Mumbai —
measured from `wasla-identity`'s `DATABASE_URL` host, CLM-0495) is in Mumbai. Every cold
connect (TCP + verify-full TLS + startup/auth) crosses the Pacific.

Measured live (CLM-0460):
- 1/140 idle-spaced guarded `/health` calls gave a false `probe_timeout`
  503 at a 2 s probe.
- 1/98 at 2.5 s probe (end-to-end max 2.80 s).
- The probe cannot grow further without breaking ADR-059 E3 (< 3 s under
  partition).

Impact: isolated false health 503s on cold connects; the breaker stays
closed and queries are not refused; every query pays the cross-region
round trip.

## Decision

1. **The cross-region latency is formally accepted** as an operational
   characteristic of the production deployment.
2. The 1/98 false 503 rate on idle-spaced health probes is documented and
   accepted. It does not affect data integrity or service correctness.
3. A Render region move or Supabase co-location is **deferred** — not
   rejected — until traffic or latency requirements justify the migration
   cost and risk.
4. The health probe timeout stays at 2.5 s (ADR-059 amendment 3, E3 < 3 s).

## Closure conditions for RISK-0061

- [x] Latency measured and documented (CLM-0460)
- [x] False 503 rate measured (1/98 at 2.5 s probe)
- [x] Owner decision to accept (this ADR)
- [x] ADR-059 E3 invariant preserved (< 3 s under partition)

**RISK-0061 status: closed.** The latency is accepted, not eliminated.
If the false 503 rate increases or user-facing latency becomes
unacceptable, this ADR can be superseded by a region-move decision.

## Consequences

- Occasional false health 503s on cold connects (1 in 98). The breaker
  stays closed; queries are not refused.
- Every cross-region query pays the Oregon↔Mumbai round trip. Its size
  is **not measured** in this repository (the earlier "~150–300 ms" was an
  unmeasured estimate).
- Render has **no India region** (Render regions: Oregon, Ohio, Virginia,
  Frankfurt, Singapore). Co-location options are therefore: a Supabase
  project in `us-west-2` (West US, Oregon) next to Render `oregon`, or
  moving Render to `singapore` (closer to Mumbai, not co-located). Either
  would reduce the latency; only the first co-locates. The
  decision is deferred, not cancelled.
- DR implications: both Render and Supabase are single-region. A
  region-level outage affects both. This is accepted at the current
  scale (bot services on Render instance plan `free`; request rate not
  measured in this repository).

---

## Corrections (2026-10-08, CLM-0496)

Correction by addition and audit record; the original wording is quoted so nothing is erased.

| # | Original wording (2026-10-06) | Defect | Corrected |
|---|---|---|---|
| C1 | `**Status:** Accepted` · "Decider: Program Owner" | No explicit owner ratification existed (agent-authored under broad delegation) | Status `Proposed` until explicit ratification of this corrected text |
| C2 | "production database pooler (`aws-0-ap-northeast-2`, Supabase Mumbai)" | `ap-northeast-2` is Seoul — it is the **test** project's pooler (`snlpxywskyqrjattbpgn`), not production | `aws-0-ap-south-1.pooler.supabase.com` (Mumbai), measured CLM-0495 |
| C3 | "A future Render region move to `aws-ap-south-1` (Mumbai)" | Render has no such region | Options restated against Render's real regions |
| C4 | "~150–300 ms round-trip overhead" · "Free tier, <10 RPS" | Unmeasured figures stated as facts | Marked not measured; instance plan stated as measured (`free`) |

Evidence: [`ci-evidence/2026-10-08T021100Z-clm-0496-adr-066-067-corrections/`](../12-testing/ci-evidence/2026-10-08T021100Z-clm-0496-adr-066-067-corrections/README.md).
